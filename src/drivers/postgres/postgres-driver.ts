import { ColumnType } from "@outerbase/sdk-transform";
import {
  ColumnTypeSelector,
  DatabaseForeignKeyAction,
  DatabaseResultSet,
  DatabaseSchemaItem,
  DatabaseSchemas,
  DatabaseTableColumn,
  DatabaseTableColumnConstraint,
  DatabaseTableSchema,
  DatabaseTableSchemaChange,
  DatabaseTriggerSchema,
  DatabaseViewSchema,
  DriverFlags,
  QueryableBaseDriver,
} from "../base-driver";

/**
 * Parsea un array literal de Postgres ("{a,b}") a string[].
 * Necesario porque setPgParser devuelve los tipos array como string crudo.
 */
function parsePgArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v !== "string") return [];
  const inner = v.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner) return [];
  return inner.split(",").map((x) => x.replace(/^"(.*)"$/, "$1"));
}

/** Mapea las reglas referenciales de information_schema a la acción FK del modelo. */
function mapFkAction(rule?: string): DatabaseForeignKeyAction | undefined {
  switch ((rule || "").toUpperCase()) {
    case "CASCADE":
      return "CASCADE";
    case "SET NULL":
      return "SET_NULL";
    case "SET DEFAULT":
      return "SET_DEFAULT";
    case "RESTRICT":
      return "RESTRICT";
    case "NO ACTION":
      return "NO_ACTION";
    default:
      return undefined;
  }
}
import CommonSQLImplement from "../common-sql-imp";
import { escapeSqlValue } from "../sqlite/sql-helper";
import { generatePostgresSchemaChange } from "./generate-schema";
import { POSTGRES_DATA_TYPE_SUGGESTION } from "./postgres-data-type";

interface PostgresSchemaRow {
  catalog_name: string;
  schema_name: string;
}

interface PostgresTableRow {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  table_type: string;
  table_size: number;
}

interface PostgresColumnRow {
  table_catalog: string;
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  column_default: string | null;
  is_nullable: "YES" | "NO";
  data_type: string;
  character_maximum_length: number;
  numeric_precision: number;
  numeric_scale: number;
  datetime_precision: number;
  character_set_name: string;
  collation_name: string;
  is_generated: "NEVER" | "ALWAYS";
  generation_expression: string;
}

interface PostgresConstraintRow {
  constraint_name: string;
  table_schema: string;
  table_name: string;
  constraint_type: string;
  column_name: string;
  reference_table_schema: string;
  reference_table_name: string;
  reference_column_name: string;
}

export default class PostgresLikeDriver extends CommonSQLImplement {
  constructor(protected _db: QueryableBaseDriver) {
    super();
  }

  query(stmt: string): Promise<DatabaseResultSet> {
    return this._db.query(stmt);
  }

  transaction(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this._db.transaction(stmts);
  }

  batch(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this._db.batch ? this._db.batch(stmts) : super.batch(stmts);
  }

  close(): void {
    // Do nothing
  }

  columnTypeSelector: ColumnTypeSelector = POSTGRES_DATA_TYPE_SUGGESTION;

  escapeId(id: string) {
    return `"${id.replace(/"/g, '""')}"`;
  }

  escapeValue(value: unknown): string {
    return escapeSqlValue(value);
  }

  getFlags(): DriverFlags {
    return {
      defaultSchema: "public",
      dialect: "postgres",
      optionalSchema: false,
      supportRowId: false,
      supportBigInt: false,
      supportModifyColumn: true,
      supportCreateUpdateTable: true,
      supportCreateUpdateDatabase: false,
      supportInsertReturning: true,
      supportUpdateReturning: true,
      supportCreateUpdateTrigger: false,
      supportUseStatement: true,
    };
  }

  async getCurrentSchema(): Promise<string | null> {
    const result = (await this.query("SHOW search_path")) as unknown as {
      rows: { search_path?: string | null }[];
    };

    const db = result.rows[0].search_path!.split(",")[0];

    return db === this.escapeId("$user") ? "public" : db;
  }

