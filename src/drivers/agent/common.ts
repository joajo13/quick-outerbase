import { generateId } from "@/lib/generate-id";
import {
  BaseDriver,
  DatabaseSchemas,
  DatabaseTableSchema,
} from "../base-driver";
import { AgentBaseDriver, AgentPromptOption, AgentStreamCallback } from "./base";

export interface ChatHistory {
  id: string;
  createdAt: number;
  messages: { role: string; content: string }[];
}

export interface CommonAgentMessage {
  role: string;
  content: string;
}

// Reglas de PartiQL que el agente le enseña al LLM para que genere statements
// EJECUTABLES contra DynamoDB (ExecuteStatement). Verificadas contra la doc de
// AWS y contra DynamoDB Local en el e2e. Si tocás esto, revisá el test e2e de
// patrones PartiQL, porque ahí se ejecutan de verdad.
export const PARTIQL_RULES = `PartiQL rules you MUST follow:
- Table names ALWAYS in double quotes: FROM "my-table". String values in single quotes: 'value'.
- SELECT: SELECT * FROM "table" WHERE pk = 'x'. An efficient WHERE filters by the partition key (and the sort key if the table has one); without a key it becomes a full table scan (allowed but slow).
- INSERT inserts a SINGLE row using document/map syntax with VALUE (never SQL "VALUES (...)"): INSERT INTO "table" VALUE {'id':'9','name':'x','count':1}
- UPDATE: UPDATE "table" SET field='x' WHERE pk='value' [AND sk='value'] — the WHERE must pin the full primary key (partition key, plus sort key if present).
- DELETE: DELETE FROM "table" WHERE pk='value' [AND sk='value'] — the WHERE must pin the full primary key.
- One operation per statement. There are NO JOINs, NO subqueries, NO GROUP BY and NO complex aggregations like in relational SQL.
- Use ONLY attributes that appear in the given schema. DynamoDB attribute types: S (string), N (number), B (binary), BOOL, NULL, L (list), M (map), SS/NS/BS (string/number/binary set).

Examples of valid PartiQL:
SELECT * FROM "Users" WHERE userId = 'u1'
INSERT INTO "Users" VALUE {'userId':'u9','email':'a@x.com','active':true,'age':30}
UPDATE "Users" SET email='b@x.com' WHERE userId='u1'
DELETE FROM "Users" WHERE userId='u1'`;

export default abstract class CommonAgentDriverImplementation extends AgentBaseDriver {
  protected history: Record<string, ChatHistory> = {};

  abstract query(messages: CommonAgentMessage[]): Promise<string>;

  /**
   * Variante streaming de query(): pega al endpoint del provider con stream
   * activado, parsea el SSE y emite eventos (text/reasoning) vía onEvent. Devuelve
   * el TEXTO acumulado (la fuente de verdad para persistir el historial). Debe
   * TIRAR si el stream no arranca (HTTP no-ok, red, CORS) para que chatStream caiga
   * al fallback no-streaming. NO toca query()/run().
   */
  abstract queryStream(
    messages: CommonAgentMessage[],
    onEvent: AgentStreamCallback
  ): Promise<string>;

  getSystemContent(option: AgentPromptOption): string {
    // DynamoDB no usa SQL relacional: se consulta con PartiQL. Le damos al LLM
    // un prompt específico con las reglas + ejemplos canónicos, en vez del de
    // "SQL expert" genérico que le hacía generar INSERT ... VALUES / JOINs que
    // DynamoDB rechaza al parsear.
    if (this.driver.getFlags().dialect === "dynamodb") {
      const intro = option.selected
        ? "You are an expert in Amazon DynamoDB PartiQL. The user is using DynamoDB, which is queried with PartiQL (NOT standard relational SQL). You are given a user-selected statement and you will improve it."
        : "You are an expert in Amazon DynamoDB PartiQL. The user is using DynamoDB, which is queried with PartiQL (NOT standard relational SQL).";

      const dynamoClosing = option.conversational
        ? "Answer conversationally: briefly explain your reasoning, and put any PartiQL you generate inside ```sql fenced code blocks. Do not execute anything."
        : "Only return a single PartiQL statement, wrapped in a ```sql code block.";

      return `${intro}

${PARTIQL_RULES}

${dynamoClosing}`;
    }

    // Contexto extra para que el modelo no alucine tablas/columnas y respete
    // el dialecto y el schema activo. Mantiene la intención original de Ctrl+B
    // ("Only return SQL code") para no volver conversacional ese flujo.
    const dialect = this.driver.getFlags().dialect;

    const guidance: string[] = [
      `You are an SQL expert. User is using ${dialect}.`,
    ];

    if (option.selectedSchema) {
      guidance.push(
        `The active schema is "${option.selectedSchema}". Use it by default for unqualified names.`
      );
    }

    if (option.schema && Object.keys(option.schema).length > 1) {
      guidance.push(
        "The database has multiple schemas, so use schema-qualified names (schema.table) to avoid ambiguity."
      );
    }

    guidance.push(
      "Only use tables and columns that appear in the provided schema. Do NOT invent tables or columns that are not present; if something is not in the schema, say so rather than guessing."
    );

    if (option.conversational) {
      // Chat tab: conversacional. Permite prosa + SQL en bloques ```sql.
      guidance.push(
        "Answer conversationally: briefly explain your reasoning and put any SQL you generate inside ```sql fenced code blocks. Do not execute anything."
      );
    } else if (option.selected) {
      guidance.push(
        "You are given a user selected query and you will improve it. Only return SQL code"
      );
    } else {
      guidance.push("Only return SQL code");
    }

    return guidance.join(" ");
  }

