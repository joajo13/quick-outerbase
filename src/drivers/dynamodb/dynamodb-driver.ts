import { ColumnType } from "@outerbase/sdk-transform";
import {
  BaseDriver,
  ColumnTypeSelector,
  DatabaseResultSet,
  DatabaseSchemaChange,
  DatabaseSchemaItem,
  DatabaseSchemas,
  DatabaseTableColumn,
  DatabaseTableIndex,
  DatabaseTableOperation,
  DatabaseTableOperationReslt,
  DatabaseTableSchema,
  DatabaseTableSchemaChange,
  DatabaseTriggerSchema,
  DatabaseValue,
  DatabaseViewSchema,
  DriverFlags,
  SelectFromTableOptions,
} from "../base-driver";
// DynamoQueryable es creado por el Agente B (database/dynamodb-queryable).
// Lo importamos por path acordado; existirá al compilar.
import { DynamoQueryable } from "../database/dynamodb-queryable";
import {
  columnTypeSelector,
  inferTypeFromHeader,
  inferType,
  DynamoDBAttributeType,
} from "./dynamodb-type";
import { itemsToResultSet, extractAttributeNames } from "./convert-result";

// ---------------------------------------------------------------------------
// Tipos auxiliares de la API de DynamoDB (respuestas del proxy)
// ---------------------------------------------------------------------------

interface DynamoKeySchemaElement {
  AttributeName: string;
  KeyType: "HASH" | "RANGE";
}

interface DynamoAttributeDefinition {
  AttributeName: string;
  AttributeType: "S" | "N" | "B";
}

interface DynamoIndexKeyProjection {
  KeySchema: DynamoKeySchemaElement[];
  IndexName: string;
}

interface DynamoTableDescription {
  TableName: string;
  KeySchema: DynamoKeySchemaElement[];
  AttributeDefinitions: DynamoAttributeDefinition[];
  GlobalSecondaryIndexes?: DynamoIndexKeyProjection[];
  LocalSecondaryIndexes?: DynamoIndexKeyProjection[];
}

interface ListTablesResult {
  TableNames: string[];
  LastEvaluatedTableName?: string;
}

interface DescribeTableResult {
  Table: DynamoTableDescription;
}

interface ScanResult {
  Items: Record<string, unknown>[];
  Count?: number;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Dado el KeySchema y AttributeDefinitions de una tabla DynamoDB,
 * devuelve las columnas mínimas (solo key attributes) con sus tipos correctos.
 */
function buildKeyColumns(
  keySchema: DynamoKeySchemaElement[],
  attrDefs: DynamoAttributeDefinition[]
): DatabaseTableColumn[] {
  const typeMap: Record<string, string> = {};
  for (const def of attrDefs) {
    typeMap[def.AttributeName] = def.AttributeType;
  }

  // HASH primero, luego RANGE
  const sorted = [...keySchema].sort((a, b) => {
    if (a.KeyType === "HASH") return -1;
    if (b.KeyType === "HASH") return 1;
    return 0;
  });

  return sorted.map((k) => ({
    name: k.AttributeName,
    type: typeMap[k.AttributeName] ?? "S",
    pk: true,
  }));
}

/**
 * Extrae el array de nombres de pk a partir del KeySchema.
 * Garantiza que nunca quede vacío: si por algún motivo no hay KeySchema,
 * retorna [] y loguea un warning.
 */
function extractPk(
  tableName: string,
  keySchema: DynamoKeySchemaElement[]
): string[] {
  if (!keySchema || keySchema.length === 0) {
    console.warn(`DynamoDB: tabla ${tableName} sin KeySchema — pk quedará vacío`);
    return [];
  }

  const hash = keySchema.find((k) => k.KeyType === "HASH");
  const range = keySchema.find((k) => k.KeyType === "RANGE");

  const pk: string[] = [];
  if (hash) pk.push(hash.AttributeName);
  if (range) pk.push(range.AttributeName);
  return pk;
}

/**
 * Construye los DatabaseTableIndex a partir de GSI y/o LSI de una tabla.
 */
function buildIndexes(table: DynamoTableDescription): DatabaseTableIndex[] {
  const indexes: DatabaseTableIndex[] = [];

  const mapIndex = (idx: DynamoIndexKeyProjection): DatabaseTableIndex => ({
    name: idx.IndexName,
    columns: idx.KeySchema.map((k) => k.AttributeName),
    unique: false,
    primary: false,
  });

  for (const gsi of table.GlobalSecondaryIndexes ?? []) {
    indexes.push(mapIndex(gsi));
  }
  for (const lsi of table.LocalSecondaryIndexes ?? []) {
    indexes.push(mapIndex(lsi));
  }

  return indexes;
}

// ---------------------------------------------------------------------------
// DynamoDriver
// ---------------------------------------------------------------------------

/**
 * DynamoDriver — Wave 1.
 *
 * Implementa la interfaz BaseDriver para DynamoDB conectado a través de un
 * proxy passthrough server-side (DynamoQueryable).
 *
 * Wave 1 implementa: schemas() y tableSchema() reales.
 * Las waves posteriores completan: query(), selectTable(), updateTableData(), etc.
 */
export class DynamoDriver extends BaseDriver {
  protected _db: DynamoQueryable;

