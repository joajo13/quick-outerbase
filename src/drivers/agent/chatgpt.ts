import { generateId } from "@/lib/generate-id";
import { BaseDriver } from "../base-driver";
import {
  AgentStreamCallback,
  AgentToolCall,
  RUN_QUERY_TOOL,
} from "./base";
import CommonAgentDriverImplementation, {
  CommonAgentMessage,
  QueryStreamResult,
} from "./common";
import { readSSEStream, readStreamError } from "./sse";
interface ChatGPTResponse {
  choices?: { message: { role: string; content: string } }[];
  error?: { message: string };
}

// Delta de tool_call en chat-completions: llega fragmentado por `index`. El id y el
// name vienen en el primer fragmento; los arguments se streamean en pedazos.
interface ChatGPTToolCallDelta {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

// Chunk de streaming de OpenAI (chat-completions, stream:true). Cada `data:` trae
// un delta incremental en choices[0].delta.content (texto) o .tool_calls (function
// calling). OpenAI por chat-completions NO expone reasoning.
interface ChatGPTStreamChunk {
  choices?: {
    delta?: { content?: string; tool_calls?: ChatGPTToolCallDelta[] };
    finish_reason?: string;
  }[];
}

// Evento SSE de la Responses API (stream:true). El campo `type` discrimina:
// response.output_text.delta (texto), response.reasoning_summary_text.delta (RESUMEN
// del reasoning), response.output_item.added (abre un function_call),
// response.function_call_arguments.delta (args del function_call), response.completed
// (cierra), response.failed / error (fallo).
interface ResponsesStreamEvent {
  type?: string;
  delta?: string;
  message?: string;
  item_id?: string;
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: { error?: { message?: string } };
}

// Mensaje en el formato de OpenAI chat-completions (incluye tool calls).
interface OpenAIChatMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
}

// Definición de la tool en el formato chat-completions.
const OPENAI_CHAT_TOOL = {
  type: "function" as const,
  function: {
    name: RUN_QUERY_TOOL.name,
    description: RUN_QUERY_TOOL.description,
    parameters: RUN_QUERY_TOOL.parameters,
  },
};

// Definición de la tool en el formato de la Responses API (plana, sin anidar).
const OPENAI_RESPONSES_TOOL = {
  type: "function" as const,
  name: RUN_QUERY_TOOL.name,
  description: RUN_QUERY_TOOL.description,
  parameters: RUN_QUERY_TOOL.parameters,
};

// Modelos de OpenAI que razonan y exponen un RESUMEN del reasoning vía Responses API
// (o-series: o1/o3/o4…, y la familia gpt-5). Los gpt clásicos (gpt-4o…) no razonan, así
// que para esos seguimos por chat-completions (sin reasoning, igual que siempre). Si la
// detección se queda corta o larga, el hard fallback de chatStream cubre el caso (cae al
// query() no-streaming, que siempre usa chat-completions).
export function isOpenAIReasoningModel(model: string): boolean {
  return /^o\d/.test(model) || /^gpt-5/.test(model);
}

export class ChatGPTDriver extends CommonAgentDriverImplementation {
  constructor(
    protected driver: BaseDriver,
    protected token: string,
    protected model: string = "gpt-4o-mini"
  ) {
    super(driver);
  }

