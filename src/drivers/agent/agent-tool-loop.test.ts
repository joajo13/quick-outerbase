import CommonAgentDriverImplementation, {
  CommonAgentMessage,
  QueryStreamResult,
} from "./common";
import {
  AgentStreamCallback,
  AgentToolCall,
  AgentToolResult,
} from "./base";
import { BaseDriver } from "../base-driver";

// Driver de prueba: queryStream devuelve respuestas de un guión predefinido, así
// testeamos el loop de tool calling sin pegarle a ningún provider real.
class ScriptedDriver extends CommonAgentDriverImplementation {
  constructor(private script: QueryStreamResult[]) {
    super({
      getFlags: () => ({ dialect: "sqlite" }),
    } as unknown as BaseDriver);
  }

  async query(): Promise<string> {
    return "fallback";
  }

  async queryStream(
    _messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    _enableTools: boolean
  ): Promise<QueryStreamResult> {
    const next = this.script.shift() ?? { text: "", toolCalls: [] };
    if (next.text) onEvent({ type: "text", delta: next.text });
    for (const tc of next.toolCalls) {
      onEvent({
        type: "tool_call",
        id: tc.id,
        name: tc.name,
        args: JSON.stringify(tc.args),
      });
    }
    return next;
  }
}

const call = (id: string, sql: string): AgentToolCall => ({
  id,
  name: "run_query",
  args: { sql },
});

test("ejecuta la tool, reinyecta el resultado y continúa hasta done", async () => {
  const driver = new ScriptedDriver([
    { text: "", toolCalls: [call("1", "SELECT 1")] },
    { text: "El resultado es 1", toolCalls: [] },
  ]);
  const executed: AgentToolCall[] = [];
  const executeTool = async (c: AgentToolCall): Promise<AgentToolResult> => {
    executed.push(c);
    return { ok: true, content: "rows: [{n:1}]" };
  };
  const events: string[] = [];
  const text = await driver.chatStream(
    "dame 1",
    undefined,
    { selected: "" },
    (e) => events.push(e.type),
    executeTool
  );

  expect(executed).toHaveLength(1);
  expect(executed[0].args.sql).toBe("SELECT 1");
  expect(text).toContain("El resultado es 1");
  expect(events).toContain("done");
});

test("corta el loop si el usuario cancela", async () => {
  const driver = new ScriptedDriver([
    { text: "", toolCalls: [call("1", "DROP TABLE t")] },
    { text: "no debería llegar acá", toolCalls: [] },
  ]);
  let secondTurnReached = false;
  const executeTool = async (): Promise<AgentToolResult> => ({
    ok: false,
    content: "El usuario no ejecutó la query.",
    cancelled: true,
  });
  const events: string[] = [];
  await driver.chatStream(
    "borrá",
    undefined,
    { selected: "" },
    (e) => {
      if (e.type === "text" && e.delta.includes("no debería")) {
        secondTurnReached = true;
      }
      events.push(e.type);
    },
    executeTool
  );
  expect(events).toContain("done");
  expect(secondTurnReached).toBe(false);
});

test("respeta MAX_TOOL_ITERATIONS", async () => {
  const driver = new ScriptedDriver(
    Array.from({ length: 20 }, (_, i) => ({
      text: "",
      toolCalls: [call(String(i), "SELECT 1")],
    }))
  );
  let n = 0;
  const executeTool = async (): Promise<AgentToolResult> => {
    n++;
    return { ok: true, content: "ok" };
  };
  await driver.chatStream(
    "loop",
    undefined,
    { selected: "" },
    () => {},
    executeTool
  );
  expect(n).toBeLessThanOrEqual(8);
});

test("sin executeTool se comporta como hoy (texto plano)", async () => {
  const driver = new ScriptedDriver([{ text: "hola", toolCalls: [] }]);
  const text = await driver.chatStream(
    "hola",
    undefined,
    { selected: "" },
    () => {}
  );
  expect(text).toBe("hola");
});
