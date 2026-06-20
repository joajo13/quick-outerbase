export type SQLStatementType =
  | "SELECT"
  | "INSERT"
  | "UPDATE"
  | "CREATE_TABLE"
  | "ALTER_TABLE"
  | "DROP_TABLE"
  | "CREATE_INDEX"
  | "DROP_INDEX"
  | "CREATE_VIEW"
  | "DROP_VIEW"
  | "CREATE_TRIGGER"
  | "DROP_TRIGGER"
  | "OTHER";

export function getSQLStatementType(statement: string): SQLStatementType {
  let trimmed = statement.trim().toUpperCase();

  // Reduce continuous whitespaces to single whitespace
  trimmed = trimmed.replace(/\s+/g, " ");

  // Replace the "IF NOT EXISTS" clause with an empty string
  trimmed = trimmed.replace("IF NOT EXISTS", "");

  // Nota: PartiQL (DynamoDB) usa SELECT/INSERT INTO/UPDATE/DELETE — los tres primeros
  // caen naturalmente en sus ramas; DELETE queda como "OTHER" (correcto, no hay DROP en PartiQL).
  if (trimmed.startsWith("SELECT")) return "SELECT";
  if (trimmed.startsWith("INSERT")) return "INSERT";
  if (trimmed.startsWith("UPDATE")) return "UPDATE";
  if (trimmed.startsWith("CREATE TABLE")) return "CREATE_TABLE";
  if (trimmed.startsWith("ALTER TABLE")) return "ALTER_TABLE";
  if (trimmed.startsWith("DROP TABLE")) return "DROP_TABLE";
  if (trimmed.startsWith("CREATE INDEX")) return "CREATE_INDEX";
  if (trimmed.startsWith("DROP INDEX")) return "DROP_INDEX";
  if (trimmed.startsWith("CREATE VIEW")) return "CREATE_VIEW";
  if (trimmed.startsWith("DROP VIEW")) return "DROP_VIEW";
  if (trimmed.startsWith("CREATE TRIGGER")) return "CREATE_TRIGGER";
  if (trimmed.startsWith("DROP TRIGGER")) return "DROP_TRIGGER";

  return "OTHER";
}
