import { BaseDriver, DatabaseTableSchema } from "../base-driver";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
import AgentDriverList from "./list";

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
