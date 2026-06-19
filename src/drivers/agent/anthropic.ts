import { BaseDriver } from "../base-driver";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";

interface AnthropicResponse {
  content: { type: string; text?: string }[];
  error?: { message: string };
}

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

  // Lenient: devuelve el bloque SQL si existe (text-to-SQL), si no el texto (explicar).
  processResult(result: string): string {
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) return codeBlock[1];
    return result.trim();
  }
}
