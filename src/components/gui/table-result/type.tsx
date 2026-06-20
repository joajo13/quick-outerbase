import { DatabaseTableColumn } from "@/drivers/base-driver";
import { ColumnType } from "@outerbase/sdk-transform";

export interface TableHeaderMetadata {
  from?: {
    schema: string;
    table: string;
    column: string;
  };

  // Primary key
  isPrimaryKey: boolean;

  // Foreign key reference
  referenceTo?: {
    schema: string;
    table: string;
    column: string;
  };

  type?: ColumnType;
  originalType?: string;

  columnSchema?: DatabaseTableColumn;

  // ---------------------------------------------------------------------------
  // DynamoDB (schema sparse / heterogéneo). Flags opcionales: no afectan el
  // path SQL, que nunca los setea.
  // ---------------------------------------------------------------------------

  /** True si la columna proviene de un atributo DynamoDB (no de un schema SQL). */
  isDynamoAttribute?: boolean;

  /** Tipo nativo DynamoDB de la columna (S, N, B, M, L, SS, NS, BS, BOOL, NULL). */
  dynamoType?: string;
}
