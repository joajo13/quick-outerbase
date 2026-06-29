import { BaseDriver } from "../base-driver";
import { AgentStreamEvent } from "./base";
import { AnthropicDriver } from "./anthropic";
import { ChatGPTDriver } from "./chatgpt";
import { GeminiDriver } from "./gemini";

// Driver de DB falso: los queryStream no usan flags, pero el constructor pide uno.
function fakeDriver(): BaseDriver {
  return {
    getFlags: () => ({ dialect: "postgres", defaultSchema: "public" }),
    escapeId: (id: string) => `"${id}"`,
  } as unknown as BaseDriver;
}

// Response con un body ReadableStream que emite los chunks dados (como si fueran los
// trozos que llegan por la red). Permite partir un evento SSE en varios chunks.
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return { ok: true, body } as unknown as Response;
}

const httpError = (status = 401): Response =>
  ({
    ok: false,
    status,
    statusText: "Unauthorized",
    text: async () => JSON.stringify({ error: { message: "bad key" } }),
  }) as unknown as Response;

const collect = () => {
  const events: AgentStreamEvent[] = [];
  return { events, push: (e: AgentStreamEvent) => events.push(e) };
};

const texts = (events: AgentStreamEvent[]) =>
  events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta);
const reasonings = (events: AgentStreamEvent[]) =>
  events
    .filter((e) => e.type === "reasoning")
    .map((e) => (e as { delta: string }).delta);

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ChatGPTDriver.queryStream — SSE de OpenAI", () => {
  test("acumula choices[].delta.content y corta en [DONE]", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"SE"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"LECT 1"}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    ) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    const c = collect();
    const out = await driver.queryStream([{ role: "user", content: "hi" }], c.push);

    expect(out).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SE", "LECT 1"]);
    // OpenAI por chat-completions NO emite reasoning.
    expect(reasonings(c.events)).toEqual([]);
  });

  test("manda stream:true en el body", async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {});

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.stream).toBe(true);
    expect(body.model).toBe("gpt-4o");
  });

  test("reensambla un evento partido en varios chunks", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"choi',
        'ces":[{"delta":{"content":"X"}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    ) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    const c = collect();
    const out = await driver.queryStream([{ role: "user", content: "hi" }], c.push);
    expect(out).toBe("X");
  });

  test("HTTP no-ok → tira (para que chatStream caiga al fallback)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(httpError(401)) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    await expect(
      driver.queryStream([{ role: "user", content: "hi" }], () => {})
    ).rejects.toThrow("bad key");
  });
});

describe("AnthropicDriver.queryStream — SSE de Anthropic (text + thinking)", () => {
  test("separa thinking_delta (reasoning) de text_delta (texto) y corta en message_stop", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"pienso"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SELECT 1"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    const c = collect();
    const out = await driver.queryStream([{ role: "user", content: "hi" }], c.push);

    expect(out).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SELECT 1"]);
    expect(reasonings(c.events)).toEqual(["pienso"]);
  });

  test("pide thinking + stream en el body", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(
      sseResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n'])
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {});

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  test("un evento error en el stream → tira", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    await expect(
      driver.queryStream([{ role: "user", content: "hi" }], () => {})
    ).rejects.toThrow("overloaded");
  });
});

describe("GeminiDriver.queryStream — SSE de Gemini (thought vs texto)", () => {
  test("parts con thought:true → reasoning, el resto → texto", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"razono","thought":true}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"SELECT 1"}]}}]}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new GeminiDriver(fakeDriver(), "g-key", "gemini-2.0-flash");
    const c = collect();
    const out = await driver.queryStream([{ role: "user", content: "hi" }], c.push);

    expect(out).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SELECT 1"]);
    expect(reasonings(c.events)).toEqual(["razono"]);
  });

  test("usa el endpoint :streamGenerateContent?alt=sse", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(sseResponse([]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new GeminiDriver(fakeDriver(), "g-key", "gemini-2.0-flash");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {});

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain(":streamGenerateContent");
    expect(url).toContain("alt=sse");
  });
});

describe("chatStream — hard fallback al query() no-streaming", () => {
  test("si el stream no arranca (HTTP no-ok), cae a query() y emite un único text + done", async () => {
    // 1ª llamada (queryStream): HTTP no-ok → tira. 2ª (query no-stream): responde OK.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(httpError(500))
      .mockResolvedValueOnce({
        json: async () => ({
          choices: [{ message: { role: "assistant", content: "SELECT 42" } }],
        }),
      } as Response) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    const c = collect();
    const out = await driver.chatStream(
      "dame un número",
      undefined,
      { selected: "" },
      c.push
    );

    expect(out).toBe("SELECT 42");
    expect(texts(c.events)).toEqual(["SELECT 42"]);
    expect(c.events.some((e) => e.type === "done")).toBe(true);
  });

  test("si solo hubo reasoning antes del fallo, cae al fallback (no se pierde la respuesta)", async () => {
    // 1ª (queryStream): emite thinking (reasoning) y después un evento error → tira,
    // pero con text vacío. 2ª (query no-stream): responde OK. El fallback debe correr.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"pienso"}}\n\n',
          'event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n',
        ])
      )
      .mockResolvedValueOnce({
        json: async () => ({
          content: [{ type: "text", text: "SELECT 99" }],
        }),
      } as Response) as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    const c = collect();
    const out = await driver.chatStream(
      "hola",
      undefined,
      { selected: "" },
      c.push
    );

    expect(out).toBe("SELECT 99");
    expect(reasonings(c.events)).toEqual(["pienso"]);
    expect(texts(c.events)).toEqual(["SELECT 99"]);
    expect(c.events[c.events.length - 1]).toEqual({ type: "done" });
  });

  test("camino feliz: streamea y persiste el texto acumulado", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hola"}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    ) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    const c = collect();
    const out = await driver.chatStream(
      "hi",
      undefined,
      { selected: "" },
      c.push
    );

    expect(out).toBe("hola");
    expect(c.events[c.events.length - 1]).toEqual({ type: "done" });
  });
});
