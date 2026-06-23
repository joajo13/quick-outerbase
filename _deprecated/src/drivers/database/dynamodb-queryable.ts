/**
 * Transporte cliente (browser) que habla con el route proxy Node `/proxy/dynamodb`.
 * Las credenciales AWS viajan en headers HTTP (nunca en el body) — el proxy las usa
 * server-side para instanciar el DynamoDBDocumentClient y firmar SigV4.
 *
 * Local-first (form): se instancia con las credenciales del usuario, que viajan
 * en headers x-aws-* (nunca en el body):
 *   new DynamoQueryable("/proxy/dynamodb", { accessKeyId, secretAccessKey, region, endpoint? })
 *
 * Env/server (autoconnect por dynamodb://<region>): se instancia SIN credenciales
 * (solo región + endpoint opcional). No se manda ningún header de credenciales;
 * el server las resuelve de la cadena estándar de AWS:
 *   new DynamoQueryable("/proxy/dynamodb", { region, endpoint? })
 *
 * Luego:
 *   await queryable.exec("ListTables", {})
 *   await queryable.exec("Scan", { TableName: "mi-tabla" })
 */

export interface DynamoQueryableConfig {
  region: string;
  /** Endpoint custom (ej: http://localhost:8000 para DynamoDB Local) */
  endpoint?: string;
  /** Credencial — opcional. Si no viene, el server resuelve de la cadena AWS. */
  accessKeyId?: string;
  /** Credencial — opcional. Va junto con accessKeyId. */
  secretAccessKey?: string;
  /** Token de sesión STS — opcional (creds temporales). */
  sessionToken?: string;
}

/** @deprecated Usá DynamoQueryableConfig. Alias por compat. */
export type DynamoCredentials = DynamoQueryableConfig;

export class DynamoQueryable {
  private readonly proxyEndpoint: string;
  private readonly config: DynamoQueryableConfig;

  constructor(
    proxyEndpoint: string = "/proxy/dynamodb",
    config: DynamoQueryableConfig
  ) {
    this.proxyEndpoint = proxyEndpoint;
    this.config = config;
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
    // region/endpoint NO son secretos → siempre van. Las credenciales SOLO si
    // las tenemos (modo local-first); en modo env/server no mandamos ninguna y el
    // proxy las resuelve de la cadena AWS del server. Nunca van al body.
    const credHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "x-aws-region": this.config.region,
    };
    if (this.config.endpoint) {
      credHeaders["x-aws-endpoint"] = this.config.endpoint;
    }
    if (this.config.accessKeyId && this.config.secretAccessKey) {
      credHeaders["x-aws-access-key-id"] = this.config.accessKeyId;
      credHeaders["x-aws-secret-access-key"] = this.config.secretAccessKey;
      if (this.config.sessionToken) {
        credHeaders["x-aws-session-token"] = this.config.sessionToken;
      }
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
