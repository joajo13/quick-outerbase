import { ChatCircle } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { createTabExtension } from "../extension-tab";

// Lazy-load del Chat: arrastra el SqlEditor (CodeMirror) y solo se necesita al
// abrir el tab, así no entra en el bundle de primer paint.
const ChatWindow = dynamic(
  () => import("@/components/gui/tabs/chat-tab"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm opacity-60">
        Cargando chat…
      </div>
    ),
  }
);

export const builtinOpenChatTab = createTabExtension({
  name: "chat",
  // Singleton: una sola pestaña de Chat a la vez (igual que el ERD).
  key: () => "",
  generate: () => ({
    title: "Chat",
    component: <ChatWindow />,
    icon: ChatCircle,
  }),
});
