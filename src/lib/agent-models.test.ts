import {
  CURATED_MODELS,
  extractGeminiModels,
  fetchProviderModels,
  filterOpenAIChatModels,
} from "./agent-models";

// Mock de fetch que devuelve una Response con ok:true y json() = payload.
const okResponse = (payload: unknown) =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload,
  } as Response);

// Mock de fetch que devuelve ok:false (HTTP error → debe caer al fallback curado).
const errorResponse = (status = 403) =>
  jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: "Forbidden",
    json: async () => ({ error: { message: "nope" } }),
  } as Response);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("filterOpenAIChatModels — solo chat models", () => {
  test("incluye gpt* y o<dígito>*, ordenados", () => {
    const out = filterOpenAIChatModels([
      "gpt-4o",
      "gpt-4o-mini",
      "o3",
      "o4-mini",
    ]);
    expect(out).toEqual(["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"]);
  });

  test("excluye embeddings, audio, imágenes, moderación, instruct", () => {
    const out = filterOpenAIChatModels([
      "gpt-4o",
      "text-embedding-3-small",
      "whisper-1",
      "dall-e-3",
      "tts-1",
      "omni-moderation-latest",
      "gpt-3.5-turbo-instruct",
      "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview",
    ]);
    expect(out).toEqual(["gpt-4o"]);
  });

  test("descarta ids vacíos", () => {
    expect(filterOpenAIChatModels(["", "gpt-4o"])).toEqual(["gpt-4o"]);
  });
});

describe("extractGeminiModels — filtra generateContent + limpia prefijo", () => {
  test("solo modelos con generateContent, sin prefijo models/", () => {
    const out = extractGeminiModels([
      {
        name: "models/gemini-2.0-flash",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
      {
        name: "models/embedding-001",
        supportedGenerationMethods: ["embedContent"],
      },
      {
        name: "models/gemini-1.5-pro",
        supportedGenerationMethods: ["generateContent"],
      },
    ]);
    expect(out).toEqual(["gemini-1.5-pro", "gemini-2.0-flash"]);
  });
});

describe("fetchProviderModels — live + fallback curado", () => {
  test("openai: parsea data[].id y filtra a chat models", async () => {
    global.fetch = okResponse({
      data: [
        { id: "gpt-4o" },
        { id: "o3" },
        { id: "text-embedding-3-large" },
      ],
    }) as unknown as typeof fetch;

    const res = await fetchProviderModels("openai", "sk-test");
    expect(res.fromFallback).toBe(false);
    expect(res.models).toContain("gpt-4o");
    expect(res.models).toContain("o3");
    expect(res.models).not.toContain("text-embedding-3-large");
  });

  test("anthropic: parsea data[].id y ordena", async () => {
    const fetchSpy = okResponse({
      data: [{ id: "claude-sonnet-4-6" }, { id: "claude-opus-4-8" }],
    });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await fetchProviderModels("anthropic", "sk-ant");
    expect(res.fromFallback).toBe(false);
    expect(res.models).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);

    // Manda la API key por x-api-key + el header de browser access.
    const headers = (fetchSpy.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  test("gemini: filtra generateContent y limpia models/", async () => {
    global.fetch = okResponse({
      models: [
        {
          name: "models/gemini-2.0-flash",
          supportedGenerationMethods: ["generateContent"],
        },
        {
          name: "models/embedding-001",
          supportedGenerationMethods: ["embedContent"],
        },
      ],
    }) as unknown as typeof fetch;

    const res = await fetchProviderModels("gemini", "g-key");
    expect(res.fromFallback).toBe(false);
    expect(res.models).toEqual(["gemini-2.0-flash"]);
  });

  test("HTTP error → cae a la lista curada con fromFallback:true", async () => {
    global.fetch = errorResponse(403) as unknown as typeof fetch;

    const res = await fetchProviderModels("openai", "sk-bad");
    expect(res.fromFallback).toBe(true);
    expect(res.models).toEqual(CURATED_MODELS.openai);
  });

  test("fetch que rechaza (red/CORS) → fallback curado", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("Failed to fetch")) as unknown as typeof fetch;

    const res = await fetchProviderModels("gemini", "g-key");
    expect(res.fromFallback).toBe(true);
    expect(res.models).toEqual(CURATED_MODELS.gemini);
  });

  test("sin token → fallback curado, sin pegarle a la red", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const res = await fetchProviderModels("anthropic", "");
    expect(res.fromFallback).toBe(true);
    expect(res.models).toEqual(CURATED_MODELS.anthropic);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
