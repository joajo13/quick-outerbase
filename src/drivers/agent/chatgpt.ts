import { BaseDriver } from "../base-driver";
import { AgentStreamCallback } from "./base";
import CommonAgentDriverImplementation, { CommonAgentMessage } from "./common";
import { readSSEStream, readStreamError } from "./sse";
interface ChatGPTResponse {
  choices?: { message: { role: string; content: string } }[];
  error?: { message: string };
}

// Chunk de streaming de OpenAI (chat-completions, stream:true). Cada `data:` trae
// un delta incremental en choices[0].delta.content. OpenAI por chat-completions NO
// expone reasoning (solo la Responses API da un resumen), así que acá solo hay texto.
interface ChatGPTStreamChunk {
  choices?: { delta?: { content?: string } }[];
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

  // Streaming SSE (stream:true). Parsea las líneas `data:`, lee el delta de texto
  // y lo emite; `data: [DONE]` cierra. Si la respuesta no es ok (sin body o {error}),
  // tira para que chatStream caiga al query() no-streaming. NO toca query()/run().
  async queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback
  ): Promise<string> {
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
        messages,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(await readStreamError(response, "OpenAI"));
    }

    let acc = "";
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
    });

    return acc;
  }
}
