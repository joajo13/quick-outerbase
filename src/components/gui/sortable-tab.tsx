import { CSS } from "@/lib/dnd-kit";
import { cn } from "@/lib/utils";
import { useSortable } from "@dnd-kit/sortable";
import { LucideIcon, LucideX } from "lucide-react";
import { forwardRef } from "react";
import { ButtonProps } from "../ui/button";
import { WindowTabItemProps } from "./windows-tab";

interface SortableTabProps {
  tab: WindowTabItemProps;
  selected: boolean;
  onSelectChange: () => void;
  onClose?: () => void;
}

type WindowTabItemButtonProps = ButtonProps & {
  selected?: boolean;
  title: string;
  icon: LucideIcon;
  onClose?: () => void;
  isDragging?: boolean;
};

export const WindowTabItemButton = forwardRef<
  HTMLButtonElement,
  WindowTabItemButtonProps
>(function WindowTabItemButton(props: WindowTabItemButtonProps, ref) {
  const {
    icon: Icon,
    selected,
    title,
    onClose,
    isDragging,
    ...rest
  } = props;

  return (
    <button
      className={cn(
        "group relative flex max-w-[240px] min-w-[140px] items-center px-2.5 text-left text-sm transition-colors",
        isDragging && "z-20",
        selected
          ? "tab-merge text-primary h-[34px] self-end rounded-t-panel bg-white dark:bg-neutral-950"
          : "h-[28px] self-center rounded-panel text-neutral-500 hover:bg-neutral-200/70 hover:text-black dark:hover:bg-neutral-800/70 dark:hover:text-white"
      )}
      onAuxClick={({ button }) => button === 1 && onClose && onClose()}
      ref={ref}
      {...rest}
    >
      <Icon className="h-4 w-4 shrink-0 grow-0" />
      <div className="line-clamp-1 grow px-2">{title}</div>
      {onClose && (
        <div
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-control transition-opacity hover:bg-neutral-300 hover:text-black dark:hover:bg-neutral-700 dark:hover:text-white",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation();
            if (onClose) onClose();
          }}
        >
          <LucideX className={cn("h-3 w-3 shrink-0 grow-0")} />
        </div>
      )}
    </button>
  );
});

export function SortableTab({
  tab,
  selected,
  onSelectChange,
  onClose,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    transition,
    transform,
    isDragging,
    setNodeRef,
  } = useSortable({ id: tab.key });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <WindowTabItemButton
      ref={setNodeRef}
      icon={tab.icon}
      title={tab.title}
      onClick={onSelectChange}
      selected={selected}
      onClose={onClose}
      style={style}
      isDragging={isDragging}
      {...attributes}
      {...listeners}
    />
  );
}
