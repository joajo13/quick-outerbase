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

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  error?: { message: string };
}

// Evento SSE de Anthropic (Messages API, stream:true). El campo `type` discrimina:
// content_block_delta trae delta.type === "text_delta" (texto), "thinking_delta"
// (reasoning) o "input_json_delta" (args de un tool_use); content_block_start abre un
// bloque (tool_use trae id/name); content_block_stop lo cierra; message_stop cierra.
interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  error?: { message?: string };
}

// Bloque de contenido en el formato de Anthropic (texto, tool_use o tool_result).
type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

// Presupuesto de "extended thinking" para que Claude exponga su razonamiento en el
// stream. Es opt-in y best-effort: en modelos que lo soportan (familia claude-4 /
// 3.7) aparece como bloque "Razonando…"; en los que NO, la API tira 400 y chatStream
// cae al query() no-streaming (sin reasoning, pero responde igual). max_tokens debe
// ser > budget_tokens (4096 > 1024).
const THINKING_BUDGET_TOKENS = 1024;
const STREAM_MAX_TOKENS = 4096;

/**
 * Driver de agente para Anthropic (Claude). Default: claude-opus-4-8.
 * La key se pasa por constructor (viene de localStorage, nunca se commitea/loguea).
 * Anthropic exige `system` como campo top-level (no como rol dentro de messages).
 */
export class AnthropicDriver extends CommonAgentDriverImplementation {
  constructor(
    protected driver: BaseDriver,
    protected token: string,
    protected model: string = "claude-opus-4-8"
  ) {
    super(driver);
  }

  // Separa el system (Anthropic lo quiere top-level) y traduce el historial al
  // formato de Anthropic: assistant con toolCalls → bloques tool_use; turnos "tool"
  // → user con bloque tool_result (coalescamos tool_results consecutivos en un solo
  // user message, como exige la API cuando hubo varios tool_use en un turno).
  private toAnthropicMessages(messages: CommonAgentMessage[]): {
    systemText: string;
    chatMessages: AnthropicMessage[];
  } {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const chatMessages: AnthropicMessage[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "tool") {
        const block: AnthropicContentBlock = {
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: m.content,
        };
        const last = chatMessages[chatMessages.length - 1];
        if (
          last &&
          last.role === "user" &&
          Array.isArray(last.content) &&
          last.content[0]?.type === "tool_result"
        ) {
          last.content.push(block);
        } else {
          chatMessages.push({ role: "user", content: [block] });
        }
        continue;
      }

      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const content: AnthropicContentBlock[] = [];
        if (m.content) content.push({ type: "text", text: m.content });
        for (const tc of m.toolCalls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.args,
          });
        }
        chatMessages.push({ role: "assistant", content });
        continue;
      }

      // user o assistant plano. Saltamos assistant vacíos (Anthropic rechaza
      // bloques de texto vacíos) — puede pasar en el fallback con historial de tools.
      if (m.role === "assistant" && !m.content) continue;
      chatMessages.push({ role: m.role, content: m.content });
    }

    return { systemText, chatMessages };
  }

  async query(messages: CommonAgentMessage[]): Promise<string> {
    const { systemText, chatMessages } = this.toAnthropicMessages(messages);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.token,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        ...(systemText ? { system: systemText } : {}),
        messages: chatMessages,
      }),
    });

    const json = (await response.json()) as AnthropicResponse;
    if (json.error) throw new Error(json.error.message);

    const text = (json.content || [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("");
    return text;
  }

  // Streaming SSE (stream:true). Separa el system top-level y parsea content_block_delta
  // → text/reasoning/tool_use. Con tools activas NO pedimos thinking: extended thinking
  // exige reenviar los bloques de razonamiento en los turnos con tool_use, que no
  // guardamos en el historial; desactivarlo evita ese requisito. Si la respuesta no es
  // ok, tira para que chatStream caiga al fallback. No toca query().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    enableTools: boolean
  ): Promise<QueryStreamResult> {
    const { systemText, chatMessages } = this.toAnthropicMessages(messages);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.token,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: STREAM_MAX_TOKENS,
        stream: true,
        ...(enableTools
          ? {
              tools: [
                {
                  name: RUN_QUERY_TOOL.name,
                  description: RUN_QUERY_TOOL.description,
                  input_schema: RUN_QUERY_TOOL.parameters,
                },
              ],
            }
          : // Reasoning opt-in (best-effort, solo sin tools). Con thinking activado,
            // Anthropic exige temperature por defecto (=1), por eso NO la seteamos.
            {
              thinking: {
                type: "enabled",
                budget_tokens: THINKING_BUDGET_TOKENS,
              },
            }),
        ...(systemText ? { system: systemText } : {}),
        messages: chatMessages,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "Anthropic"));
    }

    let acc = "";
    const toolCalls: AgentToolCall[] = [];
    // Buffers de tool_use en curso, keyeados por el index del content block.
    const toolBlocks: Record<
      number,
      { id: string; name: string; argsJson: string }
    > = {};

    await readSSEStream(response.body, (data) => {
      let event: AnthropicStreamEvent;
      try {
        event = JSON.parse(data) as AnthropicStreamEvent;
      } catch {
        return;
      }

      if (event.type === "error") {
        throw new Error(event.error?.message ?? "Anthropic stream error");
      }

      if (event.type === "message_stop") return "stop";

      // Abre un bloque tool_use: guardamos id/name y arrancamos a juntar los args.
      if (
        event.type === "content_block_start" &&
        event.content_block?.type === "tool_use" &&
        typeof event.index === "number"
      ) {
        toolBlocks[event.index] = {
          id: event.content_block.id ?? generateId(),
          name: event.content_block.name ?? RUN_QUERY_TOOL.name,
          argsJson: "",
        };
        return;
      }

      if (event.type === "content_block_delta" && event.delta) {
        if (event.delta.type === "text_delta" && event.delta.text) {
          acc += event.delta.text;
          onEvent({ type: "text", delta: event.delta.text });
        } else if (
          event.delta.type === "thinking_delta" &&
          event.delta.thinking
        ) {
          onEvent({ type: "reasoning", delta: event.delta.thinking });
        } else if (
          event.delta.type === "input_json_delta" &&
          typeof event.index === "number" &&
          toolBlocks[event.index]
        ) {
          toolBlocks[event.index].argsJson += event.delta.partial_json ?? "";
        }
        return;
      }

      // Cierra un bloque tool_use: parseamos los args y lo emitimos.
      if (
        event.type === "content_block_stop" &&
        typeof event.index === "number" &&
        toolBlocks[event.index]
      ) {
        const tb = toolBlocks[event.index];
        let args: Record<string, unknown> = {};
        try {
          args = tb.argsJson ? JSON.parse(tb.argsJson) : {};
        } catch {
          args = {};
        }
        toolCalls.push({ id: tb.id, name: tb.name, args });
        onEvent({
          type: "tool_call",
          id: tb.id,
          name: tb.name,
          args: tb.argsJson,
        });
        delete toolBlocks[event.index];
        return;
      }
    });

    return { text: acc, toolCalls };
  }

  // Lenient: devuelve el bloque SQL si existe (text-to-SQL), si no el texto (explicar).
  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
