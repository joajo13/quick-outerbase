# Chat agéntico con ejecución de queries — Design

**Fecha:** 2026-06-30
**Estado:** Implementado (typecheck + 173 tests + lint OK; pendiente e2e manual con API key + base con datos)

## Objetivo

Hacer el chat del agente AI **agéntico de verdad**: que pueda **ejecutar la query** que propone, **ver el resultado** (igual que el usuario), y **responder en base a ese resultado**. El caso canónico:

> Usuario: "Dame un reporte de los 20 mejores productos"
> Agente: propone la query → la corre (o frena pidiendo confirmación) → ve el resultado → escribe el reporte interpretando los datos.

Decisiones de producto (cerradas con el usuario):

1. **Multi-step tool calling real** — no es un solo paso pregunta/respuesta; el modelo decide cuándo correr queries vía una tool y puede encadenar (auto-corregir un SQL que falló, refinar, etc.).
2. **Toggle auto-run** en el chat: **off (default)** = confirmás cada query; **on** = corre solo sin frenar (para lecturas).
3. **Writes/DDL siempre frenan** con confirmación explícita, **aunque el auto-run esté on**. Solo las lecturas respetan el toggle.
4. **Resultado inline en el chat** como mini-grilla truncada, con "Abrir en editor" para ver todo.
5. Si no la corrés (descartás), **frena ahí**: te quedan los botones "Abrir en editor" / "Copiar".

## Contexto actual (cómo funciona hoy)

- [`chat-tab.tsx`](../../../src/components/gui/tabs/chat-tab.tsx) es el dueño del chat: estado local de `ChatMessage[]`, streaming vía `agentDriver.chatStream()`, parseo de bloques ` ```sql ` con botones **"Abrir en editor"** (`scc.tabs.openBuiltinQuery`) y **"Copiar"**.
- [`base.ts`](../../../src/drivers/agent/base.ts) define la interfaz abstracta (`run`, `chat`, `chatStream`) y el tipo `AgentStreamEvent` que **ya incluye** `{ type: "tool_call"; id; name; args? }` y `done`/`error`/`text`/`reasoning`.
- **El tool calling es scaffold vacío:** la UI ya dibuja `ToolCallChips` y `applyEvent` ya parsea eventos `tool_call`, pero **ningún driver define tools ni emite esos eventos**. Hay que llenar el andamiaje.
- [`common.ts`](../../../src/drivers/agent/common.ts) (`CommonAgentDriverImplementation`) tiene la lógica compartida: sesiones multi-turn por `sessionId` (`this.history[sessionId]`), `getSystemContent()` con el schema como DDL, y un **fallback no-streaming centralizado** (si `queryStream` falla sin emitir texto, cae a `query()`).
- Drivers concretos: [`anthropic.ts`](../../../src/drivers/agent/anthropic.ts), [`chatgpt.ts`](../../../src/drivers/agent/chatgpt.ts), [`gemini.ts`](../../../src/drivers/agent/gemini.ts). Cada uno parsea su propio SSE vía [`sse.ts`](../../../src/drivers/agent/sse.ts).
- Ejecutar SQL: `databaseDriver.query(stmt)` → `DatabaseResultSet { rows, headers, stat }` ([`base-driver.ts`](../../../src/drivers/base-driver.ts)). Helpers de SQL: `splitSqlQuery`, `resolveToNearestStatement`, `multipleQuery`.

## Enfoque elegido

**Loop de tool calling en el driver (Opción A).** Una sola tool: `run_query`. El driver maneja el protocolo del modelo (tool_use → tool_result → continuar); la UI provee un callback que ejecuta la query detrás de un gate y devuelve el resultado.

```
chatStream({ ..., executeTool })  ──►  driver (common.ts + provider)
                                        │ queryStream() parsea SSE: text/reasoning + tool_use
                                        │
   executeTool(toolCall) ◄────────────┤ detecta tool_use "run_query"
   │  1. classifyStatement(read/write) │
   │  2. gate (toggle / writes frenan) │
   │  3. databaseDriver.query()        │
   │  4. mini-grilla inline            │
   └─ AgentToolResult ────────────────►│ formatea tool_result (formato del provider)
                                        │ re-llama queryStream() con el resultado
                                        │ loop hasta done (máx 8 iteraciones)
                                        ▼  emite "done"
