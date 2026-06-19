import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Node, NodeProps } from "@xyflow/react";
import { Table2 } from "lucide-react";
import ContextMenuERD from "./context-menu-diagram";
import ERDTableColumn from "./erd-table-column";

export interface ERDSchemaNodeColumnProps {
  title: string;
  type: string;
  pk: boolean;
  fk: boolean;
  unique: boolean;
  nullable?: boolean;
  comment?: string;
}

export type ERDSchemaNodeProps = Node<{
  label: string;
  schemaName: string;
  comment?: string;
  schema: ERDSchemaNodeColumnProps[];
}>;

export function DatabaseSchemaNode({
  data,
  selected,
}: NodeProps<ERDSchemaNodeProps>) {
  const schema = data.schema;

  const header = (
    <h2
      className={
        "flex h-8 items-center gap-1.5 rounded-t-md border-b border-[#e7e8ea] bg-[#f0f0f0] px-2 text-sm font-medium text-[#141616] dark:border-[#2c2f30] dark:bg-[#232526] dark:text-white/70"
      }
    >
      <Table2 size={15} className="text-[#008543] dark:text-[#1ded83]" />
      <span className="truncate">{data.label}</span>
    </h2>
  );

  return (
    <div
      className={
        "min-w-[180px] overflow-hidden rounded-md border bg-white shadow-[0_0_20px_0_rgba(0,0,0,0.12)] transition-all dark:bg-[#141616] dark:shadow-[0_0_20px_0_rgba(0,0,0,0.45)] " +
        (selected
          ? "border-[#008543] shadow-[0_0_20px_0_rgba(29,237,131,0.35)] dark:border-[#1ded83]"
          : "border-black/10 dark:border-white/20")
      }
    >
      <ContextMenuERD tableName={data.label} schemaName={data.schemaName}>
        {data.comment ? (
          <Tooltip>
            <TooltipTrigger asChild>{header}</TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              {data.comment}
            </TooltipContent>
          </Tooltip>
        ) : (
          header
        )}
      </ContextMenuERD>
      <div>
        {schema.map((entry) => (
          <ERDTableColumn key={entry.title} column={entry} />
        ))}
      </div>
    </div>
  );
}
