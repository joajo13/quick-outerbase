import { BaseHandle } from "@/components/base-handle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Position } from "@xyflow/react";
import { Diamond, KeyRound, Link2 } from "lucide-react";
import { ERDSchemaNodeColumnProps } from "./database-schema-node";

// Verde firma de Liam (claro/oscuro para contraste).
const ACCENT = "text-[#008543] dark:text-[#1ded83]";

export default function ERDTableColumn({
  column,
}: {
  column: ERDSchemaNodeColumnProps;
}) {
  const icon = column.pk ? (
    <KeyRound size={14} strokeWidth={1.75} className={ACCENT} />
  ) : column.fk ? (
    <Link2 size={14} strokeWidth={1.75} className={ACCENT} />
  ) : column.nullable ? (
    <Diamond size={11} strokeWidth={1.75} className="text-muted-foreground/70" />
  ) : (
    <Diamond
      size={11}
      strokeWidth={1.75}
      className="fill-muted-foreground/70 text-muted-foreground/70"
    />
  );

  const row = (
    <div className="group relative grid h-8 grid-cols-[auto_1fr] items-center gap-1.5 border-b border-[#e7e8ea] px-2 last:border-b-0 last:rounded-b-md hover:bg-[#f0f1f2] dark:border-[#2c2f30] dark:hover:bg-[#383a3b]">
      <BaseHandle
        id={column.title}
        type="target"
        position={Position.Left}
        className="!h-[8px] !w-[8px] !border-0 !bg-transparent"
      />
      <div className="flex w-4 items-center justify-center">{icon}</div>
      <div className="flex items-center justify-between gap-3 overflow-hidden">
        <span className="truncate text-xs text-[#141616] dark:text-white">
          {column.title}
          {column.unique && !column.pk && (
            <span className={`ml-1 text-[9px] font-semibold ${ACCENT}`}>
              UQ
            </span>
          )}
        </span>
        <span className="shrink-0 truncate text-right font-mono text-[10px] text-[#5f6366] dark:text-white/70">
          {column.type}
        </span>
      </div>
      <BaseHandle
        id={column.title}
        type="source"
        position={Position.Right}
        className="!h-[8px] !w-[8px] !border-0 !bg-transparent"
      />
    </div>
  );

  if (!column.comment) return row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[260px]">
        <div className="text-xs">
          <span className="font-semibold">{column.title}</span> · {column.type}
        </div>
        <div className="text-muted-foreground mt-0.5 text-xs">
          {column.comment}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