```

### Por qué no las alternativas

- **B — Loop en la UI (`chat-tab.tsx`):** el driver solo emite `tool_call` y termina; la UI ejecuta, reconstruye el historial con bloques tool_use/tool_result **en el formato de cada provider** y re-llama `chatStream`. Duplica lógica multi-provider en React (Anthropic ≠ OpenAI ≠ Gemini), parte el historial entre driver y UI, frágil. Descartado.
- **C — Orquestador separado:** una capa nueva entre UI y drivers. Over-engineering para una sola tool; el historial ya vive en el driver. Descartado.

**Una sola tool** a propósito (YAGNI): el schema ya viaja en el system prompt, así que `list_tables`/`describe_table` no hacen falta todavía. La arquitectura del loop no cambia si se suman después.

## Capa de drivers (tool calling real)

### Tipos nuevos (`base.ts`)

```ts
interface AgentToolCall { id: string; name: string; args: Record<string, unknown> }

interface AgentToolResult {
  ok: boolean;
  // texto compacto que ve el MODELO (headers + sample de filas + total + duración, o el error)
  content: string;
  cancelled?: boolean; // el usuario descartó la ejecución
}

// chatStream pasa a recibir el callback:
executeTool?: (call: AgentToolCall) => Promise<AgentToolResult>;
```

Definición de la tool (JSON Schema, agnóstica de provider; cada driver la traduce a su dialecto):

```ts
run_query({
  sql: string,        // un solo statement
  reason?: string,    // por qué la corre (se muestra en el card)
})
```

### `common.ts` (el loop)

- `getSystemContent()` suma instrucciones para la tool: cuándo usar `run_query`, **preferir agregaciones en SQL** antes que traer datasets grandes (`GROUP BY ... LIMIT` mejor que `SELECT *` de 10k filas), un statement por llamada, no inventar columnas (usar el schema dado).
- Loop: corre `queryStream`; si terminó con tool_calls pendientes, por cada call hace `await executeTool(call)`, agrega al historial el turno assistant (con `tool_use`) y el turno con `tool_result`, y vuelve a llamar `queryStream`. Repite hasta `done` sin tool_calls o hasta **8 iteraciones** (corta-loops). Reusa `this.history[sessionId]`.
- Si `executeTool` devuelve `cancelled: true`, el loop corta: se inyecta un `tool_result` tipo "user cancelled" y el modelo cierra el turno (no se le da otra vuelta).
- El **fallback no-streaming** existente se preserva: si un provider falla el streaming con tools, cae a `query()` no-streaming con tools.

### Cada provider — parseo + formato en su dialecto

| Provider | Tools en el request | Parseo de tool_use (SSE) | Formato del tool_result |
|---|---|---|---|
| **Anthropic** | `tools: [...]` top-level | `content_block_start`(type `tool_use`: id, name) + `input_json_delta` (acumula args) + `content_block_stop`; `stop_reason: "tool_use"` | user message con bloque `{ type: "tool_result", tool_use_id, content }` |
| **OpenAI** | `tools: [{ type:"function", function }]` | chat-completions: `delta.tool_calls[]` (id, `function.name`, `function.arguments` en fragmentos), `finish_reason: "tool_calls"`. responses API: `function_call_arguments.delta` | message `role: "tool"` con `tool_call_id` |
| **Gemini** | `tools: [{ functionDeclarations }]` | `parts[].functionCall { name, args }` | `functionResponse` part con `{ name, response }` |

Cada `queryStream` acumula el JSON parcial de args y, cuando el bloque cierra, emite un evento `tool_call` (para que la UI lo muestre) **y** lo deja disponible para que el loop de `common.ts` lo ejecute.

## Capa de UI — el gate (`chat-tab.tsx`)

`executeTool` es el callback que implementa la UI. Pasos:

1. **Clasifica** el statement: `classifyStatement(sql) → "read" | "write"`.
2. **Decide si frena:**
   - `write`/DDL → **siempre** frena (confirmación explícita), ignora el toggle.
   - `read` → si `autoRun` on, ejecuta directo; si no, frena.
3. **Si frena:** renderiza un *tool-call card* con la query (editor read-only) + `reason`, y botones **Run** · **Abrir en editor** · **Copiar** · **Descartar**. La Promise se resuelve cuando tocás Run (ejecuta), o devuelve `cancelled: true` con Descartar.
4. **Ejecuta:** `databaseDriver.query(sql)` con try/catch.
5. **Muestra** la mini-grilla inline (~100 filas con scroll) + stats (filas, duración).
6. **Devuelve** al modelo (`AgentToolResult.content`): headers + primeras **50 filas** en formato compacto + total de filas + duración, con celdas largas truncadas. En error, devuelve el mensaje de error (para que el modelo auto-corrija).

**Estado nuevo:**
- `autoRun: boolean` (persistido en `localStorage`, como la config del agente). Toggle/switch en la barra del chat (cerca del input).
- Las tool calls quedan asociadas al mensaje assistant en curso.

**Estados visuales del tool-call card:** `pending` (botones) → `running` (spinner) → `done` (mini-grilla + stats) / `error` (mensaje + "Abrir en editor") / `cancelled` (descartado, con la query a mano).

**Persistencia en historial:** se extiende `ChatMessage.toolCalls` (el campo scaffold ya existe) para guardar `{ sql, reason, status, resultSummary }` — **un resumen** del resultado, no todas las filas (no inflar memoria). Así, al re-renderizar la conversación, los runs siguen visibles.

## Clasificación read/write (`classifyStatement`)

Helper nuevo (con tests):

- **read:** `SELECT`, `EXPLAIN`, `SHOW`, `PRAGMA` (de lectura), `WITH … SELECT`.
- **write:** `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `REPLACE`, `GRANT`, etc.
- **CTEs:** mira más allá del `WITH …` para ver el statement real (`WITH x AS (...) DELETE …` → write).
- **Multi-statement** en una sola call: si **alguno** es write → todo el bloque se trata como write (frena).
- **Ante la duda → write** (fail-safe: mejor frenar de más que ejecutar de menos).
- Reusa utilidades existentes (`splitSqlQuery`) para tokenizar; si no hay clasificador previo, se crea acá.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `src/drivers/agent/base.ts` | Tipos `AgentToolCall`/`AgentToolResult`; `chatStream` recibe `executeTool`; definición de la tool `run_query`. |
| `src/drivers/agent/common.ts` | El loop de tool calling (ejecutar tool → reinyectar resultado → continuar, máx 8 iter); instrucciones de la tool en `getSystemContent()`; manejo de cancelación; preservar fallback. |
| `src/drivers/agent/anthropic.ts` | Enviar `tools`; parsear `tool_use` (content_block + input_json_delta); formatear `tool_result`. |
| `src/drivers/agent/chatgpt.ts` | Enviar `tools`; parsear `tool_calls` (chat + responses API); formatear message `role: "tool"`. |
| `src/drivers/agent/gemini.ts` | Enviar `functionDeclarations`; parsear `functionCall`; formatear `functionResponse`. |
| `src/lib/sql/classify-statement.ts` (nuevo) | `classifyStatement(sql) → "read" \| "write"` + tests. |
| `src/components/gui/tabs/chat-tab.tsx` | `executeTool` con el gate; estado `autoRun` + toggle; render del tool-call card y la mini-grilla; persistir tool calls en `ChatMessage`. |
| `src/components/gui/tabs/chat-tool-call-card.tsx` (nuevo) | UI del card: query read-only + reason + botones + estados (pending/running/done/error/cancelled) + mini-grilla. |

