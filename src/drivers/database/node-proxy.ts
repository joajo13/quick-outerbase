import { DatabaseResultSet, QueryableBaseDriver } from "../base-driver";

/**
 * Transporte cliente (browser) que habla con el route ejecutor Node `/proxy/db`.
 * Espejo de CloudflareD1Queryable, pero contra nuestra DB local agnóstica.
 * El SQL viaja al server; la connection string vive solo server-side.
 */
export class NodeProxyQueryable implements QueryableBaseDriver {
  constructor(protected url: string = "/proxy/db") {}

  private async post(stmts: string[], transaction = false): Promise<DatabaseResultSet[]> {
    const r = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stmts, transaction }),
    });

    const json: { result?: DatabaseResultSet[]; error?: string } = await r.json();
    if (json.error) throw new Error(json.error);
    if (!json.result) throw new Error("Respuesta inválida del proxy de base de datos");
    return json.result;
  }

  async batch(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this.post(stmts, false);
  }

  async transaction(stmts: string[]): Promise<DatabaseResultSet[]> {
    return this.post(stmts, true);
  }

  async query(stmt: string): Promise<DatabaseResultSet> {
    return (await this.post([stmt], false))[0];
  }
}
