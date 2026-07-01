"use client";
import QueryWindow from "@/components/gui/tabs/query-tab";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchemaView from "./schema-sidebar";
import SidebarTab, { SidebarTabItem } from "./sidebar-tab";
import ToolSidebar from "./sidebar/tools-sidebar";
import WindowTabs, { WindowTabItemProps } from "./windows-tab";

import { useStudioContext } from "@/context/driver-provider";
import { useSchema } from "@/context/schema-provider";
import { scc } from "@/core/command";
import {
  tabCloseChannel,
  tabOpenChannel,
  tabReplaceChannel,
} from "@/core/extension-tab";
import { normalizedPathname, sendAnalyticEvents } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { Binoculars, GearSix, Table } from "@phosphor-icons/react";
import SavedDocTab from "./sidebar/saved-doc-tab";
import ChatPanel from "./tabs/chat-tab";
import { ChatProvider, useChatLayout } from "./tabs/chat-provider";

// Ancho por defecto (px) del panel lateral del chat cuando no hay uno guardado.
const CHAT_DEFAULT_WIDTH = 400;
const CHAT_WIDTH_KEY = "chat-side-width";

export default function DatabaseGui() {
  // El ChatProvider envuelve todo el layout: el panel lateral y el tab de pantalla
  // completa son dos vistas de la MISMA conversación (el estado vive acá arriba, no
  // se reinicia al alternar entre lateral y full).
  return (
    <ChatProvider>
      <DatabaseGuiInner />
    </ChatProvider>
  );
}

