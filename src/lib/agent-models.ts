import { AgentProvider } from "@/lib/ai-agent-storage";

// Fetch de la lista de modelos por provider, pegándole al endpoint `/models` con
// la API key del usuario. Si falla (CORS, permiso, offline, key inválida) caemos a
// una lista CURADA hardcodeada por provider — así el picker siempre muestra algo.

export interface ProviderModelsResult {
  models: string[];
  // true cuando la lista viene del fallback curado (no del fetch live). La UI lo
  // usa para mostrar el badge "lista offline".
  fromFallback: boolean;
}

// Listas curadas (fallback). Pensadas para ser "lo razonable hoy"; si el fetch live
// anda, esto ni se usa. No pretende ser exhaustivo: es un piso usable sin red.
export const CURATED_MODELS: Record<AgentProvider, string[]> = {
  anthropic: [
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-1-20250805",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o3",
    "o4-mini",
  ],
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
};

// Subcadenas que delatan modelos NO-chat de OpenAI (embeddings, audio, imágenes,
// moderación, etc.). El endpoint /models los mezcla todos; filtramos a chat.
const OPENAI_NON_CHAT = [
  "instruct",
  "embedding",
  "whisper",
  "tts",
  "audio",
  "realtime",
  "transcribe",
  "image",
  "dall-e",
  "moderation",
  "search",
  "davinci",
  "babbage",
];

// Filtra los ids de OpenAI a chat models: arrancan con "gpt" o con "o" + dígito
// (o1/o3/o4…), y NO matchean ninguna subcadena no-chat. Ordena alfabéticamente.
// Exportada para testear el parseo sin red.
export function filterOpenAIChatModels(ids: string[]): string[] {
  return ids
    .filter((id) => {
      if (!id) return false;
      const isChat = id.startsWith("gpt") || /^o\d/.test(id);
      if (!isChat) return false;
      return !OPENAI_NON_CHAT.some((bad) => id.includes(bad));
    })
    .sort();
}

// Extrae los modelos de Gemini que soportan generateContent y limpia el prefijo
// "models/". Exportada para testear el parseo sin red.
export function extractGeminiModels(
  models: { name?: string; supportedGenerationMethods?: string[] }[]
): string[] {
  return models
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes("generateContent")
    )
    .map((m) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}

async function fetchOpenAIModels(token: string): Promise<string[]> {
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`OpenAI /models ${response.status}`);

  const json = (await response.json()) as {
    data?: { id?: string }[];
  };
  const ids = (json.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  const filtered = filterOpenAIChatModels(ids);
  if (filtered.length === 0) throw new Error("OpenAI /models sin chat models");
  return filtered;
}

async function fetchAnthropicModels(token: string): Promise<string[]> {
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!response.ok) throw new Error(`Anthropic /models ${response.status}`);

  const json = (await response.json()) as {
    data?: { id?: string }[];
  };
  const ids = (json.data ?? []).map((m) => m.id ?? "").filter(Boolean);
  if (ids.length === 0) throw new Error("Anthropic /models vacío");
  return ids.sort();
}

async function fetchGeminiModels(token: string): Promise<string[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
      token
    )}`
  );
  if (!response.ok) throw new Error(`Gemini /models ${response.status}`);

  const json = (await response.json()) as {
    models?: { name?: string; supportedGenerationMethods?: string[] }[];
  };
  const models = extractGeminiModels(json.models ?? []);
  if (models.length === 0) throw new Error("Gemini /models sin generateContent");
  return models;
}

// Pega al /models del provider con la key; ante CUALQUIER fallo cae a la lista
// curada con fromFallback:true. Nunca tira: el picker siempre recibe modelos.
export async function fetchProviderModels(
  provider: AgentProvider,
  token: string
): Promise<ProviderModelsResult> {
  try {
    if (!token) throw new Error("sin token");

    let models: string[];
    switch (provider) {
      case "openai":
        models = await fetchOpenAIModels(token);
        break;
      case "anthropic":
        models = await fetchAnthropicModels(token);
        break;
      case "gemini":
        models = await fetchGeminiModels(token);
        break;
      default:
        throw new Error(`provider desconocido: ${provider}`);
    }

    return { models, fromFallback: false };
  } catch {
    return { models: CURATED_MODELS[provider], fromFallback: true };
  }
}
