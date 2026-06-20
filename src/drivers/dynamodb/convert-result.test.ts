import { ColumnType } from "@outerbase/sdk-transform";
import { extractAttributeNames, itemsToResultSet } from "./convert-result";

// ---------------------------------------------------------------------------
// extractAttributeNames
// ---------------------------------------------------------------------------

describe("extractAttributeNames", () => {
  test("retorna unión de keys de todos los items", () => {
    const items = [
      { pk: "1", name: "Alice" },
      { pk: "2", age: 30 },
      { pk: "3", name: "Bob", age: 25 },
    ];
    const result = extractAttributeNames(items);
    expect(result).toContain("pk");
    expect(result).toContain("name");
    expect(result).toContain("age");
    // sin duplicados
    expect(result.length).toBe(3);
  });

  test("items vacío → array vacío", () => {
    expect(extractAttributeNames([])).toEqual([]);
  });

  test("item con keys repetidas no duplica", () => {
    const items = [{ a: 1 }, { a: 2 }, { a: 3 }];
    expect(extractAttributeNames(items)).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// itemsToResultSet — estructura base
// ---------------------------------------------------------------------------

describe("itemsToResultSet", () => {
  test("items vacío → resultado vacío sin crash", () => {
    const result = itemsToResultSet([]);
    expect(result.headers).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.stat.rowsRead).toBe(0);
    expect(result.stat.rowsAffected).toBe(0);
  });

  test("items vacío con keyAttributes → headers con las keys garantizadas", () => {
    const result = itemsToResultSet([], { keyAttributes: ["pk", "sk"] });
    expect(result.headers.map((h) => h.name)).toEqual(["pk", "sk"]);
    expect(result.rows).toEqual([]);
  });

  test("keyAttributes aparecen primero en los headers", () => {
    const items = [
      { pk: "u1", sk: "profile", name: "Alice", age: 30 },
      { pk: "u2", sk: "profile", name: "Bob" },
    ];
    const result = itemsToResultSet(items, { keyAttributes: ["pk", "sk"] });
    const names = result.headers.map((h) => h.name);
    expect(names[0]).toBe("pk");
    expect(names[1]).toBe("sk");
    // el resto también está presente
    expect(names).toContain("name");
    expect(names).toContain("age");
  });

  test("atributo ausente en algún item → null en esa fila", () => {
    const items = [
      { pk: "u1", name: "Alice" },
      { pk: "u2" }, // no tiene 'name'
    ];
    const result = itemsToResultSet(items, { keyAttributes: ["pk"] });
    expect(result.rows[1]["name"]).toBeNull();
    expect(result.rows[0]["name"]).toBe("Alice");
  });

  test("stat.rowsRead refleja la cantidad de items", () => {
    const items = [{ pk: "a" }, { pk: "b" }, { pk: "c" }];
    const result = itemsToResultSet(items);
    expect(result.stat.rowsRead).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// itemsToResultSet — inferencia de tipos
// ---------------------------------------------------------------------------

describe("itemsToResultSet — tipos inferidos", () => {
  test("string → originalType S, ColumnType TEXT", () => {
    const items = [{ id: "abc" }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "id")!;
    expect(header.originalType).toBe("S");
    expect(header.type).toBe(ColumnType.TEXT);
  });

  test("number → originalType N, ColumnType REAL", () => {
    const items = [{ count: 42 }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "count")!;
    expect(header.originalType).toBe("N");
    expect(header.type).toBe(ColumnType.REAL);
  });

  test("boolean → originalType BOOL, ColumnType TEXT", () => {
    const items = [{ active: true }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "active")!;
    expect(header.originalType).toBe("BOOL");
    // BOOL mapea a TEXT según dynamodb-type.ts
    expect(header.type).toBe(ColumnType.TEXT);
  });

  test("objeto plano (Map DynamoDB) → originalType M, ColumnType BLOB", () => {
    const items = [{ metadata: { region: "us-east-1", tier: "premium" } }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "metadata")!;
    expect(header.originalType).toBe("M");
    expect(header.type).toBe(ColumnType.BLOB);
  });

  test("array (List DynamoDB) → originalType L, ColumnType BLOB", () => {
    const items = [{ tags: ["backend", "infra"] }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "tags")!;
    expect(header.originalType).toBe("L");
    expect(header.type).toBe(ColumnType.BLOB);
  });

  test("null → originalType NULL (solo si no hay otro valor para esa col)", () => {
    const items = [{ col: null }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "col")!;
    expect(header.originalType).toBe("NULL");
  });

  test("tipo inferido por primer valor no-null", () => {
    // El primer item tiene null; el segundo tiene el número — debe inferirse N
    const items = [{ score: null }, { score: 99 }];
    const result = itemsToResultSet(items);
    const header = result.headers.find((h) => h.name === "score")!;
    expect(header.originalType).toBe("N");
    expect(header.type).toBe(ColumnType.REAL);
  });

  test("valor M/L se deja tal cual en la fila (sin serializar)", () => {
    const nested = { a: 1, b: [1, 2, 3] };
    const items = [{ data: nested }];
    const result = itemsToResultSet(items);
    expect(result.rows[0]["data"]).toBe(nested); // referencia exacta
  });
});

// ---------------------------------------------------------------------------
// itemsToResultSet — keyAttributes garantizados primero incluso sin valores
// ---------------------------------------------------------------------------

describe("itemsToResultSet — keyAttributes garantizados", () => {
  test("keyAttribute garantizado aunque ningún item lo tenga (items con otros attrs)", () => {
    // Todos los items tienen 'name' pero ninguno tiene 'pk' — igual debe aparecer
    const items = [{ name: "Alice" }, { name: "Bob" }];
    const result = itemsToResultSet(items, { keyAttributes: ["pk"] });
    const names = result.headers.map((h) => h.name);
    expect(names[0]).toBe("pk");
    expect(names).toContain("name");
    // las filas tienen pk: null
    expect(result.rows[0]["pk"]).toBeNull();
  });

  test("no duplica un keyAttribute si también aparece en los items", () => {
    const items = [{ pk: "1", name: "Alice" }];
    const result = itemsToResultSet(items, { keyAttributes: ["pk"] });
    const pkHeaders = result.headers.filter((h) => h.name === "pk");
    expect(pkHeaders).toHaveLength(1);
  });
});
