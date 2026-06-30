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
  /**
   * Si es true, hay tools activas (run_query): el system prompt le dice al modelo
   * que puede ejecutar queries. Lo setea chatStream cuando recibe executeTool.
   */
  agentic?: boolean;
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

/**
 * Una invocación de herramienta que el modelo pidió. `args` ya viene parseado del
 * JSON que arma el modelo (cada provider lo entrega distinto; lo normalizamos acá).
 */
export interface AgentToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Resultado de ejecutar una tool, que se reinyecta al modelo como tool_result.
 * - content: texto que VE el modelo (headers + sample de filas + stats, o el error).
 * - cancelled: el usuario descartó la ejecución (corta el loop).
 */
export interface AgentToolResult {
  ok: boolean;
  content: string;
  cancelled?: boolean;
}

/**
 * Callback que provee la UI: recibe la tool call, aplica el gate (toggle auto-run,
 * writes frenan), ejecuta la query contra la base y devuelve el resultado. El loop
 * de tool calling vive en el driver (common.ts); la ejecución y el gate, en la UI.
 */
export type AgentToolExecutor = (
  call: AgentToolCall
) => Promise<AgentToolResult>;

/**
 * Única tool del chat agéntico. El schema ya viaja en el system prompt, así que no
 * hacen falta list_tables/describe_table: con run_query alcanza para responder
 * preguntas sobre los datos. Cada provider traduce esta definición a su dialecto.
 */
export const RUN_QUERY_TOOL = {
  name: "run_query",
  description:
    "Ejecuta un único statement SQL contra la base de datos conectada y devuelve el resultado (columnas, filas y stats). Usala para responder preguntas sobre los datos en vez de adivinar. Preferí agregaciones (GROUP BY/LIMIT) antes que traer datasets grandes. Después de ver el resultado, respondé en prosa interpretándolo.",
  parameters: {
    type: "object" as const,
    properties: {
      sql: {
        type: "string" as const,
        description: "Un solo statement SQL para ejecutar.",
      },
      reason: {
        type: "string" as const,
        description: "Breve motivo de por qué corrés esta query.",
      },
    },
    required: ["sql"],
  },
} as const;

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
   * @param executeTool Callback OPCIONAL para ejecutar tools (run_query). Si se
   *   provee, el driver corre el loop de tool calling: emite tool_call, ejecuta vía
   *   este callback, reinyecta el resultado y continúa. Si es undefined, se comporta
   *   como hoy (texto plano, sin tools).
   */
  abstract chatStream(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption,
    onEvent: AgentStreamCallback,
    executeTool?: AgentToolExecutor
  ): Promise<string>;
}
