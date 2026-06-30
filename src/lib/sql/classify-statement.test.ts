import { classifyStatement, classifyStatements } from "./classify-statement";

describe("classifyStatement", () => {
  test("SELECT y variantes de lectura → read", () => {
    expect(classifyStatement("SELECT * FROM users")).toBe("read");
    expect(classifyStatement("  select 1")).toBe("read");
    expect(classifyStatement("EXPLAIN QUERY PLAN SELECT 1")).toBe("read");
    expect(classifyStatement("PRAGMA table_info(users)")).toBe("read");
    expect(classifyStatement("SHOW TABLES")).toBe("read");
    expect(classifyStatement("DESCRIBE users")).toBe("read");
    expect(classifyStatement("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(
      "read"
    );
  });

  test("mutaciones y DDL → write", () => {
    expect(classifyStatement("INSERT INTO t VALUES (1)")).toBe("write");
    expect(classifyStatement("UPDATE t SET a=1")).toBe("write");
    expect(classifyStatement("DELETE FROM t")).toBe("write");
    expect(classifyStatement("DROP TABLE t")).toBe("write");
    expect(classifyStatement("ALTER TABLE t ADD c INT")).toBe("write");
    expect(classifyStatement("CREATE TABLE t (id int)")).toBe("write");
    expect(classifyStatement("TRUNCATE TABLE t")).toBe("write");
    expect(classifyStatement("REPLACE INTO t VALUES (1)")).toBe("write");
    expect(classifyStatement("GRANT SELECT ON t TO u")).toBe("write");
  });

  test("CTE que termina en DELETE → write", () => {
    expect(
      classifyStatement(
        "WITH t AS (SELECT 1) DELETE FROM x WHERE id IN (SELECT * FROM t)"
      )
    ).toBe("write");
  });

  test("fail-safe: vacío o desconocido → write", () => {
    expect(classifyStatement("")).toBe("write");
    expect(classifyStatement("VACUUM")).toBe("write");
    expect(classifyStatement("blah blah")).toBe("write");
  });
});

describe("classifyStatements", () => {
  test("solo lecturas → read", () => {
    expect(classifyStatements("SELECT 1; SELECT 2")).toBe("read");
  });

  test("si algún statement es write → write", () => {
    expect(classifyStatements("SELECT 1; DELETE FROM t")).toBe("write");
    expect(classifyStatements("SELECT 1; UPDATE t SET a=1")).toBe("write");
  });

  test("vacío → write (fail-safe)", () => {
    expect(classifyStatements("")).toBe("write");
    expect(classifyStatements("   ")).toBe("write");
  });
});
