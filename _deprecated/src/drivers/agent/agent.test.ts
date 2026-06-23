import { AnthropicDriver } from "./anthropic";
import { ChatGPTDriver } from "./chatgpt";
import { GeminiDriver } from "./gemini";
import { BaseDriver } from "../base-driver";

// Driver mínimo: los agentes solo usan getFlags().dialect al armar el system prompt.
const fakeDriver = {
  getFlags: () => ({ dialect: "postgres", defaultSchema: "public" }),
} as unknown as BaseDriver;

function driverForDialect(dialect: string): BaseDriver {
  return {
    getFlags: () => ({ dialect, defaultSchema: "default" }),
  } as unknown as BaseDriver;
}

function mockFetchOnce(jsonBody: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    json: async () => jsonBody,
  });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  return fetchMock;
}

describe("LLM agent drivers — request por proveedor y parseo de respuesta", () => {
  const messages = [
    { role: "system", content: "You are an SQL expert" },
    { role: "user", content: "list users" },
  ];

  test("Anthropic: arma el request correcto y parsea content[].text", async () => {
    const fetchMock = mockFetchOnce({
      content: [{ type: "text", text: "```sql\nSELECT * FROM users;\n```" }],
    });

    const agent = new AnthropicDriver(fakeDriver, "sk-ant-KEY", "claude-opus-4-8");
    const out = await agent.query(messages);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-ant-KEY");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe(
      "true"
    );
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-opus-4-8");
    // system va top-level, NO dentro de messages
    expect(body.system).toBe("You are an SQL expert");
    expect(body.messages).toEqual([{ role: "user", content: "list users" }]);
    // parseo correcto del texto
    expect(out).toContain("SELECT * FROM users;");
  });

  test("Anthropic: processResult extrae el bloque SQL (text-to-SQL)", async () => {
    mockFetchOnce({
      content: [{ type: "text", text: "Sure:\n```sql\nSELECT 1;\n```" }],
    });
    const agent = new AnthropicDriver(fakeDriver, "KEY");
    const result = await agent.run("generate a query", undefined, {
      selected: "",
    });
    expect(result.trim()).toBe("SELECT 1;");
  });

  test("Anthropic: processResult devuelve prosa cuando no hay SQL (explicar)", async () => {
    mockFetchOnce({
      content: [{ type: "text", text: "Esta tabla guarda usuarios." }],
    });
    const agent = new AnthropicDriver(fakeDriver, "KEY");
    const result = await agent.run("explain table users", undefined, {
      selected: "",
    });
    expect(result).toBe("Esta tabla guarda usuarios.");
  });

  test("OpenAI: arma el request correcto y parsea choices[0].message.content", async () => {
    const fetchMock = mockFetchOnce({
      choices: [
        { message: { role: "assistant", content: "```sql\nSELECT 2;\n```" } },
      ],
    });

    const agent = new ChatGPTDriver(fakeDriver, "sk-openai-KEY");
    const out = await agent.query(messages);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-openai-KEY");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual(messages);
    expect(out).toContain("SELECT 2;");
  });

  test("Gemini: arma el request correcto y parsea candidates[0].content.parts", async () => {
    const fetchMock = mockFetchOnce({
      candidates: [
        { content: { parts: [{ text: "```sql\nSELECT 3;\n```" }] } },
      ],
    });

    const agent = new GeminiDriver(fakeDriver, "gm-KEY", "gemini-2.0-flash");
    const out = await agent.query(messages);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    expect(url).toContain("key=gm-KEY");
    const body = JSON.parse(init.body);
    // systemInstruction separado, roles mapeados a user/model
    expect(body.systemInstruction.parts[0].text).toBe("You are an SQL expert");
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "list users" }] },
    ]);
    expect(out).toContain("SELECT 3;");
  });

  test("Errores del proveedor se propagan", async () => {
    mockFetchOnce({ error: { message: "invalid api key" } });
    const agent = new AnthropicDriver(fakeDriver, "bad");
    await expect(agent.query(messages)).rejects.toThrow("invalid api key");
  });
});

// ---------------------------------------------------------------------------
// getSystemContent — rama por dialecto (DynamoDB = PartiQL, resto = SQL)
// ---------------------------------------------------------------------------

describe("getSystemContent — DynamoDB usa PartiQL, no SQL genérico", () => {
  // Cualquier driver de agente sirve: getSystemContent vive en el común.
  const agentFor = (dialect: string) =>
    new AnthropicDriver(driverForDialect(dialect), "KEY");

  test("dynamodb (generar): enseña PartiQL y NO instruye SQL genérico", () => {
    const sys = agentFor("dynamodb").getSystemContent({ selected: "" });

    // Menciona PartiQL y DynamoDB explícitamente.
    expect(sys).toMatch(/PartiQL/);
    expect(sys).toMatch(/DynamoDB/);
    // NO debe decir "You are an SQL expert" (el prompt viejo y errado).
    expect(sys).not.toMatch(/You are an SQL expert/);
    // Reglas clave que evitan los errores reportados (VALUES, JOINs):
    expect(sys).toMatch(/VALUE \{/); // sintaxis de documento, no VALUES (...)
    expect(sys).toMatch(/double quotes/i); // nombres de tabla entre comillas dobles
    expect(sys).toMatch(/NO JOINs/);
    // Sigue pidiendo fence ```sql porque processResult extrae ese bloque.
    expect(sys).toMatch(/```sql/);
  });

  test("dynamodb (mejorar selección): también es PartiQL y menciona mejorar", () => {
    const sys = agentFor("dynamodb").getSystemContent({
      selected: "SELECT * FROM \"Users\"",
    });

    expect(sys).toMatch(/PartiQL/);
    expect(sys).toMatch(/improve/i);
    expect(sys).not.toMatch(/You are an SQL expert/);
  });

  test.each(["postgres", "mysql", "sqlite", "dolt", "libsql"])(
    "%s: el prompt queda INTACTO (SQL expert, sin PartiQL)",
    (dialect) => {
      const generate = agentFor(dialect).getSystemContent({ selected: "" });
      const improve = agentFor(dialect).getSystemContent({
        selected: "SELECT 1",
      });

      // Exactamente el prompt original, byte por byte.
      expect(generate).toBe(
        `You are an SQL expert. User is using ${dialect}.Only return SQL code`
      );
      expect(improve).toBe(
        `You are an SQL expert. User is using ${dialect}. You are given a user selected query and you will improve it. Only return SQL code`
      );
      // Y nunca menciona PartiQL.
      expect(generate).not.toMatch(/PartiQL/);
      expect(improve).not.toMatch(/PartiQL/);
    }
  );
});