## Flujo de datos

```
Usuario: "Dame un reporte de los 20 mejores productos"
   └─ chatStream({ executeTool }) → driver arma system+schema+turno usuario → queryStream()
        └─ modelo emite tool_use run_query({ sql: "SELECT ... LIMIT 20", reason: "..." })
             └─ common.ts: await executeTool(call)
                  └─ UI: classifyStatement → "read"
                       ├─ autoRun OFF → render card pending (Run/Abrir/Copiar/Descartar) → espera
                       │     └─ Usuario toca Run → databaseDriver.query() → mini-grilla + AgentToolResult
                       └─ autoRun ON → databaseDriver.query() directo → mini-grilla + AgentToolResult
                  └─ common.ts: agrega tool_use + tool_result al historial → queryStream() de nuevo
                       └─ modelo ve los datos → emite texto: el reporte interpretado → done

Query falla (columna inexistente)
   └─ executeTool devuelve content = error message
        └─ modelo lo ve → propone SQL corregido vía otro tool_use (read → respeta toggle) → reintenta

Usuario toca Descartar
   └─ executeTool devuelve { cancelled: true }
        └─ common.ts inyecta "user cancelled" → modelo cierra: "ok, no la corrí, te la dejo arriba"

Write (UPDATE/DELETE/DROP) con autoRun ON
   └─ classifyStatement → "write" → frena IGUAL (card pending) → espera confirmación explícita
```

