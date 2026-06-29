import { BaseDriver } from "../base-driver";
import { AgentStreamCallback } from "./base";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
import { readSSEStream, readStreamError } from "./sse";

interface GeminiResponse {
  candidates?: { content: { parts: { text?: string }[] } }[];
  error?: { message: string };
}

// Chunk de streaming de Gemini (:streamGenerateContent?alt=sse). Cada `data:` trae
// candidates con parts incrementales. Una part con thought:true es reasoning; el
// resto es texto. NO forzamos includeThoughts (rompería el streaming del default
// gemini-2.0-flash, que no es modelo "thinking"): si el modelo elegido emite
// thoughts, los mostramos; si no, no inventamos.
interface GeminiStreamChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
  }[];
  error?: { message?: string };
}

/**
 * Driver de agente para Google Gemini. Default: gemini-2.0-flash.
 * La key se pasa por constructor (localStorage). Gemini usa `?key=` y
 * `systemInstruction` separado, con roles "user"/"model".
 */
export class GeminiDriver extends CommonAgentDriverImplementation {
  constructor(
    protected driver: BaseDriver,
    protected token: string,
    protected model: string = "gemini-2.0-flash"
  ) {
    super(driver);
  }

  async query(messages: CommonAgentMessage[]): Promise<string> {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(
      this.token
    )}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
        contents,
      }),
    });

    const json = (await response.json()) as GeminiResponse;
    if (json.error) throw new Error(json.error.message);

    const text = (json.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("");
    return text;
  }

  // Streaming SSE (:streamGenerateContent?alt=sse). Arma el body igual que query()
  // y parsea cada chunk: parts con thought:true → reasoning, resto → texto. Si la
  // respuesta no es ok, tira para que chatStream caiga al fallback. No toca query().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback
  ): Promise<string> {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(
      this.token
    )}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(systemText
          ? { systemInstruction: { parts: [{ text: systemText }] } }
          : {}),
        contents,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "Gemini"));
    }

    let acc = "";
    await readSSEStream(response.body, (data) => {
      let chunk: GeminiStreamChunk;
      try {
        chunk = JSON.parse(data) as GeminiStreamChunk;
      } catch {
        return;
      }

      if (chunk.error) {
        throw new Error(chunk.error.message ?? "Gemini stream error");
      }

      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (!part.text) continue;
        if (part.thought) {
          onEvent({ type: "reasoning", delta: part.text });
        } else {
          acc += part.text;
          onEvent({ type: "text", delta: part.text });
        }
      }
    });

    return acc;
  }

  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
