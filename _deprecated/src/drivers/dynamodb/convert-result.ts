/**
 * convert-result.ts — Wave 1
 *
 * Funciones puras que transforman items DynamoDB (ya unmarshalled por el
 * DocumentClient del proxy) a las estructuras internas del Studio.
 *
 * "Pura" = sin efectos secundarios, sin I/O, 100% testeable sin AWS.
 */

import { DatabaseHeader, DatabaseResultSet, DatabaseResultStat } from "../base-driver";
import { DynamoDBAttributeType, inferType } from "./dynamodb-type";

// ---------------------------------------------------------------------------
// Helpers de inferencia de tipo JS → DynamoDB type string
// ---------------------------------------------------------------------------

/**
 * Infiere el tipo DynamoDB a partir de un valor JS plano (post-unmarshall).
 * El DocumentClient deja los valores como JS nativos, no como { S: "..." }.
 */
function inferDynamoTypeFromValue(value: unknown): DynamoDBAttributeType {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return "BOOL";
  if (typeof value === "number") return "N";
  if (typeof value === "string") return "S";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "B";
  if (Array.isArray(value)) return "L";
  if (typeof value === "object") return "M";
  return "S"; // fallback
}

// ---------------------------------------------------------------------------
// extractAttributeNames
// ---------------------------------------------------------------------------

/**
 * Retorna la unión de todas las keys observadas en los items.
 * Útil para construir headers dinámicos (DynamoDB no tiene schema fijo).
 */
export function extractAttributeNames(items: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      seen.add(key);
    }
  }
  return Array.from(seen);
}

// ---------------------------------------------------------------------------
// itemsToResultSet
// ---------------------------------------------------------------------------

export interface ItemsToResultSetOptions {
  /** Atributos de clave (PK / SK) que se garantizan primero en los headers. */
  keyAttributes?: string[];
}

/**
 * Convierte un array de items DynamoDB (unmarshalled) en un DatabaseResultSet.
 *
 * Garantías:
 * - Los keyAttributes aparecen PRIMERO en los headers, incluso si algún item
 *   no los tiene.
 * - Los headers son la UNIÓN de todas las keys observadas más los keyAttributes.
 * - El tipo se infiere desde el PRIMER valor no-null encontrado para esa columna.
 * - Valores M (objeto) y L (array) se dejan tal cual — el renderer del Studio
 *   los serializa como crea conveniente.
 */
export function itemsToResultSet(
  items: Record<string, unknown>[],
  opts: ItemsToResultSetOptions = {}
): DatabaseResultSet {
  const { keyAttributes = [] } = opts;

  // 1. Construir el orden de columnas: keys primero, luego el resto en orden de aparición.
  const keySet = new Set(keyAttributes);
  const extraKeys: string[] = [];

  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!keySet.has(key)) {
        extraKeys.push(key);
        keySet.add(key); // evitar duplicados en extraKeys también
      }
    }
  }

  // Columns = keyAttributes garantizados primero + extras en orden de aparición
  const allColumns = [...keyAttributes, ...extraKeys];

  // 2. Inferir tipo por columna (primer valor no-null visto)
  const columnTypes = new Map<string, DynamoDBAttributeType>();

  for (const item of items) {
    for (const col of allColumns) {
      if (columnTypes.has(col)) continue;
      const val = item[col];
      if (val !== null && val !== undefined) {
        columnTypes.set(col, inferDynamoTypeFromValue(val));
      }
    }
    // Early-exit si ya tenemos tipo para todas las columnas
    if (columnTypes.size === allColumns.length) break;
  }

  // 3. Construir headers
  // Si una columna solo tuvo valores null/undefined nunca se registró en columnTypes
  // → el tipo es genuinamente desconocido/null en DynamoDB, representado como NULL.
  const headers: DatabaseHeader[] = allColumns.map((col) => {
    const dynamoType = columnTypes.get(col) ?? "NULL";
    return {
      name: col,
      displayName: col,
      originalType: dynamoType,
      type: inferType(dynamoType),
    };
  });

  // 4. Construir rows — cada fila es un Record<string, unknown> con todas las columnas
  const rows = items.map((item) => {
    const row: Record<string, unknown> = {};
    for (const col of allColumns) {
      // columnas ausentes en el item → null (DynamoDB es sparse)
      row[col] = col in item ? item[col] : null;
    }
    return row;
  });

  // 5. Stat
  const stat: DatabaseResultStat = {
    rowsAffected: 0,
    rowsRead: items.length,
    rowsWritten: null,
    queryDurationMs: null,
  };

  return { headers, rows, stat };
}
