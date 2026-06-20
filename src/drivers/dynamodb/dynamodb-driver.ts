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

  async query(stmt: string): Promise<DatabaseResultSet> {
    const trimmed = stmt.trim();

    // ¿Es un statement control-plane JSON ({ __dynamo, params })?
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as {
          __dynamo?: string;
          params?: Record<string, unknown>;
        };
        if (parsed && parsed.__dynamo) {
          await this._db.exec(parsed.__dynamo, parsed.params ?? {});
          return itemsToResultSet([], { keyAttributes: [] });
        }
      } catch {
        // No era JSON válido → lo tratamos como PartiQL más abajo.
      }
    }

    // PartiQL
    const res = (await this._db.exec("ExecuteStatement", {
      Statement: stmt,
    })) as { Items?: Record<string, unknown>[] };

    return itemsToResultSet(res.Items ?? [], { keyAttributes: [] });
  }

  async batch(stmts: string[]): Promise<DatabaseResultSet[]> {
    const results: DatabaseResultSet[] = [];
    for (const s of stmts) {
      results.push(await this.query(s));
    }
    return results;
  }

  async transaction(stmts: string[]): Promise<DatabaseResultSet[]> {
    // Secuencial (NO en paralelo) para preservar el orden.
    const results: DatabaseResultSet[] = [];
    for (const s of stmts) {
      results.push(await this.query(s));
    }
    return results;
  }

  trigger(
    _schemaName: string,
    _name: string
  ): Promise<DatabaseTriggerSchema> {
    throw new Error("DynamoDB: no implementado todavia (wave posterior)");
  }

  async findFirst(
    schemaName: string,
    tableName: string,
    key: Record<string, DatabaseValue>
  ): Promise<DatabaseResultSet> {
    const pk = (await this.tableSchema(schemaName, tableName)).pk;

    // La Key de DynamoDB debe ser EXACTAMENTE el key schema (sin atributos extra)
    const filteredKey: Record<string, unknown> = {};
    for (const attr of pk) {
      if (attr in key) filteredKey[attr] = key[attr];
    }

    const res = (await this._db.exec("GetItem", {
      TableName: tableName,
      Key: filteredKey,
    })) as { Item?: Record<string, unknown> };

    const item = res.Item;
    return itemsToResultSet(item ? [item] : [], { keyAttributes: pk });
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

  async updateTableData(
    schemaName: string,
    tableName: string,
    ops: DatabaseTableOperation[],
    validateSchema?: DatabaseTableSchema
  ): Promise<DatabaseTableOperationReslt[]> {
    const schema =
      validateSchema ?? (await this.tableSchema(schemaName, tableName));
    const pk = schema.pk;

    if (!pk || pk.length === 0) {
      throw new Error(
        "DynamoDB: tabla sin clave primaria, no se puede editar"
      );
    }

    const pkSet = new Set(pk);

    // Tipo DynamoDB por atributo (S/N/B/BOOL/...). La grilla edita SIEMPRE como
    // string; sin coerción un atributo N terminaría guardado como S y corrompería
    // el tipo del atributo en la tabla. Coercionamos los N a number antes de mandar.
    const typeOf: Record<string, string> = {};
    for (const c of schema.columns) typeOf[c.name] = c.type;

    const coerce = (attr: string, value: DatabaseValue): DatabaseValue => {
      if (value === null || value === undefined) return value;
      if (typeOf[attr] === "N" && typeof value === "string") {
        const trimmed = value.trim();
        const n = Number(trimmed);
        if (trimmed === "" || Number.isNaN(n)) {
          throw new Error(
            `DynamoDB: "${value}" no es un número válido para la columna "${attr}"`
          );
        }
        return n;
      }
      return value;
    };

    const results: DatabaseTableOperationReslt[] = [];

    for (const op of ops) {
      if (op.operation === "INSERT") {
        // La partition/sort key son obligatorias: sin ellas DynamoDB devuelve un
        // ValidationException críptico. Avisamos claro antes de salir a la red.
        for (const attr of pk) {
          if (op.values[attr] === null || op.values[attr] === undefined) {
            throw new Error(
              `DynamoDB: falta la clave "${attr}" para insertar el item`
            );
          }
        }

        // El DocumentClient TIRA si un atributo es undefined; lo sacamos (una
        // celda sin tocar llega como undefined). null sí es válido (tipo NULL).
        const item: Record<string, DatabaseValue> = {};
        for (const [attr, value] of Object.entries(op.values)) {
          if (value === undefined) continue;
          item[attr] = coerce(attr, value);
        }

        await this._db.exec("PutItem", { TableName: tableName, Item: item });
        // Put no devuelve el item: reflejamos los values que mandamos.
        results.push({ record: item });
        continue;
      }

      // UPDATE / DELETE comparten `where`
      const filteredKey: Record<string, unknown> = {};
      for (const attr of pk) {
        if (attr in op.where) filteredKey[attr] = op.where[attr];
      }

      if (op.operation === "DELETE") {
        await this._db.exec("DeleteItem", {
          TableName: tableName,
          Key: filteredKey,
        });
        results.push({});
        continue;
      }

      // UPDATE: construir SET con los atributos no-clave de op.values.
      // Excluimos undefined (el DocumentClient tira) y la pk (no se puede mutar
      // la Key vía UpdateExpression).
      const setEntries = Object.entries(op.values).filter(
        ([attr, value]) => !pkSet.has(attr) && value !== undefined
      );

      if (setEntries.length === 0) {
        // No hay nada que setear: devolvemos el item actual vía GetItem.
        const res = (await this._db.exec("GetItem", {
          TableName: tableName,
          Key: filteredKey,
        })) as { Item?: Record<string, DatabaseValue> };
        results.push({ record: res.Item });
        continue;
      }

      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};
      const setClauses: string[] = [];

      setEntries.forEach(([attr, value], i) => {
        const nameKey = `#k${i}`;
        const valueKey = `:v${i}`;
        expressionAttributeNames[nameKey] = attr;
        expressionAttributeValues[valueKey] = coerce(attr, value);
        setClauses.push(`${nameKey} = ${valueKey}`);
      });

      const res = (await this._db.exec("UpdateItem", {
        TableName: tableName,
        Key: filteredKey,
        UpdateExpression: `SET ${setClauses.join(", ")}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW",
      })) as { Attributes?: Record<string, DatabaseValue> };

      results.push({ record: res.Attributes });
    }

    return results;
  }

  async dropTable(_schemaName: string, tableName: string): Promise<void> {
    await this._db.exec("DeleteTable", { TableName: tableName });
  }

  async emptyTable(schemaName: string, tableName: string): Promise<void> {
    const pk = (await this.tableSchema(schemaName, tableName)).pk;
    if (!pk || pk.length === 0) {
      // Sin pk no podemos armar DeleteRequest; no hay nada que hacer.
      return;
    }

    // ProjectionExpression con alias para evitar palabras reservadas.
    const projectionNames: Record<string, string> = {};
    const projectionParts: string[] = [];
    pk.forEach((attr, i) => {
      const nameKey = `#p${i}`;
      projectionNames[nameKey] = attr;
      projectionParts.push(nameKey);
    });

    // 1. Scan paginado proyectando solo la pk → juntar todas las keys.
    const keys: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const params: Record<string, unknown> = {
        TableName: tableName,
        ProjectionExpression: projectionParts.join(", "),
        ExpressionAttributeNames: projectionNames,
      };
      if (lastEvaluatedKey) params.ExclusiveStartKey = lastEvaluatedKey;

      const scanResult = (await this._db.exec("Scan", params)) as ScanResult & {
        LastEvaluatedKey?: Record<string, unknown>;
      };

      for (const item of scanResult.Items ?? []) {
        const key: Record<string, unknown> = {};
        for (const attr of pk) key[attr] = item[attr];
        keys.push(key);
      }
      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    if (keys.length === 0) return;

    // 2. Borrar en chunks de 25 (límite de BatchWriteItem). BatchWriteItem puede
    //    devolver UnprocessedItems (throttling/capacidad) SIN fallar: si los
    //    ignoráramos, emptyTable reportaría éxito con la tabla a medio vaciar.
    //    Reintentamos los pendientes con backoff exponencial.
    for (let i = 0; i < keys.length; i += 25) {
      const chunk = keys.slice(i, i + 25);
      let requestItems: Record<string, { DeleteRequest: { Key: unknown } }[]> = {
        [tableName]: chunk.map((Key) => ({ DeleteRequest: { Key } })),
      };

      for (let attempt = 0; requestItems[tableName]?.length; attempt++) {
        const res = (await this._db.exec("BatchWriteItem", {
          RequestItems: requestItems,
        })) as {
          UnprocessedItems?: Record<
            string,
            { DeleteRequest: { Key: unknown } }[]
          >;
        };

        const pending = res?.UnprocessedItems?.[tableName] ?? [];
        if (pending.length === 0) break;

        if (attempt >= 8) {
          throw new Error(
            `DynamoDB: no se pudieron borrar ${pending.length} items de ${tableName} tras varios reintentos`
          );
        }

        requestItems = { [tableName]: pending };
        await new Promise((r) => setTimeout(r, Math.min(1000, 50 * 2 ** attempt)));
      }
    }
  }

  createUpdateTableSchema(change: DatabaseTableSchemaChange): string[] {
    // OJO: el SchemaEditorTab llama esto en un useMemo durante el render para
    // generar el "preview script". NUNCA debe tirar — devolvemos un statement
    // JSON que transaction()/query() saben interpretar (__dynamo control-plane).
    const newName = change.name?.new?.trim();
    const oldName = change.name?.old?.trim();

    // Solo soportamos creación de tabla nueva en esta wave.
    if (!newName || oldName) {
      // rename / alter columns / GSI: DynamoDB no permite alterar key schema.
      return [];
    }

    // Columnas marcadas como pk (en orden): primera = HASH, segunda = RANGE.
    // Guard de la REGLA DE ORO: este método corre en render (useMemo); si
    // change.columns llega undefined (change a medio formar), .map tiraría y
    // crashearía el SchemaEditorTab. Nunca debe tirar.
    const pkColumns = (change.columns ?? [])
      .map((c) => c.new)
      .filter((col): col is DatabaseTableColumn => !!col && col.pk === true);

    if (pkColumns.length === 0) {
      // Sin partition key no se puede crear la tabla.
      return [];
    }

    const dynamoAttrType = (type: string | undefined): "S" | "N" | "B" => {
      const t = (type ?? "").toLowerCase();
      if (
        t.includes("int") ||
        t.includes("num") ||
        t.includes("real") ||
        t.includes("float") ||
        t.includes("double") ||
        t.includes("decimal")
      ) {
        return "N";
      }
      if (t.includes("binary") || t.includes("blob")) return "B";
      return "S";
    };

    const hash = pkColumns[0];
    const range = pkColumns[1];

    const keySchema: DynamoKeySchemaElement[] = [
      { AttributeName: hash.name, KeyType: "HASH" },
    ];
    const attributeDefinitions: DynamoAttributeDefinition[] = [
      { AttributeName: hash.name, AttributeType: dynamoAttrType(hash.type) },
    ];

    if (range) {
      keySchema.push({ AttributeName: range.name, KeyType: "RANGE" });
      attributeDefinitions.push({
        AttributeName: range.name,
        AttributeType: dynamoAttrType(range.type),
      });
    }

    const params = {
      TableName: newName,
      KeySchema: keySchema,
      AttributeDefinitions: attributeDefinitions,
      BillingMode: "PAY_PER_REQUEST",
    };

    return [JSON.stringify({ __dynamo: "CreateTable", params })];
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
