import { BaseDriver, SupportedDialect } from "@/drivers/base-driver";
import { NodeProxyQueryable } from "@/drivers/database/node-proxy";
// DEPRECATED: dynamodb — drivers de DynamoDB sacados del build (ver _deprecated/README.md).
// import { DynamoQueryable } from "@/drivers/database/dynamodb-queryable";
// import { DynamoDriver } from "@/drivers/dynamodb/dynamodb-driver";
import PostgresLikeDriver from "@/drivers/postgres/postgres-driver";
import MySQLLikeDriver from "@/drivers/mysql/mysql-driver";
import { SqliteLikeBaseDriver } from "@/drivers/sqlite-base-driver";

/** Opciones extra por dialecto para el flujo env (sin secretos). */
export interface EnvDriverOptions {
  /** Región AWS (dynamodb). */
  region?: string;
  /** Endpoint custom (dynamodb, ej: DynamoDB Local). */
  endpoint?: string;
}

/**
 * Construye el BaseDriver del Studio para el flujo por DATABASE_URL.
 * El dialecto lo decide el server (inferido del scheme) y se inyecta
 * el transporte NodeProxyQueryable que pega a /proxy/db.
 *
 * `schema` es el schema configurado (Prisma ?schema=X). Cuando viene, el driver
 * de Postgres filtra la introspección a ese schema (árbol y ERD muestran solo ese).
 *
 * DynamoDB es el caso especial: usa su propio proxy (/proxy/dynamodb) y NO recibe
 * credenciales — solo región/endpoint. Las creds las resuelve el server desde la
 * cadena estándar de AWS, así que nunca llegan al browser.
 */
export function createEnvDriver(
  dialect: SupportedDialect,
  schema?: string,
  options?: EnvDriverOptions
): BaseDriver {
  // DEPRECATED: dynamodb — soporte DynamoDB removido del build del CLI npx.
  // Antes acá se instanciaba DynamoDriver contra /proxy/dynamodb. Reversible:
  // ver _deprecated/README.md. database-url.ts ya no produce dialect "dynamodb",
  // así que este guard nunca se alcanza por el flujo normal.
  if (dialect === "dynamodb") {
    throw new Error(
      "DynamoDB fue deprecado en esta build del CLI. Ver _deprecated/README.md para reactivarlo."
    );
  }

  const queryable = new NodeProxyQueryable("/proxy/db");

  switch (dialect) {
    case "postgres":
    case "dolt":
      return new PostgresLikeDriver(queryable, schema);
    case "mysql":
      return new MySQLLikeDriver(queryable);
    case "sqlite":
    default:
      return new SqliteLikeBaseDriver(queryable);
  }
}
