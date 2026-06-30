# Chat agéntico con ejecución de queries — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chat del agente AI pueda ejecutar la query que propone vía una tool `run_query`, ver el resultado, y responder en base a él — con un gate de confirmación (toggle auto-run; los writes siempre frenan).

**Architecture:** Tool calling real, con el **loop en el driver** (`common.ts`): `chatStream` corre `queryStream`, detecta `tool_use`, ejecuta cada tool vía un callback `executeTool` que provee la UI (gate + `databaseDriver.query()` + mini-grilla), reinyecta el `tool_result` y continúa hasta `done` o 8 iteraciones. El historial multi-turn (`CommonAgentMessage[]`) se extiende con campos agnósticos de tool calls; cada provider los traduce a su dialecto (Anthropic content blocks, OpenAI `tool_calls`/`role:"tool"`, Gemini `functionCall`/`functionResponse`). La UI clasifica read/write con `classifyStatement` (sobre el `getSQLStatementType` existente) y aplica el gate.

**Tech Stack:** Next.js 15 + React 19, TypeScript, jest (`testEnvironment: node`, `.test.ts` al lado del archivo), Tailwind v4, lucide-react / @phosphor-icons. Comandos: `npm test -- <ruta>`, `npm run typecheck`.

## Global Constraints

- **Una sola tool:** `run_query({ sql: string, reason?: string })`. Nada de `list_tables`/`describe_table` (el schema ya va en el system prompt).
- **Gate:** writes/DDL **siempre** frenan (confirmación explícita) aunque `autoRun` esté on. Solo lecturas respetan el toggle. Ante la duda, `classifyStatement` devuelve `"write"` (fail-safe).
- **Loop:** máximo `MAX_TOOL_ITERATIONS = 8` vueltas. Si se alcanza, corta y avisa.
- **Resultado al modelo:** headers + primeras **50 filas** compactas + total + duración; celdas largas truncadas. Mini-grilla en UI: ~100 filas con scroll + "Abrir en editor".
- **Aditivo:** no romper `run()`/`chat()` ni el hard-fallback no-streaming existente. El tool calling solo aplica a `chatStream`.
- **Idioma del código:** comentarios cortos en español rioplatense, matchear el estilo del archivo vecino.
- **Cambios sin commitear previos:** trabajar sobre el estado actual del working tree (rediseño del chat ya aplicado). No revertir nada ajeno.

---

### Task 1: `classifyStatement` (read/write) — función pura

Clasifica un statement SQL como lectura o escritura. Reusa `getSQLStatementType` de `sql-helper.ts` y agrega keywords que ese helper no cubre (DELETE, TRUNCATE, REPLACE, GRANT, etc.). Fail-safe a `write`.

**Files:**
- Create: `src/lib/sql/classify-statement.ts`
- Test: `src/lib/sql/classify-statement.test.ts`

**Interfaces:**
- Consumes: `getSQLStatementType` de `@/drivers/sql-helper`.
- Produces:
  ```ts
  export type StatementAccess = "read" | "write";
  export function classifyStatement(sql: string): StatementAccess;
  export function classifyStatements(sql: string): StatementAccess; // multi-statement: write si alguno es write
  ```

- [ ] **Step 1: Test que falla** — `src/lib/sql/classify-statement.test.ts`:

```ts
import { classifyStatement, classifyStatements } from "./classify-statement";

describe("classifyStatement", () => {
  test("SELECT y variantes de lectura → read", () => {
    expect(classifyStatement("SELECT * FROM users")).toBe("read");
    expect(classifyStatement("  select 1")).toBe("read");
    expect(classifyStatement("EXPLAIN QUERY PLAN SELECT 1")).toBe("read");
    expect(classifyStatement("PRAGMA table_info(users)")).toBe("read");
    expect(classifyStatement("SHOW TABLES")).toBe("read");
    expect(classifyStatement("WITH t AS (SELECT 1) SELECT * FROM t")).toBe("read");
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
  });

  test("CTE que termina en DELETE → write", () => {
    expect(classifyStatement("WITH t AS (SELECT 1) DELETE FROM x WHERE id IN (SELECT * FROM t)")).toBe("write");
  });

  test("fail-safe: vacío o desconocido → write", () => {
    expect(classifyStatement("")).toBe("write");
    expect(classifyStatement("VACUUM")).toBe("write");
    expect(classifyStatement("blah blah")).toBe("write");
  });
});

describe("classifyStatements", () => {
  test("si algún statement es write → write", () => {
    expect(classifyStatements("SELECT 1; SELECT 2")).toBe("read");
    expect(classifyStatements("SELECT 1; DELETE FROM t")).toBe("read" === "read" ? "write" : "write");
    expect(classifyStatements("SELECT 1; UPDATE t SET a=1")).toBe("write");
  });
});
```

- [ ] **Step 2: Correr y verificar que falla** — `npm test -- src/lib/sql/classify-statement.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — `src/lib/sql/classify-statement.ts`:

```ts
import { getSQLStatementType } from "@/drivers/sql-helper";
import { splitSqlQuery } from "@/components/lexer/sql"; // ajustar import real (ver nota)

export type StatementAccess = "read" | "write";

// Keywords de lectura que arrancan un statement. Todo lo demás → write (fail-safe).
const READ_PREFIXES = ["SELECT", "EXPLAIN", "PRAGMA", "SHOW", "DESCRIBE", "DESC ", "WITH"];

// Resuelve el statement "efectivo": si arranca con WITH (CTE), salta al primer
// keyword después del bloque de CTEs para ver si la operación final lee o escribe.
function effectiveHead(sql: string): string {
  const norm = sql.trim().replace(/\s+/g, " ").toUpperCase();
  if (!norm.startsWith("WITH")) return norm;
  // Buscar el verbo terminal tras los CTEs. Heurística simple: el último de estos
  // keywords que aparezca como palabra es la operación real.
  const WRITE_VERBS = ["INSERT", "UPDATE", "DELETE", "MERGE", "REPLACE"];
  for (const verb of WRITE_VERBS) {
    if (new RegExp(`\\b${verb}\\b`).test(norm)) return verb;
  }
  return "SELECT"; // WITH ... SELECT
}

export function classifyStatement(sql: string): StatementAccess {
  const head = effectiveHead(sql);
  if (!head) return "write";

  // getSQLStatementType cubre SELECT/INSERT/UPDATE/DDL de tablas/índices/vistas/triggers.
  const t = getSQLStatementType(sql);
  if (t === "SELECT") return "read";
  if (t !== "OTHER") return "write"; // INSERT/UPDATE/CREATE_*/ALTER_*/DROP_*

  // OTHER: desambiguar con el head (DELETE, TRUNCATE, PRAGMA, SHOW, etc.)
  if (READ_PREFIXES.some((p) => head.startsWith(p.trim()))) return "read";
  return "write";
}