  async schemas(): Promise<DatabaseSchemas> {
    const schemaSql = `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')`;
    const tableSql =
      "SELECT *, pg_total_relation_size(quote_ident(table_schema) || '.' || quote_ident(table_name)) AS table_size FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast');";
    const columnSql =
      "SELECT * FROM information_schema.columns WHERE table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')";
    const constraintSql = `SELECT
	tc.constraint_name,
	tc.table_schema,
	tc.table_name,
	tc.constraint_type,
	kcu.column_name,
	ccu.table_schema AS reference_table_schema,
	ccu.table_name AS reference_table_name,
	ccu.column_name AS reference_column_name
FROM
	information_schema.table_constraints AS tc
	LEFT JOIN information_schema.key_column_usage AS kcu
	ON (
		tc.table_schema = kcu.table_schema AND
		tc.table_name = kcu.table_name AND
		tc.constraint_name = kcu.constraint_name
	)
	LEFT JOIN information_schema.constraint_column_usage AS ccu
	ON (
		ccu.table_schema = kcu.table_schema AND
		ccu.constraint_name = kcu.constraint_name
	)
WHERE
	tc.table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')`;

    const tableCommentSql = `SELECT n.nspname AS table_schema, c.relname AS table_name, obj_description(c.oid,'pg_class') AS comment
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','v','m','p') AND n.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND obj_description(c.oid,'pg_class') IS NOT NULL`;

    const columnCommentSql = `SELECT n.nspname AS table_schema, c.relname AS table_name, a.attname AS column_name, col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped AND n.nspname NOT IN ('information_schema','pg_catalog','pg_toast') AND col_description(a.attrelid, a.attnum) IS NOT NULL`;

    const result = await this.batch([
      schemaSql,
      tableSql,
      columnSql,
      constraintSql,
      tableCommentSql,
      columnCommentSql,
    ]);

    const schemaResult = result[0].rows as unknown as PostgresSchemaRow[];
    const tableResult = result[1].rows as unknown as PostgresTableRow[];
    const columnsResult = result[2].rows as unknown as PostgresColumnRow[];
    const constraintResult = result[3]
      .rows as unknown as PostgresConstraintRow[];
    const tableCommentResult = result[4].rows as unknown as {
      table_schema: string;
      table_name: string;
      comment: string | null;
    }[];
    const columnCommentResult = result[5].rows as unknown as {
      table_schema: string;
      table_name: string;
      column_name: string;
      comment: string | null;
    }[];

    const schemas: DatabaseSchemas = {};

    for (const schema of schemaResult) {
      schemas[schema.schema_name] = [];
    }

    const tableRecord: Record<string, DatabaseSchemaItem> = {};
    for (const table of tableResult) {
      const key = table.table_schema + "." + table.table_name;

      const tableItem: DatabaseSchemaItem = {
        name: table.table_name,
        schemaName: table.table_schema,
        type: table.table_type === "BASE TABLE" ? "table" : "view",
        tableName: table.table_name,
        tableSchema: {
          stats: {
            sizeInByte: table.table_size,
          },
          columns: [],
          constraints: [],
          pk: [],
          autoIncrement: false,
          schemaName: table.table_schema,
          tableName: table.table_name,
        },
      };

      tableRecord[key] = tableItem;

      if (schemas[table.table_schema]) {
        schemas[table.table_schema].push(tableItem);
      }
    }

    // Add columns to table schema
    const columnRecord: Record<string, DatabaseTableColumn> = {};
    for (const column of columnsResult) {
      const key =
        column.table_schema +
        "." +
        column.table_name +
        "." +
        column.column_name;

      const columnItem: DatabaseTableColumn = {
        name: column.column_name,
        type: column.data_type,
        constraint: {
          notNull: column.is_nullable === "NO",
          defaultValue: column.column_default,
          generatedExpression: column.generation_expression,
        },
      };

      columnRecord[key] = columnItem;

      const tableKey = column.table_schema + "." + column.table_name;

      const tableSchema = tableRecord[tableKey]?.tableSchema;
      if (tableSchema) {
        tableSchema.columns.push(columnItem);
      }
    }

    // Add constraints to table schema
    const constraintRecord: Record<string, DatabaseTableColumnConstraint> = {};

    for (const constraint of constraintResult) {
      const tableKey = constraint.table_schema + "." + constraint.table_name;
      const constraintKey = tableKey + "." + constraint.column_name;

      const constraintItem = constraintRecord[constraintKey] || {
        name: constraint.constraint_name,
        primaryKey: false,
        notNull: false,
        unique: false,
        checkExpression: "",
        defaultValue: null,
      };

      if (constraint.constraint_type === "PRIMARY KEY") {
        constraintItem.primaryKey = true;
        constraintItem.primaryColumns = [
          ...(constraintItem?.primaryColumns ?? []),
          constraint.column_name,
        ];
      } else if (constraint.constraint_type === "FOREIGN KEY") {
        constraintItem.foreignKey = {
          foreignSchemaName: constraint.reference_table_schema,
          foreignTableName: constraint.reference_table_name,
          foreignColumns: [
            ...(constraintItem?.foreignKey?.foreignColumns ?? []),
            constraint.reference_column_name,
          ],
          columns: [constraint.column_name],
        };
      } else if (constraint.constraint_type === "UNIQUE") {
        constraintItem.unique = true;
        constraintItem.uniqueColumns = [
          ...(constraintItem.uniqueColumns ?? []),
          constraint.column_name,
        ];
      }

      constraintRecord[constraintKey] = constraintItem;
      const tableSchema = tableRecord[tableKey]?.tableSchema;
      if (tableSchema) {
        tableSchema.constraints = [
          ...(tableRecord[tableKey].tableSchema?.constraints ?? []),
          constraintItem,
        ];
      }
    }

    // Building PK
    for (const tableKey in tableRecord) {
      const table = tableRecord[tableKey];
      if (table.tableSchema?.constraints) {
        const pk = table.tableSchema.constraints.find(
          (c) => c.primaryKey
        ) as DatabaseTableColumnConstraint;
        if (pk) {
          table.tableSchema.pk = pk.primaryColumns ?? [];
        }
      }
    }

    // Apply table comments
    for (const tc of tableCommentResult) {
      if (!tc.comment) continue;
      const item = tableRecord[tc.table_schema + "." + tc.table_name];
      if (item?.tableSchema) item.tableSchema.comment = tc.comment;
    }

    // Apply column comments
    for (const cc of columnCommentResult) {
      if (!cc.comment) continue;
      const col =
        columnRecord[
          cc.table_schema + "." + cc.table_name + "." + cc.column_name
        ];
      if (col) col.comment = cc.comment;
    }

    return schemas;
  }

