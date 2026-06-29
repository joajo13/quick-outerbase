"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import { modelPickerDialog } from "@/app/(outerbase)/model-picker-dialog";
import { providerPickerDialog } from "@/app/(outerbase)/provider-picker-dialog";
import { getAgentFromLocalStorage } from "@/lib/ai-agent-storage";
import { Key, Plus, Sparkle } from "@phosphor-icons/react";
import useSWR from "swr";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

// Barra superior del chat: [sparkle] Provider · model, botón 🔑 (API key) y ＋ (new
// chat). Lee la config vía el MISMO SWR `/local-agent-setting` que usa el storage, así
// se re-renderiza solo cuando se guarda desde cualquiera de los dialogs. Click en el
// provider abre el provider-picker; click en el modelo abre el model-picker.
export default function ChatTabHeader({
  onNewChat,
}: {
  onNewChat: () => void;
}) {
  const { data: config } = useSWR(
    "/local-agent-setting",
    getAgentFromLocalStorage
  );

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2 text-sm">
      <Sparkle className="h-4 w-4 shrink-0 opacity-70" weight="fill" />

      {config ? (
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => providerPickerDialog.show({}).then().catch()}
            className="rounded px-1.5 py-0.5 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900"
            title="Cambiar proveedor"
          >
            {PROVIDER_LABEL[config.provider] ?? config.provider}
          </button>
          <span className="opacity-40">·</span>
          <button
            type="button"
            onClick={() => modelPickerDialog.show({}).then().catch()}
            className="min-w-0 truncate rounded px-1.5 py-0.5 opacity-80 hover:bg-neutral-100 dark:hover:bg-neutral-900"
            title="Cambiar modelo"
          >
            {config.model}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => localSettingDialog.show({}).then().catch()}
          className="rounded px-1.5 py-0.5 opacity-70 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          Configurar IA
        </button>
      )}

      <div className="grow" />

      <button
        type="button"
        onClick={() => localSettingDialog.show({}).then().catch()}
        aria-label="API key"
        title="API key"
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        <Key className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onNewChat}
        aria-label="Nuevo chat"
        title="Nuevo chat"
        className="flex h-7 w-7 items-center justify-center rounded hover:bg-neutral-100 dark:hover:bg-neutral-900"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
