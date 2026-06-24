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
}
