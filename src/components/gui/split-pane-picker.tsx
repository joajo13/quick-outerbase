import { cn } from "@/lib/utils";
import { LucidePlus, LucideX } from "lucide-react";
import { WindowTabItemProps } from "./windows-tab";

export interface SplitPanePickerProps {
  availableTabs: WindowTabItemProps[];
  createMenu: { text: string; onClick: () => void }[];
  onPickExisting: (tabKey: string) => void;
  onCancel: () => void;
}

export default function SplitPanePicker({
  availableTabs,
  createMenu,
  onPickExisting,
  onCancel,
}: SplitPanePickerProps) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 bg-white p-6 dark:bg-neutral-950">
      <button
        onClick={onCancel}
        title="Cancelar split"
        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-control text-neutral-500 transition hover:bg-neutral-200 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
      >
        <LucideX className="h-4 w-4" />
      </button>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <div className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          New
        </div>
        {createMenu.map((item, idx) => (
          <button
            key={idx}
            onClick={item.onClick}
            className="flex items-center gap-2 rounded-panel border border-neutral-200 px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <LucidePlus className="h-4 w-4 shrink-0 text-neutral-500" />
            {item.text}
          </button>
        ))}
      </div>

      {availableTabs.length > 0 && (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <div className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
            Open existing
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onPickExisting(tab.key)}
                className={cn(
                  "flex items-center gap-2 rounded-panel px-3 py-2 text-left text-sm transition",
                  "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                )}
              >
                <tab.icon className="h-4 w-4 shrink-0 text-neutral-500" />
                <span className="line-clamp-1">{tab.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
