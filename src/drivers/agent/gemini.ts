import { BaseDriver } from "../base-driver";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";

interface GeminiResponse {
  candidates?: { content: { parts: { text?: string }[] } }[];
  error?: { message: string };
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

  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
