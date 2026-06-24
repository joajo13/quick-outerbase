"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import SqlEditor from "@/components/gui/sql-editor";
import { Button } from "@/components/ui/button";
import { useStudioContext } from "@/context/driver-provider";
import { useSchema } from "@/context/schema-provider";
import { scc } from "@/core/command";
import { SupportedDialect } from "@/drivers/base-driver";
import { generateId } from "@/lib/generate-id";
import {
  ArrowSquareOut,
  Copy,
  PaperPlaneTilt,
  Robot,
  Sparkle,
} from "@phosphor-icons/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);
    scrollToBottom();

    try {
      // chat() devuelve el texto crudo del assistant (markdown, con posibles
      // bloques ```sql). NO usamos run() porque recorta a SQL y tira error en
      // prosa. NO se ejecuta nada: solo se genera y se muestra.
      const reply = await agentDriver.chat(
        agentDriver.getDefaultModelName(),
        text,
        sessionId.current,
        {
          selected: "",
          schema,
          selectedSchema: currentSchemaName,
        }
      );

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Error: " +
            (e instanceof Error ? e.message : "no se pudo generar la respuesta"),
        },
      ]);
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
          return (
            <div
              key={index}
              className={isUser ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  isUser
                    ? "bg-primary text-primary-foreground max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                    : "bg-neutral-100 dark:bg-neutral-900 max-w-[85%] rounded-lg px-3 py-2"
                }
              >
                {isUser ? (
                  message.content
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

        {loading && (
          <div className="flex justify-start">
            <div className="bg-neutral-100 dark:bg-neutral-900 rounded-lg px-3 py-2 text-sm opacity-70">
              Pensando…
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder="Escribí tu mensaje… (Enter para enviar, Shift+Enter para salto de línea)"
            rows={2}
            className="border-input bg-background focus:border-secondary-foreground grow resize-none rounded-md border p-2 text-sm outline-hidden"
          />
          <Button onClick={onSend} disabled={loading || !input.trim()}>
            <PaperPlaneTilt className="mr-2 h-4 w-4" />
            Enviar
          </Button>
        </div>
      </div>
    </div>
  );
}
