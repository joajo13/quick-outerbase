"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import SqlEditor from "@/components/gui/sql-editor";
import { Button } from "@/components/ui/button";
import { useStudioContext } from "@/context/driver-provider";
import { useSchema } from "@/context/schema-provider";
import { scc } from "@/core/command";
import { AgentStreamEvent } from "@/drivers/agent/base";
import { SupportedDialect } from "@/drivers/base-driver";
import { generateId } from "@/lib/generate-id";
import {
  ArrowSquareOut,
  CaretDown,
  CaretRight,
  Copy,
  PaperPlaneTilt,
  Robot,
  Sparkle,
  Wrench,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ChatShimmer from "./chat-shimmer";
import ChatTabHeader from "./chat-tab-header";

interface ToolCall {
  id: string;
  name: string;
  args?: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  // Razonamiento del modelo (Anthropic/Gemini con flag). Se renderiza en un bloque
  // colapsable arriba del texto. OpenAI no lo expone → queda vacío.
  reasoning?: string;
  // Tool-calls: scaffold display-only (hoy no se emiten). Se dibujan como chips.
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
    case "tool_call":
      next.toolCalls = [
        ...(next.toolCalls || []),
        { id: event.id, name: event.name, args: event.args },
      ];
      break;
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
    <div className="my-2 overflow-hidden rounded-md border">
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
                className="my-2 overflow-auto rounded-md border bg-neutral-50 p-2 text-xs dark:bg-neutral-950"
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
    <div className="mb-2 rounded-md border border-dashed">
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

export default function ChatWindow() {
  const { agentDriver, databaseDriver } = useStudioContext();
  const { schema, currentSchemaName } = useSchema();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // sessionId estable durante toda la vida del tab → la conversación es
  // multi-turn y coherente (el driver mantiene el historial por sessionId).
  const sessionId = useRef(generateId());
  const scrollRef = useRef<HTMLDivElement>(null);

  const dialect: SupportedDialect = databaseDriver.getFlags().dialect;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const onSend = useCallback(async () => {
    const text = input.trim();
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
      // tool_call/done/error). Arma la MISMA sesión multi-turno que chat() y persiste
      // el historial. NO se ejecuta nada: solo se genera y se muestra. Si el stream
      // falla, el driver cae solo al query() no-streaming (hard fallback).
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
          if (event.type === "text") scrollToBottom();
        }
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
  ]);

  // Nuevo chat: limpia los mensajes y rota el sessionId → el driver arranca un
  // historial in-memory fresco (re-manda system + schema en el próximo turno).
  const onNewChat = useCallback(() => {
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
    <div className="flex h-full flex-col">
      <ChatTabHeader onNewChat={onNewChat} />

      <div
        ref={scrollRef}
        className="flex grow flex-col gap-4 overflow-y-auto p-4"
      >
        {messages.length === 0 && (
          <div className="flex grow flex-col items-center justify-center gap-2 text-center opacity-60">
            <Sparkle className="h-8 w-8" />
            <p className="text-sm">
              Preguntá lo que quieras sobre tu base. El asistente genera SQL a
              partir de tu schema. No se ejecuta nada automáticamente.
            </p>
          </div>
        )}

        {messages.map((message, index) => {
          const isUser = message.role === "user";
          if (isUser) {
            return (
              <div key={index} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap">
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
              <div className="bg-neutral-100 dark:bg-neutral-900 max-w-[85%] rounded-lg px-3 py-2">
                {hasReasoning && (
                  <ReasoningBlock
                    reasoning={message.reasoning || ""}
                    streaming={message.streaming}
                  />
                )}

                {message.toolCalls && message.toolCalls.length > 0 && (
                  <ToolCallChips toolCalls={message.toolCalls} />
                )}

                {showShimmer ? (
                  <ChatShimmer label={hasReasoning ? "Razonando…" : undefined} />
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

      <div className="shrink-0 border-t p-3">
        {/* items-stretch + h-auto en el botón → el botón iguala la altura del
            textarea (2 filas) en vez de quedar más bajo y pegado al fondo. */}
        <div className="flex items-stretch gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribí tu mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
            rows={2}
            className="border-input bg-background focus:border-secondary-foreground grow resize-none rounded-md border p-2 text-sm outline-hidden"
          />
          <Button
            onClick={onSend}
            disabled={loading || !input.trim()}
            className="h-auto"
          >
            <PaperPlaneTilt className="mr-2 h-4 w-4" />
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