// Multi-statement: si alguno es write, todo el bloque se trata como write.
export function classifyStatements(sql: string): StatementAccess {
  const parts = sql.split(";").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "write";
  return parts.some((p) => classifyStatement(p) === "write") ? "write" : "read";
}
```

> **Nota de implementación:** verificar el import real de un splitter de SQL si hace falta; si `splitSqlQuery` no está disponible o complica, usar el `split(";")` simple como en `classifyStatements` (suficiente para el gate). Quitar el import no usado.

- [ ] **Step 4: Correr y verificar que pasa** — `npm test -- src/lib/sql/classify-statement.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git add src/lib/sql/classify-statement.ts src/lib/sql/classify-statement.test.ts && git commit -m "feat(ai): classifyStatement read/write para el gate del chat"`

---

### Task 2: Tipos de tool calling (`base.ts`) + historial extendido (`common.ts`)

Define los tipos y la tool. Extiende `chatStream` con `executeTool`. Extiende `CommonAgentMessage` y `queryStream` para transportar tool calls.

**Files:**
- Modify: `src/drivers/agent/base.ts`
- Modify: `src/drivers/agent/common.ts:42-54` (firmas abstractas) y tipos

**Interfaces:**
- Produces (en `base.ts`):
  ```ts
  export interface AgentToolCall { id: string; name: string; args: Record<string, unknown> }
  export interface AgentToolResult { ok: boolean; content: string; cancelled?: boolean }
  export type AgentToolExecutor = (call: AgentToolCall) => Promise<AgentToolResult>;

  export const RUN_QUERY_TOOL = {
    name: "run_query",
    description:
      "Ejecuta un único statement SQL contra la base de datos conectada y devuelve el resultado (headers, filas y stats). Usala para responder preguntas sobre los datos. Preferí agregaciones (GROUP BY/LIMIT) antes que traer datasets grandes.",
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Un solo statement SQL." },
        reason: { type: "string", description: "Breve motivo de por qué corrés esta query." },
      },
      required: ["sql"],
    },
  } as const;

  // chatStream pasa a recibir un 5to parámetro OPCIONAL:
  abstract chatStream(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption,
    onEvent: AgentStreamCallback,
    executeTool?: AgentToolExecutor
  ): Promise<string>;
  ```
- Produces (en `common.ts`):
  ```ts
  export interface CommonAgentMessage {
    role: string; // "system" | "user" | "assistant" | "tool"
    content: string;
    toolCalls?: AgentToolCall[]; // en turnos assistant que invocan tools
    toolCallId?: string;         // en turnos "tool" (qué call responde)
  }

  export interface QueryStreamResult {
    text: string;
    toolCalls: AgentToolCall[]; // vacío = el modelo terminó sin pedir tools
  }

  abstract queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback
  ): Promise<QueryStreamResult>; // ⚠️ cambia de Promise<string> a QueryStreamResult
  ```

- [ ] **Step 1: Editar `base.ts`** — agregar `AgentToolCall`, `AgentToolResult`, `AgentToolExecutor`, `RUN_QUERY_TOOL`, y el parámetro `executeTool?` en la firma abstracta de `chatStream`. (El evento `tool_call` ya existe en `AgentStreamEvent`; conservarlo.)

- [ ] **Step 2: Editar `common.ts`** — extender `CommonAgentMessage` con `toolCalls?`/`toolCallId?`; agregar `QueryStreamResult`; cambiar el tipo de retorno abstracto de `queryStream` a `Promise<QueryStreamResult>`. Importar los tipos nuevos de `base.ts`.

- [ ] **Step 3: typecheck** — `npm run typecheck`. Va a fallar en los 3 drivers (queryStream retorna string) y en `chatStream` de common (usa el retorno). **Esperado**: esos errores se arreglan en Task 3–6. Si querés un checkpoint verde, hacé Task 2+3 juntos antes de commitear. Commit al final de Task 3.

---

### Task 3: Loop de tool calling en `common.ts`

Reescribe `chatStream` para iterar: correr `queryStream`, si hay tool calls ejecutarlas vía `executeTool`, reinyectar `tool_result` y volver. Agrega instrucciones de la tool al system prompt.

**Files:**
- Modify: `src/drivers/agent/common.ts` (`chatStream` líneas 261-326, `getSystemContent`, helpers de sesión)
- Test: `src/drivers/agent/agent-tool-loop.test.ts` (nuevo)

**Interfaces:**
- Consumes: `QueryStreamResult`, `AgentToolExecutor`, `AgentToolCall`, `AgentToolResult` (Task 2).
- Produces: `chatStream(message, previousId, option, onEvent, executeTool?)` con loop; constante `MAX_TOOL_ITERATIONS = 8`.

- [ ] **Step 1: Test que falla** — `src/drivers/agent/agent-tool-loop.test.ts`. Subclase mínima de `CommonAgentDriverImplementation` con `queryStream` y `query` mockeados por un guión de respuestas:

```ts
import CommonAgentDriverImplementation, { CommonAgentMessage, QueryStreamResult } from "./common";
import { AgentStreamCallback, AgentToolCall, AgentToolResult } from "./base";

