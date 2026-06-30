import { BaseDriver } from "../base-driver";
import { AgentStreamEvent } from "./base";
import { AnthropicDriver } from "./anthropic";
import { ChatGPTDriver, isOpenAIReasoningModel } from "./chatgpt";
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
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      false
    );

    expect(out.text).toBe("SELECT 1");
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
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, false);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.stream).toBe(true);
    expect(body.model).toBe("gpt-4o");
  });

  test("manda tools cuando enableTools es true", async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, true);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.tools?.[0]?.function?.name).toBe("run_query");
  });

  test("parsea tool_calls fragmentados y los devuelve en toolCalls", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"run_query","arguments":"{\\"sql\\":\\"SE"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"LECT 1\\"}"}}]}}]}\n\n',
        "data: [DONE]\n\n",
      ])
    ) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    const c = collect();
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      true
    );

    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe("run_query");
    expect(out.toolCalls[0].args.sql).toBe("SELECT 1");
    expect(c.events.some((e) => e.type === "tool_call")).toBe(true);
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
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      false
    );
    expect(out.text).toBe("X");
  });

  test("HTTP no-ok → tira (para que chatStream caiga al fallback)", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(httpError(401)) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    await expect(
      driver.queryStream([{ role: "user", content: "hi" }], () => {}, false)
    ).rejects.toThrow("bad key");
  });
});

describe("isOpenAIReasoningModel — detección de modelos que razonan", () => {
  test("o-series y gpt-5 razonan; los gpt clásicos no", () => {
    expect(isOpenAIReasoningModel("o3")).toBe(true);
    expect(isOpenAIReasoningModel("o4-mini")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-5.1-2025-11-13")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-4o")).toBe(false);
    expect(isOpenAIReasoningModel("gpt-4o-mini")).toBe(false);
  });
});

describe("ChatGPTDriver.queryStream — Responses API para modelos que razonan", () => {
  test("o-series pega a /v1/responses con reasoning summary y separa reasoning de texto", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"response.reasoning_summary_text.delta","delta":"pensando"}\n\n',
        'data: {"type":"response.output_text.delta","delta":"SELECT 1"}\n\n',
        'data: {"type":"response.completed"}\n\n',
      ])
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "o4-mini");
    const c = collect();
    const out = await driver.queryStream(
      [
        { role: "system", content: "sos un experto SQL" },
        { role: "user", content: "hi" },
      ],
      c.push,
      false
    );

    expect(out.text).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SELECT 1"]);
    expect(reasonings(c.events)).toEqual(["pensando"]);

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.reasoning).toEqual({ summary: "auto" });
    expect(body.stream).toBe(true);
    // El system va como instructions; los turnos como input.
    expect(body.instructions).toBe("sos un experto SQL");
    expect(body.input).toEqual([{ role: "user", content: "hi" }]);
    // Los modelos de razonamiento rechazan temperature: no debe mandarse.
    expect(body.temperature).toBeUndefined();
  });

  test("response.failed → tira (chatStream cae al fallback no-streaming)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"response.failed","response":{"error":{"message":"no access"}}}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "o3");
    await expect(
      driver.queryStream([{ role: "user", content: "hi" }], () => {}, false)
    ).rejects.toThrow("no access");
  });

  test("un gpt clásico NO usa Responses API: sigue por chat-completions", async () => {
    const fetchSpy = jest
      .fn()
      .mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new ChatGPTDriver(fakeDriver(), "sk", "gpt-4o");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, false);

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://api.openai.com/v1/chat/completions"
    );
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
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      false
    );

    expect(out.text).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SELECT 1"]);
    expect(reasonings(c.events)).toEqual(["pienso"]);
  });

  test("pide thinking + stream en el body (sin tools)", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(
      sseResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n'])
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, false);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
  });

  test("con tools manda run_query y NO pide thinking", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(
      sseResponse(['event: message_stop\ndata: {"type":"message_stop"}\n\n'])
    );
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, true);

    const body = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.tools?.[0]?.name).toBe("run_query");
    expect(body.thinking).toBeUndefined();
  });

  test("parsea un bloque tool_use (content_block_start + input_json_delta)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"run_query"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"sql\\":\\"SELECT 1\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    const c = collect();
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      true
    );

    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].id).toBe("toolu_1");
    expect(out.toolCalls[0].args.sql).toBe("SELECT 1");
    expect(c.events.some((e) => e.type === "tool_call")).toBe(true);
  });

  test("un evento error en el stream → tira", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new AnthropicDriver(fakeDriver(), "sk-ant", "claude-opus-4-8");
    await expect(
      driver.queryStream([{ role: "user", content: "hi" }], () => {}, false)
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
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      false
    );

    expect(out.text).toBe("SELECT 1");
    expect(texts(c.events)).toEqual(["SELECT 1"]);
    expect(reasonings(c.events)).toEqual(["razono"]);
  });

  test("parsea una part functionCall y la devuelve en toolCalls", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"run_query","args":{"sql":"SELECT 1"}}}]}}]}\n\n',
      ])
    ) as unknown as typeof fetch;

    const driver = new GeminiDriver(fakeDriver(), "g-key", "gemini-2.0-flash");
    const c = collect();
    const out = await driver.queryStream(
      [{ role: "user", content: "hi" }],
      c.push,
      true
    );

    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0].name).toBe("run_query");
    expect(out.toolCalls[0].args.sql).toBe("SELECT 1");
    expect(c.events.some((e) => e.type === "tool_call")).toBe(true);
  });

  test("usa el endpoint :streamGenerateContent?alt=sse", async () => {
    const fetchSpy = jest.fn().mockResolvedValue(sseResponse([]));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const driver = new GeminiDriver(fakeDriver(), "g-key", "gemini-2.0-flash");
    await driver.queryStream([{ role: "user", content: "hi" }], () => {}, false);

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
