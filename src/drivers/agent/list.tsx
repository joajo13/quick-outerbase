import { ReactElement } from "react";
import { BaseDriver } from "../base-driver";
import {
  AgentBaseDriver,
  AgentPromptOption,
  AgentStreamCallback,
  AgentToolExecutor,
} from "./base";
import { AnthropicDriver } from "./anthropic";
import { ChatGPTDriver } from "./chatgpt";
// DEPRECATED: cloudflare — agent free-tier de Cloudflare Workers AI sacado del build.
// El assistant queda como BYO (Anthropic/OpenAI/Gemini). Ver _deprecated/README.md.
// import CloudflareAgentDriver from "./cloudflare";
import { GeminiDriver } from "./gemini";

interface AgentDriverListItem {
  name: string;
  free?: boolean;
  available: boolean;
  // Ítem que no es un modelo seleccionable sino un atajo para abrir el dialog
  // de settings de AI (pegar la API key). Se renderiza clickeable, no disabled.
  openSettings?: boolean;
}

interface AgentDriverListGroup {
  name: string;
  title: ReactElement | string;
  agents: AgentDriverListItem[];
}

// Config local del proveedor BYO (provider + model + token). Definido acá para
// evitar el ciclo de imports con ai-agent-storage.
interface AgentConfig {
  provider: "openai" | "anthropic" | "gemini";
  model: string;
  token: string;
}

const PROVIDER_LABEL: Record<AgentConfig["provider"], string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

const DEFAULT_FREE_TIER_MODEL = "llama-3.3-70b";

function buildProviderDriver(
  databaseDriver: BaseDriver,
  config: AgentConfig
): AgentBaseDriver {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicDriver(databaseDriver, config.token, config.model);
    case "gemini":
      return new GeminiDriver(databaseDriver, config.token, config.model);
    case "openai":
    default:
      return new ChatGPTDriver(databaseDriver, config.token, config.model);
  }
}

export default class AgentDriverList {
  protected dict: Record<string, AgentBaseDriver | undefined> = {};
  protected defaultModelName: string | undefined;
  protected config?: AgentConfig;

  constructor(databaseDriver: BaseDriver, config?: AgentConfig) {
    this.config = config;

    // DEPRECATED: cloudflare — antes acá se registraban los modelos free-tier de
    // Cloudflare Workers AI (llama-3.3-70b / sqlcoder-7b-2). Removidos del build.
    this.dict = {};

    // Driver del proveedor configurado (BYO key), registrado bajo el model name.
    if (config?.token) {
      this.dict[config.model] = buildProviderDriver(databaseDriver, config);
    }

    this.defaultModelName =
      (typeof localStorage !== "undefined"
        ? localStorage.getItem("default-agent-model")
        : null) ??
      config?.model ??
      DEFAULT_FREE_TIER_MODEL;
  }

  setDefaultModelName(name: string) {
    this.defaultModelName = name;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("default-agent-model", name);
    }
  }

  getDefaultModelName(): string {
    return this.defaultModelName || DEFAULT_FREE_TIER_MODEL;
  }

  // ¿Hay al menos un modelo USABLE? dict solo se puebla cuando hay un provider
  // BYO con token configurado, así que esto equivale a "el usuario ya configuró
  // provider/model/token". Lo usa el chat tab para decidir si mostrar el CTA de
  // settings en vez de dejar mandar mensajes que fallarían con "model not available".
  hasUsableModel(): boolean {
    return Object.values(this.dict).some((d) => d !== undefined);
  }

  list(): AgentDriverListGroup[] {
    // DEPRECATED: cloudflare — removido el grupo free-tier de Cloudflare Workers AI.
    const groups: AgentDriverListGroup[] = [];

    if (this.config?.token) {
      groups.push({
        name: "byo",
        title: PROVIDER_LABEL[this.config.provider],
        agents: [{ name: this.config.model, available: true }],
      });
    } else {
      groups.push({
        name: "byo",
        title: "Bring your own model",
        agents: [
          { name: "configure in settings", available: false, openSettings: true },
        ],
      });
    }

    return groups;
  }

  // Resuelve el driver para un modelName: primero la key pedida, luego el default
  // (que puede quedar STALE en localStorage["default-agent-model"], p.ej. un
  // free-tier removido como "llama-3.3-70b"), y por último CUALQUIER driver
  // configurado. Así, si hay una key BYO válida (hasUsableModel() === true), TANTO
  // run() (Ctrl+B) COMO chat() siempre resuelven y no fallan con "model not
  // available" por un default viejo. Aditivo: solo cambia el caso que antes tiraba
  // teniendo un driver configurado; si dict está vacío, sigue devolviendo undefined.
  protected resolveDriver(modelName: string): AgentBaseDriver | undefined {
    return (
      this.dict[modelName] ??
      this.dict[this.getDefaultModelName()] ??
      Object.values(this.dict).find((d) => d !== undefined)
    );
  }

  async run(
    modelName: string,
    message: string,
    sessionId: string | undefined,
    options: AgentPromptOption
  ): Promise<string> {
    const driver = this.resolveDriver(modelName);

    if (!driver) {
      throw new Error(`Selected model ${modelName} is not available`);
    }

    return await driver.run(message, sessionId, options);
  }

  // Variante conversacional para el chat tab: misma resolución que run() pero
  // delega en driver.chat(), que devuelve el texto crudo del assistant.
  async chat(
    modelName: string,
    message: string,
    sessionId: string | undefined,
    options: AgentPromptOption
  ): Promise<string> {
    const driver = this.resolveDriver(modelName);

    if (!driver) {
      throw new Error(`Selected model ${modelName} is not available`);
    }

    return await driver.chat(message, sessionId, options);
  }

  // Variante STREAMING para el chat tab: misma resolución que chat() pero delega en
  // driver.chatStream(), que emite el texto token a token vía onEvent. Si se pasa
  // executeTool, el driver corre el loop de tool calling (run_query). Aditivo: no
  // toca run()/chat().
  async chatStream(
    modelName: string,
    message: string,
    sessionId: string | undefined,
    options: AgentPromptOption,
    onEvent: AgentStreamCallback,
    executeTool?: AgentToolExecutor
  ): Promise<string> {
    const driver = this.resolveDriver(modelName);

    if (!driver) {
      throw new Error(`Selected model ${modelName} is not available`);
    }

    return await driver.chatStream(
      message,
      sessionId,
      options,
      onEvent,
      executeTool
    );
  }
}
