import { DynamoDriver } from "./dynamodb-driver";
import { DynamoQueryable } from "../database/dynamodb-queryable";
import {
  DatabaseTableOperation,
  DatabaseTableSchema,
  DatabaseTableSchemaChange,
  DatabaseTableColumn,
} from "../base-driver";

// ---------------------------------------------------------------------------
// Fake DynamoQueryable — inyecta respuestas conocidas por acción, sin AWS.
// ---------------------------------------------------------------------------

function makeFakeQueryable(
  handlers: Record<string, (params: Record<string, unknown>) => unknown>
): DynamoQueryable {
  const fake = {
    exec: jest.fn(async (action: string, params: object = {}) => {
      const handler = handlers[action];
      if (!handler) {
        throw new Error(`fake exec: acción no manejada "${action}"`);
      }
      return handler(params as Record<string, unknown>);
    }),
  };
  return fake as unknown as DynamoQueryable;
}

// Variante que ADEMÁS captura todas las llamadas { action, params } para
// inspeccionarlas, y provee defaults razonables si no hay handler para una
// acción. Útil para los tests de CRUD/PartiQL/createUpdateTableSchema.
interface ExecCall {
  action: string;
  params: Record<string, unknown>;
}

function makeCapturingDriver(canned: Record<string, unknown> = {}): {
  driver: DynamoDriver;
  calls: ExecCall[];
  callsFor: (action: string) => ExecCall[];
} {
  const calls: ExecCall[] = [];

  const fake = {
    async exec(action: string, params: object = {}): Promise<unknown> {
      calls.push({ action, params: params as Record<string, unknown> });
      if (action in canned) return canned[action];
      switch (action) {
        case "Scan":
          return { Items: [] };
        case "GetItem":
          return { Item: undefined };
        case "PutItem":
          return {};
        case "UpdateItem":
          return { Attributes: {} };
        case "DeleteItem":
          return {};
        case "ExecuteStatement":
          return { Items: [] };
        default:
          return {};
      }
    },
  };

  const driver = new DynamoDriver(fake as unknown as DynamoQueryable);
  return {
    driver,
    calls,
    callsFor: (action: string) => calls.filter((c) => c.action === action),
  };
}

// Respuesta canned de DescribeTable para resolver la pk de una tabla.
function describeTableWithPk(
  tableName: string,
  pk: string[]
): Record<string, unknown> {
  return {
    DescribeTable: {
      Table: {
        TableName: tableName,
        KeySchema: pk.map((name, i) => ({
          AttributeName: name,
          KeyType: i === 0 ? "HASH" : "RANGE",
        })),
        AttributeDefinitions: pk.map((name) => ({
          AttributeName: name,
          AttributeType: "S",
        })),
      },
    },
  };
}

function col(
  name: string,
  pk: boolean,
  type = "string"
): DatabaseTableColumn {
  return { name, type, pk };
}

// Respuesta típica de DescribeTable para una tabla con PK (HASH) + SK (RANGE).
const usersDescribe = {
  Table: {
    TableName: "Users",
    KeySchema: [
      { AttributeName: "userId", KeyType: "HASH" },
      { AttributeName: "createdAt", KeyType: "RANGE" },
    ],
    AttributeDefinitions: [
      { AttributeName: "userId", AttributeType: "S" },
      { AttributeName: "createdAt", AttributeType: "S" },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "email-index",
        KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
      },
    ],
  },
};

