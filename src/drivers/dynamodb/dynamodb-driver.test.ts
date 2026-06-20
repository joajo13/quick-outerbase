import { DynamoDriver } from "./dynamodb-driver";
import { DynamoQueryable } from "../database/dynamodb-queryable";

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
