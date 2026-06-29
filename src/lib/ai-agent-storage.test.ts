import {
  DEFAULT_MODEL_BY_PROVIDER,
  getAgentFromLocalStorage,
  mergeAgentConfig,
  patchAgentConfig,
} from "./ai-agent-storage";

// Mock mínimo de localStorage (jest corre en node, no hay window.localStorage real).
function mockLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  };
}

beforeEach(() => {
  (global as unknown as { localStorage: Storage }).localStorage =
    mockLocalStorage() as unknown as Storage;
});

describe("mergeAgentConfig — merge parcial puro", () => {
  test("solo model: mantiene provider y token", () => {
    const out = mergeAgentConfig(
      { provider: "anthropic", model: "claude-opus-4-8", token: "k" },
      { model: "claude-sonnet-4-6" }
    );
    expect(out).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      token: "k",
    });
  });

  test("cambio de provider sin model: cae al default del nuevo provider, mantiene token", () => {
    const out = mergeAgentConfig(
      { provider: "anthropic", model: "claude-opus-4-8", token: "k" },
      { provider: "openai" }
    );
    expect(out).toEqual({
      provider: "openai",
      model: DEFAULT_MODEL_BY_PROVIDER.openai,
      token: "k",
    });
  });

  test("sin current: defaults (anthropic, token vacío) con el partial encima", () => {
    const out = mergeAgentConfig(undefined, { model: "x" });
    expect(out).toEqual({ provider: "anthropic", model: "x", token: "" });
  });

  test("token:'' explícito limpia la key (cambio de provider la invalida)", () => {
    // El provider-picker manda token:'' al cambiar de provider: la key vieja es de
    // otro provider. mergeAgentConfig debe respetar el '' y NO recuperar el viejo.
    const out = mergeAgentConfig(
      { provider: "anthropic", model: "claude-opus-4-8", token: "sk-ant" },
      { provider: "openai", model: DEFAULT_MODEL_BY_PROVIDER.openai, token: "" }
    );
    expect(out).toEqual({
      provider: "openai",
      model: DEFAULT_MODEL_BY_PROVIDER.openai,
      token: "",
    });
  });
});

describe("getAgentFromLocalStorage — parseo defensivo", () => {
  test("config válida → la devuelve", () => {
    localStorage.setItem(
      "agent",
      JSON.stringify({ provider: "openai", model: "gpt-4o", token: "sk" })
    );
    expect(getAgentFromLocalStorage()).toEqual({
      provider: "openai",
      model: "gpt-4o",
      token: "sk",
    });
  });

  test("provider inválido → undefined", () => {
    localStorage.setItem(
      "agent",
      JSON.stringify({ provider: "cohere", model: "x", token: "sk" })
    );
    expect(getAgentFromLocalStorage()).toBeUndefined();
  });

  test("sin token → undefined", () => {
    localStorage.setItem(
      "agent",
      JSON.stringify({ provider: "openai", model: "gpt-4o" })
    );
    expect(getAgentFromLocalStorage()).toBeUndefined();
  });

  test("sin model → usa el default del provider", () => {
    localStorage.setItem(
      "agent",
      JSON.stringify({ provider: "gemini", token: "g" })
    );
    expect(getAgentFromLocalStorage()?.model).toBe(
      DEFAULT_MODEL_BY_PROVIDER.gemini
    );
  });

  test("JSON inválido → undefined", () => {
    localStorage.setItem("agent", "{ no es json");
    expect(getAgentFromLocalStorage()).toBeUndefined();
  });
});

describe("patchAgentConfig — merge + persistencia", () => {
  test("patch de model sobre config guardada: persiste el merge y lo devuelve", () => {
    localStorage.setItem(
      "agent",
      JSON.stringify({ provider: "anthropic", model: "claude-opus-4-8", token: "k" })
    );

    const out = patchAgentConfig({ model: "claude-sonnet-4-6" });
    const merged = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      token: "k",
    };

    expect(out).toEqual(merged);
    expect(JSON.parse(localStorage.getItem("agent") as string)).toEqual(merged);
  });
});
