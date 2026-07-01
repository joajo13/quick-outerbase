"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import { useStudioContext } from "@/context/driver-provider";
import { useSchema } from "@/context/schema-provider";
import { scc } from "@/core/command";
import {
  AgentStreamEvent,
  AgentToolCall,
  AgentToolResult,
} from "@/drivers/agent/base";
import { DatabaseResultSet, SupportedDialect } from "@/drivers/base-driver";
import { buildChatSuggestions } from "@/lib/chat-suggestions";
import { generateId } from "@/lib/generate-id";
import { classifyStatements } from "@/lib/sql/classify-statement";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChatToolCall,
  ChatToolCallResult,
} from "./chat-tool-call-card";

// ToolCall en la UI: el tipo lo define la card (lleva sql/estado/resultado del run).
type ToolCall = ChatToolCall;

// Cuerpo del assistant como lista ORDENADA de partes: texto y tool-calls intercalados
// en el mismo orden en que el modelo los emitió. Antes el texto se aplanaba en un solo
// string y las tools iban en un array aparte que se dibujaba SIEMPRE arriba del texto,
// perdiendo el orden real (la card del run quedaba encima del texto que la introducía).
export type ChatMessagePart =
  | { type: "text"; content: string }
  | { type: "tool"; tool: ToolCall };

export interface ChatMessage {
  role: "user" | "assistant";
  // user: el texto tipeado. En el assistant el cuerpo vive en `parts`.
  content?: string;
  // Razonamiento del modelo (Anthropic/Gemini con flag). Se renderiza en un bloque
  // colapsable arriba del texto. OpenAI no lo expone → queda vacío.
  reasoning?: string;
  // Cuerpo del assistant: texto + tool-calls en orden de emisión.
  parts?: ChatMessagePart[];
  // El turno del assistant todavía está streameando (controla shimmer + auto-colapso).
  streaming?: boolean;
}

// Dónde vive el chat en el layout:
//  - closed: no se muestra en ningún lado.
//  - side:   panel lateral acoplado a la derecha (default al abrir).
//  - full:   pantalla completa como tab dentro de WindowTabs.
export type ChatMode = "closed" | "side" | "full";

// Aplica un evento del stream al ÚLTIMO mensaje (que siempre es el assistant en
// curso). Devuelve un array nuevo (inmutable) para que React re-renderice.
function applyEvent(
  messages: ChatMessage[],
  event: AgentStreamEvent
): ChatMessage[] {
  const idx = messages.length - 1;
  if (idx < 0) return messages;

  const last = messages[idx];
  if (last.role !== "assistant") return messages;

  const next: ChatMessage = { ...last };
  const parts = (next.parts ?? []).slice();
  switch (event.type) {
    case "text": {
      // Append al último part si YA es texto; si no (p.ej. justo antes hubo un
      // tool_call), abrimos un part de texto NUEVO → el texto que sigue cae debajo de
      // la card, respetando el orden en que el modelo lo dijo.
      const tail = parts[parts.length - 1];
      if (tail && tail.type === "text") {
        parts[parts.length - 1] = {
          type: "text",
          content: tail.content + event.delta,
        };
      } else {
        parts.push({ type: "text", content: event.delta });
      }
      next.parts = parts;
      break;
    }
    case "reasoning":
      next.reasoning = (next.reasoning || "") + event.delta;
      break;
    case "tool_call": {
      // Parseamos sql/reason de los args (puede venir incompleto si el JSON cortó).
      let sql: string | undefined;
      let reason: string | undefined;
      try {
        const parsed = event.args ? JSON.parse(event.args) : {};
        if (typeof parsed.sql === "string") sql = parsed.sql;
        if (typeof parsed.reason === "string") reason = parsed.reason;
      } catch {
        // args incompletos: executeTool igual recibe los args parseados del driver.
      }
      parts.push({
        type: "tool",
        tool: {
          id: event.id,
          name: event.name,
          args: event.args,
          sql,
          reason,
          status: "pending",
        },
      });
      next.parts = parts;
      break;
    }
    case "error": {
      // Si el turno no alcanzó a emitir nada, mostramos el error como texto.
      const hasBody = parts.some(
        (p) => p.type === "tool" || (p.type === "text" && p.content.trim() !== "")
      );
      if (!hasBody) parts.push({ type: "text", content: "Error: " + event.message });
      next.parts = parts;
      next.streaming = false;
      break;
    }
    case "done":
      next.streaming = false;
      break;
  }

  const copy = messages.slice();
  copy[idx] = next;
  return copy;
}