  async tableSchema(
    schemaName: string,
    tableName: string
  ): Promise<DatabaseTableSchema> {
    const sv = (v: string) => this.escapeValue(v);

    // Una sola tanda de queries (batch) para minimizar round-trips.
    const columnSql = `SELECT * FROM information_schema.columns WHERE table_schema = ${sv(schemaName)} AND table_name = ${sv(tableName)} ORDER BY ordinal_position`;

    const constraintSql = `SELECT
	tc.constraint_name,
	tc.table_schema,
	tc.table_name,
	tc.constraint_type,
	kcu.column_name,
	kcu.ordinal_position,
	ccu.table_schema AS reference_table_schema,
	ccu.table_name AS reference_table_name,
	ccu.column_name AS reference_column_name,
	rc.update_rule,
	rc.delete_rule
FROM
	information_schema.table_constraints AS tc
	LEFT JOIN information_schema.key_column_usage AS kcu
	ON (tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name AND tc.constraint_name = kcu.constraint_name)
	LEFT JOIN information_schema.constraint_column_usage AS ccu
	ON (ccu.table_schema = kcu.table_schema AND ccu.constraint_name = kcu.constraint_name)
	LEFT JOIN information_schema.referential_constraints AS rc
	ON (rc.constraint_schema = tc.table_schema AND rc.constraint_name = tc.constraint_name)
WHERE
	tc.table_schema = ${sv(schemaName)} AND tc.table_name = ${sv(tableName)}
ORDER BY kcu.ordinal_position`;

    // COMMENTs de columnas (pg_catalog).
    const colCommentSql = `SELECT a.attname AS column_name, col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ${sv(schemaName)} AND c.relname = ${sv(tableName)} AND a.attnum > 0 AND NOT a.attisdropped`;

    // COMMENT de la tabla.
    const tableCommentSql = `SELECT obj_description((${sv(schemaName)} || '.' || ${sv(tableName)})::regclass, 'pg_class') AS comment`;

    // CHECK constraints con su expresión completa.
    const checkSql = `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = ${sv(schemaName)} AND c.relname = ${sv(tableName)} AND con.contype = 'c'`;

    // Índices (con columnas, unique y primary).
    const indexSql = `SELECT i.relname AS index_name, ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
  (SELECT array_agg(a.attname ORDER BY k.ord)
   FROM unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord)
   JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum) AS columns,
  pg_get_indexdef(ix.indexrelid) AS definition
FROM pg_index ix
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_class t ON t.oid = ix.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = ${sv(schemaName)} AND t.relname = ${sv(tableName)}`;

    const result = await this.batch([
      columnSql,
      constraintSql,
      colCommentSql,
      tableCommentSql,
      checkSql,
      indexSql,
    ]);

    const columnsResult = result[0].rows as unknown as PostgresColumnRow[];
    const constraintResult = result[1]
      .rows as unknown as (PostgresConstraintRow & {
      update_rule?: string;
      delete_rule?: string;
    })[];
    const colCommentRows = result[2].rows as unknown as {
      column_name: string;
      comment: string | null;
    }[];
    const tableComment =
      (result[3].rows?.[0] as { comment?: string | null } | undefined)
        ?.comment ?? undefined;
    const checkRows = result[4].rows as unknown as {
      name: string;
      def: string;
    }[];
    const indexRows = result[5].rows as unknown as {
      index_name: string;
      is_unique: boolean;
      is_primary: boolean;
      columns: string | string[] | null;
      definition: string;
    }[];

    const commentByColumn: Record<string, string> = {};
    for (const r of colCommentRows) {
      if (r.comment) commentByColumn[r.column_name] = r.comment;
    }

    const constraintRecord: Record<string, DatabaseTableColumnConstraint> = {};
    for (const constraint of constraintResult.filter(
      (f) => f.column_name !== null
    )) {
      const key = constraint.constraint_name;
      const constraintItem = constraintRecord[key] || {
        name: constraint.constraint_name,
        primaryKey: false,
        notNull: false,
        unique: false,
        checkExpression: "",
        defaultValue: null,
      };

      if (constraint.constraint_type === "PRIMARY KEY") {
        constraintItem.primaryKey = true;
        constraintItem.primaryColumns = [
          ...(constraintItem?.primaryColumns ?? []),
          constraint.column_name,
        ];
      } else if (constraint.constraint_type === "FOREIGN KEY") {
        constraintItem.foreignKey = {
          foreignSchemaName: constraint.reference_table_schema,
          foreignTableName: constraint.reference_table_name,
          foreignColumns: [
            ...(constraintItem?.foreignKey?.foreignColumns ?? []),
            constraint.reference_column_name,
          ],
          columns: [
            ...(constraintItem?.foreignKey?.columns ?? []),
            constraint.column_name,
          ],
          onUpdate: mapFkAction(constraint.update_rule),
          onDelete: mapFkAction(constraint.delete_rule),
        };
      } else if (constraint.constraint_type === "UNIQUE") {
        constraintItem.unique = true;
        constraintItem.uniqueColumns = [
          ...(constraintItem.uniqueColumns ?? []),
          constraint.column_name,
        ];
      }

      constraintRecord[key] = constraintItem;
    }

    // Agregar CHECK constraints (con expresión).
    for (const chk of checkRows) {
      constraintRecord[chk.name] = {
        name: chk.name,
        checkExpression: chk.def.replace(/^CHECK\s*/i, "").trim(),
      };
    }

    const pkColumn =
      Object.values(constraintRecord).find((c) => c.primaryKey)
        ?.primaryColumns ?? [];

    const indexes = indexRows.map((ix) => ({
      name: ix.index_name,
      columns: parsePgArray(ix.columns),
      unique: ix.is_unique,
      primary: ix.is_primary,
      definition: ix.definition,
    }));

    const tableSchema: DatabaseTableSchema = {
      columns: columnsResult.map((column) => ({
        name: column.column_name,
        type: column.data_type,
        comment: commentByColumn[column.column_name],
        constraint: {
          notNull: column.is_nullable === "NO",
          defaultValue: column.column_default,
          generatedExpression: column.generation_expression,
          primaryKey: pkColumn.includes(column.column_name),
        },
      })),
      constraints: Object.values(constraintRecord),
      pk: pkColumn,
      autoIncrement: true,
      schemaName,
      tableName,
      comment: tableComment ?? undefined,
      indexes,
    };

    return tableSchema;
  }

