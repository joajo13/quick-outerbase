// Seed de DynamoDB Local para los e2e (creds FAKE, endpoint local).
// Uso: node verify/seed-dynamodb.mjs [endpoint] [region]
// Requiere @aws-sdk/client-dynamodb en node_modules (dep de la app).
import {
  DynamoDBClient,
  CreateTableCommand,
  PutItemCommand,
  waitUntilTableExists,
  ListTablesCommand,
} from "@aws-sdk/client-dynamodb";

const endpoint = process.argv[2] || "http://localhost:8000";
const region = process.argv[3] || "us-east-1";

const client = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: "fake", secretAccessKey: "fake" },
});

const TABLE = "Users";

async function main() {
  // Crear tabla si no existe (PK simple: id String).
  const existing = await client.send(new ListTablesCommand({}));
  if (!existing.TableNames?.includes(TABLE)) {
    await client.send(
      new CreateTableCommand({
        TableName: TABLE,
        AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      })
    );
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: TABLE });
  }

  const items = [
    { id: { S: "u1" }, name: { S: "Ada Lovelace" }, age: { N: "36" }, active: { BOOL: true } },
    { id: { S: "u2" }, name: { S: "Alan Turing" }, age: { N: "41" }, active: { BOOL: true } },
    { id: { S: "u3" }, name: { S: "Grace Hopper" }, age: { N: "85" }, active: { BOOL: false } },
    { id: { S: "u4" }, name: { S: "Edsger Dijkstra" }, age: { N: "72" }, active: { BOOL: false } },
    { id: { S: "u5" }, name: { S: "Margaret Hamilton" }, age: { N: "88" }, active: { BOOL: true } },
  ];
  for (const Item of items) {
    await client.send(new PutItemCommand({ TableName: TABLE, Item }));
  }

  const after = await client.send(new ListTablesCommand({}));
  console.log("OK seed DynamoDB. Tablas:", after.TableNames?.join(", "));
  console.log(`Tabla ${TABLE} sembrada con ${items.length} items.`);
}

main().catch((e) => {
  console.error("FALLO seed dynamodb:", e?.message || e);
  process.exit(1);
});