// Driver de prueba: queryStream devuelve respuestas de una cola predefinida.
class ScriptedDriver extends CommonAgentDriverImplementation {
  constructor(private script: QueryStreamResult[]) {
    super({ getFlags: () => ({ dialect: "sqlite" }) } as any);
  }
  async query(): Promise<string> { return "fallback"; }
  async queryStream(_m: CommonAgentMessage[], onEvent: AgentStreamCallback): Promise<QueryStreamResult> {
    const next = this.script.shift() ?? { text: "", toolCalls: [] };
    if (next.text) onEvent({ type: "text", delta: next.text });
    for (const tc of next.toolCalls) onEvent({ type: "tool_call", id: tc.id, name: tc.name, args: JSON.stringify(tc.args) });
    return next;
  }
}

const call = (id: string, sql: string): AgentToolCall => ({ id, name: "run_query", args: { sql } });

test("ejecuta la tool, reinyecta el resultado y continúa hasta done", async () => {
  const driver = new ScriptedDriver([
    { text: "", toolCalls: [call("1", "SELECT 1")] }, // 1er turno: pide tool
    { text: "El resultado es 1", toolCalls: [] },       // 2do turno: responde
  ]);
  const executed: AgentToolCall[] = [];
  const executeTool = async (c: AgentToolCall): Promise<AgentToolResult> => {
    executed.push(c);
    return { ok: true, content: "rows: [{n:1}]" };
  };
  const events: string[] = [];
  const text = await driver.chatStream("dame 1", undefined, { selected: "" }, (e) => events.push(e.type), executeTool);

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
  const executeTool = async (): Promise<AgentToolResult> => ({ ok: false, content: "cancelled", cancelled: true });
  const events: string[] = [];
  const text = await driver.chatStream("borrá", undefined, { selected: "" }, (e) => events.push(e.type), executeTool);
  expect(events).toContain("done");
  // Tras cancelar, el modelo recibe el tool_result cancelled y cierra: no se ejecuta el 2do guión como tool.
});

test("respeta MAX_TOOL_ITERATIONS", async () => {
  // queryStream siempre pide una tool nueva → debe cortar a las 8.
  const driver = new ScriptedDriver(
    Array.from({ length: 20 }, (_, i) => ({ text: "", toolCalls: [call(String(i), "SELECT 1")] }))
  );
  let n = 0;
  const executeTool = async (): Promise<AgentToolResult> => { n++; return { ok: true, content: "ok" }; };
  await driver.chatStream("loop", undefined, { selected: "" }, () => {}, executeTool);
  expect(n).toBeLessThanOrEqual(8);
});

test("sin executeTool se comporta como hoy (texto plano)", async () => {
  const driver = new ScriptedDriver([{ text: "hola", toolCalls: [] }]);
  const text = await driver.chatStream("hola", undefined, { selected: "" }, () => {});
  expect(text).toBe("hola");
});
```

- [ ] **Step 2: Correr y verificar que falla** — `npm test -- src/drivers/agent/agent-tool-loop.test.ts` → FAIL.

- [ ] **Step 3: Implementar el loop** — reescribir `chatStream` en `common.ts`. Esqueleto (con el hard-fallback preservado dentro de `runOneTurn`):

```ts
export const MAX_TOOL_ITERATIONS = 8;