## Manejo de errores / edge cases

- **Query falla:** `tool_result` lleva el error; el modelo puede auto-corregir (read respeta toggle; write frena igual).
- **Usuario descarta:** `cancelled: true` corta el loop limpio; el modelo cierra el turno sin reintentar.
- **Loop infinito:** tope de **8 iteraciones**; si se alcanza, corta y avisa en el chat.
- **Multi-statement en una call:** si alguno es write → se trata todo como write (frena).
- **Args inválidos del modelo** (JSON roto, falta `sql`): `tool_result` con error de validación; el modelo reintenta.
- **Provider sin soporte de streaming de tools:** cae al fallback no-streaming con tools (ya existe la rama de fallback en `common.ts`).
- **Sin API key / sin modelo configurado:** comportamiento actual (ya manejado por la infra).
- **Resultado enorme:** al modelo solo van 50 filas + total; la mini-grilla muestra ~100 con scroll; "Abrir en editor" para el dataset completo.
- **Cambio de schema por un write** (CREATE/DROP/USE ejecutado tras confirmación): disparar `refreshSchema()` como hace `query-tab`.

## Testing

- **Unit `classifyStatement`:** read/write/CTE (`WITH … SELECT` vs `WITH … DELETE`)/multi-statement/PRAGMA/EXPLAIN/edge cases/fail-safe ante input raro.
- **Unit del loop (`common.ts`)** con un mock provider: emite `tool_use` → verifica que llama `executeTool`, reinyecta el `tool_result`, continúa, corta en `done`, respeta el máximo de iteraciones, y maneja `cancelled`.
- **Unit del gate:** matriz `autoRun {on, off}` × `{read, write}` → frena o no según corresponde (write siempre frena).
- **Manual (browser, con Claude in Chrome):** pedir un reporte → confirmar la query → ver mini-grilla → ver el reporte interpretado; probar auto-run on/off; probar un write con auto-run on (debe frenar); probar una query que falla (auto-corrección).
- Sigue el patrón de tests existente en `tabs` (commits `test(tabs)`).

## Fuera de scope (v1 — YAGNI)

- Tools extra (`list_tables`, `describe_table`): el schema ya va en el system prompt.
- Gráficos/charts en el resultado (solo mini-grilla).
- Persistir result sets completos (solo samples/resúmenes).
- Auto-run para writes (sin excepciones: siempre frenan).
- Streaming de la ejecución de la query (la query corre atómica vía `databaseDriver.query`).
- Cancelar una query ya en ejecución (solo se puede descartar antes de correr).