  getSchemaContent(option: AgentPromptOption) {
    const parts = [];

    if (option.schema) {
      if (this.driver.getFlags().dialect === "dynamodb") {
        // En DynamoDB el bloque describe la estructura de cada tabla (claves y
        // atributos vistos); la PRIMARY KEY del DDL es la partition/sort key.
        // Las queries que generes deben ser PartiQL, no SQL relacional.
        parts.push(
          "Here is my DynamoDB schema (PRIMARY KEY = partition key, plus sort key if present). Query it with PartiQL:\n\n"
        );
      } else {
        parts.push(
          "Here is " +
            this.driver.getFlags().dialect +
            " my database schema:\n\n"
        );
      }

      parts.push(
        "```sql\n" + this.convertSchemaToDDLContent(option.schema) + "```"
      );
    }

    return parts.join("\n");
  }

  processResult(result: string): string {
    // Find the code block and extract it
    const codeBlock = result.match(/```sql\n([\s\S]*?)```/);
    if (codeBlock) {
      return codeBlock[1];
    }

    throw new Error("We cannot generate good response");
  }

  // Recupera/crea la sesión y le agrega el turno del usuario (system + schema +
  // selección SOLO en el primer turno). Compartido por runRaw() y chatStream()
  // para que ambos armen el historial multi-turno EXACTAMENTE igual. Devuelve la
  // sesión lista para mandar al proveedor (todavía sin la respuesta del assistant).
  private prepareSession(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): ChatHistory {
    const session = this.history[previousId ?? ""] ?? {
      id: previousId || generateId(),
      createdAt: Date.now(),
      messages: [],
    };

    if (session.messages.length === 0) {
      session.messages.push({
        role: "system",
        content: this.getSystemContent(option),
      });

      session.messages.push({
        role: "user",
        content: this.getSchemaContent(option),
      });

      if (option.selected) {
        session.messages.push({
          role: "user",
          content:
            "This is my selected query ```sql\n" + option.selected + "```",
        });
      }
    }

    session.messages.push({
      role: "user",
      content: message,
    });

    return session;
  }

  // Persiste la respuesta del assistant en el historial in-memory de la sesión.
  private persistAssistant(session: ChatHistory, result: string) {
    session.messages.push({
      role: "assistant",
      content: result,
    });

    this.history[session.id] = session;
  }

