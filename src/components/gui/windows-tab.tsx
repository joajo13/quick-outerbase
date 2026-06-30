import { restrictToHorizontalAxis } from "@/lib/dnd-kit";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { type LucideIcon, LucidePlus, LucideX } from "lucide-react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { SortableTab } from "./sortable-tab";
import {
  SplitState,
  createSplitState,
  splitTab,
  reconcileSelected,
  setPaneTab,
  focusPane,
  closePane,
  syncWithTabs,
  resizePanes,
  MAX_PANES,
} from "./split-tabs-state";
import SplitPanePicker from "./split-pane-picker";

export interface WindowTabItemProps {
  component: React.JSX.Element;
  icon: LucideIcon;
  title: string;
  identifier: string;
  key: string;
  type?: string;
}

interface WindowTabsProps {
  menu?: { text: string; onClick: () => void }[];
  tabs: WindowTabItemProps[];
  selected: number;
  hideCloseButton?: boolean;
  onSelectChange: (selectedIndex: number) => void;
  onTabsChange?: (value: WindowTabItemProps[]) => void;
  enableSplit?: boolean; // default false. Activa el split en este WindowTabs.
}

const WindowTabsContext = createContext<{
  replaceCurrentTab: (tab: WindowTabItemProps) => void;
  changeCurrentTab: (value: { title?: string; identifier?: string }) => void;
}>({
  replaceCurrentTab: () => {
    throw new Error("Not implemented");
  },
  changeCurrentTab: () => {
    throw new Error("Not implemented");
  },
});

const CurrentWindowTab = createContext<{ isActiveTab: boolean }>({
  isActiveTab: false,
});

export function useTabsContext() {
  return useContext(WindowTabsContext);
}

export function useCurrentTab() {
  return useContext(CurrentWindowTab);
}