function DatabaseGuiInner() {
  const DEFAULT_WIDTH = 300;

  const [defaultWidthPercentage, setDefaultWidthPercentage] = useState(25);

  useEffect(() => {
    setDefaultWidthPercentage((DEFAULT_WIDTH / window.innerWidth) * 100);
  }, []);

  const { databaseDriver, docDriver, extensions, containerClassName } =
    useStudioContext();

  // Estado de layout del chat: openChat() lo abre en lateral (default).
  const { mode: chatMode, openChat } = useChatLayout();

  // Ancho del panel lateral del chat (en %), persistido en localStorage. Lo leemos en
  // un effect para no romper la hidratación; el panel sólo se monta tras interacción
  // (mode==="side"), así que el valor ya está listo cuando aparece.
  const [chatSizePercentage, setChatSizePercentage] = useState(30);
  useEffect(() => {
    const saved = Number(localStorage.getItem(CHAT_WIDTH_KEY));
    if (saved >= 15 && saved <= 60) {
      setChatSizePercentage(saved);
    } else {
      setChatSizePercentage((CHAT_DEFAULT_WIDTH / window.innerWidth) * 100);
    }
  }, []);
  const persistChatSize = useCallback((size: number) => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CHAT_WIDTH_KEY, String(Math.round(size)));
    }
  }, []);

  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const { currentSchemaName } = useSchema();
  const [tabs, setTabs] = useState<WindowTabItemProps[]>(() => [
    {
      title: "Query",
      identifier: "query",
      key: "query",
      component: <QueryWindow initialName="Query" />,
      icon: Binoculars,
      type: "query",
    },
  ]);

  const openTabInternal = useCallback((tabOption: WindowTabItemProps) => {
    setTabs((prev) => {
      const foundIndex = prev.findIndex(
        (tab) => tab.identifier === tabOption.key
      );

      if (foundIndex >= 0) {
        setSelectedTabIndex(foundIndex);
        return prev;
      }
      setSelectedTabIndex(prev.length);

      return [...prev, tabOption];
    });
  }, []);

  const replaceTabInternal = useCallback(
    (tabOption: WindowTabItemProps) => {
      setTabs((prev) => {
        const foundIndex = prev.findIndex(
          (tab) => tab.identifier === tabOption.key
        );

        if (foundIndex >= 0) {
          setSelectedTabIndex(foundIndex);
          return prev;
        }

        return prev.map((tab, tabIndex) => {
          if (tabIndex === selectedTabIndex) {
            return tabOption;
          }
          return tab;
        });
      });
    },
    [selectedTabIndex]
  );

  const closeStudioTab = useCallback(
    (keys: string[]) => {
      if (keys) {
        setTabs((currentTabs) => {
          const selectedTab = currentTabs[selectedTabIndex];
          const newTabs = currentTabs.filter(
            (t) => !keys?.includes(t.identifier)
          );

          if (selectedTab) {
            const selectedTabNewIndex = newTabs.findIndex(
              (t) => t.identifier === selectedTab.identifier
            );
            if (selectedTabNewIndex < 0) {
              setSelectedTabIndex(
                Math.min(selectedTabIndex, newTabs.length - 1)
              );
            } else {
              setSelectedTabIndex(selectedTabNewIndex);
            }
          }

          return newTabs;
        });
      }
    },
    [selectedTabIndex]
  );

  useEffect(() => {
    return tabOpenChannel.listen(openTabInternal);
  }, [openTabInternal]);

  useEffect(() => {
    return tabCloseChannel.listen(closeStudioTab);
  }, [closeStudioTab]);

  useEffect(() => {
    return tabReplaceChannel.listen(replaceTabInternal);
  }, [replaceTabInternal]);

  const sidebarTabs = useMemo(() => {
    return [
      {
        key: "database",
        name: "Schema",
        content: <SchemaView />,
        icon: <Table weight="light" size={24} />,
      },
      docDriver
        ? {
            key: "saved",
            name: "Queries",
            content: <SavedDocTab />,
            icon: <Binoculars weight="light" size={24} />,
          }
        : undefined,
      {
        key: "tools",
        name: "Tools",
        content: <ToolSidebar />,
        icon: <GearSix weight="light" size={24} />,
      },
      ...extensions.getSidebars(),
    ].filter(Boolean) as SidebarTabItem[];
  }, [docDriver, extensions]);

  const tabSideMenu = useMemo(() => {
    return [
      {
        text: "New Query",
        onClick: () => {
          scc.tabs.openBuiltinQuery({});
        },
      },
      databaseDriver.getFlags().supportCreateUpdateTable
        ? {
            text: "New Table",
            onClick: () => {
              scc.tabs.openBuiltinSchema({ schemaName: currentSchemaName });
            },
          }
        : undefined,
      {
        text: "Chat",
        // El chat abre por default en lateral; desde ahí se expande a pantalla completa.
        onClick: () => {
          openChat();
        },
      },
    ].filter(Boolean) as { text: string; onClick: () => void }[];
  }, [currentSchemaName, databaseDriver, openChat]);

  // Send to analytic when tab changes.
  const previousLogTabKey = useRef<string>("");
  useEffect(() => {
    const currentTab = tabs[selectedTabIndex];
    if (currentTab && currentTab.key !== previousLogTabKey.current) {
      // We don't log the first tab because it's already logged in the main screen.
      if (previousLogTabKey.current) {
        sendAnalyticEvents([
          {
            name: "page_view",
            data: {
              path: normalizedPathname(window.location.pathname),
              tab: currentTab.type,
              tab_key: currentTab.key,
            },
          },
        ]);
      }

      previousLogTabKey.current = currentTab.key;
    }
  }, [tabs, selectedTabIndex, previousLogTabKey]);

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col bg-neutral-100 dark:bg-black",
        containerClassName
      )}
    >
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel
          id="sidebar"
          order={1}
          minSize={5}
          defaultSize={defaultWidthPercentage}
        >
          <SidebarTab tabs={sidebarTabs} />
        </ResizablePanel>
        <ResizableHandle withHandle className="bg-transparent" />
        {/* Sin defaultSize: el panel principal toma el espacio remanente. Así, al abrir
            el chat, los defaultSize de los paneles visibles suman 100 y react-resizable
            -panels no tira el warning de "invalid layout total size". */}
        <ResizablePanel id="main" order={2}>
          <WindowTabs
            enableSplit
            menu={tabSideMenu}
            tabs={tabs}
            selected={selectedTabIndex}
            onSelectChange={setSelectedTabIndex}
            onTabsChange={setTabs}
          />
        </ResizablePanel>

        {/* Panel lateral del chat (default al abrir). En pantalla completa (mode
            "full") no se renderiza: el chat pasa a ser un tab dentro de WindowTabs.
            El panel es transparente: el ChatPanel arma su propia barra de tabs +
            content redondeado que flota sobre el fondo neutro (mismo look que el
            área de tabs), con un espacio en lugar de una línea divisoria. */}
        {chatMode === "side" && (
          <>
            <ResizableHandle withHandle className="bg-transparent" />
            <ResizablePanel
              id="chat"
              order={3}
              defaultSize={chatSizePercentage}
              minSize={18}
              maxSize={55}
              onResize={persistChatSize}
            >
              <ChatPanel variant="side" />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