// Mapea un DatabaseResultSet a la forma que consume la mini-grilla: headers por
// displayName, rows como matriz alineada a las columnas (keyeadas por header.name).
function mapResultSet(rs: DatabaseResultSet): ChatToolCallResult {
  const keys = rs.headers.map((h) => h.name);
  const headers = rs.headers.map((h) => h.displayName || h.name);
  const rows = rs.rows.map((row) => keys.map((k) => row[k]));
  return {
    headers,
    rows,
    rowCount: rs.rows.length,
    durationMs: rs.stat?.queryDurationMs ?? null,
  };
}

// Texto compacto que ve el MODELO como tool_result: columnas + hasta 50 filas (celdas
// largas truncadas) + total + stats. Para datasets grandes mandamos solo la muestra
// (el modelo debería preferir agregaciones en SQL antes que traer todo).
function formatResultForModel(rs: DatabaseResultSet): string {
  const MAX = 50;
  const keys = rs.headers.map((h) => h.name);
  const total = rs.rows.length;
  const sample = rs.rows.slice(0, MAX).map((row) => {
    const obj: Record<string, unknown> = {};
    for (const k of keys) {
      let v = row[k];
      if (v instanceof Uint8Array || v instanceof ArrayBuffer) v = "[blob]";
      else if (typeof v === "string" && v.length > 200) v = v.slice(0, 200) + "…";
      obj[k] = v;
    }
    return obj;
  });

  const lines: string[] = [];
  lines.push(`Columns: ${keys.join(", ") || "(none)"}`);
  lines.push(
    `Rows returned: ${total}${total > MAX ? ` (showing first ${MAX})` : ""}`
  );
  if (sample.length > 0) lines.push(JSON.stringify(sample));
  if (rs.stat?.rowsAffected) lines.push(`Rows affected: ${rs.stat.rowsAffected}`);
  if (rs.stat?.queryDurationMs != null) {
    lines.push(`Duration: ${rs.stat.queryDurationMs}ms`);
  }
  return lines.join("\n");
}

// La conversación cambia seguido (cada tecla, cada delta del stream). Sólo el
// ChatPanel la consume.
interface ChatSessionValue {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  autoRun: boolean;
  toggleAutoRun: () => void;
  send: (overrideText?: string) => void;
  newChat: () => void;
  resolvePending: (id: string, action: "run" | "discard") => void;
  // Query esperando confirmación (o null). La consume la barra fija sobre el input y
  // los atajos Ctrl+Enter (run) / Esc (descartar).
  pendingRun: ToolCall | null;
  dialect: SupportedDialect;
  suggestions: string[];
  openSettings: () => void;
}

// El layout cambia poco (sólo al abrir/expandir/cerrar). Lo consumen el layout raíz
// (database-gui) y los botones que abren el chat, por eso va en un context aparte:
// así tipear en el input NO re-renderiza todo el árbol de tabs.
interface ChatLayoutValue {
  mode: ChatMode;
  openChat: () => void;
  expand: () => void;
  collapse: () => void;
  closeChat: () => void;
  handleFullTabClosed: () => void;
}

const ChatSessionContext = createContext<ChatSessionValue | null>(null);
const ChatLayoutContext = createContext<ChatLayoutValue | null>(null);

// Conversación (mensajes, input, envío…). Para el ChatPanel.
export function useChat() {
  const ctx = useContext(ChatSessionContext);
  if (!ctx) throw new Error("useChat must be used within a ChatProvider");
  return ctx;
}