  // Traduce el historial al formato chat-completions de OpenAI: assistant con
  // toolCalls → tool_calls; turnos "tool" → role:"tool" con tool_call_id.
  private toOpenAIMessages(
    messages: CommonAgentMessage[]
  ): OpenAIChatMessage[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          tool_call_id: m.toolCallId ?? "",
          content: m.content,
        };
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  // Traduce el historial al formato `input` de la Responses API: assistant con
  // toolCalls → items function_call; turnos "tool" → function_call_output.
  private toResponsesInput(messages: CommonAgentMessage[]): unknown[] {
    const input: unknown[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;
      if (m.role === "tool") {
        input.push({
          type: "function_call_output",
          call_id: m.toolCallId ?? "",
          output: m.content,
        });
        continue;
      }
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        if (m.content) input.push({ role: "assistant", content: m.content });
        for (const tc of m.toolCalls) {
          input.push({
            type: "function_call",
            call_id: tc.id,
            name: tc.name,
            arguments: JSON.stringify(tc.args),
          });
        }
        continue;
      }
      input.push({ role: m.role, content: m.content });
    }
    return input;
  }

  async query(messages: CommonAgentMessage[]): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Usar el modelo configurado por el usuario (BYO), no uno hardcodeado.
        // Antes se mandaba SIEMPRE "gpt-4o-mini" ignorando el modelo elegido, y si
        // la API key no tenía acceso a ese modelo, OpenAI devolvía {error} sin
        // `choices` → choices[0] tiraba "Cannot read properties of undefined".
        model: this.model,
        temperature: 0,
        messages: this.toOpenAIMessages(messages),
      }),
    });

    const jsonResponse = (await response.json()) as ChatGPTResponse;
    // OpenAI reporta fallos (modelo inexistente, key inválida, cuota) como
    // { error: { message } } SIN `choices`. Lo propagamos como Error legible en vez
    // de explotar accediendo a choices[0] (que era el bug "reading '0'").
    if (jsonResponse.error) throw new Error(jsonResponse.error.message);

    const content = jsonResponse.choices?.[0]?.message?.content;
    if (content == null) {
      throw new Error("OpenAI devolvió una respuesta inesperada (sin choices).");
    }
    return content;
  }

  // Streaming SSE. Despacha según el modelo: los que razonan van por la Responses API
  // (que expone el resumen del reasoning); el resto por chat-completions (sin reasoning,
  // como siempre). Si la respuesta no arranca, tira para que chatStream caiga al query()
  // no-streaming. NO toca query()/run().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    enableTools: boolean
  ): Promise<QueryStreamResult> {
    if (isOpenAIReasoningModel(this.model)) {
      return this.queryStreamResponses(messages, onEvent, enableTools);
    }
    return this.queryStreamChat(messages, onEvent, enableTools);
  }

  // Camino chat-completions (stream:true): parsea `data:`, lee choices[0].delta.content
  // (texto) y .tool_calls (function calling); `data: [DONE]` cierra. Sin reasoning.
  private async queryStreamChat(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    enableTools: boolean
  ): Promise<QueryStreamResult> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        stream: true,
        messages: this.toOpenAIMessages(messages),
        ...(enableTools ? { tools: [OPENAI_CHAT_TOOL] } : {}),
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "OpenAI"));
    }

    let acc = "";
    // Acumulamos los tool_calls por index: id/name del primer fragmento, args sumados.
    const toolAcc: Record<
      number,
      { id: string; name: string; argsJson: string }
    > = {};

    await readSSEStream(response.body, (data) => {
      if (data === "[DONE]") return "stop";

      let chunk: ChatGPTStreamChunk;
      try {
        chunk = JSON.parse(data) as ChatGPTStreamChunk;
      } catch {
        return; // chunk parcial/keep-alive: lo ignoramos
      }

      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        acc += delta;
        onEvent({ type: "text", delta });
      }

      const toolDeltas = chunk.choices?.[0]?.delta?.tool_calls;
      if (toolDeltas) {
        for (const tc of toolDeltas) {
          const idx = tc.index ?? 0;
          if (!toolAcc[idx]) {
            toolAcc[idx] = {
              id: tc.id ?? generateId(),
              name: tc.function?.name ?? RUN_QUERY_TOOL.name,
              argsJson: "",
            };
          }
          if (tc.id) toolAcc[idx].id = tc.id;
          if (tc.function?.name) toolAcc[idx].name = tc.function.name;
          if (tc.function?.arguments) {
            toolAcc[idx].argsJson += tc.function.arguments;
          }
        }
      }
    });

    return { text: acc, toolCalls: this.finalizeToolCalls(toolAcc, onEvent) };
  }

  // Camino Responses API (stream:true) para modelos que razonan. Manda el system como
  // `instructions` y los turnos como `input`, pide `reasoning.summary:"auto"` y parsea
  // texto/reasoning/function_call. No setea temperature (los razonadores la rechazan).
  private async queryStreamResponses(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    enableTools: boolean
  ): Promise<QueryStreamResult> {
    const instructions = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const input = this.toResponsesInput(messages);

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        // Pide el resumen del reasoning (solo lo emiten los modelos que razonan).
        reasoning: { summary: "auto" },
        ...(instructions ? { instructions } : {}),
        ...(enableTools ? { tools: [OPENAI_RESPONSES_TOOL] } : {}),
        input,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "OpenAI"));
    }

    let acc = "";
    // function_call en curso, keyeados por item_id (fc_...). Guardamos el call_id como
    // id de la tool (es lo que referencia function_call_output al reinyectar).
    const fnAcc: Record<
      string,
      { id: string; name: string; argsJson: string }
    > = {};

    await readSSEStream(response.body, (data) => {
      let event: ResponsesStreamEvent;
      try {
        event = JSON.parse(data) as ResponsesStreamEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "response.output_text.delta":
          if (event.delta) {
            acc += event.delta;
            onEvent({ type: "text", delta: event.delta });
          }
          return;
        case "response.reasoning_summary_text.delta":
          if (event.delta) onEvent({ type: "reasoning", delta: event.delta });
          return;
        case "response.output_item.added":
          if (event.item?.type === "function_call" && event.item.id) {
            fnAcc[event.item.id] = {
              id: event.item.call_id ?? event.item.id,
              name: event.item.name ?? RUN_QUERY_TOOL.name,
              argsJson: event.item.arguments ?? "",
            };
          }
          return;
        case "response.function_call_arguments.delta":
          if (event.item_id && fnAcc[event.item_id]) {
            fnAcc[event.item_id].argsJson += event.delta ?? "";
          }
          return;
        case "response.completed":
          return "stop";
        case "response.failed":
          throw new Error(
            event.response?.error?.message ?? "OpenAI Responses stream falló"
          );
        case "error":
          throw new Error(event.message ?? "OpenAI Responses stream error");
        default:
          return;
      }
    });

    return { text: acc, toolCalls: this.finalizeToolCalls(fnAcc, onEvent) };
  }

  // Cierra los tool_calls acumulados: parsea los args y emite un evento tool_call por
  // cada uno. Compartido por ambos caminos (la key del record es indistinta).
  private finalizeToolCalls(
    acc: Record<string | number, { id: string; name: string; argsJson: string }>,
    onEvent: AgentStreamCallback
  ): AgentToolCall[] {
    const toolCalls: AgentToolCall[] = [];
    for (const key of Object.keys(acc)) {
      const t = acc[key];
      let args: Record<string, unknown> = {};
      try {
        args = t.argsJson ? JSON.parse(t.argsJson) : {};
      } catch {
        args = {};
      }
      toolCalls.push({ id: t.id, name: t.name, args });
      onEvent({ type: "tool_call", id: t.id, name: t.name, args: t.argsJson });
    }
    return toolCalls;
  }
}
