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

interface GeminiResponse {
  candidates?: { content: { parts: { text?: string }[] } }[];
  error?: { message: string };
}

// Una part de Gemini: texto, reasoning (thought) o functionCall (args ya es objeto).
interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
}

// Una entrada de `contents` en el formato de Gemini.
interface GeminiContent {
  role: string;
  parts: Record<string, unknown>[];
}

// Chunk de streaming de Gemini (:streamGenerateContent?alt=sse). Cada `data:` trae
// candidates con parts incrementales. Una part con thought:true es reasoning;
// functionCall es una tool; el resto es texto. NO forzamos includeThoughts (rompería
// el streaming del default gemini-2.0-flash): si el modelo emite thoughts, los
// mostramos; si no, no inventamos.
interface GeminiStreamChunk {
  candidates?: {
    content?: { parts?: GeminiPart[] };
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

  // System (Gemini lo quiere en systemInstruction) + contents en formato Gemini:
  // assistant con toolCalls → parts con functionCall; turnos "tool" → user con part
  // functionResponse. Roles: assistant → "model", el resto → "user".
  private toGeminiContents(messages: CommonAgentMessage[]): {
    systemText: string;
    contents: GeminiContent[];
  } {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents: GeminiContent[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "tool") {
        contents.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: RUN_QUERY_TOOL.name,
                response: { result: m.content },
              },
            },
          ],
        });
        continue;
      }

      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const parts: Record<string, unknown>[] = [];
        if (m.content) parts.push({ text: m.content });
        for (const tc of m.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.args } });
        }
        contents.push({ role: "model", parts });
        continue;
      }

      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      });
    }

    return { systemText, contents };
  }

  async query(messages: CommonAgentMessage[]): Promise<string> {
    const { systemText, contents } = this.toGeminiContents(messages);

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

  // Streaming SSE (:streamGenerateContent?alt=sse). Parsea cada chunk: parts con
  // thought:true → reasoning, functionCall → tool, resto → texto. Con tools activas
  // declara run_query. Si la respuesta no es ok, tira para que chatStream caiga al
  // fallback. No toca query().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback,
    enableTools: boolean
  ): Promise<QueryStreamResult> {
    const { systemText, contents } = this.toGeminiContents(messages);

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
        ...(enableTools
          ? {
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: RUN_QUERY_TOOL.name,
                      description: RUN_QUERY_TOOL.description,
                      parameters: RUN_QUERY_TOOL.parameters,
                    },
                  ],
                },
              ],
            }
          : {}),
        contents,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "Gemini"));
    }

    let acc = "";
    const toolCalls: AgentToolCall[] = [];
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
        // Gemini no da id de tool call → generamos uno.
        if (part.functionCall) {
          const id = generateId();
          const name = part.functionCall.name ?? RUN_QUERY_TOOL.name;
          const args = part.functionCall.args ?? {};
          toolCalls.push({ id, name, args });
          onEvent({
            type: "tool_call",
            id,
            name,
            args: JSON.stringify(args),
          });
          continue;
        }
        if (!part.text) continue;
        if (part.thought) {
          onEvent({ type: "reasoning", delta: part.text });
        } else {
          acc += part.text;
          onEvent({ type: "text", delta: part.text });
        }
      }
    });

    return { text: acc, toolCalls };
  }

  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