  constructor(queryable: DynamoQueryable) {
    super();
    this._db = queryable;
  }

  // -------------------------------------------------------------------------
  // Flags
  // -------------------------------------------------------------------------

  getFlags(): DriverFlags {
    return {
      dialect: "dynamodb",
      defaultSchema: "default",
      optionalSchema: true,
      supportBigInt: false,
      supportCreateUpdateTable: true,
      supportModifyColumn: false,
      supportInsertReturning: true,
      supportUpdateReturning: true,
      supportRowId: false,
      supportCreateUpdateDatabase: false,
      supportCreateUpdateTrigger: false,
      supportUseStatement: false,
    };
  }

  // -------------------------------------------------------------------------
  // Implementaciones triviales / no-op seguros
  // -------------------------------------------------------------------------

  columnTypeSelector: ColumnTypeSelector = columnTypeSelector;

  getCollationList(): string[] {
    return [];
  }

  close(): void {
    // no-op: DynamoQueryable es stateless (HTTP)
  }

  getCurrentSchema(): Promise<string | null> {
    return Promise.resolve(null);
  }

  escapeId(id: string): string {
    // DynamoDB no usa comillas de escape SQL estándar; devolvemos el id tal cual.
    return id;
  }

  // -------------------------------------------------------------------------
  // Wave 1: schemas() — lista todas las tablas con su PK/SK e índices
  // -------------------------------------------------------------------------

  async schemas(): Promise<DatabaseSchemas> {
    // 1. Listar todas las tablas, paginando si hay más de 100
    const tableNames: string[] = [];
    let lastEvaluatedTableName: string | undefined;

    do {
      const params: Record<string, unknown> = {};
      if (lastEvaluatedTableName) {
        params.ExclusiveStartTableName = lastEvaluatedTableName;
      }

      const listResult = (await this._db.exec("ListTables", params)) as ListTablesResult;
      tableNames.push(...(listResult.TableNames ?? []));
      lastEvaluatedTableName = listResult.LastEvaluatedTableName;
    } while (lastEvaluatedTableName);

    // 2. Describir todas las tablas en paralelo
    const descriptions = await Promise.all(
      tableNames.map(async (tableName): Promise<DatabaseSchemaItem> => {
        try {
          const descResult = (await this._db.exec("DescribeTable", {
            TableName: tableName,
          })) as DescribeTableResult;

          const table = descResult.Table;
          const pk = extractPk(tableName, table.KeySchema ?? []);
          const keyColumns = buildKeyColumns(
            table.KeySchema ?? [],
            table.AttributeDefinitions ?? []
          );
          const indexes = buildIndexes(table);

          const tableSchema: DatabaseTableSchema = {
            schemaName: "default",
            tableName,
            columns: keyColumns,
            pk,
            autoIncrement: false,
            indexes,
          };

          return {
            type: "table",
            name: tableName,
            schemaName: "default",
            tableSchema,
          };
        } catch (err) {
          // Si DescribeTable falla para una tabla específica, no bloqueamos el resto
          console.error(`DynamoDB: DescribeTable falló para ${tableName}:`, err);
          return {
            type: "table",
            name: tableName,
            schemaName: "default",
          };
        }
      })
    );

    // 3. Un único schema sintético "default" que contiene todas las tablas
    return {
      default: descriptions,
    };
  }