describe("DynamoDriver.selectTable", () => {
  test("PK/SK primero en headers y filas correctas", async () => {
    const items = [
      {
        userId: "u1",
        createdAt: "2024-01-01",
        email: "a@x.com",
        active: true,
        profile: { age: 30 },
        tags: ["a", "b"],
      },
      { userId: "u2", createdAt: "2024-02-01", email: "b@x.com" },
    ];

    const driver = new DynamoDriver(
      makeFakeQueryable({
        DescribeTable: () => usersDescribe,
        Scan: () => ({ Items: items, Count: items.length }),
      })
    );

    const { data, schema } = await driver.selectTable("default", "Users", {
      limit: 100,
      offset: 0,
    });

    const headerNames = data.headers.map((h) => h.name);
    // PK (userId) y SK (createdAt) garantizados primero, en ese orden.
    expect(headerNames[0]).toBe("userId");
    expect(headerNames[1]).toBe("createdAt");
    // atributos dinámicos presentes
    expect(headerNames).toContain("email");
    expect(headerNames).toContain("active");
    expect(headerNames).toContain("profile");
    expect(headerNames).toContain("tags");

    // schema reporta la PK correcta
    expect(schema.pk).toEqual(["userId", "createdAt"]);

    // filas: 2 items
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]["userId"]).toBe("u1");
    // celda ausente (item 2 no tiene 'active') → null, sin crash
    expect(data.rows[1]["active"]).toBeNull();

    // tipos DynamoDB inferidos en headers
    const byName = Object.fromEntries(
      data.headers.map((h) => [h.name, h.originalType])
    );
    expect(byName["active"]).toBe("BOOL");
    expect(byName["profile"]).toBe("M");
    expect(byName["tags"]).toBe("L");
  });

  test("Scan vacío → headers de keyAttributes, 0 filas, sin crash", async () => {
    const driver = new DynamoDriver(
      makeFakeQueryable({
        DescribeTable: () => usersDescribe,
        Scan: () => ({ Items: [], Count: 0 }),
      })
    );

    const { data } = await driver.selectTable("default", "Users", {
      limit: 100,
      offset: 0,
    });

    const headerNames = data.headers.map((h) => h.name);
    expect(headerNames).toEqual(["userId", "createdAt"]);
    expect(data.rows).toHaveLength(0);
  });

  test("usa el limit de options en el Scan", async () => {
    const scanSpy = jest.fn(() => ({ Items: [] }));
    const driver = new DynamoDriver(
      makeFakeQueryable({
        DescribeTable: () => usersDescribe,
        Scan: scanSpy,
      })
    );

    await driver.selectTable("default", "Users", { limit: 25, offset: 0 });

    expect(scanSpy).toHaveBeenCalledWith(
      expect.objectContaining({ TableName: "Users", Limit: 25 })
    );
  });

  test("degrada elegante si el Scan falla (devuelve grilla con solo keys)", async () => {
    // DescribeTable funciona pero ambos Scan (el de tableSchema y el de selectTable) fallan.
    const driver = new DynamoDriver(
      makeFakeQueryable({
        DescribeTable: () => usersDescribe,
        Scan: () => {
          throw new Error("AccessDenied");
        },
      })
    );

    const { data } = await driver.selectTable("default", "Users", {
      limit: 100,
      offset: 0,
    });

    expect(data.headers.map((h) => h.name)).toEqual(["userId", "createdAt"]);
    expect(data.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createUpdateTableSchema — PURO, se evalúa en render, NUNCA debe tirar.
// ---------------------------------------------------------------------------

describe("DynamoDriver.createUpdateTableSchema", () => {
  test("tabla nueva con partition key sola → 1 statement CreateTable con HASH", () => {
    const { driver } = makeCapturingDriver();
    const change: DatabaseTableSchemaChange = {
      name: { new: "users" },
      columns: [
        { key: "c0", old: null, new: col("id", true) },
        { key: "c1", old: null, new: col("email", false) },
      ],
      constraints: [],
    };

    const stmts = driver.createUpdateTableSchema(change);
    expect(stmts).toHaveLength(1);

    const parsed = JSON.parse(stmts[0]) as {
      __dynamo: string;
      params: {
        TableName: string;
        KeySchema: { AttributeName: string; KeyType: string }[];
        BillingMode: string;
      };
    };

    expect(parsed.__dynamo).toBe("CreateTable");
    expect(parsed.params.TableName).toBe("users");
    expect(parsed.params.BillingMode).toBe("PAY_PER_REQUEST");
    expect(parsed.params.KeySchema).toEqual([
      { AttributeName: "id", KeyType: "HASH" },
    ]);
  });

  test("partition + sort key → KeySchema HASH + RANGE en orden", () => {
    const { driver } = makeCapturingDriver();
    const change: DatabaseTableSchemaChange = {
      name: { new: "events" },
      columns: [
        { key: "c0", old: null, new: col("pk", true) },
        { key: "c1", old: null, new: col("sk", true) },
        { key: "c2", old: null, new: col("payload", false) },
      ],
      constraints: [],
    };

    const parsed = JSON.parse(driver.createUpdateTableSchema(change)[0]) as {
      params: { KeySchema: { AttributeName: string; KeyType: string }[] };
    };

    expect(parsed.params.KeySchema).toEqual([
      { AttributeName: "pk", KeyType: "HASH" },
      { AttributeName: "sk", KeyType: "RANGE" },
    ]);
  });

  test("pk numérica → AttributeType N", () => {
    const { driver } = makeCapturingDriver();
    const change: DatabaseTableSchemaChange = {
      name: { new: "counters" },
      columns: [{ key: "c0", old: null, new: col("id", true, "integer") }],
      constraints: [],
    };

    const parsed = JSON.parse(driver.createUpdateTableSchema(change)[0]) as {
      params: { AttributeDefinitions: { AttributeType: string }[] };
    };
    expect(parsed.params.AttributeDefinitions[0].AttributeType).toBe("N");
  });

  test("rename (old + new) → [] (DynamoDB no permite alterar key schema)", () => {
    const { driver } = makeCapturingDriver();
    const change: DatabaseTableSchemaChange = {
      name: { old: "users", new: "people" },
      columns: [{ key: "c0", old: col("id", true), new: col("id", true) }],
      constraints: [],
    };
    expect(driver.createUpdateTableSchema(change)).toEqual([]);
  });

  test("sin partition key → [] (no se puede crear)", () => {
    const { driver } = makeCapturingDriver();
    const change: DatabaseTableSchemaChange = {
      name: { new: "noKey" },
      columns: [{ key: "c0", old: null, new: col("just_a_field", false) }],
      constraints: [],
    };
    expect(driver.createUpdateTableSchema(change)).toEqual([]);
  });

  test("NUNCA tira, ni con change vacío ni con columnas new=null", () => {
    const { driver } = makeCapturingDriver();
    expect(() =>
      driver.createUpdateTableSchema({
        name: {},
        columns: [],
        constraints: [],
      })
    ).not.toThrow();
    expect(() =>
      driver.createUpdateTableSchema({
        name: { new: "x" },
        columns: [{ key: "c0", old: null, new: null }],
        constraints: [],
      })
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// query() — control-plane JSON vs PartiQL
// ---------------------------------------------------------------------------

describe("DynamoDriver.query", () => {
  test("statement control-plane JSON → exec con la acción del __dynamo, NO PartiQL", async () => {
    const { driver, calls, callsFor } = makeCapturingDriver();

    const stmt = JSON.stringify({
      __dynamo: "CreateTable",
      params: { TableName: "users", BillingMode: "PAY_PER_REQUEST" },
    });

    await driver.query(stmt);

    expect(callsFor("CreateTable")).toHaveLength(1);
    expect(callsFor("CreateTable")[0].params).toEqual({
      TableName: "users",
      BillingMode: "PAY_PER_REQUEST",
    });
    expect(callsFor("ExecuteStatement")).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  test("texto PartiQL → exec('ExecuteStatement', { Statement })", async () => {
    const { driver, callsFor } = makeCapturingDriver();
    const stmt = "SELECT * FROM users WHERE id = '1'";
    await driver.query(stmt);

    const partiql = callsFor("ExecuteStatement");
    expect(partiql).toHaveLength(1);
    expect(partiql[0].params).toEqual({ Statement: stmt });
  });

  test("JSON sin __dynamo → cae a PartiQL sin romper", async () => {
    const { driver, callsFor } = makeCapturingDriver();
    const stmt = '{"foo": "bar"}';
    await driver.query(stmt);
    expect(callsFor("ExecuteStatement")).toHaveLength(1);
    expect(callsFor("ExecuteStatement")[0].params).toEqual({ Statement: stmt });
  });
});

// ---------------------------------------------------------------------------
// updateTableData — INSERT / UPDATE / DELETE
// ---------------------------------------------------------------------------

describe("DynamoDriver.updateTableData", () => {
  const schema: DatabaseTableSchema = {
    schemaName: "default",
    tableName: "users",
    columns: [],
    pk: ["id"],
    autoIncrement: false,
  };

  test("INSERT → exec('PutItem', { TableName, Item: values })", async () => {
    const { driver, callsFor } = makeCapturingDriver();
    const ops: DatabaseTableOperation[] = [
      { operation: "INSERT", values: { id: "1", name: "Alice" } },
    ];

    const res = await driver.updateTableData("default", "users", ops, schema);

    const puts = callsFor("PutItem");
    expect(puts).toHaveLength(1);
    expect(puts[0].params).toEqual({
      TableName: "users",
      Item: { id: "1", name: "Alice" },
    });
    expect(res[0].record).toEqual({ id: "1", name: "Alice" });
  });

  test("UPDATE → exec('UpdateItem') con Key SOLO pk y SET de los no-key", async () => {
    const { driver, callsFor } = makeCapturingDriver({
      UpdateItem: { Attributes: { id: "1", name: "Bob" } },
    });

    const ops: DatabaseTableOperation[] = [
      {
        operation: "UPDATE",
        values: { id: "1", name: "Bob" },
        where: { id: "1", name: "Alice" },
      },
    ];

    await driver.updateTableData("default", "users", ops, schema);

    const updates = callsFor("UpdateItem");
    expect(updates).toHaveLength(1);
    const p = updates[0].params as {
      Key: Record<string, unknown>;
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
    };

    // La Key debe ser EXACTAMENTE la pk, sin atributos extra del where.
    expect(p.Key).toEqual({ id: "1" });
    expect(p.Key).not.toHaveProperty("name");

    // El SET cubre solo 'name' (no-key), nunca la pk 'id'.
    expect(Object.values(p.ExpressionAttributeNames)).toEqual(["name"]);
    expect(Object.values(p.ExpressionAttributeValues)).toEqual(["Bob"]);
    expect(p.UpdateExpression).toMatch(/^SET /);
  });

  test("UPDATE sin atributos no-key → GetItem y devuelve el record actual", async () => {
    const { driver, callsFor } = makeCapturingDriver({
      GetItem: { Item: { id: "1", name: "Existing" } },
    });

    const ops: DatabaseTableOperation[] = [
      { operation: "UPDATE", values: { id: "1" }, where: { id: "1" } },
    ];

    const res = await driver.updateTableData("default", "users", ops, schema);

    expect(callsFor("UpdateItem")).toHaveLength(0);
    const gets = callsFor("GetItem");
    expect(gets).toHaveLength(1);
    expect(gets[0].params).toEqual({ TableName: "users", Key: { id: "1" } });
    expect(res[0].record).toEqual({ id: "1", name: "Existing" });
  });

  test("DELETE → exec('DeleteItem', { Key }) con Key SOLO pk", async () => {
    const { driver, callsFor } = makeCapturingDriver();

    const ops: DatabaseTableOperation[] = [
      { operation: "DELETE", where: { id: "1", name: "Alice" } },
    ];

    await driver.updateTableData("default", "users", ops, schema);

    const dels = callsFor("DeleteItem");
    expect(dels).toHaveLength(1);
    expect(dels[0].params).toEqual({ TableName: "users", Key: { id: "1" } });
    const key = (dels[0].params as { Key: Record<string, unknown> }).Key;
    expect(key).not.toHaveProperty("name");
  });

  test("sin validateSchema resuelve la pk vía DescribeTable", async () => {
    const { driver, callsFor } = makeCapturingDriver(
      describeTableWithPk("users", ["id"])
    );

    const ops: DatabaseTableOperation[] = [
      { operation: "INSERT", values: { id: "9", name: "Zoe" } },
    ];

    await driver.updateTableData("default", "users", ops);

    expect(callsFor("DescribeTable")).toHaveLength(1);
    expect(callsFor("PutItem")).toHaveLength(1);
  });

  test("tabla sin pk → tira error claro", async () => {
    const { driver } = makeCapturingDriver();
    const emptyPkSchema: DatabaseTableSchema = { ...schema, pk: [] };

    await expect(
      driver.updateTableData("default", "users", [], emptyPkSchema)
    ).rejects.toThrow(/clave primaria/);
  });

  test("preserva el orden de las ops en los resultados", async () => {
    const { driver } = makeCapturingDriver();
    const ops: DatabaseTableOperation[] = [
      { operation: "INSERT", values: { id: "1" } },
      { operation: "INSERT", values: { id: "2" } },
      { operation: "INSERT", values: { id: "3" } },
    ];
    const res = await driver.updateTableData("default", "users", ops, schema);
    expect(res.map((r) => r.record?.id)).toEqual(["1", "2", "3"]);
  });
});

// ---------------------------------------------------------------------------
// findFirst — GetItem con Key filtrada a la pk
// ---------------------------------------------------------------------------

describe("DynamoDriver.findFirst", () => {
  test("exec('GetItem') con Key SOLO pk (sin atributos extra)", async () => {
    const { driver, callsFor } = makeCapturingDriver({
      ...describeTableWithPk("users", ["id"]),
      GetItem: { Item: { id: "1", name: "Alice" } },
    });

    const result = await driver.findFirst("default", "users", {
      id: "1",
      name: "Alice", // atributo extra que NO debe entrar en la Key
    });

    const gets = callsFor("GetItem");
    expect(gets).toHaveLength(1);
    expect(gets[0].params).toEqual({ TableName: "users", Key: { id: "1" } });
    const key = (gets[0].params as { Key: Record<string, unknown> }).Key;
    expect(key).not.toHaveProperty("name");

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]["id"]).toBe("1");
  });

  test("pk compuesta (HASH+RANGE) → ambas en la Key", async () => {
    const { driver, callsFor } = makeCapturingDriver({
      ...describeTableWithPk("events", ["pk", "sk"]),
      GetItem: { Item: { pk: "u1", sk: "2024" } },
    });

    await driver.findFirst("default", "events", {
      pk: "u1",
      sk: "2024",
      extra: "ignorame",
    });

    const key = (
      callsFor("GetItem")[0].params as { Key: Record<string, unknown> }
    ).Key;
    expect(key).toEqual({ pk: "u1", sk: "2024" });
    expect(key).not.toHaveProperty("extra");
  });

  test("item no encontrado → resultset vacío sin crash", async () => {
    const { driver } = makeCapturingDriver({
      ...describeTableWithPk("users", ["id"]),
      GetItem: { Item: undefined },
    });

    const result = await driver.findFirst("default", "users", { id: "nope" });
    expect(result.rows).toEqual([]);
  });
});
