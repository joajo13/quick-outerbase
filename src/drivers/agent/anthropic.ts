import { BaseDriver } from "../base-driver";
import { AgentStreamCallback } from "./base";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
import { readSSEStream, readStreamError } from "./sse";

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  error?: { message: string };
}

// Evento SSE de Anthropic (Messages API, stream:true). El campo `type` discrimina:
// content_block_delta trae delta.type === "text_delta" (texto) o "thinking_delta"
// (reasoning); message_stop cierra; error reporta un fallo.
interface AnthropicStreamEvent {
  type?: string;
  delta?: { type?: string; text?: string; thinking?: string };
  error?: { message?: string };
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

  async query(messages: CommonAgentMessage[]): Promise<string> {
    // Separar el system (Anthropic lo quiere top-level) del resto.
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const chatMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

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

  // Streaming SSE (stream:true) con reasoning best-effort. Separa el system top-level
  // igual que query(), pide thinking, y parsea content_block_delta → text/reasoning.
  // Si la respuesta no es ok, tira para que chatStream caiga al fallback. No toca query().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback
  ): Promise<string> {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const chatMessages = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

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
        // Reasoning opt-in (best-effort). Con thinking activado, Anthropic exige
        // temperature por defecto (=1), por eso NO la seteamos.
        thinking: { type: "enabled", budget_tokens: THINKING_BUDGET_TOKENS },
        ...(systemText ? { system: systemText } : {}),
        messages: chatMessages,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "Anthropic"));
    }

    let acc = "";
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

      if (event.type === "content_block_delta" && event.delta) {
        if (event.delta.type === "text_delta" && event.delta.text) {
          acc += event.delta.text;
          onEvent({ type: "text", delta: event.delta.text });
        } else if (
          event.delta.type === "thinking_delta" &&
          event.delta.thinking
        ) {
          onEvent({ type: "reasoning", delta: event.delta.thinking });
        }
      }
    });

    return acc;
  }

  // Lenient: devuelve el bloque SQL si existe (text-to-SQL), si no el texto (explicar).
  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
