"use client";
import { scc } from "@/core/command";
import ListButtonItem from "../list-button-item";
import { ChatCircle, Robot, TreeStructure } from "@phosphor-icons/react";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import { useChatLayout } from "../tabs/chat-provider";

export default function SettingSidebar() {
  // El chat abre por default en lateral; desde ahí se puede expandir a pantalla completa.
  const { openChat } = useChatLayout();

  return (
    <div className="flex flex-col grow p-2">
      <ListButtonItem
        text="Relational Diagram"
        onClick={() => {
          scc.tabs.openBuiltinERD({});
        }}
        icon={TreeStructure}
      />
      <ListButtonItem
        text="Chat"
        onClick={openChat}
        icon={ChatCircle}
      />
      {/* Acceso al setting de AI (API key) en modo local: abre el mismo dialog
          que usa el nav de cloud, pero acá queda visible en el visor standalone. */}
      <ListButtonItem
        text="AI Assistant Setting"
        onClick={() => {
          localSettingDialog.show({}).then().catch();
        }}
        icon={Robot}
      />
    </div>
  );
}
