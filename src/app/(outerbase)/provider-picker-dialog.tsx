"use client";
import { createDialog } from "@/components/create-dialog";
import { Button } from "@/components/orbit/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AgentProvider,
  DEFAULT_MODEL_BY_PROVIDER,
  getAgentFromLocalStorage,
  patchAgentConfig,
} from "@/lib/ai-agent-storage";
import { useMemo, useState } from "react";
import { localSettingDialog } from "./local-setting-dialog";

const PROVIDERS: { value: AgentProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (ChatGPT)" },
  { value: "gemini", label: "Google Gemini" },
];

// Dialog para cambiar de proveedor. Al elegir uno distinto, el modelo se resetea al
// default de ESE provider (DEFAULT_MODEL_BY_PROVIDER) vía patchAgentConfig. Si no hay
// API key guardada, ofrece abrir el dialog de key (la key es por-provider).
export const providerPickerDialog = createDialog(({ close }) => {
  const current = useMemo(() => getAgentFromLocalStorage(), []);
  const [provider, setProvider] = useState<AgentProvider>(
    current?.provider ?? "anthropic"
  );

  const changed = provider !== current?.provider;

  const onSave = () => {
    // Reset del modelo al default del provider elegido. Si CAMBIÓ el provider, además
    // LIMPIAMOS el token: la config guarda una sola key y la anterior es de OTRO
    // provider — dejarla colgada mandaría una key inválida (401 silencioso) y rompería
    // tanto el chat como el Ctrl+B text-to-SQL, que comparten esta config. Mejor quedar
    // sin key (estado "configurá IA" explícito) que con una key equivocada.
    patchAgentConfig({
      provider,
      model: DEFAULT_MODEL_BY_PROVIDER[provider],
      ...(changed ? { token: "" } : {}),
    });
    close(undefined);

    // Si cambió el provider (key vieja inservible) o no había key, abrimos el dialog
    // para que el usuario pegue la key correcta del provider nuevo.
    if (changed || !current?.token) {
      localSettingDialog.show({}).then().catch();
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Elegí un proveedor</DialogTitle>
        <DialogDescription>
          Al cambiar de proveedor, el modelo se resetea al default. Si no tenés una
          API key para ese proveedor, te la vamos a pedir.
        </DialogDescription>
      </DialogHeader>

      <RadioGroup
        value={provider}
        onValueChange={(v) => setProvider(v as AgentProvider)}
        className="flex flex-col gap-1"
      >
        {PROVIDERS.map((p) => (
          <label
            key={p.value}
            className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <RadioGroupItem value={p.value} />
            <span>{p.label}</span>
            {p.value === current?.provider && (
              <span className="ml-auto text-xs opacity-50">actual</span>
            )}
          </label>
        ))}
      </RadioGroup>

      <DialogFooter>
        <Button size="lg" variant="primary" onClick={onSave}>
          {changed ? "Cambiar proveedor" : "Guardar"}
        </Button>
      </DialogFooter>
    </>
  );
});
