import { SavedConnectionRawLocalStorage } from "@/app/(theme)/connect/saved-connection-storage";
import { CloudflareD1Queryable } from "./database/cloudflare-d1";
import CloudflareWAEDriver from "./database/cloudflare-wae";
import { DynamoQueryable } from "./database/dynamodb-queryable";
import { RqliteQueryable } from "./database/rqlite";
import { StarbaseQuery } from "./database/starbasedb";
import TursoDriver from "./database/turso";
import { ValtownQueryable } from "./database/valtown";
import { DynamoDriver } from "./dynamodb/dynamodb-driver";
import { SqliteLikeBaseDriver } from "./sqlite-base-driver";

export function createLocalDriver(conn: SavedConnectionRawLocalStorage) {
  if (conn.driver === "rqlite") {
    return new SqliteLikeBaseDriver(
      new RqliteQueryable(conn.url!, conn.username, conn.password)
    );
  } else if (conn.driver === "valtown") {
    return new SqliteLikeBaseDriver(new ValtownQueryable(conn.token!));
  } else if (conn.driver === "cloudflare-d1") {
    return new SqliteLikeBaseDriver(
      new CloudflareD1Queryable("/proxy/d1", {
        Authorization: "Bearer " + conn.token,
        "x-account-id": conn.username ?? "",
        "x-database-id": conn.database ?? "",
      })
    );
  } else if (conn.driver === "starbase") {
    return new SqliteLikeBaseDriver(new StarbaseQuery(conn.url!, conn.token!));
  } else if (conn.driver === "cloudflare-wae") {
    return new CloudflareWAEDriver(conn.username!, conn.token!);
  } else if (conn.driver === "dynamodb") {
    return new DynamoDriver(
      new DynamoQueryable("/proxy/dynamodb", {
        accessKeyId: conn.awsAccessKeyId ?? "",
        secretAccessKey: conn.awsSecretAccessKey ?? "",
        region: conn.awsRegion ?? "us-east-1",
        endpoint: conn.awsEndpoint,
      })
    );
  }

  return new TursoDriver(conn.url!, conn.token!, true);
}
