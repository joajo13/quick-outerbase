"use client";
import SqlEditor from "@/components/gui/sql-editor";
import { Button } from "@/components/ui/button";
import { useStudioContext } from "@/context/driver-provider";
import { scc } from "@/core/command";
import { SupportedDialect } from "@/drivers/base-driver";
import { cn } from "@/lib/utils";
import {
  ArrowsInSimple,
  ArrowSquareOut,
  ArrowsOutSimple,
  ArrowUp,
  CaretDown,
  CaretRight,
  ChatCircle,
  CircleNotch,
  Copy,
  Key,
  Lightning,
  Plus,
  Robot,
  Sparkle,
  Wrench,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useChat, useChatLayout } from "./chat-provider";
import ChatModelControls from "./chat-model-controls";
import ChatShimmer from "./chat-shimmer";
import ChatToolCallCard, { ChatToolCall } from "./chat-tool-call-card";

// ToolCall en la UI: el tipo lo define la card (lleva sql/estado/resultado del run).
type ToolCall = ChatToolCall;

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

// Botón redondo flotante del header (API key, nuevo chat, expandir/contraer, cerrar).
// Se usa en pantalla completa, donde flota sobre la conversación centrada.
function HeaderButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="border-input bg-background/80 pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
    >
      {children}
    </button>
  );
}

// Botón "ghost" del header estilo pestaña del panel lateral: sin borde ni sombra,
// sólo un hover sutil. Mismo lenguaje visual que los iconos del sidebar izquierdo.
function GhostButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-control text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

