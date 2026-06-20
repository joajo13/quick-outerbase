/**
 * Transporte cliente (browser) que habla con el route proxy Node `/proxy/dynamodb`.
 * Las credenciales AWS viajan en headers HTTP (nunca en el body) — el proxy las usa
 * server-side para instanciar el DynamoDBDocumentClient y firmar SigV4.
 *
 * El agente A (DynamoDriver) instancia este queryable así:
 *   new DynamoQueryable("/proxy/dynamodb", { accessKeyId, secretAccessKey, region, endpoint? })
 * y luego llama:
 *   await queryable.exec("ListTables", {})
 *   await queryable.exec("Scan", { TableName: "mi-tabla" })
 */

export interface DynamoCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Endpoint custom (ej: http://localhost:8000 para DynamoDB Local) */
  endpoint?: string;
}

export class DynamoQueryable {
  private readonly proxyEndpoint: string;
  private readonly creds: DynamoCredentials;

  constructor(
    proxyEndpoint: string = "/proxy/dynamodb",
    creds: DynamoCredentials
  ) {
    this.proxyEndpoint = proxyEndpoint;
    this.creds = creds;
  }

  /**
   * Ejecuta una acción del SDK de DynamoDB contra el proxy server-side.
   *
   * @param action  Nombre del comando SDK sin el sufijo "Command"
   *                (ej: "ListTables", "Scan", "Query", "GetItem", "PutItem", etc.)
   * @param params  Parámetros del comando (ej: { TableName: "mi-tabla", Limit: 100 })
   * @returns       Respuesta del SDK ya unmarshalled por el DocumentClient
   */
  async exec(action: string, params: object = {}): Promise<unknown> {
    // Armar los headers de credenciales — nunca van al body
    const credHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-aws-access-key-id": this.creds.accessKeyId,
      "x-aws-secret-access-key": this.creds.secretAccessKey,
      "x-aws-region": this.creds.region,
    };
    if (this.creds.endpoint) {
      credHeaders["x-aws-endpoint"] = this.creds.endpoint;
    }

    const response = await fetch(this.proxyEndpoint, {
      method: "POST",
      headers: credHeaders,
      body: JSON.stringify({ action, params }),
    });

    const json: { result?: unknown; error?: string } = await response.json();

    if (!response.ok || json.error) {
      throw new Error(
        `DynamoDB proxy error [${action}] HTTP ${response.status}: ${json.error ?? "respuesta inesperada"}`
      );
    }

    if (json.result === undefined) {
      throw new Error(`DynamoDB proxy [${action}]: respuesta sin campo 'result'`);
    }

    return json.result;
  }
}
