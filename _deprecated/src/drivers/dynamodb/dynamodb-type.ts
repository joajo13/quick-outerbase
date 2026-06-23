import { ColumnType } from "@outerbase/sdk-transform";
import { ColumnTypeSelector, DatabaseTableColumn } from "../base-driver";

/**
 * Tipos nativos de DynamoDB y su mapeo al ColumnType del Studio.
 * Ref: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html
 */
export type DynamoDBAttributeType =
  | "S"   // String
  | "N"   // Number
  | "B"   // Binary
  | "M"   // Map (documento anidado)
  | "L"   // List
  | "SS"  // String Set
  | "NS"  // Number Set
  | "BS"  // Binary Set
  | "BOOL" // Boolean
  | "NULL"; // Null

/** Mapea un tipo de atributo DynamoDB al ColumnType interno del Studio. */
export function inferType(dynamoType?: DynamoDBAttributeType): ColumnType {
  if (!dynamoType) return ColumnType.TEXT;

  switch (dynamoType) {
    case "N":
    case "NS":
      return ColumnType.REAL;

    case "B":
    case "BS":
    case "L":
    case "M":
      return ColumnType.BLOB;

    case "S":
    case "SS":
    case "BOOL":
    case "NULL":
    default:
      return ColumnType.TEXT;
  }
}

/**
 * Infiere el ColumnType a partir de la cabecera de columna.
 * El campo `type` debería ser el código DynamoDB (S, N, B, etc.)
 * o un string humano — se hace best-effort.
 */
export function inferTypeFromHeader(
  header?: DatabaseTableColumn
): ColumnType | undefined {
  if (!header?.type) return undefined;

  const t = header.type.toUpperCase() as DynamoDBAttributeType;
  return inferType(t);
}

/**
 * Selector de tipo para el editor de columnas del Studio.
 * DynamoDB usa un conjunto cerrado de tipos escalares/colección.
 */
export const columnTypeSelector: ColumnTypeSelector = {
  type: "dropdown",
  idTypeName: "N",
  textTypeName: "S",
  dropdownOptions: [
    { text: "String (S)", value: "S" },
    { text: "Number (N)", value: "N" },
    { text: "Binary (B)", value: "B" },
    { text: "Boolean (BOOL)", value: "BOOL" },
    { text: "Null (NULL)", value: "NULL" },
    { text: "Map (M)", value: "M" },
    { text: "List (L)", value: "L" },
    { text: "String Set (SS)", value: "SS" },
    { text: "Number Set (NS)", value: "NS" },
    { text: "Binary Set (BS)", value: "BS" },
  ],
};
