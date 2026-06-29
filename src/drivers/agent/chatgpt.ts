import { BaseDriver } from "../base-driver";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
interface ChatGPTResponse {
  choices?: { message: { role: string; content: string } }[];
  error?: { message: string };
}

export class ChatGPTDriver extends CommonAgentDriverImplementation {
  constructor(
    protected driver: BaseDriver,
    protected token: string,
    protected model: string = "gpt-4o-mini"
  ) {
    super(driver);
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
        messages: messages,
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
}