async chatStream(
  message: string,
  previousId: string | undefined,
  option: AgentPromptOption,
  onEvent: AgentStreamCallback,
  executeTool?: AgentToolExecutor
): Promise<string> {
  const session = this.prepareSession(message, previousId, { ...option, conversational: true });
  let lastText = "";

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let result: QueryStreamResult;
    try {
      result = await this.runStreamTurn(session.messages, onEvent);
    } catch (err) {
      // hard-fallback no-streaming (igual que hoy, pero solo en el 1er turno sin texto)
      result = await this.fallbackTurn(session.messages, onEvent, err);
    }
    lastText = result.text || lastText;

    if (!executeTool || result.toolCalls.length === 0) {
      this.persistAssistant(session, result.text);
      onEvent({ type: "done" });
      return result.text;
    }

    // Persistir el turno assistant CON los tool_use, y ejecutar cada tool.
    session.messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
    let cancelled = false;
    for (const tc of result.toolCalls) {
      const toolResult = await executeTool(tc);
      session.messages.push({ role: "tool", content: toolResult.content, toolCallId: tc.id });
      if (toolResult.cancelled) cancelled = true;
    }
    if (cancelled) {
      // dar una última vuelta para que el modelo cierre, o cortar acá:
      // simplest: cortar con lo que haya.
      onEvent({ type: "done" });
      return lastText;
    }
  }

  // Se alcanzó el tope de iteraciones.
  onEvent({ type: "error", message: "Se alcanzó el máximo de pasos del agente." });
  onEvent({ type: "done" });
  return lastText;
}
```

Helpers privados:
- `runStreamTurn(messages, onEvent)`: envuelve `queryStream` con el acumulador de texto (igual que el `wrapped` actual) y devuelve `QueryStreamResult`.
- `fallbackTurn(messages, onEvent, err)`: la lógica de fallback actual (si no hubo texto → `query()` no-streaming → emitir un `text`), devolviendo `{ text, toolCalls: [] }`. El no-streaming NO soporta tools (acotado: el fallback solo aplica cuando el streaming ni arrancó).

- [ ] **Step 4: Instrucciones de la tool en `getSystemContent`** — cuando `option.conversational`, agregar a `guidance`:

```ts
guidance.push(
  "Tenés una herramienta `run_query(sql, reason?)` que ejecuta UN statement SQL y te devuelve el resultado. Usala para responder preguntas sobre los datos en vez de adivinar. Preferí agregaciones (GROUP BY/LIMIT) antes que traer muchas filas. Después de ver el resultado, respondé en prosa interpretándolo."
);
```

- [ ] **Step 5: Correr tests** — `npm test -- src/drivers/agent/agent-tool-loop.test.ts` → PASS. Correr también `npm test -- src/drivers/agent/agent-stream.test.ts` para no regresionar el fallback.

- [ ] **Step 6: Commit** — `git add src/drivers/agent/base.ts src/drivers/agent/common.ts src/drivers/agent/agent-tool-loop.test.ts && git commit -m "feat(ai): loop de tool calling en common.ts + tipos run_query"`

---

### Task 4: Anthropic — tools + parseo `tool_use`

**Files:**
- Modify: `src/drivers/agent/anthropic.ts` (`queryStream` 81-146; tipos de stream event)

**Interfaces:**
- Consumes: `RUN_QUERY_TOOL`, `CommonAgentMessage` (con `toolCalls`/`toolCallId`), `QueryStreamResult`.
- Produces: `queryStream(...) => Promise<QueryStreamResult>` con tool_use.

- [ ] **Step 1: Mapear mensajes a content blocks** — al construir `chatMessages`, traducir:
  - `role:"assistant"` con `toolCalls` → `content: [{ type:"text", text }, ...toolCalls.map(tc => ({ type:"tool_use", id: tc.id, name: tc.name, input: tc.args }))]`.
  - `role:"tool"` → `role:"user"`, `content: [{ type:"tool_result", tool_use_id: m.toolCallId, content: m.content }]`.
  - resto → `{ role, content: m.content }`.
- [ ] **Step 2: Mandar `tools`** — agregar al body `tools: [{ name: RUN_QUERY_TOOL.name, description: RUN_QUERY_TOOL.description, input_schema: RUN_QUERY_TOOL.parameters }]`.
- [ ] **Step 3: Parsear `tool_use` en el SSE** — manejar:
  - `content_block_start` con `content_block.type === "tool_use"` → arrancar un buffer `{ id, name, argsJson: "" }`.
  - `content_block_delta` con `delta.type === "input_json_delta"` → `argsJson += delta.partial_json`.
  - `content_block_stop` → cerrar el buffer: `JSON.parse(argsJson)` → push a `toolCalls` y emitir `onEvent({ type:"tool_call", id, name, args: argsJson })`.
  - `message_delta`/`message_stop` con `stop_reason:"tool_use"` → fin del turno con tool calls.
- [ ] **Step 4: Devolver `{ text: acc, toolCalls }`.** Extender los tipos locales `AnthropicStreamEvent` para los campos nuevos.
- [ ] **Step 5: typecheck + Commit** — `npm run typecheck` (Anthropic ok); `git add src/drivers/agent/anthropic.ts && git commit -m "feat(ai): tool_use run_query en el driver Anthropic"`

---

### Task 5: OpenAI — tools + parseo `tool_calls`

**Files:**
- Modify: `src/drivers/agent/chatgpt.ts` (`queryStreamChat` 93-134, `queryStreamResponses` 141-207)

**Interfaces:** igual que Task 4, formato OpenAI.

- [ ] **Step 1: chat-completions** — agregar `tools: [{ type:"function", function: { name, description, parameters } }]` al body. Mapear historial: `assistant` con `toolCalls` → `{ role:"assistant", content: text || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type:"function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }`; `tool` → `{ role:"tool", tool_call_id: m.toolCallId, content: m.content }`.
- [ ] **Step 2: Parsear deltas de tool_calls** — acumular por índice: `chunk.choices[0].delta.tool_calls[i]` trae `id`, `function.name`, `function.arguments` (fragmentos). Acumular `arguments` por índice; `finish_reason:"tool_calls"` cierra. Emitir `tool_call` y push a `toolCalls`.
- [ ] **Step 3: Responses API** — agregar `tools` en formato responses (`{ type:"function", name, description, parameters }`); parsear `response.output_item.added`/`response.function_call_arguments.delta`/`response.output_item.done` para reconstruir la function call. Mapear historial con `function_call`/`function_call_output` items en `input`.
- [ ] **Step 4: Ambos devuelven `{ text, toolCalls }`.** typecheck + Commit — `git add src/drivers/agent/chatgpt.ts && git commit -m "feat(ai): tool_use run_query en el driver OpenAI (chat + responses)"`

---

### Task 6: Gemini — tools + parseo `functionCall`

**Files:**
- Modify: `src/drivers/agent/gemini.ts` (`queryStream` 77-138; y `query` para el fallback de mapeo si aplica)

**Interfaces:** igual, formato Gemini.

- [ ] **Step 1: Mandar tools** — agregar al body `tools: [{ functionDeclarations: [{ name, description, parameters }] }]`.
- [ ] **Step 2: Mapear historial** — `assistant` con `toolCalls` → `{ role:"model", parts: toolCalls.map(tc => ({ functionCall: { name: tc.name, args: tc.args } })) }` (+ part de texto si hay); `tool` → `{ role:"user", parts: [{ functionResponse: { name:"run_query", response: { result: m.content } } }] }`.
- [ ] **Step 3: Parsear `functionCall`** — en cada part: si `part.functionCall` → push `{ id: generado, name: part.functionCall.name, args: part.functionCall.args }` y emitir `tool_call`. (Gemini no da id → generar uno con `generateId()`.)
- [ ] **Step 4: Devolver `{ text: acc, toolCalls }`.** typecheck + Commit — `git add src/drivers/agent/gemini.ts && git commit -m "feat(ai): functionCall run_query en el driver Gemini"`

---

### Task 7: Gate + estado en `chat-tab.tsx`

Implementa `executeTool` (clasifica, aplica gate, ejecuta, devuelve), el toggle `autoRun`, y cablea `executeTool` en la llamada a `chatStream`. Extiende `ChatMessage`/`ToolCall` para persistir el run.

**Files:**
- Modify: `src/components/gui/tabs/chat-tab.tsx` (`ToolCall`/`ChatMessage` 30-46, `applyEvent` 50-87, `onSend` 302-407, render)

**Interfaces:**
- Consumes: `classifyStatement` (Task 1), `databaseDriver.query` (`DatabaseResultSet`), `AgentToolCall`/`AgentToolResult` (Task 2), `ChatToolCallCard` (Task 8).
- Produces: `executeTool` que se pasa como 5to arg a `agentDriver.chatStream`.

- [ ] **Step 1: Extender tipos** — `ToolCall` suma estado del run:
  ```ts
  interface ToolCall {
    id: string;
    name: string;
    args?: string;
    sql?: string;
    reason?: string;
    status?: "pending" | "running" | "done" | "error" | "cancelled";
    result?: { headers: string[]; rows: unknown[][]; rowCount: number; durationMs: number | null };
    error?: string;
  }
  ```
- [ ] **Step 2: Estado `autoRun`** — `const [autoRun, setAutoRun] = useState(() => localStorage.getItem("chat-auto-run") === "1")`; persistir en un `useEffect`. Toggle (switch) en la barra del chat.
- [ ] **Step 3: `executeTool`** — `useCallback` que:
  1. Parsea `args` → `{ sql, reason }`.
  2. `const access = classifyStatement(sql)`.
  3. `const mustConfirm = access === "write" || !autoRun`.
  4. Si `mustConfirm`: setear el toolCall en estado `pending` con los botones (Run/Abrir/Copiar/Descartar) y devolver una Promise que resuelve cuando el usuario actúa (guardar `resolve` en un ref/map por `id`). Descartar → `{ ok:false, content:"El usuario no ejecutó la query.", cancelled:true }`.
  5. Al confirmar (o si no `mustConfirm`): estado `running` → `await databaseDriver.query(sql)` → estado `done` con el result (mapear `DatabaseResultSet` a `{ headers, rows, rowCount, durationMs }`) → devolver `{ ok:true, content: formatForModel(resultSet) }`.
  6. En catch: estado `error` → `{ ok:false, content: "Error: " + message }`.
  7. `formatForModel`: headers + 50 filas compactas + total + duración, celdas largas truncadas.
- [ ] **Step 4: Cablear en `onSend`** — pasar `executeTool` como 5to arg de `chatStream`. El `applyEvent` para `tool_call` ya agrega el chip; extenderlo para guardar `sql`/`reason`/`status:"pending"` parseando `args`.
- [ ] **Step 5: Render** — reemplazar `ToolCallChips` por `ChatToolCallCard` (Task 8) para los toolCalls del mensaje. Mantener el chip como fallback visual si no hay `sql`.
- [ ] **Step 6: typecheck + Commit** — `git add src/components/gui/tabs/chat-tab.tsx && git commit -m "feat(ai): gate de ejecucion (executeTool + auto-run) en el chat"`

---

### Task 8: `ChatToolCallCard` con mini-grilla

Componente presentacional del run: query read-only + reason + botones + estados + mini-grilla.

**Files:**
- Create: `src/components/gui/tabs/chat-tool-call-card.tsx`

**Interfaces:**
- Consumes: `ToolCall` (estado de Task 7), `SqlEditor`, `scc.tabs.openBuiltinQuery`.
- Produces:
  ```ts
  export interface ChatToolCallCardProps {
    toolCall: ToolCall;
    dialect: SupportedDialect;
    onRun: () => void;
    onDiscard: () => void;
  }
  export default function ChatToolCallCard(props: ChatToolCallCardProps): JSX.Element;
  ```

- [ ] **Step 1: Crear el componente** — card con:
  - Header: ícono + `reason` (o "Ejecutar query").
  - Query en `SqlEditor readOnly` (como `CodeBlock`).
  - Si `status === "pending"`: botones **Run** · **Abrir en editor** (`scc.tabs.openBuiltinQuery({ name:"From Chat", initialCode: sql })`) · **Copiar** · **Descartar**.
  - Si `status === "running"`: spinner.
  - Si `status === "done"`: mini-grilla (`<table>` simple, ~100 filas con `max-h` + scroll) + stats (filas, ms) + "Abrir en editor".
  - Si `status === "error"`: mensaje de error + "Abrir en editor".
  - Si `status === "cancelled"`: query a mano + "Abrir en editor" / "Copiar".
- [ ] **Step 2: typecheck** — `npm run typecheck` → PASS.
- [ ] **Step 3: Commit** — `git add src/components/gui/tabs/chat-tool-call-card.tsx && git commit -m "feat(ai): ChatToolCallCard con mini-grilla inline"`

---

### Task 9: Verificación e2e

- [ ] **Step 1: typecheck + tests** — `npm run typecheck` y `npm test` → PASS (sin regresiones en `agent-stream.test.ts`).
- [ ] **Step 2: Manual (browser, puerto 3008, Claude in Chrome)** — conectar a una base con datos y verificar:
  1. "Dame un reporte de los 20 mejores productos" → el agente propone la query → con auto-run OFF aparece el card `pending` → Run → mini-grilla → el agente responde interpretando. ✓
  2. Auto-run ON → la lectura corre sola sin frenar. ✓
  3. Un `UPDATE`/`DELETE` con auto-run ON → **frena igual** (card pending). ✓
  4. Query que falla (columna inexistente) → el agente ve el error y propone una corrección. ✓
  5. Descartar → el agente cierra sin ejecutar; quedan "Abrir en editor"/"Copiar". ✓
  6. "Abrir en editor" desde el card → abre un query-tab con el SQL. ✓
- [ ] **Step 3: Commit final** si hubo ajustes.

---

## Self-Review

**Spec coverage:**
- Multi-step tool calling real → Task 2 (tipos) + Task 3 (loop) + Task 4–6 (drivers).
- Loop en el driver (Opción A) → Task 3; historial agnóstico extendido → Task 2; traducción por provider → Task 4–6.
- Toggle auto-run → Task 7 (estado + gate).
- Writes/DDL siempre frenan → Task 1 (`classifyStatement` fail-safe) + Task 7 (`mustConfirm = write || !autoRun`).
- Resultado inline mini-grilla + "Abrir en editor" → Task 8; sample 50 filas al modelo → Task 7 (`formatForModel`).
- Frena si no se corre (Abrir/Copiar) → Task 7 (gate pending) + Task 8 (botones).
- Auto-corrección de errores → Task 3 (reinyecta error como tool_result) verificado en Task 9 step 2.4.
- Máx 8 iteraciones → Task 3 (`MAX_TOOL_ITERATIONS`).
- No romper fallback no-streaming → Task 3 (`fallbackTurn`), verificado en Task 9 step 1.

**Type consistency:** `AgentToolCall`/`AgentToolResult`/`AgentToolExecutor` (Task 2) se usan idénticos en Task 3 (loop) y Task 7 (`executeTool`). `QueryStreamResult` (Task 2) es el retorno de `queryStream` en Task 4–6 y el consumo en Task 3. `ToolCall` extendido (Task 7) se consume en `ChatToolCallCard` (Task 8).

**Placeholder scan:** el único punto "a verificar en implementación" es el import del splitter de SQL en Task 1 (con fallback explícito a `split(";")`). Sin TODOs en el resto.

**Riesgo principal:** el parseo de `tool_use` en streaming por provider (Task 4–6) es lo más delicado; los tests del loop (Task 3) usan un provider scripteado, así que el parseo real se valida en la verificación manual (Task 9). Si un provider da problemas con streaming de tools, el modelo igual cae al fallback no-streaming (sin tools) — aceptable como degradación.
