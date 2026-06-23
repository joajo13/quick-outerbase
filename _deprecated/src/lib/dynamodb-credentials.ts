/**
 * Resolución de la config del cliente DynamoDB del lado del SERVER (en el proxy).
 *
 * Dos modos, ambos sin que ningún secreto quede en el browser/IndexedDB/URL:
 *
 *  1. Local-first (form): el cliente manda las creds en headers x-aws-* y acá las
 *     usamos como credenciales explícitas. Es el modo actual, intacto.
 *
 *  2. Env/server (autoconnect por dynamodb://<region>): el cliente NO manda creds,
 *     solo región (+endpoint). Devolvemos config SIN `credentials` para que el AWS
 *     SDK las resuelva por su cadena por default: env AWS_ACCESS_KEY_ID/SECRET/
 *     SESSION_TOKEN, ~/.aws/credentials (perfil) o IAM role. Las creds nunca salen
 *     del server.
 *
 * Helper puro (sin dependencias de Next) para poder testearlo en unit tests.
 */

export interface DynamoHeaderInput {
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
  region?: string | null;
  endpoint?: string | null;
}

export interface DynamoExplicitCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface DynamoClientResolution {
  region: string;
  endpoint?: string;
  /** Si viene, son creds explícitas (modo headers). Si no, el SDK las resuelve solo. */
  credentials?: DynamoExplicitCredentials;
}

export class DynamoCredentialsError extends Error {}

/** Normaliza un header a string no vacío o undefined. */
function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t ? t : undefined;
}

/**
 * Resuelve { region, endpoint?, credentials? } a partir de los headers del request
 * y del entorno del server. Lanza DynamoCredentialsError si no hay forma de
 * determinar la región.
 */
export function resolveDynamoClientConfig(
  headers: DynamoHeaderInput,
  env: Record<string, string | undefined> = process.env
): DynamoClientResolution {
  // Región: header (viene de la URL en modo env, o del form en local-first) y,
  // como fallback, la cadena estándar de AWS del server.
  const region =
    clean(headers.region) ||
    clean(env.AWS_REGION) ||
    clean(env.AWS_DEFAULT_REGION);

  if (!region) {
    throw new DynamoCredentialsError(
      "Falta la región de AWS. Pasala en la URL (dynamodb://<region>) o seteá AWS_REGION / AWS_DEFAULT_REGION en el server."
    );
  }

  // Endpoint: header (URL ?endpoint=) o el env estándar del SDK para DynamoDB.
  const endpoint =
    clean(headers.endpoint) || clean(env.AWS_ENDPOINT_URL_DYNAMODB);

  const accessKeyId = clean(headers.accessKeyId);
  const secretAccessKey = clean(headers.secretAccessKey);

  // Modo headers (local-first): solo si vienen AMBAS, access key + secret.
  if (accessKeyId && secretAccessKey) {
    const sessionToken = clean(headers.sessionToken);
    return {
      region,
      ...(endpoint ? { endpoint } : {}),
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      },
    };
  }

  // Modo env/server: sin `credentials` → el SDK resuelve de la cadena por default.
  return {
    region,
    ...(endpoint ? { endpoint } : {}),
  };
}
