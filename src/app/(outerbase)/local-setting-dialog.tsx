import { createDialog } from "@/components/create-dialog";
import LabelInput from "@/components/label-input";
import { Button } from "@/components/orbit/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AgentProvider,
  DEFAULT_MODEL_BY_PROVIDER,
  getAgentFromLocalStorage,
  updateAgentFromLocalStorage,
} from "@/lib/ai-agent-storage";
import { useCallback, useEffect, useState } from "react";

const PROVIDERS: { value: AgentProvider; label: string }[] = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (ChatGPT)" },
  { value: "gemini", label: "Google Gemini" },
];

export const localSettingDialog = createDialog(({ close }) => {
  const [provider, setProvider] = useState<AgentProvider>("anthropic");
  const [model, setModel] = useState<string>(
    DEFAULT_MODEL_BY_PROVIDER.anthropic
  );
  const [token, setToken] = useState<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const agentData = getAgentFromLocalStorage();
    if (!agentData) return;
    setProvider(agentData.provider);
    setModel(agentData.model);
    setToken(agentData.token);
  }, []);

  const onProviderChange = useCallback((p: AgentProvider) => {
    setProvider(p);
    setModel(DEFAULT_MODEL_BY_PROVIDER[p]);
  }, []);

  const onSaveClicked = useCallback(() => {
    updateAgentFromLocalStorage({
      provider,
      model: model || DEFAULT_MODEL_BY_PROVIDER[provider],
      token,
    });
    close(undefined);
  }, [provider, model, token, close]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>API Key</DialogTitle>
        <DialogDescription>
          Elegí un proveedor y pegá tu API key para habilitar el asistente
          (text-to-SQL y explicaciones). La key se guarda solo en localStorage de
          tu navegador. No la guardamos en ningún servidor ni se loguea. El modelo lo
          podés elegir desde la barra del chat; acá queda como override manual opcional.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Provider</label>
          <select
            className="border-input bg-background h-9 rounded-control border px-2 text-sm"
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as AgentProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <LabelInput
          type="password"
          label="API Key"
          placeholder="API Key"
          size="lg"
          value={token}
          onValueChange={setToken}
        />

        <LabelInput
          label="Modelo (override opcional)"
          placeholder="Dejalo vacío para usar el default del proveedor"
          size="lg"
          value={model}
          onValueChange={setModel}
        />
      </div>

      <DialogFooter>
        <Button size="lg" variant="primary" onClick={onSaveClicked}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
});
