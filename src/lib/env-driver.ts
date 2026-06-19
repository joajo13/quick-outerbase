import { BaseDriver, SupportedDialect } from "@/drivers/base-driver";
import { NodeProxyQueryable } from "@/drivers/database/node-proxy";
import PostgresLikeDriver from "@/drivers/postgres/postgres-driver";
import MySQLLikeDriver from "@/drivers/mysql/mysql-driver";
import { SqliteLikeBaseDriver } from "@/drivers/sqlite-base-driver";

/**
 * Construye el BaseDriver del Studio para el flujo por DATABASE_URL.
 * El dialecto lo decide el server (inferido del scheme) y se inyecta
 * el transporte NodeProxyQueryable que pega a /proxy/db.
 */
export function createEnvDriver(dialect: SupportedDialect): BaseDriver {
  const queryable = new NodeProxyQueryable("/proxy/db");

  switch (dialect) {
    case "postgres":
    case "dolt":
      return new PostgresLikeDriver(queryable);
    case "mysql":
      return new MySQLLikeDriver(queryable);
    case "sqlite":
    default:
      return new SqliteLikeBaseDriver(queryable);
  }
}
