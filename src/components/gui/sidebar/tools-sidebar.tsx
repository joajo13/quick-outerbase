"use client";
import { scc } from "@/core/command";
import ListButtonItem from "../list-button-item";
import { Robot, StackMinus, TreeStructure } from "@phosphor-icons/react";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";

export default function SettingSidebar() {
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
        text="Drop & Empty Multiple Tables"
        onClick={() => {
          scc.tabs.openBuiltinMassDropTable({});
        }}
        icon={StackMinus}
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
