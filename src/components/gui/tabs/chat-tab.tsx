"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import SqlEditor from "@/components/gui/sql-editor";
import { Button } from "@/components/ui/button";
import { useStudioContext } from "@/context/driver-provider";
import { useSchema } from "@/context/schema-provider";
import { scc } from "@/core/command";
import {
  AgentStreamEvent,
  AgentToolCall,
  AgentToolResult,
} from "@/drivers/agent/base";
import { DatabaseResultSet, SupportedDialect } from "@/drivers/base-driver";
import { generateId } from "@/lib/generate-id";
import { buildChatSuggestions } from "@/lib/chat-suggestions";
import { classifyStatements } from "@/lib/sql/classify-statement";
import {
  ArrowSquareOut,
  ArrowUp,
  CaretDown,
  CaretRight,
  CircleNotch,
  Copy,
  Key,
  Lightning,
  Plus,
  Robot,
  Sparkle,
  Wrench,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import ChatModelControls from "./chat-model-controls";
import ChatShimmer from "./chat-shimmer";
import ChatToolCallCard, {
  ChatToolCall,
  ChatToolCallResult,
} from "./chat-tool-call-card";

// ToolCall en la UI: el tipo lo define la card (lleva sql/estado/resultado del run).
type ToolCall = ChatToolCall;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Razonamiento del modelo (Anthropic/Gemini con flag). Se renderiza en un bloque
  // colapsable arriba del texto. OpenAI no lo expone → queda vacío.
  reasoning?: string;
  // Tool-calls del agente (run_query): la query propuesta + el ciclo de vida del run.
  toolCalls?: ToolCall[];
  // El turno del assistant todavía está streameando (controla shimmer + auto-colapso).
  streaming?: boolean;
}

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
  switch (event.type) {
    case "text":
      next.content = (next.content || "") + event.delta;
      break;
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
      next.toolCalls = [
        ...(next.toolCalls || []),
        {
          id: event.id,
          name: event.name,
          args: event.args,
          sql,
          reason,
          status: "pending",
        },
      ];
      break;
    }
    case "error":
      // Si no hubo nada de texto, mostramos el error como contenido del turno.
      next.content = next.content || "Error: " + event.message;
      next.streaming = false;
      break;
    case "done":
      next.streaming = false;
      break;
  }

  const copy = messages.slice();
  copy[idx] = next;
  return copy;
}

// Segmento de un mensaje del assistant: o bien prosa (texto) o un bloque de
// código fenced (```lang ... ```). No hay markdown renderer en el bundle vivo,
// así que parseamos los fenced blocks a mano y renderizamos el resto como texto.
type MessageSegment =
  | { type: "text"; content: string }
  | { type: "code"; language: string; content: string };

