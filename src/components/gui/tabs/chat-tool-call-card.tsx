"use client";
import SqlEditor from "@/components/gui/sql-editor";
import { Button } from "@/components/ui/button";
import { scc } from "@/core/command";
import { SupportedDialect } from "@/drivers/base-driver";
import {
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Copy,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";

// Resultado de un run, en forma lista para la mini-grilla. `keys` es el nombre de
// columna que keyea la row; `headers` es el displayName para mostrar.
export interface ChatToolCallResult {
  headers: string[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number | null;
}

// Una tool call con todo su estado de UI (la query propuesta y el ciclo de vida del
// run). Owner de este tipo: la card. chat-tab lo importa para ChatMessage.toolCalls.
export interface ChatToolCall {
  id: string;
  name: string;
  args?: string;
  sql?: string;
  reason?: string;
  status?: "pending" | "running" | "done" | "error" | "cancelled";
  result?: ChatToolCallResult;
  error?: string;
}

// Cantidad máxima de filas que mostramos en la mini-grilla (el resto, "Abrir en editor").
const MAX_GRID_ROWS = 100;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "[blob]";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const s = String(value);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

export interface ChatToolCallCardProps {
  toolCall: ChatToolCall;
  dialect: SupportedDialect;
  onRun: () => void;
  onDiscard: () => void;
}

export default function ChatToolCallCard({
  toolCall,
  dialect,
  onRun,
  onDiscard,
}: ChatToolCallCardProps) {
  const sql = toolCall.sql ?? "";
  const status = toolCall.status ?? "pending";

  const onCopy = () => {
    window.navigator.clipboard
      .writeText(sql)
      .then(() => toast.success("SQL copiado al portapapeles"))
      .catch(() => toast.error("No se pudo copiar"));
  };

  const onOpenInEditor = () => {
    scc.tabs.openBuiltinQuery({ name: "From Chat", initialCode: sql });
  };

  return (
    <div className="my-2 overflow-hidden rounded-panel border">
      {/* Header: motivo + estado */}
      <div className="flex items-center gap-1.5 border-b bg-neutral-50 px-3 py-1.5 text-xs font-medium dark:bg-neutral-950">
        <StatusIcon status={status} />
        <span className="line-clamp-1 grow opacity-80">
          {toolCall.reason || "Ejecutar query"}
        </span>
      </div>

      {/* Query read-only */}
      <div className="max-h-[220px] overflow-auto bg-neutral-50 dark:bg-neutral-950">
        <SqlEditor value={sql} dialect={dialect} readOnly />
      </div>

      {/* Estado pending: botones de acción (el punto de freno) */}
      {status === "pending" && (
        <div className="flex flex-wrap gap-2 border-t bg-neutral-50 p-2 dark:bg-neutral-950">
          <Button size="sm" onClick={onRun}>
            <Play className="mr-1.5 h-4 w-4" weight="fill" />
            Run
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenInEditor}>
            <ArrowSquareOut className="mr-1.5 h-4 w-4" />
            Abrir en editor
          </Button>
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy className="mr-1.5 h-4 w-4" />
            Copiar
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard}>
            <X className="mr-1.5 h-4 w-4" />
            Descartar
          </Button>
        </div>
      )}

      {/* Estado running: spinner */}
      {status === "running" && (
        <div className="flex items-center gap-2 border-t bg-neutral-50 p-2 text-xs opacity-70 dark:bg-neutral-950">
          <CircleNotch className="h-4 w-4 animate-spin" weight="bold" />
          Ejecutando…
        </div>
      )}

      {/* Estado done: mini-grilla + stats */}
      {status === "done" && toolCall.result && (
        <div className="border-t bg-white dark:bg-neutral-950">
          <ResultGrid result={toolCall.result} />
          <div className="flex items-center gap-2 border-t px-2 py-1.5 text-xs opacity-70">
            <span>
              {toolCall.result.rowCount}{" "}
              {toolCall.result.rowCount === 1 ? "fila" : "filas"}
            </span>
            {toolCall.result.durationMs != null && (
              <span>· {toolCall.result.durationMs} ms</span>
            )}
            <button
              type="button"
              onClick={onOpenInEditor}
              className="ml-auto inline-flex items-center gap-1 hover:opacity-100"
            >
              <ArrowSquareOut className="h-3.5 w-3.5" />
              Abrir en editor
            </button>
          </div>
        </div>
      )}

      {/* Estado error: mensaje + abrir en editor */}
      {status === "error" && (
        <div className="border-t bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          <div className="whitespace-pre-wrap">{toolCall.error}</div>
          <button
            type="button"
            onClick={onOpenInEditor}
            className="mt-1.5 inline-flex items-center gap-1 underline opacity-80 hover:opacity-100"
          >
            <ArrowSquareOut className="h-3.5 w-3.5" />
            Abrir en editor
          </button>
        </div>
      )}

      {/* Estado cancelled: la query queda a mano */}
      {status === "cancelled" && (
        <div className="flex flex-wrap gap-2 border-t bg-neutral-50 p-2 dark:bg-neutral-950">
          <span className="mr-1 inline-flex items-center text-xs opacity-60">
            No ejecutada
          </span>
          <Button variant="outline" size="sm" onClick={onOpenInEditor}>
            <ArrowSquareOut className="mr-1.5 h-4 w-4" />
            Abrir en editor
          </Button>
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy className="mr-1.5 h-4 w-4" />
            Copiar
          </Button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ChatToolCall["status"] }) {
  switch (status) {
    case "running":
      return <CircleNotch className="h-3.5 w-3.5 animate-spin" weight="bold" />;
    case "done":
      return (
        <CheckCircle
          className="h-3.5 w-3.5 text-green-600 dark:text-green-400"
          weight="fill"
        />
      );
    case "error":
      return (
        <WarningCircle
          className="h-3.5 w-3.5 text-red-600 dark:text-red-400"
          weight="fill"
        />
      );
    case "cancelled":
      return <X className="h-3.5 w-3.5 opacity-50" />;
    default:
      return <Play className="h-3.5 w-3.5 opacity-60" weight="fill" />;
  }
}

function ResultGrid({ result }: { result: ChatToolCallResult }) {
  const rows = result.rows.slice(0, MAX_GRID_ROWS);

  if (result.headers.length === 0) {
    return (
      <div className="px-3 py-2 text-xs opacity-60">
        Sin columnas (la query no devolvió un result set).
      </div>
    );
  }

  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-neutral-100 dark:bg-neutral-900">
          <tr>
            {result.headers.map((h, i) => (
              <th
                key={i}
                className="border-b px-2 py-1 text-left font-medium whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="even:bg-neutral-50 dark:even:bg-neutral-900/40">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="border-b px-2 py-1 whitespace-nowrap"
                  title={formatCell(cell)}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rowCount > MAX_GRID_ROWS && (
        <div className="px-2 py-1 text-xs opacity-60">
          Mostrando {MAX_GRID_ROWS} de {result.rowCount} filas. Abrí en editor para
          ver todo.
        </div>
      )}
    </div>
  );
}
