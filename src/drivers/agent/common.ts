import { generateId } from "@/lib/generate-id";
import {
  BaseDriver,
  DatabaseSchemas,
  DatabaseTableSchema,
} from "../base-driver";
import { AgentBaseDriver, AgentPromptOption } from "./base";

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

  getSystemContent(option: AgentPromptOption): string {
    // DynamoDB no usa SQL relacional: se consulta con PartiQL. Le damos al LLM
    // un prompt específico con las reglas + ejemplos canónicos, en vez del de
    // "SQL expert" genérico que le hacía generar INSERT ... VALUES / JOINs que
    // DynamoDB rechaza al parsear.
    if (this.driver.getFlags().dialect === "dynamodb") {
      const intro = option.selected
        ? "You are an expert in Amazon DynamoDB PartiQL. The user is using DynamoDB, which is queried with PartiQL (NOT standard relational SQL). You are given a user-selected statement and you will improve it."
        : "You are an expert in Amazon DynamoDB PartiQL. The user is using DynamoDB, which is queried with PartiQL (NOT standard relational SQL).";

      return `${intro}

${PARTIQL_RULES}

Only return a single PartiQL statement, wrapped in a \`\`\`sql code block.`;
    }

    if (option.selected) {
      return `You are an SQL expert. User is using ${this.driver.getFlags().dialect}. You are given a user selected query and you will improve it. Only return SQL code`;
    }

    return `You are an SQL expert. User is using ${this.driver.getFlags().dialect}.Only return SQL code`;
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

  async run(
    message: string,
    previousId: string | undefined,
    option: AgentPromptOption
  ): Promise<string> {
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

    const result = await this.query(session.messages);

    // Save the chat history
    session.messages.push({
      role: "assistant",
      content: result,
    });

    this.history[session.id] = session;
    return this.processResult(result);
  }

  constructor(protected driver: BaseDriver) {
    super();
  }

  protected convertTableToDDLContent(
    schemaName: string | undefined,
    table: DatabaseTableSchema
  ): string {
    const columns = table.columns
      .map((column) => {
        return `${this.driver.escapeId(column.name)} ${column.type}`;
      })
      .join(",\n");

    const fullTableName = schemaName
      ? `${this.driver.escapeId(schemaName)}.${this.driver.escapeId(table.tableName ?? "")}`
      : this.driver.escapeId(table.tableName ?? "");

    const primaryKeyPart =
      table.pk.length > 0
        ? `, PRIMARY KEY (${table.pk.map(this.driver.escapeId).join(", ")})`
        : "";

    const foreignKeyPart: string[] = [];
    for (const column of table.columns) {
      if (column.constraint?.foreignKey) {
        foreignKeyPart.push(
          [
            "FOREIGN KEY",
            column.name,
            "REFERENCES",
            column.constraint.foreignKey.foreignTableName ?? "",
            "(",
            (column.constraint?.foreignKey?.foreignColumns ?? [])[0] ?? "",
            ")",
          ].join(" ")
        );
      }
    }

    for (const constraint of table.constraints ?? []) {
      if (constraint.foreignKey) {
        foreignKeyPart.push(
          [
            "FOREIGN KEY",
            `(${(constraint.foreignKey.columns ?? []).join(", ")})`,
            "REFERENCES",
            constraint.foreignKey.foreignTableName ?? "",
            `(${(constraint.foreignKey.foreignColumns ?? []).join(", ")})`,
          ].join(" ")
        );
      }
    }

    return `CREATE TABLE ${fullTableName} (\n${columns}\n ${primaryKeyPart});`;
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
