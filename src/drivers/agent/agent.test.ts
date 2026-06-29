import { BaseDriver, DatabaseTableSchema } from "../base-driver";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
import AgentDriverList from "./list";
import { ChatGPTDriver } from "./chatgpt";

// Driver de DB falso: los agentes solo usan getFlags() (dialect/defaultSchema) y
// escapeId() al armar el DDL/system prompt. escapeId envuelve en comillas dobles
// (estilo Postgres) para poder assertear identificadores en el output.
function fakeDriver(
  dialect = "postgres",
  defaultSchema = "public"
): BaseDriver {
  return {
    getFlags: () => ({ dialect, defaultSchema }),
    escapeId: (id: string) => `"${id}"`,
  } as unknown as BaseDriver;
}

// Subclase mínima: expone el convertTableToDDLContent protected y provee un
// query() stub (no se llama en estos tests). Castea a un tipo que abre el método.
class TestDriver extends CommonAgentDriverImplementation {
  async query(_messages: CommonAgentMessage[]): Promise<string> {
    return "";
  }

  publicConvertTableToDDLContent(
    schemaName: string | undefined,
    table: DatabaseTableSchema
  ): string {
    return this.convertTableToDDLContent(schemaName, table);
  }
}

function makeTable(): DatabaseTableSchema {
  return {
    schemaName: "public",
    tableName: "orders",
    autoIncrement: false,
    pk: ["id"],
    type: "table",
    comment: "Customer orders table",
    columns: [
      { name: "id", type: "integer" },
      {
        name: "email",
        type: "varchar(255)",
        comment: "user email address",
        constraint: { notNull: true, unique: true },
      },
      {
        name: "status",
        type: "varchar(20)",
        constraint: { defaultValue: "'pending'" },
      },
      {
        name: "user_id",
        type: "integer",
        constraint: {
          foreignKey: {
            foreignTableName: "users",
            foreignColumns: ["id"],
          },
        },
      },
    ],
    constraints: [],
    indexes: [
      { name: "orders_pkey", columns: ["id"], primary: true },
      { name: "orders_status_idx", columns: ["status"], unique: false },
    ],
  };
}

describe("convertTableToDDLContent — DDL enriquecido", () => {
  const ddl = () =>
    new TestDriver(fakeDriver()).publicConvertTableToDDLContent(
      undefined,
      makeTable()
    );

  test("incluye columna NOT NULL", () => {
    expect(ddl()).toContain("NOT NULL");
  });

  test("comentario de columna va en su propia línea ANTES de la columna (no se come la coma)", () => {
    const out = ddl();
    expect(out).toContain("-- user email address");
    // El comentario está en su propia línea, seguido por la def de la columna...
    expect(out).toContain('-- user email address\n"email" varchar(255)');
    // ...y la def de email queda separada de la siguiente columna por una coma.
    // (Si el comentario fuera inline `def -- comment`, el `--` de SQL se comería
    // esta coma y el CREATE TABLE quedaría malformado.)
    expect(out).toMatch(/"email" varchar\(255\) NOT NULL UNIQUE,\n/);
  });

  test("incluye comentario de tabla como línea previa al CREATE TABLE", () => {
    const out = ddl();
    expect(out).toContain("-- Customer orders table");
    expect(out.indexOf("-- Customer orders table")).toBeLessThan(
      out.indexOf("CREATE TABLE")
    );
  });

  test("incluye DEFAULT y UNIQUE", () => {
    const out = ddl();
    expect(out).toContain("DEFAULT");
    expect(out).toContain("UNIQUE");
  });

  test("incluye la PRIMARY KEY", () => {
    expect(ddl()).toContain("PRIMARY KEY");
  });

  test("incluye una línea FOREIGN KEY ... REFERENCES (no la dropea)", () => {
    const out = ddl();
    expect(out).toContain("FOREIGN KEY");
    expect(out).toContain("REFERENCES");
    // La tabla referenciada va escapada (consistente con el resto de identificadores).
    expect(out).toMatch(/REFERENCES\s+"users"/);
  });

  test("incluye CREATE INDEX para índices no-primarios y omite el primary", () => {
    const out = ddl();
    expect(out).toContain("CREATE INDEX");
    expect(out).toContain("orders_status_idx");
    // El índice primario (orders_pkey) no debe salir como CREATE INDEX.
    expect(out).not.toContain("orders_pkey");
  });

  test("prefiere index.definition cuando está presente (Postgres indexdef)", () => {
    const table = makeTable();
    table.indexes = [
      {
        name: "orders_email_idx",
        columns: ["email"],
        unique: true,
        definition:
          "CREATE UNIQUE INDEX orders_email_idx ON public.orders USING btree (email)",
      },
    ];
    const out = new TestDriver(fakeDriver()).publicConvertTableToDDLContent(
      undefined,
      table
    );
    expect(out).toContain(
      "CREATE UNIQUE INDEX orders_email_idx ON public.orders USING btree (email)"
    );
  });

  test("no crashea cuando faltan campos opcionales (sqlite sin comments/indexes)", () => {
    const minimal: DatabaseTableSchema = {
      schemaName: "main",
      tableName: "t",
      autoIncrement: false,
      pk: [],
      type: "table",
      columns: [{ name: "a", type: "TEXT" }],
    };
    const out = new TestDriver(
      fakeDriver("sqlite", "main")
    ).publicConvertTableToDDLContent(undefined, minimal);
    expect(out).toContain("CREATE TABLE");
    expect(out).toContain('"a" TEXT');
    expect(out).not.toContain("--");
    expect(out).not.toContain("CREATE INDEX");
  });
});

