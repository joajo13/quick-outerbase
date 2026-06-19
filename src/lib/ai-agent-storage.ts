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