export default function WindowTabs({
  menu,
  tabs,
  selected,
  hideCloseButton,
  onSelectChange,
  onTabsChange,
  enableSplit = false,
}: WindowTabsProps) {
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8,
    },
  });
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const tabMenuRef = useRef<HTMLDivElement>(null);

  // --- Step 2: Estado del split y sincronización ---

  const selectedKey = tabs[selected]?.key ?? null;

  const [split, setSplit] = useState<SplitState>(() =>
    createSplitState(selectedKey)
  );

  // Reconciliar cuando cambia la tab seleccionada (click en strip, tab nueva, etc.).
  const lastSelectedKey = useRef<string | null>(selectedKey);
  useEffect(() => {
    if (!enableSplit) return;
    if (selectedKey === lastSelectedKey.current) return;
    lastSelectedKey.current = selectedKey;
    setSplit((s) => reconcileSelected(s, selectedKey));
  }, [enableSplit, selectedKey]);

  // Sincronizar paneles cuando cambian las tabs (cierres desde el strip).
  const tabKeys = useMemo(() => tabs.map((t) => t.key), [tabs]);
  useEffect(() => {
    if (!enableSplit) return;
    setSplit((s) => syncWithTabs(s, tabKeys));
  }, [enableSplit, tabKeys]);

  useEffect(() => {
    const container = tabContainerRef.current;
    if (!container) return;

    const selectedTab = container.children[selected];
    if (!selectedTab) return;

    const containerRect = container.getBoundingClientRect();
    const selectedTabRect = selectedTab.getBoundingClientRect();

    let menuWidth = 0;
    if (tabMenuRef.current) {
      menuWidth = tabMenuRef.current.getBoundingClientRect().width;
    }

    if (selectedTabRect.left < containerRect.left) {
      container.scrollLeft += selectedTabRect.left - containerRect.left;
    } else if (selectedTabRect.right > containerRect.right) {
      container.scrollLeft +=
        selectedTabRect.right - containerRect.right + menuWidth + 1;
    }
  }, [selected, tabs]);

  useEffect(() => {
    const container = tabContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY !== 0) {
        container.scrollLeft += event.deltaY;
        event.preventDefault();
      }
    };

    container.addEventListener("wheel", handleWheel);
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  const sensors = useSensors(pointerSensor, keyboardSensor);

  const replaceCurrentTab = useCallback(
    (tab: WindowTabItemProps) => {
      if (tabs[selected]) {
        tabs[selected] = tab;
        if (onTabsChange) {
          onTabsChange([...tabs]);
        }
      }
    },
    [tabs, selected, onTabsChange]
  );

  const changeCurrentTab = useCallback(
    (value: { title?: string; identifier?: string }) => {
      if (tabs[selected]) {
        if (value.title) tabs[selected].title = value.title;
        if (value.identifier) tabs[selected].identifier = value.identifier;

        if (onTabsChange) {
          onTabsChange([...tabs]);
        }
      }
    },
    [tabs, selected, onTabsChange]
  );

  const contextValue = useMemo(
    () => ({ replaceCurrentTab, changeCurrentTab }),
    [changeCurrentTab, replaceCurrentTab]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (active.id !== over?.id) {
        const selectedTab = tabs[selected];
        const oldIndex = tabs.findIndex((tab) => tab.key === active.id);
        const newIndex = tabs.findIndex((tab) => tab.key === over?.id);
        const newTabs = arrayMove(tabs, oldIndex, newIndex);

        if (onTabsChange) {
          onTabsChange(newTabs);
        }

        const selectedIndex = newTabs.findIndex(
          (tab) => tab.key === selectedTab?.key
        );
        onSelectChange(selectedIndex);
      }
    },
    [onTabsChange, tabs, onSelectChange, selected]
  );

  // --- Step 3: Handlers del split ---

  const handleSplitTab = useCallback((tabKey: string) => {
    setSplit((s) => splitTab(s, tabKey));
  }, []);

  const handleClosePane = useCallback((paneIndex: number) => {
    setSplit((s) => closePane(s, paneIndex));
  }, []);

  const handleFocusPane = useCallback((paneIndex: number) => {
    setSplit((s) => focusPane(s, paneIndex));
  }, []);

  const handlePickExisting = useCallback((paneIndex: number, tabKey: string) => {
    setSplit((s) => setPaneTab(s, paneIndex, tabKey));
  }, []);

  const handleResize = useCallback((dividerIndex: number, deltaPercent: number) => {
    setSplit((s) => ({ ...s, sizes: resizePanes(s.sizes, dividerIndex, deltaPercent) }));
  }, []);

  // Map tabKey -> índice de panel donde se ve (para CSS order y marcadores).
  const paneIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    if (enableSplit) {
      split.panes.forEach((p, i) => {
        if (p.tabKey) map.set(p.tabKey, i);
      });
    }
    return map;
  }, [enableSplit, split.panes]);

  const isSplitActive = enableSplit && split.panes.length > 1;

  return (
    <WindowTabsContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToHorizontalAxis]}
      >
        <div className="flex h-full w-full flex-col pl-2">
          <div className="no-scrollbar shrink-0 grow-0 overflow-x-auto">
            <div
              className="window-tab-scrollbar flex h-[40px] items-end gap-1.5 pr-2 pl-7"
              ref={tabContainerRef}
            >
              <SortableContext
                items={tabs.map((tab) => tab.key)}
                strategy={horizontalListSortingStrategy}
              >
                {/* Step 4: Cablear el strip (onSplit + marcador) */}
                {tabs.map((tab, idx) => (
                  <SortableTab
                    key={tab.key}
                    tab={tab}
                    selected={idx === selected}
                    splitMarked={
                      enableSplit &&
                      paneIndexByKey.has(tab.key) &&
                      paneIndexByKey.get(tab.key) !== split.focusedPaneIndex
                    }
                    onSplit={
                      enableSplit && split.panes.length < MAX_PANES
                        ? () => handleSplitTab(tab.key)
                        : undefined
                    }
                    onSelectChange={() => {
                      onSelectChange(idx);
                    }}
                    onClose={
                      hideCloseButton
                        ? undefined
                        : () => {
                            const newTabs = tabs.filter((t) => t.key !== tab.key);
                            if (selected >= idx) {
                              onSelectChange(newTabs.length - 1);
                            }
                            if (onTabsChange) {
                              onTabsChange(newTabs);
                            }
                          }
                    }
                  />
                ))}
              </SortableContext>

              {menu && (
                <div
                  ref={tabMenuRef}
                  style={{ zIndex: 50, position: "sticky" }}
                  className={`right-0 flex h-[40px] items-center bg-neutral-100 dark:bg-black`}
                >
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger>
                      <div className="ml-1.5 flex h-7 items-center justify-center gap-1 rounded-panel p-1.5 py-2 text-sm text-neutral-600 transition hover:bg-neutral-200 hover:text-black dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white">
                        <LucidePlus className="h-4 w-4" /> New
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {menu.map((menuItem, menuIdx) => {
                        return (
                          <DropdownMenuItem
                            key={menuIdx}
                            onClick={menuItem.onClick}
                          >
                            {menuItem.text}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              <div className="h-[40px] flex-1"></div>
            </div>
          </div>

          {/* Step 5: Render del área de contenido en modo split */}
          {!isSplitActive ? (
            <div className="relative grow overflow-hidden rounded-t-panel bg-white dark:bg-neutral-950">
              {tabs.map((tab, tabIndex) => (
                <CurrentWindowTab.Provider
                  key={tab.key}
                  value={{ isActiveTab: tabIndex === selected }}
                >
                  <div
                    className="absolute top-0 right-0 bottom-0 left-0"
                    style={{
                      display: tabIndex === selected ? "inherit" : "none",
                    }}
                  >
                    {tab.component}
                  </div>
                </CurrentWindowTab.Provider>
              ))}
            </div>
          ) : (
            <div className="relative flex grow overflow-hidden rounded-t-panel bg-white dark:bg-neutral-950">
              {/* Tabs: montadas siempre, ubicadas por CSS order. Las no visibles: display none. */}
              {tabs.map((tab) => {
                const paneIdx = paneIndexByKey.get(tab.key);
                const visible = paneIdx !== undefined;
                return (
                  <CurrentWindowTab.Provider
                    key={tab.key}
                    value={{ isActiveTab: paneIdx === split.focusedPaneIndex }}
                  >
                    <div
                      onMouseDownCapture={
                        visible ? () => handleFocusPane(paneIdx!) : undefined
                      }
                      className={cn(
                        "relative min-w-0 overflow-hidden",
                        visible &&
                          paneIdx === split.focusedPaneIndex &&
                          "ring-1 ring-inset ring-primary/40"
                      )}
                      style={
                        visible
                          ? {
                              order: paneIdx! * 2,
                              flexGrow: 0,
                              flexShrink: 0,
                              flexBasis: `${split.sizes[paneIdx!]}%`,
                            }
                          : { display: "none" }
                      }
                    >
                      {/* botón de cerrar panel */}
                      <button
                        onClick={() => handleClosePane(paneIdx!)}
                        title="Cerrar panel"
                        className="absolute top-1 right-1 z-30 flex h-6 w-6 items-center justify-center rounded-control bg-white/70 text-neutral-500 transition hover:bg-neutral-200 hover:text-black dark:bg-neutral-950/70 dark:hover:bg-neutral-800 dark:hover:text-white"
                      >
                        <LucideX className="h-3.5 w-3.5" />
                      </button>
                      {tab.component}
                    </div>
                  </CurrentWindowTab.Provider>
                );
              })}

              {/* Pickers: un panel por cada pane con tabKey null. */}
              {split.panes.map((pane, paneIdx) =>
                pane.tabKey === null ? (
                  <div
                    key={`picker-${paneIdx}`}
                    onMouseDownCapture={() => handleFocusPane(paneIdx)}
                    className={cn(
                      "relative min-w-0 overflow-hidden",
                      paneIdx === split.focusedPaneIndex &&
                        "ring-1 ring-inset ring-primary/40"
                    )}
                    style={{
                      order: paneIdx * 2,
                      flexGrow: 0,
                      flexShrink: 0,
                      flexBasis: `${split.sizes[paneIdx]}%`,
                    }}
                  >
                    <SplitPanePicker
                      availableTabs={tabs.filter((t) => !paneIndexByKey.has(t.key))}
                      createMenu={menu ?? []}
                      onPickExisting={(tabKey) => handlePickExisting(paneIdx, tabKey)}
                      onCancel={() => handleClosePane(paneIdx)}
                    />
                  </div>
                ) : null
              )}

              {/* Divisores: uno antes de cada panel a partir del segundo. */}
              {split.panes.slice(1).map((_, i) => {
                const dividerIndex = i; // entre panel i e i+1
                return (
                  <SplitDivider
                    key={`divider-${dividerIndex}`}
                    order={dividerIndex * 2 + 1}
                    onResize={(deltaPercent) => handleResize(dividerIndex, deltaPercent)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </DndContext>
    </WindowTabsContext.Provider>
  );
}

// Step 6: Divisor arrastreable entre paneles (delta incremental).
function SplitDivider({
  order,
  onResize,
}: {
  order: number;
  onResize: (deltaPercent: number) => void;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const parentWidth =
      e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;

    let lastX = startX;
    const onMove = (ev: PointerEvent) => {
      const deltaPercent = ((ev.clientX - lastX) / parentWidth) * 100;
      lastX = ev.clientX;
      onResize(deltaPercent);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={{ order, flexGrow: 0, flexShrink: 0, flexBasis: 6 }}
      onPointerDown={onPointerDown}
      className="z-20 cursor-col-resize bg-neutral-100 transition-colors hover:bg-primary/40 dark:bg-black"
    />
  );
}
