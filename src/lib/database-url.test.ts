import { parseDatabaseUrl, DatabaseUrlError, redact } from "./database-url";

describe("parseDatabaseUrl — inferencia de motor por scheme", () => {
  test("postgres:// → postgres, default schema public", () => {
    const r = parseDatabaseUrl("postgres://u:p@localhost:5432/db");
    expect(r.engine).toBe("postgres");
    expect(r.dialect).toBe("postgres");
    expect(r.schema).toBe("public");
  });

  test("postgresql:// también → postgres", () => {
    expect(parseDatabaseUrl("postgresql://u:p@h:5432/db").engine).toBe(
      "postgres"
    );
  });

  test("?schema=ventas estilo Prisma se extrae y se quita del connection string", () => {
    const r = parseDatabaseUrl("postgres://u:p@h:5432/db?schema=ventas");
    expect(r.schema).toBe("ventas");
    expect(r.connectionString).not.toContain("schema=ventas");
  });

  test("mysql:// → mysql", () => {
    const r = parseDatabaseUrl("mysql://u:p@localhost:3306/shop");
    expect(r.engine).toBe("mysql");
    expect(r.dialect).toBe("mysql");
  });

  test("sqlite: y file: → sqlite, normaliza a file:", () => {
    expect(parseDatabaseUrl("sqlite:./local.db").dialect).toBe("sqlite");
    const r = parseDatabaseUrl("file:./local.db");
    expect(r.engine).toBe("sqlite");
    expect(r.connectionString.startsWith("file:")).toBe(true);
  });

  test("libsql:// → dialecto sqlite, extrae authToken", () => {
    const r = parseDatabaseUrl("libsql://db.turso.io?authToken=secret123");
    expect(r.engine).toBe("libsql");
    expect(r.dialect).toBe("sqlite");
    expect(r.authToken).toBe("secret123");
  });

  test("dynamodb://us-east-1 → dialecto dynamodb, región, sin endpoint", () => {
    const r = parseDatabaseUrl("dynamodb://us-east-1");
    expect(r.engine).toBe("dynamodb");
    expect(r.dialect).toBe("dynamodb");
    expect(r.region).toBe("us-east-1");
    expect(r.endpoint).toBeUndefined();
    expect(r.displayName).toBe("DynamoDB (us-east-1)");
  });

  test("dynamodb con ?endpoint= (DynamoDB Local) lo extrae", () => {
    const r = parseDatabaseUrl(
      "dynamodb://us-east-1?endpoint=http://localhost:8000"
    );
    expect(r.region).toBe("us-east-1");
    expect(r.endpoint).toBe("http://localhost:8000");
  });

  test("dynamodb sin región → error claro", () => {
    expect(() => parseDatabaseUrl("dynamodb://")).toThrow(DatabaseUrlError);
    expect(() => parseDatabaseUrl("dynamodb://")).toThrow(/región/i);
  });

  test("dynamodb NUNCA acepta credenciales en userinfo (user:pass@)", () => {
    expect(() =>
      parseDatabaseUrl("dynamodb://AKIA123:secret@us-east-1")
    ).toThrow(DatabaseUrlError);
    expect(() =>
      parseDatabaseUrl("dynamodb://AKIA123:secret@us-east-1")
    ).toThrow(/credenciales/i);
  });

  test("dynamodb NUNCA acepta credenciales en query params", () => {
    expect(() =>
      parseDatabaseUrl(
        "dynamodb://us-east-1?accessKeyId=AKIA123&secretAccessKey=shh"
      )
    ).toThrow(DatabaseUrlError);
    expect(() =>
      parseDatabaseUrl("dynamodb://us-east-1?aws_secret_access_key=shh")
    ).toThrow(/credenciales/i);
  });

  test("dynamodb: connectionString y displayName no contienen secretos", () => {
    const r = parseDatabaseUrl(
      "dynamodb://us-east-1?endpoint=http://localhost:8000"
    );
    expect(r.connectionString).not.toMatch(/secret|accessKey/i);
    expect(r.displayName).not.toMatch(/secret|accessKey/i);
  });

  test("scheme no reconocido → error claro", () => {
    expect(() => parseDatabaseUrl("mongodb://localhost/x")).toThrow(
      DatabaseUrlError
    );
    expect(() => parseDatabaseUrl("mongodb://localhost/x")).toThrow(
      /no soportado/i
    );
  });

  test("URL vacío → error", () => {
    expect(() => parseDatabaseUrl("")).toThrow(DatabaseUrlError);
  });

  test("displayName no incluye la credencial; redact() oculta la password", () => {
    const r = parseDatabaseUrl("postgres://user:supersecret@h:5432/db");
    // displayName (lo que se muestra en la UI) es la db, no la credencial
    expect(r.displayName).toBe("db");
    expect(r.displayName).not.toContain("supersecret");
    // redact() (para logs/errores) enmascara la password
    expect(redact("postgres://user:supersecret@h:5432/db")).not.toContain(
      "supersecret"
    );
    expect(redact("postgres://user:supersecret@h:5432/db")).toContain("***");
  });
});