  // -------------------------------------------------------------------------
  // Wave 1: tableSchema() — schema detallado de una tabla + muestreo Scan
  // -------------------------------------------------------------------------

  async tableSchema(
    _schemaName: string,
    tableName: string
  ): Promise<DatabaseTableSchema> {
    // 1. Describe la tabla para obtener PK/SK e índices firmes
    const descResult = (await this._db.exec("DescribeTable", {
      TableName: tableName,
    })) as DescribeTableResult;

    const table = descResult.Table;
    const pk = extractPk(tableName, table.KeySchema ?? []);
    const keyColumns = buildKeyColumns(
      table.KeySchema ?? [],
      table.AttributeDefinitions ?? []
    );
    const indexes = buildIndexes(table);

    // Nombres de los atributos de clave (garantizados en el schema)
    const keyAttrNames = keyColumns.map((c) => c.name);
    const keyAttrSet = new Set(keyAttrNames);

    // 2. Scan limitado para muestrear atributos no-clave (DynamoDB es schemaless)
    let sampledItems: Record<string, unknown>[] = [];
    try {
      const scanResult = (await this._db.exec("Scan", {
        TableName: tableName,
        Limit: 30,
      })) as ScanResult;
      sampledItems = scanResult.Items ?? [];
    } catch (err) {
      // Si el Scan falla (permisos, etc.), degradamos elegante con solo las key attrs
      console.warn(
        `DynamoDB: Scan falló para ${tableName} — schema solo con key attributes:`,
        err
      );
    }

    // 3. Construir columnas: keys primero + atributos extra muestreados
    const extraAttrNames = extractAttributeNames(sampledItems).filter(
      (name) => !keyAttrSet.has(name)
    );

    // Inferir tipo de los atributos extra desde los items muestreados
    const extraColumns: DatabaseTableColumn[] = extraAttrNames.map((attrName) => {
      // Buscar el primer valor no-null para este atributo en los items muestreados
      let inferredType: DynamoDBAttributeType = "S";
      for (const item of sampledItems) {
        const val = item[attrName];
        if (val !== null && val !== undefined) {
          inferredType = inferDynamoTypeFromValue(val);
          break;
        }
      }
      return {
        name: attrName,
        type: inferredType,
        pk: false,
      };
    });

    const columns: DatabaseTableColumn[] = [...keyColumns, ...extraColumns];

    return {
      schemaName: "default",
      tableName,
      columns,
      pk,
      autoIncrement: false,
      indexes,
    };
  }

  // -------------------------------------------------------------------------
  // Métodos delegados a helpers
  // -------------------------------------------------------------------------

  inferTypeFromHeader(header?: DatabaseTableColumn): ColumnType | undefined {
    return inferTypeFromHeader(header);
  }

  // -------------------------------------------------------------------------
  // Stubs — waves posteriores
  // -------------------------------------------------------------------------

