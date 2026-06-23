import { SupportedDialect } from "@/drivers/base-driver";

/**
 * Motor físico inferido del scheme del DATABASE_URL.
 * `libsql` y `sqlite` mapean ambos al dialecto "sqlite" del Studio.
 */
export type EngineKind =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "libsql"
  | "dynamodb";

export interface ParsedDatabaseUrl {
  /** Motor físico (driver Node a usar en el route). */
  engine: EngineKind;
  /** Dialecto que entiende el Studio (BaseDriver). */
  dialect: SupportedDialect;
  /** Connection string limpio para el driver Node (sin el param ?schema). */
  connectionString: string;
  /** Schema de Postgres (estilo Prisma ?schema=public). Default "public". */
  schema: string;
  /** authToken para libsql/Turso (de la URL o env). */
  authToken?: string;
  /** Nombre legible para mostrar en la UI (db o archivo), sin secretos. */
  displayName: string;
  /** Región AWS (solo dynamodb). No es secreto. */
  region?: string;
  /** Endpoint custom (solo dynamodb, ej: http://localhost:8000). */
  endpoint?: string;
}

const SCHEME_MAP: Record<string, EngineKind> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  sqlite: "sqlite",
  file: "sqlite",
  libsql: "libsql",
  // DEPRECATED: dynamodb — scheme removido del build del CLI npx. El parser ya no
  // produce engine "dynamodb" (parseDynamodb queda como código muerto reversible).
  // Ver _deprecated/README.md.
};

export class DatabaseUrlError extends Error {}

function extractScheme(raw: string): string {
  const m = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (!m) {
    throw new DatabaseUrlError(
      `DATABASE_URL inválido: no tiene scheme (ej: postgres://...). Recibí: "${redact(raw)}"`
    );
  }
  return m[1].toLowerCase();
}

/** Oculta credenciales para mensajes de error / logs. */
export function redact(raw: string): string {
  try {
    return raw.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
  } catch {
    return "***";
  }
}

/**
 * Parsea un DATABASE_URL y infiere el motor por el scheme.
 * Lanza DatabaseUrlError con mensaje claro si el scheme no se reconoce.
 */
export function parseDatabaseUrl(raw: string): ParsedDatabaseUrl {
  const input = (raw ?? "").trim();
  if (!input) {
    throw new DatabaseUrlError("DATABASE_URL vacío.");
  }

  const scheme = extractScheme(input);
  const engine = SCHEME_MAP[scheme];

  if (!engine) {
    const supported =
      "postgres://, postgresql://, mysql://, sqlite:/file:, libsql://, dynamodb://<region>";
    throw new DatabaseUrlError(
      `Scheme no soportado: "${scheme}://". Motores soportados: ${supported}.`
    );
  }

  if (engine === "postgres") return parsePostgres(input);
  if (engine === "mysql") return parseMysql(input);
  if (engine === "libsql") return parseLibsql(input);
  if (engine === "dynamodb") return parseDynamodb(input);
  return parseSqlite(input);
}

function parsePostgres(input: string): ParsedDatabaseUrl {
  // pg-connection-string no entiende ?schema= (param de Prisma): lo extraemos y limpiamos.
  const u = new URL(input);
  const schema = u.searchParams.get("schema") || "public";
  u.searchParams.delete("schema");
  const connectionString = u.toString();
  const displayName = u.pathname.replace(/^\//, "") || "postgres";
  return {
    engine: "postgres",
    dialect: "postgres",
    connectionString,
    schema,
    displayName,
  };
}

function parseMysql(input: string): ParsedDatabaseUrl {
  const u = new URL(input);
  // Prisma a veces agrega ?schema= en mysql también: lo ignoramos (mysql usa la db del path).
  u.searchParams.delete("schema");
  const displayName = u.pathname.replace(/^\//, "") || "mysql";
  return {
    engine: "mysql",
    dialect: "mysql",
    connectionString: u.toString(),
    schema: "",
    displayName,
  };
}

function parseLibsql(input: string): ParsedDatabaseUrl {
  const u = new URL(input);
  const authToken = u.searchParams.get("authToken") || undefined;
  u.searchParams.delete("authToken");
  return {
    engine: "libsql",
    dialect: "sqlite",
    connectionString: u.toString(),
    schema: "",
    authToken,
    displayName: u.host || "libsql",
  };
}

/**
 * DynamoDB: la URL lleva SOLO región + endpoint opcional. Formato:
 *   dynamodb://<region>[?endpoint=http://localhost:8000]
 *
 * Las credenciales NUNCA van en la URL (quedarían en el historial del shell, en
 * `ps`, en logs). Las resuelve el server desde la cadena estándar de AWS
 * (env AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN, ~/.aws/credentials o IAM role).
 * Si alguien igual mete creds en la URL, fallamos fuerte y claro.
 */
function parseDynamodb(input: string): ParsedDatabaseUrl {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new DatabaseUrlError(
      `URL de DynamoDB inválida. Usá dynamodb://<region> (ej: dynamodb://us-east-1). Recibí: "${redact(input)}"`
    );
  }

  // Guard de seguridad: nada de credenciales en la URL.
  if (u.username || u.password) {
    throw new DatabaseUrlError(
      "No pongas credenciales AWS en la URL de DynamoDB (sacá el user:pass@). " +
        "Las credenciales se toman del entorno del server: AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, ~/.aws/credentials (perfil) o IAM role."
    );
  }
  const credParams = [
    "accesskeyid",
    "secretaccesskey",
    "sessiontoken",
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
  ];
  for (const [key] of u.searchParams) {
    if (credParams.includes(key.toLowerCase())) {
      throw new DatabaseUrlError(
        `No pongas credenciales en la URL de DynamoDB (param "${key}"). ` +
          "Las credenciales se toman del entorno del server (env AWS_*, ~/.aws/credentials o IAM role)."
      );
    }
  }

  // region = host (dynamodb://us-east-1). Soportamos también ?region= por si acaso.
  const region = (u.hostname || u.searchParams.get("region") || "").trim();
  if (!region) {
    throw new DatabaseUrlError(
      "Falta la región en la URL de DynamoDB. Usá dynamodb://<region> (ej: dynamodb://us-east-1)."
    );
  }

  const endpoint = u.searchParams.get("endpoint")?.trim() || undefined;

  return {
    engine: "dynamodb",
    dialect: "dynamodb",
    // Sin secretos: solo region (+endpoint). No se usa para conectar — las creds
    // las pone el server. Lo dejamos por consistencia con el resto del shape.
    connectionString: endpoint
      ? `dynamodb://${region}?endpoint=${endpoint}`
      : `dynamodb://${region}`,
    schema: "",
    displayName: `DynamoDB (${region})`,
    region,
    endpoint,
  };
}

function parseSqlite(input: string): ParsedDatabaseUrl {
  // sqlite:./db.sqlite  |  file:./db.sqlite  |  file:/abs/path  → libsql client usa "file:"
  const withoutScheme = input.replace(/^(sqlite|file):/i, "");
  const filePath = withoutScheme.replace(/^\/\//, "");
  const connectionString = `file:${filePath}`;
  const displayName = filePath.split(/[\\/]/).pop() || "sqlite";
  return {
    engine: "sqlite",
    dialect: "sqlite",
    connectionString,
    schema: "",
    displayName,
  };
}
