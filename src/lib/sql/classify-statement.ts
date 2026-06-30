import { getSQLStatementType } from "@/drivers/sql-helper";

// Clasifica un statement SQL como lectura o escritura, para el gate del chat
// agéntico: las lecturas pueden correr solas con auto-run; las escrituras SIEMPRE
// piden confirmación. Ante la duda, devolvemos "write" (fail-safe: mejor frenar
// de más que ejecutar algo destructivo sin que el usuario lo vea).
export type StatementAccess = "read" | "write";

// Keywords que arrancan un statement de LECTURA. Todo lo demás → write.
const READ_PREFIXES = [
  "SELECT",
  "EXPLAIN",
  "PRAGMA",
  "SHOW",
  "DESCRIBE",
  "DESC",
];

// Verbos de escritura que pueden aparecer como operación terminal de un CTE.
const WRITE_VERBS = ["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE"];

// Resuelve el "head" efectivo del statement. Si arranca con WITH (CTE), busca el
// verbo terminal: si hay un verbo de escritura, esa es la operación real; si no,
// es un WITH ... SELECT (lectura).
function effectiveHead(sql: string): string {
  const norm = sql.trim().replace(/\s+/g, " ").toUpperCase();
  if (!norm.startsWith("WITH")) return norm;
  for (const verb of WRITE_VERBS) {
    if (new RegExp(`\\b${verb}\\b`).test(norm)) return verb;
  }
  return "SELECT"; // WITH ... SELECT
}

export function classifyStatement(sql: string): StatementAccess {
  const head = effectiveHead(sql);
  if (!head) return "write";

  // getSQLStatementType cubre SELECT/INSERT/UPDATE y DDL de tablas/índices/vistas/triggers.
  const type = getSQLStatementType(sql);
  if (type === "SELECT") return "read";
  if (type !== "OTHER") return "write"; // INSERT/UPDATE/CREATE_*/ALTER_*/DROP_*

  // OTHER: desambiguar con el head (DELETE, TRUNCATE, PRAGMA, SHOW, EXPLAIN, etc.).
  if (READ_PREFIXES.some((p) => head.startsWith(p))) return "read";
  return "write";
}

// Multi-statement: si alguno es write, todo el bloque se trata como write.
export function classifyStatements(sql: string): StatementAccess {
  const parts = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return "write";
  return parts.some((p) => classifyStatement(p) === "write") ? "write" : "read";
}