// Parser de fenced code blocks. Divide el texto en segmentos de prosa y código.
// Captura el lenguaje opcional luego de los backticks de apertura.
function parseMessageSegments(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fenceRegex = /```([\w-]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }

    segments.push({
      type: "code",
      language: (match[1] || "sql").toLowerCase(),
      content: match[2].replace(/\n$/, ""),
    });

    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }

  // Si no había ningún fenced block, devolvemos el texto completo como prosa.
  if (segments.length === 0) {
    segments.push({ type: "text", content: text });
  }

  return segments;
}

function CodeBlock({
  code,
  dialect,
}: {
  code: string;
  dialect: SupportedDialect;
}) {
  const onCopy = useCallback(() => {
    window.navigator.clipboard
      .writeText(code)
      .then(() => toast.success("SQL copiado al portapapeles"))
      .catch(() => toast.error("No se pudo copiar"));
  }, [code]);

  const onOpenInEditor = useCallback(() => {
    // Abre un tab de query NORMAL (no guardado) precargado con el SQL generado.
    // NO se ejecuta automáticamente: el usuario decide cuándo correrlo.
    scc.tabs.openBuiltinQuery({ name: "From Chat", initialCode: code });
  }, [code]);

  return (
    <div className="my-2 overflow-hidden rounded-panel border">
      <div className="max-h-[300px] overflow-auto bg-neutral-50 dark:bg-neutral-950">
        <SqlEditor value={code} dialect={dialect} readOnly />
      </div>
      <div className="flex gap-2 border-t bg-neutral-50 p-2 dark:bg-neutral-950">
        <Button variant="outline" size="sm" onClick={onOpenInEditor}>
          <ArrowSquareOut className="mr-1.5 h-4 w-4" />
          Abrir en editor
        </Button>
        <Button variant="outline" size="sm" onClick={onCopy}>
          <Copy className="mr-1.5 h-4 w-4" />
          Copiar
        </Button>
      </div>
    </div>
  );
}

// Lenguajes que tratamos como SQL → van al SqlEditor con "Abrir en editor".
// Cualquier otro (json/bash/python/text…) se muestra como texto plano.
const SQL_LANGS = new Set([
  "sql",
  "postgres",
  "postgresql",
  "psql",
  "plpgsql",
  "mysql",
  "mariadb",
  "sqlite",
  "tsql",
  "",
]);

function AssistantMessage({
  content,
  dialect,
}: {
  content: string;
  dialect: SupportedDialect;
}) {
  const segments = parseMessageSegments(content);

  return (
    <div className="flex flex-col">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          // Solo SQL va al editor; otros lenguajes como bloque de texto plano
          // (sin "Abrir en editor", que no tendría sentido para no-SQL).
          if (!SQL_LANGS.has(segment.language)) {
            return (
              <pre
                key={index}
                className="my-2 overflow-auto rounded-panel border bg-neutral-50 p-2 text-xs dark:bg-neutral-950"
              >
                <code>{segment.content}</code>
              </pre>
            );
          }

          return (
            <CodeBlock
              key={index}
              code={segment.content}
              dialect={dialect}
            />
          );
        }

        const trimmed = segment.content.trim();
        if (!trimmed) return null;

        return (
          <div key={index} className="text-sm whitespace-pre-wrap">
            {segment.content}
          </div>
        );
      })}
    </div>
  );
}

// Bloque colapsable de razonamiento ("Razonando…"). Mientras el assistant streamea,
// arranca abierto para que se vea el reasoning en vivo; cuando termina (streaming →
// false) se auto-colapsa. El usuario puede togglearlo a mano en cualquier momento.
function ReasoningBlock({
  reasoning,
  streaming,
}: {
  reasoning: string;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(true);
  // userToggled: si el usuario tocó el bloque, respetamos su decisión y no
  // auto-colapsamos al terminar.
  const userToggled = useRef(false);

  useEffect(() => {
    if (!streaming && !userToggled.current) {
      setOpen(false);
    }
  }, [streaming]);

  return (
    <div className="mb-2 rounded-panel border border-dashed">
      <button
        type="button"
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium opacity-70"
      >
        {open ? (
          <CaretDown className="h-3 w-3" />
        ) : (
          <CaretRight className="h-3 w-3" />
        )}
        {streaming ? "Razonando…" : "Razonamiento"}
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs whitespace-pre-wrap opacity-70">
          {reasoning}
        </div>
      )}
    </div>
  );
}

// Chips de tool-calls. Scaffold: hoy no se emiten (no hay tools reales), pero si
// llegaran eventos tool_call en el stream, la UI ya sabe dibujarlos.
function ToolCallChips({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {toolCalls.map((tc) => (
        <span
          key={tc.id}
          className="inline-flex items-center gap-1 rounded-full border bg-neutral-50 px-2 py-0.5 text-xs dark:bg-neutral-950"
          title={tc.args}
        >
          <Wrench className="h-3 w-3" />
          {tc.name}
        </span>
      ))}
    </div>
  );
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

export default function ChatWindow() {
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

  // sessionId estable durante toda la vida del tab → la conversación es
  // multi-turn y coherente (el driver mantiene el historial por sessionId).
  const sessionId = useRef(generateId());

  // Resolvers de las tool calls en espera de confirmación, keyeados por id. La card
  // los dispara con Run/Descartar; executeTool crea la promesa y guarda el resolve.
  const pendingResolvers = useRef(
    new Map<string, (action: "run" | "discard") => void>()
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dialect: SupportedDialect = databaseDriver.getFlags().dialect;

  // Sugerencias del estado vacío: dinámicas a partir de las tablas (y vistas) del
  // schema actual. Si no hay ninguna, buildChatSuggestions cae a 3 prompts genéricos.
  const suggestions = useMemo(() => {
    const tables = currentSchema
      .filter((item) => item.type === "table" || item.type === "view")
      .map((item) => item.name);
    return buildChatSuggestions(tables);
  }, [currentSchema]);

  // Auto-resize del textarea: crece con el contenido hasta max-h-40 (después
  // scrollea, lo clampea el CSS). Reseteamos a 'auto' antes de medir para que
  // también achique al borrar líneas o al limpiarse después de enviar.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Actualiza (inmutable) una tool call por id dentro de su mensaje assistant.
  const updateToolCall = useCallback(
    (id: string, patch: Partial<ToolCall>) => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (m.role !== "assistant" || !m.toolCalls) return m;
          const i = m.toolCalls.findIndex((tc) => tc.id === id);
          if (i < 0) return m;
          changed = true;
          const toolCalls = m.toolCalls.slice();
          toolCalls[i] = { ...toolCalls[i], ...patch };
          return { ...m, toolCalls };
        });
        return changed ? next : prev;
      });
    },
    []
  );

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
        const action = await new Promise<"run" | "discard">((resolve) => {
          pendingResolvers.current.set(call.id, resolve);
        });
        pendingResolvers.current.delete(call.id);
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

  const onSend = useCallback(async (overrideText?: string) => {
    // overrideText: lo usan las sugerencias del estado vacío para mandar directo sin
    // pasar por el input. Por defecto toma el texto del textarea.
    const text = (overrideText ?? input).trim();
    if (!text || loading || !agentDriver || !agentDriver.hasUsableModel()) return;

    setInput("");
    // Empujamos el turno del usuario + un placeholder de assistant en streaming.
    // El placeholder es el ÚLTIMO mensaje: applyEvent siempre actualiza ese.
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      {
        role: "assistant",
        content: "",
        reasoning: "",
        toolCalls: [],
        streaming: true,
      },
    ]);
    setLoading(true);
    scrollToBottom();

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
          if (event.type === "text" || event.type === "tool_call") {
            scrollToBottom();
          }
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
      scrollToBottom();
    }
  }, [
    input,
    loading,
    agentDriver,
    schema,
    currentSchemaName,
    scrollToBottom,
    executeTool,
  ]);

  // Nuevo chat: limpia los mensajes y rota el sessionId → el driver arranca un
  // historial in-memory fresco (re-manda system + schema en el próximo turno).
  // Resolvemos como "discard" cualquier tool call en espera para no dejar el loop
  // (ni el spinner de loading) colgado.
  const onNewChat = useCallback(() => {
    pendingResolvers.current.forEach((resolve) => resolve("discard"));
    pendingResolvers.current.clear();
    setMessages([]);
    setInput("");
    sessionId.current = generateId();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter envía; Shift+Enter inserta salto de línea.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend]
  );

  const onOpenSettings = useCallback(() => {
    localSettingDialog.show({}).then().catch();
  }, []);

  // Estado vacío: sin un modelo usable (no hay agentDriver, o lo hay pero sin
  // provider/model/token configurado → dict vacío) mostramos un CTA que abre el
  // dialog de settings de AI (mismo mecanismo que tools-sidebar). Importante:
  // agentDriver NO es undefined cuando falta la key (existe con un default muerto),
  // por eso chequeamos hasUsableModel() y no solo la existencia del driver.
  if (!agentDriver || !agentDriver.hasUsableModel()) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <Sparkle className="h-10 w-10 opacity-60" />
        <div className="max-w-md">
          <h2 className="mb-1 text-lg font-semibold">Chat con IA</h2>
          <p className="text-sm opacity-70">
            Configurá un proveedor de IA (Anthropic, OpenAI o Gemini) y pegá tu
            API key para charlar con el asistente y generar SQL a partir de tu
            schema.
          </p>
        </div>
        <Button onClick={onOpenSettings}>
          <Robot className="mr-2 h-4 w-4" />
          Configurar IA
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Botones flotantes (sin barra ni línea divisoria, sin ícono genérico de IA):
          API key + nuevo chat. El wrapper no captura clicks (pointer-events-none) para
          no tapar el scroll; solo los botones sí (pointer-events-auto). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end gap-2 p-3">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="API key"
          title="API key"
          className="border-input bg-background/80 pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <Key className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onNewChat}
          aria-label="Nuevo chat"
          title="Nuevo chat"
          className="border-input bg-background/80 pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        className="flex grow flex-col gap-4 overflow-y-auto p-4 pt-14"
      >
        {messages.length === 0 && (
          <div className="flex grow flex-col items-center justify-center gap-4 text-center">
            {/* Ícono = el MISMO loader del agente (gota gooey por SMIL → anima siempre,
                aún con prefers-reduced-motion), no un ícono genérico estático. */}
            <ChatShimmer size={44} label="Chat con IA" />
            <div>
              <p className="text-sm font-medium">Preguntá sobre tu base</p>
              <p className="mx-auto mt-1 max-w-xs text-xs opacity-60">
                El asistente genera y puede ejecutar SQL para responderte. Vos
                confirmás cada query (o activá auto-run para las lecturas).
              </p>
            </div>
            {/* 3 sugerencias dinámicas (de las tablas del schema). Click → manda directo. */}
            <div className="flex w-full max-w-[330px] flex-col gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => onSend(suggestion)}
                  className="border-input rounded-control border px-3 py-2 text-left text-xs transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === "user";
          if (isUser) {
            return (
              <div key={index} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-panel px-3 py-2 text-sm whitespace-pre-wrap">
                  {message.content}
                </div>
              </div>
            );
          }

          // Assistant: reasoning colapsable + tool chips + texto. Mientras no haya
          // texto y el turno siga streameando, mostramos el shimmer (muta a
          // "Razonando…" si ya llegó reasoning).
          const hasReasoning = !!message.reasoning;
          const showShimmer = message.streaming && !message.content;

          return (
            <div key={index} className="flex justify-start">
              {/* Mientras carga (shimmer) la burbuja va sin caja gris: solo la
                  grilla con la gota. Cuando llega texto, vuelve el fondo normal. */}
              <div
                className={
                  showShimmer
                    ? "max-w-[85%]"
                    : "bg-neutral-100 dark:bg-neutral-900 max-w-[85%] rounded-panel px-3 py-2"
                }
              >
                {hasReasoning && (
                  <ReasoningBlock
                    reasoning={message.reasoning || ""}
                    streaming={message.streaming}
                  />
                )}

                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="flex flex-col">
                    {message.toolCalls.map((tc) =>
                      tc.sql ? (
                        <ChatToolCallCard
                          key={tc.id}
                          toolCall={tc}
                          dialect={dialect}
                          onRun={() => resolvePending(tc.id, "run")}
                          onDiscard={() => resolvePending(tc.id, "discard")}
                        />
                      ) : (
                        <ToolCallChips key={tc.id} toolCalls={[tc]} />
                      )
                    )}
                  </div>
                )}

                {showShimmer ? (
                  <ChatShimmer />
                ) : (
                  <AssistantMessage
                    content={message.content}
                    dialect={dialect}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 p-3">
        {/* Zona inferior centrada. El ancho es DINÁMICO al ancho de la tab (que es
            arrastrable): escala al 80% del panel, con piso 480px y techo 800px, y nunca
            desborda (min 100%). Así crece al agrandar la tab y se achica con ella. */}
        <div
          className="mx-auto flex flex-col gap-2"
          style={{ width: "min(100%, clamp(480px, 80%, 800px))" }}
        >
          {/* Input estilo "pill": el textarea crece con el contenido (auto-resize)
              y el botón circular de enviar queda alineado abajo (items-end) cuando
              el texto pasa de una línea. Sin + ni micrófono: solo texto y enviar. */}
          <div className="border-input bg-background focus-within:border-secondary-foreground flex items-end gap-2 rounded-2xl border px-3 py-2 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Preguntá lo que quieras…"
            rows={1}
            className="max-h-40 min-h-8 grow resize-none bg-transparent py-1.5 text-sm leading-5 outline-hidden"
          />
          <button
            type="button"
            onClick={() => onSend()}
            disabled={loading || !input.trim()}
            aria-label={loading ? "Generando…" : "Enviar"}
            title={loading ? "Generando…" : "Enviar"}
            // Mientras genera, opacity-100 (no disabled:opacity-40) para que el
            // spinner se vea bien; deshabilitado por input vacío sí se apaga.
            className={`bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity ${
              loading ? "opacity-100" : "disabled:opacity-40"
            }`}
          >
            {loading ? (
              <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
            ) : (
              <ArrowUp className="h-4 w-4" weight="bold" />
            )}
          </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="grow">
              <ChatModelControls />
            </div>
            {/* Toggle auto-run: off = confirmás cada query; on = las lecturas corren
                solas. Las escrituras SIEMPRE piden confirmación, aunque esté on. */}
            <button
              type="button"
              onClick={toggleAutoRun}
              aria-pressed={autoRun}
              title="Auto-run: cuando está activo, las queries de lectura se ejecutan solas. Las escrituras (INSERT/UPDATE/DELETE/DDL) siempre piden confirmación."
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2 py-1 text-xs transition-colors ${
                autoRun
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-input opacity-70 hover:opacity-100"
              }`}
            >
              <Lightning
                className="h-3.5 w-3.5"
                weight={autoRun ? "fill" : "regular"}
              />
              Auto-run {autoRun ? "on" : "off"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