  // Arma la sesión, llama al proveedor (no-streaming) y persiste el historial.
  // Devuelve la respuesta CRUDA del assistant. Compartido por run() (Ctrl+B,
  // text-to-SQL) y chat() (tab conversacional). Comportamiento idéntico al previo.
  private async runRaw(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string> {
    const session = this.prepareSession(message, previousId, option);
    const result = await this.query(session.messages);
    this.persistAssistant(session, result);
    return result;
  }

  async run(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string> {
    const result = await this.runRaw(message, previousId, option);
    return this.processResult(result);
  }

  // Variante conversacional para el chat tab: devuelve el texto CRUDO del
  // assistant sin pasar por processResult. Esto hace que funcione incluso con
  // ChatGPT, cuyo processResult (heredado) tira si la respuesta no es SQL.
  async chat(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string> {
    // Marca la sesión como conversacional para que getSystemContent permita
    // prosa (el chat tab renderiza texto + bloques SQL), sin tocar Ctrl+B/run().
    return await this.runRaw(message, previousId, {
      ...option,
      conversational: true,
    });
  }

  // Variante STREAMING de chat() para el chat tab. Arma la misma sesión multi-turno
  // (conversacional) que chat(), pero delega en queryStream() para emitir el texto
  // token a token vía onEvent. Acumula el texto y lo persiste igual que chat().
  //
  // Hard fallback (centralizado acá, no duplicado en cada provider): si queryStream
  // tira SIN haber emitido TEXTO (caso típico: HTTP no-ok, CORS, red, un modelo que
  // rechaza el flag de reasoning, o un error SSE que llega DESPUÉS del reasoning pero
  // ANTES del texto), caemos al query() no-streaming y emitimos un único evento "text"
  // con toda la respuesta. La decisión gatea por TEXTO real mostrado al usuario, NO
  // por reasoning: el reasoning va a un bloque aparte y no es "la respuesta", así que
  // si solo hubo reasoning todavía es seguro (y deseable) reintentar por el camino
  // no-streaming. Si ya salió texto y después explota, NO rehacemos (duplicaría):
  // cerramos con un "error". Nunca tira: siempre resuelve emitiendo "done", para que
  // la UI event-driven cierre el turno.
  async chatStream(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption,
    onEvent: AgentStreamCallback
  ): Promise<string> {
    const session = this.prepareSession(message, previousId, {
      ...option,
      conversational: true,
    });

    // Acumulamos el texto VISIBLE para: (a) persistir el historial y (b) decidir si el
    // hard fallback es seguro. El reasoning NO se acumula acá a propósito (no es la
    // respuesta y no debe inhibir el fallback).
    let text = "";

    const wrapped: AgentStreamCallback = (event) => {
      if (event.type === "text") {
        text += event.delta;
      }
      onEvent(event);
    };

    try {
      const finalText = await this.queryStream(session.messages, wrapped);
      // queryStream devuelve el texto acumulado (fuente de verdad). Si por algún
      // motivo no acumulamos vía eventos, usamos su retorno.
      if (finalText) text = finalText;
      this.persistAssistant(session, text);
      onEvent({ type: "done" });
      return text;
    } catch (streamError) {
      if (text) {
        // Ya mostramos TEXTO real: no podemos rehacer la respuesta sin duplicarla.
        onEvent({
          type: "error",
          message:
            streamError instanceof Error
              ? streamError.message
              : "El stream se interrumpió",
        });
        this.persistAssistant(session, text);
        onEvent({ type: "done" });
        return text;
      }

      // No salió texto (a lo sumo reasoning) → fallback duro al camino no-streaming.
      try {
        text = await this.query(session.messages);
        this.persistAssistant(session, text);
        onEvent({ type: "text", delta: text });
        onEvent({ type: "done" });
        return text;
      } catch (fallbackError) {
        onEvent({
          type: "error",
          message:
            fallbackError instanceof Error
              ? fallbackError.message
              : "No se pudo generar la respuesta",
        });
        onEvent({ type: "done" });
        return "";
      }
    }
  }

  constructor(protected driver: BaseDriver) {
    super();
  }

  protected convertTableToDDLContent(
    schemaName: string | undefined,
    table: DatabaseTableSchema
  ): string {
    const escapeId = (id: string) => this.driver.escapeId(id);

    // Por columna: tipo + NOT NULL/DEFAULT/UNIQUE + comentario inline. Todos los
    // campos son opcionales (sqlite no trae comments/defaults) → emitimos solo lo
    // que está presente para no ensuciar el DDL ni romper si falta.
    const columns = table.columns
      .map((column) => {
        const parts = [`${escapeId(column.name)} ${column.type}`];

        const constraint = column.constraint;
        if (constraint?.notNull) {
          parts.push("NOT NULL");
        }

        const defaultValue =
          constraint?.defaultValue ?? constraint?.defaultExpression;
        // Solo primitivos: evita "DEFAULT [object Object]" si llegara un objeto.
        if (
          typeof defaultValue === "string" ||
          typeof defaultValue === "number" ||
          typeof defaultValue === "boolean" ||
          typeof defaultValue === "bigint"
        ) {
          parts.push(`DEFAULT ${String(defaultValue)}`);
        }

        if (constraint?.unique) {
          parts.push("UNIQUE");
        }

        const line = parts.join(" ");

        // El comentario va en su PROPIA línea ANTES de la columna. Si fuera inline
        // (`def -- comment`), el `--` del SQL se comería la coma separadora que el
        // join agrega después → CREATE TABLE malformado para columnas no-últimas.
        // Aplanamos newlines del comentario para no dejar una línea SQL "bare"
        // (sin `--`) dentro del CREATE TABLE cuando el comment es multilínea.
        if (column.comment) {
          const c = column.comment.replace(/\r?\n/g, " ");
          return `-- ${c}\n${line}`;
        }

        return line;
      })
      .join(",\n");

    const fullTableName = schemaName
      ? `${escapeId(schemaName)}.${escapeId(table.tableName ?? "")}`
      : escapeId(table.tableName ?? "");

    const primaryKeyPart =
      table.pk.length > 0
        ? `, PRIMARY KEY (${table.pk.map(escapeId).join(", ")})`
        : "";

    // FKs: a nivel columna (constraint.foreignKey) y a nivel tabla
    // (table.constraints[].foreignKey). Antes se computaban y se tiraban (bug):
    // ahora SÍ se appendean al cuerpo del CREATE TABLE.
    // La introspección de FKs puede venir INCOMPLETA: p.ej. los FK cross-schema
    // de Postgres devuelven la tabla/columnas referenciadas en null desde
    // information_schema (constraint_column_usage no matchea entre schemas).
    // Filtramos nombres null/vacíos y omitimos el FK si le falta la tabla destino
    // o las columnas, en vez de pasarle null a escapeId (que hace id.replace y
    // tiraría "Cannot read properties of null (reading 'replace')").
    const foreignKeyPart: string[] = [];
    for (const column of table.columns) {
      const fk = column.constraint?.foreignKey;
      if (!fk) continue;
      const foreignColumns = (fk.foreignColumns ?? []).filter(Boolean);
      if (!column.name || !fk.foreignTableName || foreignColumns.length === 0) {
        continue;
      }
      foreignKeyPart.push(
        [
          "FOREIGN KEY",
          `(${escapeId(column.name)})`,
          "REFERENCES",
          escapeId(fk.foreignTableName),
          `(${foreignColumns.map(escapeId).join(", ")})`,
        ].join(" ")
      );
    }

    for (const constraint of table.constraints ?? []) {
      const fk = constraint.foreignKey;
      if (!fk) continue;
      const columns = (fk.columns ?? []).filter(Boolean);
      const foreignColumns = (fk.foreignColumns ?? []).filter(Boolean);
      if (!fk.foreignTableName || columns.length === 0 || foreignColumns.length === 0) {
        continue;
      }
      foreignKeyPart.push(
        [
          "FOREIGN KEY",
          `(${columns.map(escapeId).join(", ")})`,
          "REFERENCES",
          escapeId(fk.foreignTableName),
          `(${foreignColumns.map(escapeId).join(", ")})`,
        ].join(" ")
      );
    }

    const foreignKeyClause =
      foreignKeyPart.length > 0 ? `,\n ${foreignKeyPart.join(",\n ")}` : "";

    // Comentario de tabla como línea previa al CREATE TABLE (Postgres).
    // Aplanamos newlines por la misma razón que en los comentarios de columna.
    const tableComment = table.comment
      ? `-- ${table.comment.replace(/\r?\n/g, " ")}\n`
      : "";

    const createStatement = `${tableComment}CREATE TABLE ${fullTableName} (\n${columns}\n ${primaryKeyPart}${foreignKeyClause});`;

    // Índices: skip los primary (ya cubiertos por PRIMARY KEY). Postgres trae la
    // definición completa en index.definition; si no, la reconstruimos.
    const indexStatements: string[] = [];
    for (const index of table.indexes ?? []) {
      if (index.primary) continue;

      if (index.definition) {
        indexStatements.push(`${index.definition};`);
      } else {
        const cols = (index.columns ?? []).map(escapeId).join(", ");
        if (!cols) continue;
        const unique = index.unique ? "UNIQUE " : "";
        indexStatements.push(
          `CREATE ${unique}INDEX ${escapeId(index.name)} ON ${fullTableName} (${cols});`
        );
      }
    }

    return [createStatement, ...indexStatements].join("\n");
  }

  protected convertSchemaToDDLContent(schemas: DatabaseSchemas): string {
    const schemaParts: string[] = [];
    const defaultSchema = this.driver.getFlags().defaultSchema;

    for (const [schemaName, schema] of Object.entries(schemas)) {
      for (const table of schema) {
        if (!table.tableSchema) continue;
        if (!["table", "view"].includes(table.type)) continue;

        schemaParts.push(
          this.convertTableToDDLContent(
            defaultSchema.toLowerCase() === schemaName.toLowerCase()
              ? ""
              : schemaName,
            table.tableSchema
          )
        );
      }
    }

    return schemaParts.join("\n\n");
  }
}