// El chat como panel. `variant` decide sólo la cáscara (botón expandir vs contraer
// y el ancho del input); toda la conversación vive en el ChatProvider, así que
// lateral y pantalla completa comparten los MISMOS mensajes.
export default function ChatPanel({
  variant = "side",
}: {
  variant?: "side" | "full";
}) {
  const { agentDriver } = useStudioContext();
  const {
    messages,
    input,
    setInput,
    loading,
    autoRun,
    toggleAutoRun,
    send,
    newChat,
    resolvePending,
    dialect,
    suggestions,
    openSettings,
  } = useChat();
  const { expand, collapse, closeChat, handleFullTabClosed } = useChatLayout();

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Cuando el tab de pantalla completa se desmonta (la X del strip lo cerró), avisamos
  // al provider para que sincronice el modo. Si el cierre vino de contraer/cerrar, es
  // un no-op (el provider ya cambió el modo antes).
  useEffect(() => {
    if (variant !== "full") return;
    return () => handleFullTabClosed();
  }, [variant, handleFullTabClosed]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  // Autoscroll al pie en cada cambio de mensajes (incluye los deltas del streaming,
  // que devuelven un array nuevo).
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Auto-resize del textarea: crece con el contenido hasta max-h-40 (después
  // scrollea, lo clampea el CSS). Reseteamos a 'auto' antes de medir para que
  // también achique al borrar líneas o al limpiarse después de enviar.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter envía; Shift+Enter inserta salto de línea.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  // Pantalla completa: botones flotantes sobre la conversación centrada. El wrapper no
  // captura clicks (pointer-events-none) para no tapar el scroll; sólo los botones sí.
  const floatingHeader = (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end gap-2 p-3">
      <HeaderButton onClick={collapse} label="Volver a lateral">
        <ArrowsInSimple className="h-4 w-4" />
      </HeaderButton>
      <HeaderButton onClick={newChat} label="Nuevo chat">
        <Plus className="h-4 w-4" />
      </HeaderButton>
      <HeaderButton onClick={openSettings} label="API key">
        <Key className="h-4 w-4" />
      </HeaderButton>
      <HeaderButton onClick={closeChat} label="Cerrar chat">
        <X className="h-4 w-4" />
      </HeaderButton>
    </div>
  );

  // Panel lateral: barra superior que replica la de las tabs (Query, Tables…). Una
  // "pestaña" Chat activa a la izquierda con el MISMO look que WindowTabItemButton
  // (rounded-t + orejas tab-merge que la funden con el panel) y las acciones a la
  // derecha. El panel "flota" con esquinas redondeadas sobre el fondo neutro (el pl-2
  // del contenedor deja el espacio, sin línea divisoria).
  const sideTabBar = (
    <div className="shrink-0 grow-0">
      {/* pl-7 igual que WindowTabs: la tab arranca corrida del borde para que las
          orejas tab-merge caigan sobre el panel y la fundan bien con el content. */}
      <div className="flex h-[40px] items-end gap-1.5 pr-1 pl-7">
        <div className="tab-merge text-primary relative flex h-[34px] items-center self-end rounded-t-panel bg-white px-2.5 text-sm dark:bg-neutral-950">
          <ChatCircle className="h-4 w-4 shrink-0 grow-0" />
          <div className="line-clamp-1 px-2">Chat</div>
        </div>
        <div className="grow" />
        <div className="flex items-center gap-0.5 self-center pb-1">
          <GhostButton onClick={expand} label="Pantalla completa">
            <ArrowsOutSimple className="h-4 w-4" />
          </GhostButton>
          <GhostButton onClick={newChat} label="Nuevo chat">
            <Plus className="h-4 w-4" />
          </GhostButton>
          <GhostButton onClick={openSettings} label="API key">
            <Key className="h-4 w-4" />
          </GhostButton>
          <GhostButton onClick={closeChat} label="Cerrar chat">
            <X className="h-4 w-4" />
          </GhostButton>
        </div>
      </div>
    </div>
  );

  // ¿Hay un modelo usable? Si no (falta provider/model/token) mostramos el CTA de
  // settings. agentDriver NO es undefined cuando falta la key (existe con un default
  // muerto), por eso chequeamos hasUsableModel().
  const agentReady = !!agentDriver && agentDriver.hasUsableModel();

  const emptyState = (
    <div className="flex grow flex-col items-center justify-center gap-4 p-8 text-center">
      <Sparkle className="h-10 w-10 opacity-60" />
      <div className="max-w-md">
        <h2 className="mb-1 text-lg font-semibold">Chat con IA</h2>
        <p className="text-sm opacity-70">
          Configurá un proveedor de IA (Anthropic, OpenAI o Gemini) y pegá tu API
          key para charlar con el asistente y generar SQL a partir de tu schema.
        </p>
      </div>
      <Button onClick={openSettings}>
        <Robot className="mr-2 h-4 w-4" />
        Configurar IA
      </Button>
    </div>
  );

  const conversation = (
    <>
      <div
        ref={scrollRef}
        className={cn(
          "flex grow flex-col gap-4 overflow-y-auto p-4",
          // Sólo en pantalla completa dejamos lugar arriba para los botones flotantes;
          // en lateral la barra de tabs ya ocupa su espacio en el flujo.
          variant === "full" && "pt-14"
        )}
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
                  onClick={() => send(suggestion)}
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
        {/* Zona inferior. En pantalla completa se centra y escala al ancho de la tab
            (piso 480px, techo 800px). En el panel lateral ocupa el 100% (el panel ya
            es angosto y arrastrable). */}
        <div
          className="mx-auto flex flex-col gap-2"
          style={
            variant === "full"
              ? { width: "min(100%, clamp(480px, 80%, 800px))" }
              : { width: "100%" }
          }
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
              onClick={() => send()}
              disabled={loading || !input.trim()}
              aria-label={loading ? "Generando…" : "Enviar"}
              title={loading ? "Generando…" : "Enviar"}
              // Mientras genera, opacity-100 (no disabled:opacity-40) para que el
              // spinner se vea bien; deshabilitado por input vacío sí se apaga.
              className={cn(
                "bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-opacity",
                loading ? "opacity-100" : "disabled:opacity-40"
              )}
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
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2 py-1 text-xs transition-colors",
                autoRun
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-input opacity-70 hover:opacity-100"
              )}
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
    </>
  );

  const body = agentReady ? conversation : emptyState;

  if (variant === "side") {
    // Replica la estructura de WindowTabs: barra de tabs + content con esquinas
    // redondeadas que "flota" sobre el fondo neutro. El pl-2 deja un espacio (no una
    // línea) contra el área de tabs de al lado.
    return (
      <div className="flex h-full w-full flex-col pl-2">
        {sideTabBar}
        <div className="relative flex grow flex-col overflow-hidden rounded-t-panel bg-white dark:bg-neutral-950">
          {body}
        </div>
      </div>
    );
  }

  // Pantalla completa: los botones flotan sobre la conversación (o el CTA).
  return (
    <div className="relative flex h-full flex-col">
      {floatingHeader}
      {body}
    </div>
  );
}
