import { DatabaseSchemas } from "../base-driver";

export interface AgentPromptOption {
  schema?: DatabaseSchemas;
  selectedSchema?: string;
  selected: string;
  /**
   * Si es true, el system prompt permite respuestas conversacionales (prosa +
   * SQL en bloques ```sql) en vez de "Only return SQL code". Lo setea chat()
   * para el tab conversacional; Ctrl+B/run() lo dejan undefined (SQL-only).
   */
  conversational?: boolean;
}

export interface AgentPromptResponse {
  result: string;
  id: string;
}

/**
 * Eventos que emite el camino de streaming (chatStream). Es un modelo aditivo:
 * el chat tab los consume para renderizar token a token. Hoy solo se emiten
 * "text", "reasoning", "done" y "error"; "tool_call" queda como scaffold (la UI
 * sabe dibujar chips si llegaran, pero NO definimos tools reales ni ejecutamos
 * nada — se mantiene la postura del producto).
 *
 * - reasoning: razonamiento del modelo (Anthropic/Gemini con flag; OpenAI no lo expone).
 * - text: texto visible del assistant (markdown, con posibles bloques ```sql).
 * - tool_call: invocación de herramienta (display-only, scaffold).
 * - done: el stream terminó OK.
 * - error: el stream falló; message es legible para mostrar al usuario.
 */
export type AgentStreamEvent =
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; args?: string }
  | { type: "done" }
  | { type: "error"; message: string };

export type AgentStreamCallback = (event: AgentStreamEvent) => void;

export abstract class AgentBaseDriver {
  /**
   *
   * @param message User message
   * @param previousId Previous message id. If not provided, it is a new conversation
   * @param option
   */
  abstract run(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string>;

  /**
   * Variante conversacional: devuelve el texto crudo del assistant (sin
   * procesarlo como SQL), para el chat tab. Mantiene la misma sesión multi-turno
   * keyeada por previousId que run().
   *
   * @param message User message
   * @param previousId Previous message id. If not provided, it is a new conversation
   * @param option
   */
  abstract chat(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string>;

  /**
   * Variante streaming de chat(): arma la MISMA sesión multi-turno que chat()/run()
   * pero emite el texto token a token vía onEvent (text/reasoning/tool_call/done/error).
   * Acumula el texto y lo persiste en el historial igual que chat(). Devuelve el texto
   * final acumulado. NO reemplaza a chat()/run(): es un camino nuevo, aditivo.
   *
   * @param message User message
   * @param previousId Previous message id. If not provided, it is a new conversation
   * @param option
   * @param onEvent Callback que recibe cada evento del stream
   */
  abstract chatStream(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption,
    onEvent: AgentStreamCallback
  ): Promise<string>;
}
