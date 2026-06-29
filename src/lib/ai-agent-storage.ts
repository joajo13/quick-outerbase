import AgentDriverList from "@/drivers/agent/list";
import { BaseDriver } from "@/drivers/base-driver";
import { useMemo } from "react";
import useSWR, { mutate } from "swr";

export type AgentProvider = "openai" | "anthropic" | "gemini";

export interface LocalAgentType {
  provider: AgentProvider;
  model: string;
  token: string;
}

export const DEFAULT_MODEL_BY_PROVIDER: Record<AgentProvider, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

export function getAgentFromLocalStorage(): LocalAgentType | undefined {
  if (typeof window === "undefined") return undefined;

  const agentRawData = localStorage.getItem("agent");
  if (!agentRawData) return undefined;

  let agentData: Partial<LocalAgentType>;
  try {
    agentData = JSON.parse(agentRawData);
  } catch {
    return undefined;
  }

  const provider = agentData.provider as AgentProvider | undefined;
  if (
    provider !== "openai" &&
    provider !== "anthropic" &&
    provider !== "gemini"
  )
    return undefined;
  if (!agentData.token) return undefined;

  return {
    provider,
    model: agentData.model || DEFAULT_MODEL_BY_PROVIDER[provider],
    token: agentData.token,
  };
}

export function updateAgentFromLocalStorage(data: LocalAgentType) {
  localStorage.setItem("agent", JSON.stringify(data));
  mutate("/local-agent-setting", data);
}

// Merge puro (sin side-effects) de una config parcial sobre la actual. Si falta el
// model y cambió el provider, cae al default de ESE provider. Usado por los dialogs
// de provider/model para no perder los campos que no tocan. Testeable sin localStorage.
export function mergeAgentConfig(
  current: LocalAgentType | undefined,
  partial: Partial<LocalAgentType>
): LocalAgentType {
  const provider = partial.provider ?? current?.provider ?? "anthropic";
  const token = partial.token ?? current?.token ?? "";

  // Si cambió el provider y no vino un model explícito, reseteamos al default de ESE
  // provider — mantener el model del provider anterior no tendría sentido (p.ej. un
  // "gpt-4o" colgando en una config de anthropic).
  const providerChanged =
    partial.provider != null && partial.provider !== current?.provider;
  const model =
    partial.model ??
    (providerChanged ? DEFAULT_MODEL_BY_PROVIDER[provider] : current?.model) ??
    DEFAULT_MODEL_BY_PROVIDER[provider];

  return { provider, model, token };
}

// Aplica un update PARCIAL de la config (merge sobre lo guardado + persiste + mutate).
// Lo usan model-picker (solo model) y provider-picker (provider + model default).
export function patchAgentConfig(
  partial: Partial<LocalAgentType>
): LocalAgentType {
  const merged = mergeAgentConfig(getAgentFromLocalStorage(), partial);
  updateAgentFromLocalStorage(merged);
  return merged;
}

export function useAvailableAIAgents(databaseDriver?: BaseDriver | null) {
  const { data: agentConfig } = useSWR(
    "/local-agent-setting",
    getAgentFromLocalStorage
  );

  return useMemo(() => {
    if (!databaseDriver) return undefined;
    return new AgentDriverList(databaseDriver, agentConfig);
  }, [databaseDriver, agentConfig]);
}