// Layout (dónde vive el chat + acciones de apertura). Para el layout y los triggers.
export function useChatLayout() {
  const ctx = useContext(ChatLayoutContext);
  if (!ctx) throw new Error("useChatLayout must be used within a ChatProvider");
  return ctx;
}

export function ChatProvider({ children }: PropsWithChildren) {
  const { agentDriver, databaseDriver } = useStudioContext();
  const { schema, currentSchema, currentSchemaName, refresh } = useSchema();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Auto-run: si está activo, las lecturas se ejecutan solas; las escrituras SIEMPRE
  // piden confirmación. Lo leemos de localStorage en un effect (no en el inicializador)
  // para no romper la hidratación SSR. autoRunRef da el valor fresco dentro de
  // executeTool (que corre durante el stream, después de toggles).
  const [autoRun, setAutoRun] = useState(false);
  const autoRunRef = useRef(autoRun);
  useEffect(() => {
    autoRunRef.current = autoRun;
  }, [autoRun]);
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      setAutoRun(localStorage.getItem("chat-auto-run") === "1");
    }
  }, []);
  const toggleAutoRun = useCallback(() => {
    setAutoRun((v) => {
      const next = !v;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("chat-auto-run", next ? "1" : "0");
      }
      return next;
    });
  }, []);

  // Estado de layout del chat. modeRef da el valor fresco a callbacks que corren
  // fuera del render (p.ej. el cleanup del tab full al desmontarse).
  const [mode, setMode] = useState<ChatMode>("closed");
  const modeRef = useRef<ChatMode>("closed");
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Abre el chat en lateral (default). Si ya está en pantalla completa, re-enfoca el tab.
  const openChat = useCallback(() => {
    if (modeRef.current === "full") {
      scc.tabs.openBuiltinChat({});
      return;
    }
    modeRef.current = "side";
    setMode("side");
  }, []);

  // Lateral → pantalla completa: abre (o enfoca) el tab de chat.
  const expand = useCallback(() => {
    modeRef.current = "full";
    setMode("full");
    scc.tabs.openBuiltinChat({});
  }, []);

  // Pantalla completa → lateral: cierra el tab y reaparece el panel.
  const collapse = useCallback(() => {
    modeRef.current = "side";
    setMode("side");
    scc.tabs.close(["chat"]);
  }, []);

  // Cerrar del todo el chat, esté donde esté.
  const closeChat = useCallback(() => {
    const wasFull = modeRef.current === "full";
    modeRef.current = "closed";
    setMode("closed");
    if (wasFull) scc.tabs.close(["chat"]);
  }, []);

  // Lo llama el ChatPanel (variant full) al desmontarse: si el tab se cerró a mano
  // (la X del strip) el modo seguía en "full" → lo pasamos a closed. Si venía de
  // collapse()/closeChat(), modeRef ya no es "full" y esto es un no-op.
  const handleFullTabClosed = useCallback(() => {
    if (modeRef.current === "full") {
      modeRef.current = "closed";
      setMode("closed");
    }
  }, []);

  // sessionId estable durante toda la vida del provider → la conversación es
  // multi-turn y coherente (el driver mantiene el historial por sessionId).
  const sessionId = useRef(generateId());

  // Resolvers de las tool calls en espera de confirmación, keyeados por id. La card
  // los dispara con Run/Descartar; executeTool crea la promesa y guarda el resolve.
  const pendingResolvers = useRef(
    new Map<string, (action: "run" | "discard") => void>()
  );

  const dialect: SupportedDialect = databaseDriver.getFlags().dialect;

  // Sugerencias del estado vacío: dinámicas a partir de las tablas (y vistas) del
  // schema actual. Si no hay ninguna, buildChatSuggestions cae a 3 prompts genéricos.
  const suggestions = useMemo(() => {
    const tables = currentSchema
      .filter((item) => item.type === "table" || item.type === "view")
      .map((item) => item.name);
    return buildChatSuggestions(tables);
  }, [currentSchema]);

  // Actualiza (inmutable) una tool call por id dentro de su mensaje assistant. Ahora
  // las tool calls viven como partes del cuerpo (`parts`), así que la buscamos ahí.
  const updateToolCall = useCallback(
    (id: string, patch: Partial<ToolCall>) => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.role !== "assistant" || !m.parts) return m;
          const i = m.parts.findIndex(
            (p) => p.type === "tool" && p.tool.id === id
          );
          if (i < 0) return m;
          const part = m.parts[i];
          if (part.type !== "tool") return m;
          changed = true;
          const parts = m.parts.slice();
          parts[i] = { type: "tool", tool: { ...part.tool, ...patch } };
          return { ...m, parts };
        });
        return changed ? next : prev;
      });
    },
    []
  );

  // Query esperando confirmación del usuario (Run/Descartar). La setea executeTool
  // cuando frena, la limpia al resolverse. Alimenta la barra fija sobre el input y los
  // atajos de teclado; es reactiva (a diferencia de pendingResolvers, que es un ref).
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);

  // La tool call pendiente, resuelta desde los mensajes por id → le da a la barra el
  // reason/sql para mostrar. null cuando no hay ninguna esperando.
  const pendingRun = useMemo<ToolCall | null>(() => {
    if (!pendingRunId) return null;
    for (const m of messages) {
      if (m.role !== "assistant" || !m.parts) continue;
      for (const p of m.parts) {
        if (p.type === "tool" && p.tool.id === pendingRunId) return p.tool;
      }
    }
    return null;
  }, [pendingRunId, messages]);

  // La card dispara esto al tocar Run/Descartar: resuelve la promesa que dejó
  // executeTool en espera.
  const resolvePending = useCallback(
    (id: string, action: "run" | "discard") => {
      const resolve = pendingResolvers.current.get(id);
      if (resolve) resolve(action);
    },
    []
  );

  // El gate de ejecución que le pasamos al driver. Clasifica read/write, aplica el
  // toggle auto-run (los writes SIEMPRE frenan), ejecuta contra la base y devuelve el
  // resultado formateado para el modelo. Mientras tanto actualiza la card.
  const executeTool = useCallback(
    async (call: AgentToolCall): Promise<AgentToolResult> => {
      const sql = typeof call.args?.sql === "string" ? call.args.sql : "";
      const reason =
        typeof call.args?.reason === "string" ? call.args.reason : undefined;

      if (!sql.trim()) {
        updateToolCall(call.id, {
          status: "error",
          error: "La tool no recibió ninguna query (sql vacío).",
        });
        return {
          ok: false,
          content: "Error: run_query fue llamada sin un sql válido.",
        };
      }

      // El evento tool_call pudo cortar el JSON de args → fijamos sql/reason ahora.
      updateToolCall(call.id, { sql, reason });

      const access = classifyStatements(sql);
      const mustConfirm = access === "write" || !autoRunRef.current;

      if (mustConfirm) {
        updateToolCall(call.id, { status: "pending" });
        setPendingRunId(call.id);
        const action = await new Promise<"run" | "discard">((resolve) => {
          pendingResolvers.current.set(call.id, resolve);
        });
        pendingResolvers.current.delete(call.id);
        // Limpiamos el pendiente sólo si sigue siendo ESTE (defensivo ante carreras).
        setPendingRunId((cur) => (cur === call.id ? null : cur));
        if (action === "discard") {
          updateToolCall(call.id, { status: "cancelled" });
          return {
            ok: false,
            content: "El usuario decidió NO ejecutar esta query.",
            cancelled: true,
          };
        }
      }

      updateToolCall(call.id, { status: "running" });
      try {
        const rs = await databaseDriver.query(sql);
        updateToolCall(call.id, { status: "done", result: mapResultSet(rs) });
        // Un write/DDL puede haber cambiado el schema → lo refrescamos.
        if (access === "write") refresh();
        return { ok: true, content: formatResultForModel(rs) };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        updateToolCall(call.id, { status: "error", error: message });
        return { ok: false, content: "Error al ejecutar la query: " + message };
      }
    },
    [databaseDriver, refresh, updateToolCall]
  );

  const send = useCallback(
    async (overrideText?: string) => {
      // overrideText: lo usan las sugerencias del estado vacío para mandar directo sin
      // pasar por el input. Por defecto toma el texto del textarea.
      const text = (overrideText ?? input).trim();
      if (!text || loading || !agentDriver || !agentDriver.hasUsableModel())
        return;

      setInput("");
      // Empujamos el turno del usuario + un placeholder de assistant en streaming.
      // El placeholder es el ÚLTIMO mensaje: applyEvent siempre actualiza ese.
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        {
          role: "assistant",
          reasoning: "",
          parts: [],
          streaming: true,
        },
      ]);
      setLoading(true);

      try {
        // chatStream() emite el texto token a token vía onEvent (text/reasoning/
        // tool_call/done/error) y, con executeTool, corre el loop de tool calling:
        // el modelo pide run_query → executeTool aplica el gate y ejecuta → el resultado
        // vuelve al modelo, que sigue o responde. Si el stream falla, el driver cae solo
        // al query() no-streaming (hard fallback).
        await agentDriver.chatStream(
          agentDriver.getDefaultModelName(),
          text,
          sessionId.current,
          {
            selected: "",
            schema,
            selectedSchema: currentSchemaName,
          },
          (event) => {
            setMessages((prev) => applyEvent(prev, event));
          },
          executeTool
        );
      } catch (e) {
        // chatStream no debería tirar (emite "error" como evento), pero por las dudas
        // (p.ej. resolveDriver sin driver) cerramos el turno con el error visible.
        setMessages((prev) =>
          applyEvent(prev, {
            type: "error",
            message:
              e instanceof Error ? e.message : "no se pudo generar la respuesta",
          })
        );
      } finally {
        setLoading(false);
      }
    },
    [input, loading, agentDriver, schema, currentSchemaName, executeTool]
  );

  // Nuevo chat: limpia los mensajes y rota el sessionId → el driver arranca un
  // historial in-memory fresco (re-manda system + schema en el próximo turno).
  // Resolvemos como "discard" cualquier tool call en espera para no dejar el loop
  // (ni el spinner de loading) colgado.
  const newChat = useCallback(() => {
    pendingResolvers.current.forEach((resolve) => resolve("discard"));
    pendingResolvers.current.clear();
    setPendingRunId(null);
    setMessages([]);
    setInput("");
    sessionId.current = generateId();
  }, []);

  const openSettings = useCallback(() => {
    localSettingDialog.show({}).then().catch();
  }, []);

  const sessionValue = useMemo<ChatSessionValue>(
    () => ({
      messages,
      input,
      setInput,
      loading,
      autoRun,
      toggleAutoRun,
      send,
      newChat,
      resolvePending,
      pendingRun,
      dialect,
      suggestions,
      openSettings,
    }),
    [
      messages,
      input,
      loading,
      autoRun,
      toggleAutoRun,
      send,
      newChat,
      resolvePending,
      pendingRun,
      dialect,
      suggestions,
      openSettings,
    ]
  );

  // Sólo cambia cuando cambia `mode` (las acciones son estables) → tipear en el chat
  // no re-renderiza el layout raíz ni WindowTabs.
  const layoutValue = useMemo<ChatLayoutValue>(
    () => ({
      mode,
      openChat,
      expand,
      collapse,
      closeChat,
      handleFullTabClosed,
    }),
    [mode, openChat, expand, collapse, closeChat, handleFullTabClosed]
  );

  return (
    <ChatLayoutContext.Provider value={layoutValue}>
      <ChatSessionContext.Provider value={sessionValue}>
        {children}
      </ChatSessionContext.Provider>
    </ChatLayoutContext.Provider>
  );
}