describe("convertTableToDDLContent — FKs con introspección incompleta (cross-schema)", () => {
  // escapeId REAL de Postgres: hace id.replace(...). Si le llega null tira
  // "Cannot read properties of null (reading 'replace')" — exactamente el crash
  // del bug. Lo replicamos acá para que el test falle ANTES del fix.
  function strictPgDriver(): BaseDriver {
    return {
      getFlags: () => ({ dialect: "postgres", defaultSchema: "public" }),
      escapeId: (id: string) => `"${id.replace(/"/g, '""')}"`,
    } as unknown as BaseDriver;
  }

  // FK cross-schema: information_schema.constraint_column_usage no matchea entre
  // schemas, así que schemas() arma foreignTableName/foreignColumns en null.
  function tableWithBrokenFk(): DatabaseTableSchema {
    return {
      schemaName: "analytics",
      tableName: "events",
      autoIncrement: false,
      pk: ["id"],
      type: "table",
      columns: [
        { name: "id", type: "integer" },
        { name: "book_id", type: "integer" },
      ],
      constraints: [
        {
          name: "events_book_id_fkey",
          foreignKey: {
            foreignTableName: undefined,
            foreignColumns: [null as unknown as string],
            columns: ["book_id"],
          },
        },
      ],
      indexes: [],
    };
  }

  test("NO crashea con un FK cross-schema (foreignColumns/foreignTableName en null)", () => {
    expect(() =>
      new TestDriver(strictPgDriver()).publicConvertTableToDDLContent(
        "analytics",
        tableWithBrokenFk()
      )
    ).not.toThrow();
  });

  test("omite el FK incompleto en vez de emitir REFERENCES \"\" ()", () => {
    const out = new TestDriver(strictPgDriver()).publicConvertTableToDDLContent(
      "analytics",
      tableWithBrokenFk()
    );
    // El CREATE TABLE se genera igual...
    expect(out).toContain("CREATE TABLE");
    expect(out).toContain('"book_id"');
    // ...pero sin un FOREIGN KEY malformado apuntando a la nada.
    expect(out).not.toContain('REFERENCES ""');
    expect(out).not.toMatch(/REFERENCES\s+""\s*\(\)/);
  });

  test("un FK completo en el mismo schema sí se emite (no rompemos el caso bueno)", () => {
    const table: DatabaseTableSchema = {
      schemaName: "public",
      tableName: "books",
      autoIncrement: false,
      pk: ["id"],
      type: "table",
      columns: [
        { name: "id", type: "integer" },
        { name: "author_id", type: "integer" },
      ],
      constraints: [
        {
          name: "books_author_id_fkey",
          foreignKey: {
            foreignTableName: "authors",
            foreignColumns: ["id"],
            columns: ["author_id"],
          },
        },
      ],
      indexes: [],
    };
    const out = new TestDriver(strictPgDriver()).publicConvertTableToDDLContent(
      undefined,
      table
    );
    expect(out).toContain("FOREIGN KEY");
    expect(out).toMatch(/REFERENCES\s+"authors"\s*\("id"\)/);
  });
});