  trigger(): Promise<DatabaseTriggerSchema> {
    throw new Error("Not implemented");
  }

  createUpdateTableSchema(change: DatabaseTableSchemaChange): string[] {
    return generatePostgresSchemaChange(this, change);
  }

  createUpdateDatabaseSchema(): string[] {
    throw new Error("Not implemented");
  }

  createTrigger(): string {
    throw new Error("Not implemented");
  }

  dropTrigger(): string {
    throw new Error("Not implemented");
  }

  async view(schemaName: string, name: string): Promise<DatabaseViewSchema> {
    const sql = `SELECT * FROM information_schema.views WHERE TABLE_SCHEMA=${this.escapeValue(schemaName)} AND TABLE_NAME=${this.escapeValue(name)}`;
    const result = await this.query(sql);

    const viewRow = result.rows[0] as { view_definition: string } | undefined;
    if (!viewRow) throw new Error("View dose not exist");

    const statement = viewRow.view_definition.trim();

    return {
      schemaName,
      name,
      statement,
    };
  }

  createView(view: DatabaseViewSchema): string {
    return `CREATE VIEW ${this.escapeId(view.schemaName)}.${this.escapeId(view.name)} AS ${view.statement}`;
  }

  dropView(schemaName: string, name: string): string {
    return `DROP VIEW IF EXISTS ${this.escapeId(schemaName)}.${this.escapeId(name)}`;
  }

  inferTypeFromHeader(): ColumnType | undefined {
    return undefined;
  }
}
