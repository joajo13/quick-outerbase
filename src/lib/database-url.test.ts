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