describe("getSystemContent — contexto enriquecido (no dynamodb)", () => {
  const agent = (dialect = "postgres", defaultSchema = "public") =>
    new TestDriver(fakeDriver(dialect, defaultSchema));

  test("menciona el dialecto (postgres)", () => {
    const sys = agent().getSystemContent({ selected: "" });
    expect(sys).toContain("postgres");
  });

  test("menciona el schema activo cuando se pasa selectedSchema", () => {
    const sys = agent().getSystemContent({
      selected: "",
      selectedSchema: "sales",
    });
    expect(sys).toContain("sales");
  });

  test("instruye NO inventar tablas/columnas", () => {
    const sys = agent().getSystemContent({ selected: "" });
    expect(sys.toLowerCase()).toContain("invent");
  });

  test("mantiene la intención de Ctrl+B (Only return SQL code)", () => {
    expect(agent().getSystemContent({ selected: "" })).toContain(
      "Only return SQL code"
    );
    expect(agent().getSystemContent({ selected: "SELECT 1" })).toContain(
      "Only return SQL code"
    );
  });

  test("variante selected pide mejorar la query", () => {
    const sys = agent().getSystemContent({ selected: "SELECT 1" });
    expect(sys).toContain("improve");
  });

  test("sugiere nombres calificados con schema cuando hay múltiples schemas", () => {
    const sys = agent().getSystemContent({
      selected: "",
      schema: {
        public: [],
        sales: [],
      },
    });
    expect(sys).toContain("schema.table");
  });

  test("modo conversacional (chat) NO fuerza 'Only return SQL code'", () => {
    const sys = agent().getSystemContent({
      selected: "",
      conversational: true,
    });
    expect(sys).not.toContain("Only return SQL code");
    expect(sys.toLowerCase()).toContain("conversationally");
  });

  test("modo conversacional sigue mencionando el dialecto y no inventar", () => {
    const sys = agent().getSystemContent({
      selected: "",
      conversational: true,
    });
    expect(sys).toContain("postgres");
    expect(sys.toLowerCase()).toContain("invent");
  });
});

describe("AgentDriverList.resolveDriver — resolución robusta de modelo", () => {
  // Subclase para exponer dict/defaultModelName/resolveDriver (protected) sin red.
  class ExposedList extends AgentDriverList {
    seed(dict: Record<string, unknown>, def: string) {
      this.dict = dict as never;
      this.defaultModelName = def;
    }
    pick(modelName: string) {
      return this.resolveDriver(modelName);
    }
  }

  const make = () => new ExposedList(fakeDriver());
  const agentA = { tag: "a" } as never;
  const agentB = { tag: "b" } as never;

  test("modelName presente → ese driver exacto", () => {
    const list = make();
    list.seed({ a: agentA, b: agentB }, "a");
    expect(list.pick("b")).toBe(agentB);
    expect(list.hasUsableModel()).toBe(true);
  });

  test("default STALE (free-tier removido) pero hay BYO configurado → resuelve al configurado, NO tira", () => {
    const list = make();
    // dict solo tiene el modelo BYO; el default quedó apuntando a un modelo viejo.
    list.seed({ "claude-opus-4-8": agentA }, "llama-3.3-70b");
    // El modelName pedido es el stale (lo que pasan query-tab/chat-tab vía
    // getDefaultModelName). Antes esto tiraba "model not available" en run() y chat().
    expect(list.pick("llama-3.3-70b")).toBe(agentA);
    expect(list.hasUsableModel()).toBe(true);
  });

  test("dict vacío → undefined (sin provider configurado)", () => {
    const list = make();
    list.seed({}, "llama-3.3-70b");
    expect(list.pick("x")).toBeUndefined();
    expect(list.hasUsableModel()).toBe(false);
  });
});

describe("ChatGPTDriver.query — modelo configurado + manejo de errores", () => {
  const mockFetch = (payload: unknown) =>
    jest.fn().mockResolvedValue({
      json: async () => payload,
    } as Response);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("manda el MODELO CONFIGURADO (no el hardcodeado gpt-4o-mini)", async () => {
    const fetchSpy = mockFetch({
      choices: [{ message: { role: "assistant", content: "SELECT 1" } }],
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new ChatGPTDriver(
      fakeDriver(),
      "sk-test",
      "gpt-5.1-2025-11-13"
    );
    await driver.query([{ role: "user", content: "hi" }]);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.model).toBe("gpt-5.1-2025-11-13");
    expect(body.model).not.toBe("gpt-4o-mini");
  });

  test("respuesta de error de OpenAI ({error} sin choices) → Error legible, NO 'reading 0'", async () => {
    global.fetch = mockFetch({
      error: { message: "The model `gpt-4o-mini` does not exist." },
    }) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk-test", "gpt-4o-mini");
    await expect(driver.query([{ role: "user", content: "hi" }])).rejects.toThrow(
      "The model `gpt-4o-mini` does not exist."
    );
    // El bug original: "Cannot read properties of undefined (reading '0')".
    await expect(
      driver.query([{ role: "user", content: "hi" }])
    ).rejects.not.toThrow(/reading '0'/);
  });

  test("respuesta sin choices ni error → Error defensivo (no crashea con choices[0])", async () => {
    global.fetch = mockFetch({}) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk-test", "gpt-4o-mini");
    await expect(
      driver.query([{ role: "user", content: "hi" }])
    ).rejects.toThrow(/sin choices/);
  });

  test("respuesta exitosa → devuelve el content del primer choice", async () => {
    global.fetch = mockFetch({
      choices: [
        { message: { role: "assistant", content: "SELECT count(*) FROM books" } },
      ],
    }) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk-test", "gpt-4o-mini");
    await expect(driver.query([{ role: "user", content: "hi" }])).resolves.toBe(
      "SELECT count(*) FROM books"
    );
  });
});