  escapeValue(_value: unknown): string {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  query(_stmt: string): Promise<DatabaseResultSet> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  batch(_stmts: string[]): Promise<DatabaseResultSet[]> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  transaction(_stmts: string[]): Promise<DatabaseResultSet[]> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  trigger(
    _schemaName: string,
    _name: string
  ): Promise<DatabaseTriggerSchema> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  findFirst(
    _schemaName: string,
    _tableName: string,
    _key: Record<string, DatabaseValue>
  ): Promise<DatabaseResultSet> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  // -------------------------------------------------------------------------
  // Wave 2: selectTable() — primera página de items para la grilla
  // -------------------------------------------------------------------------

  async selectTable(
    schemaName: string,
    tableName: string,
    options: SelectFromTableOptions
  ): Promise<{ data: DatabaseResultSet; schema: DatabaseTableSchema }> {
    // 1. Schema (PK/SK + atributos muestreados). Reusa tableSchema(), que ya
    //    hace DescribeTable + Scan de muestreo y degrada elegante.
    const schema = await this.tableSchema(schemaName, tableName);
    const keyAttributes = schema.pk;

    // 2. Scan de la primera página. DynamoDB NO tiene offset numérico: para la
    //    Wave 2 traemos solo la primera página de `Limit` items. La paginación
    //    fina ("load more" vía LastEvaluatedKey) queda como TODO.
    const limit = options.limit && options.limit > 0 ? options.limit : 100;

    let items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    try {
      const scanResult = (await this._db.exec("Scan", {
        TableName: tableName,
        Limit: limit,
      })) as ScanResult & { LastEvaluatedKey?: Record<string, unknown> };

      items = scanResult.Items ?? [];
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } catch (err) {
      // Degradación elegante: si el Scan falla (permisos, tabla vacía de
      // permisos, etc.) devolvemos un resultset vacío con solo las key columns
      // en vez de crashear la grilla.
      console.warn(
        `DynamoDB: Scan falló para ${tableName} en selectTable — grilla vacía:`,
        err
      );
    }

    // 3. Transformar items → DatabaseResultSet (reusa la lógica pura de Wave 1).
    //    itemsToResultSet garantiza keyAttributes primero en los headers y
    //    rellena con null las celdas ausentes (DynamoDB es sparse).
    const data = itemsToResultSet(items, { keyAttributes });

    // Si el Scan devolvió 0 items, itemsToResultSet igual arma headers a partir
    // de keyAttributes (PK/SK) → la grilla muestra columnas pero 0 filas.

    // TODO (Wave futura "load more"): exponer lastEvaluatedKey como cursor
    // opaco para paginación. Por ahora solo lo logueamos si existe.
    if (lastEvaluatedKey) {
      console.info(
        `DynamoDB: ${tableName} tiene más items (LastEvaluatedKey presente) — "load more" pendiente.`
      );
    }

    return { data, schema };
  }

  updateTableData(
    _schemaName: string,
    _tableName: string,
    _ops: DatabaseTableOperation[],
    _validateSchema?: DatabaseTableSchema
  ): Promise<DatabaseTableOperationReslt[]> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  dropTable(_schemaName: string, _tableName: string): Promise<void> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  emptyTable(_schemaName: string, _tableName: string): Promise<void> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  createUpdateTableSchema(_change: DatabaseTableSchemaChange): string[] {
    // OJO: el SchemaEditorTab llama esto en un useMemo durante el render para
    // generar el "preview script". Si tiramos acá, el render del tab explota y
    // React reintenta en loop (freeze sin "Maximum update depth"). Devolvemos un
    // preview vacío; la generación real de CreateTable/UpdateTable es Wave 4.
    return [];
  }

  createUpdateDatabaseSchema(_change: DatabaseSchemaChange): string[] {
    // Igual que arriba: se evalúa en render, no debe tirar. DynamoDB no tiene
    // schemas SQL, así que no hay script que generar.
    return [];
  }

  createTrigger(_trigger: DatabaseTriggerSchema): string {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  dropTrigger(_schemaName: string, _name: string): string {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  createView(_view: DatabaseViewSchema): string {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  dropView(_schemaName: string, _name: string): string {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  view(_schemaName: string, _name: string): Promise<DatabaseViewSchema> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }
}

// ---------------------------------------------------------------------------
// Helper privado (también usado en convert-result a través de la misma lógica)
// ---------------------------------------------------------------------------

function inferDynamoTypeFromValue(value: unknown): DynamoDBAttributeType {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return "BOOL";
  if (typeof value === "number") return "N";
  if (typeof value === "string") return "S";
  if (typeof value === "object" && !Array.isArray(value)) return "M";
  if (Array.isArray(value)) return "L";
  return "S";
}
