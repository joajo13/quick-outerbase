/**
 * E2E REAL contra DynamoDB Local (Docker) — verifica que los PATRONES de PartiQL
 * que el system prompt del agente le enseña al LLM son EJECUTABLES de verdad a
 * través del driver (DynamoDriver.query → ExecuteStatement), sin depender de un
 * LLM no determinista.
 *
 * Gateado por env: solo corre con DYNAMODB_E2E=1 y DynamoDB Local en :8000.
 * En `npm test` normal / CI queda SKIPPEADO, así no rompe sin Docker.
 *
 * Levantar el contenedor:
 *   docker run -d -p 8000:8000 --name dynamodb-local amazon/dynamodb-local \
 *     -jar DynamoDBLocal.jar -sharedDb -inMemory
 * Correr:
 *   DYNAMODB_E2E=1 AWS_ACCESS_KEY_ID=fake AWS_SECRET_ACCESS_KEY=fake \
 *     npx jest partiql-e2e
 */

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  ListTablesCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  QueryCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ExecuteStatementCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDriver } from "./dynamodb-driver";
import { DynamoQueryable } from "../database/dynamodb-queryable";

const E2E = process.env.DYNAMODB_E2E === "1";
const ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const TABLE = "PartiqlE2E";

// Queryable real: misma semántica que el proxy server-side (mapea action →
// Command del SDK) pero in-process contra DynamoDB Local. Se la inyectamos al
// DynamoDriver, así ejercitamos EXACTAMENTE el camino del driver de producción.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COMMAND_MAP: Record<string, new (params: any) => any> = {
  ListTables: ListTablesCommand,
  DescribeTable: DescribeTableCommand,
  CreateTable: CreateTableCommand,
  DeleteTable: DeleteTableCommand,
  Scan: ScanCommand,
  Query: QueryCommand,
  GetItem: GetCommand,
  PutItem: PutCommand,
  UpdateItem: UpdateCommand,
  DeleteItem: DeleteCommand,
  ExecuteStatement: ExecuteStatementCommand,
};

function makeRealQueryable(): { queryable: DynamoQueryable; close: () => void } {
  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: ENDPOINT,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fake",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fake",
    },
  });
  const doc = DynamoDBDocumentClient.from(client);

  const queryable = {
    async exec(action: string, params: object = {}): Promise<unknown> {
      const CommandClass = COMMAND_MAP[action];
      if (!CommandClass) throw new Error(`e2e: acción no mapeada "${action}"`);
      const result = (await doc.send(new CommandClass(params ?? {}))) as Record<
        string,
        unknown
      >;
      const { $metadata, ...data } = result;
      void $metadata;
      return data;
    },
  } as unknown as DynamoQueryable;

  return { queryable, close: () => client.destroy() };
}

async function waitTableActive(
  doc: DynamoDBDocumentClient,
  table: string
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await doc.send(new DescribeTableCommand({ TableName: table }));
      if (r.Table?.TableStatus === "ACTIVE") return;
    } catch {
      /* todavía no existe */
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`tabla ${table} no quedó ACTIVE a tiempo`);
}

(E2E ? describe : describe.skip)(
  "PartiQL patterns ejecutan contra DynamoDB Local (e2e)",
  () => {
    let driver: DynamoDriver;
    let close: () => void;
    let rawClient: DynamoDBDocumentClient;

    beforeAll(async () => {
      const real = makeRealQueryable();
      close = real.close;
      driver = new DynamoDriver(real.queryable);

      const admin = new DynamoDBClient({
        region: "us-east-1",
        endpoint: ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "fake",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "fake",
        },
      });
      rawClient = DynamoDBDocumentClient.from(admin);

      // Tabla limpia: borrar si quedó de una corrida previa, recrear y sembrar.
      try {
        await admin.send(new DeleteTableCommand({ TableName: TABLE }));
        await new Promise((res) => setTimeout(res, 300));
      } catch {
        /* no existía */
      }
      await admin.send(
        new CreateTableCommand({
          TableName: TABLE,
          AttributeDefinitions: [
            { AttributeName: "userId", AttributeType: "S" },
          ],
          KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
          BillingMode: "PAY_PER_REQUEST",
        })
      );
      await waitTableActive(rawClient, TABLE);
      await rawClient.send(
        new PutCommand({
          TableName: TABLE,
          Item: { userId: "u1", email: "a@x.com", active: true, age: 30 },
        })
      );
    }, 30000);

    afterAll(async () => {
      try {
        await rawClient.send(new DeleteTableCommand({ TableName: TABLE }));
      } catch {
        /* best effort */
      }
      close?.();
    });

    // Cada query es EXACTAMENTE un patrón que el prompt enseña (comillas dobles
    // en la tabla, simples en strings, VALUE {...} en el insert, PK completa en
    // update/delete). Si DynamoDB lo parsea y ejecuta, el prompt es ejecutable.

    test("SELECT con partition key", async () => {
      const res = await driver.query(
        `SELECT * FROM "${TABLE}" WHERE userId = 'u1'`
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].userId).toBe("u1");
      expect(res.rows[0].email).toBe("a@x.com");
    });

    test("INSERT con sintaxis de documento VALUE {...}", async () => {
      await driver.query(
        `INSERT INTO "${TABLE}" VALUE {'userId':'u9','email':'z@x.com','active':true,'age':25}`
      );
      const check = await driver.query(
        `SELECT * FROM "${TABLE}" WHERE userId = 'u9'`
      );
      expect(check.rows).toHaveLength(1);
      expect(check.rows[0].email).toBe("z@x.com");
    });

    test("UPDATE con PK completa en el WHERE", async () => {
      await driver.query(
        `UPDATE "${TABLE}" SET email='b@x.com' WHERE userId='u1'`
      );
      const check = await driver.query(
        `SELECT * FROM "${TABLE}" WHERE userId = 'u1'`
      );
      expect(check.rows[0].email).toBe("b@x.com");
    });

    test("DELETE con PK completa en el WHERE", async () => {
      await driver.query(`DELETE FROM "${TABLE}" WHERE userId='u9'`);
      const check = await driver.query(
        `SELECT * FROM "${TABLE}" WHERE userId = 'u9'`
      );
      expect(check.rows).toHaveLength(0);
    });
  }
);
