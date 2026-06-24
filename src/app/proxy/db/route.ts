import { NextRequest, NextResponse } from "next/server";
import {
  setPgParser,
  transformPgResult,
  transformMySQLResult,
  transformTursoResult,
  type ResultSet,
} from "@outerbase/sdk-transform";
import { parseDatabaseUrl, redact } from "@/lib/database-url";

// pg/mysql2/libsql necesitan el runtime de Node (no Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ejecutor agnóstico server-side. Toma DATABASE_URL de process.env,
 * infiere el motor por scheme y ejecuta SQL. La credencial NUNCA sale al browser.
 */
interface Executor {
  exec(stmts: string[], transaction: boolean): Promise<ResultSet[]>;
}

// Cache del executor a nivel módulo (un pool por proceso), no por request.
let executorPromise: Promise<Executor> | null = null;
let cachedUrl: string | null = null;

function getExecutor(): Promise<Executor> {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    return Promise.reject(new Error("DATABASE_URL no está seteado en el entorno."));
  }
  if (executorPromise && cachedUrl === url) return executorPromise;
  cachedUrl = url;
  executorPromise = buildExecutor(url);
  return executorPromise;
}

async function buildExecutor(url: string): Promise<Executor> {
  const parsed = parseDatabaseUrl(url);

  if (parsed.engine === "postgres") {
    const pg = await import("pg");
    setPgParser(pg.types);
    // search_path estilo Prisma ?schema=: solo lo seteamos cuando vino un schema
    // no vacío. Sin ?schema (undefined/"") dejamos el search_path default de
    // Postgres — nunca emitimos `-c search_path=` vacío.
    const pgSchema = parsed.schema?.trim();
    // Solo seteamos `-c search_path=` si el schema es un identificador simple y
    // seguro. Interpolar un valor con espacios/tokens en las libpq `options`
    // rompe la conexión (Postgres las parsea space-delimited) o inyectaría GUCs
    // extra. Si no matchea, lo omitimos: la introspección lista todos los schemas
    // igual y selectTable califica el schema explícitamente, así que no se pierde
    // funcionalidad. (parsed.schema viene del DATABASE_URL server-side, no del
    // request; esto es defensa en profundidad para schemas con nombres raros.)
    const safeSchema =
      pgSchema && /^[A-Za-z_][A-Za-z0-9_$]*$/.test(pgSchema)
        ? pgSchema
        : undefined;
    const pool = new pg.Pool({
      connectionString: parsed.connectionString,
      max: 5,
      options: safeSchema ? `-c search_path=${safeSchema}` : undefined,
    });
    return {
      async exec(stmts) {
        const client = await pool.connect();
        try {
          const out: ResultSet[] = [];
          for (const sql of stmts) {
            // pg con múltiples sentencias devuelve un array de resultados.
            const r = (await client.query({
              text: sql,
              rowMode: "array",
            })) as unknown;
            const last = Array.isArray(r) ? r[r.length - 1] : r;
            out.push(transformPgResult(last));
          }
          return out;
        } finally {
          client.release();
        }
      },
    };
  }

  if (parsed.engine === "mysql") {
    const mysql = await import("mysql2/promise");
    const pool = mysql.createPool({
      uri: parsed.connectionString,
      connectionLimit: 5,
      multipleStatements: false,
    });
    return {
      async exec(stmts) {
        const conn = await pool.getConnection();
        try {
          const out: ResultSet[] = [];
          for (const sql of stmts) {
            const r = await conn.query({ sql, rowsAsArray: true });
            out.push(transformMySQLResult(r));
          }
          return out;
        } finally {
          conn.release();
        }
      },
    };
  }

  // sqlite / libsql → @libsql/client
  const { createClient } = await import("@libsql/client");
  const client = createClient({
    url: parsed.connectionString,
    authToken: parsed.authToken,
  });
  return {
    async exec(stmts) {
      const out: ResultSet[] = [];
      for (const sql of stmts) {
        const r = await client.execute(sql);
        out.push(transformTursoResult(r));
      }
      return out;
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      stmts?: string[];
      sql?: string;
      transaction?: boolean;
    };

    const stmts = body.stmts ?? (body.sql ? [body.sql] : []);
    if (stmts.length === 0) {
      return NextResponse.json({ error: "No SQL provided" }, { status: 400 });
    }

    const executor = await getExecutor();
    const result = await executor.exec(stmts, !!body.transaction);
    return NextResponse.json({ result });
  } catch (e) {
    const msg = (e as Error).message ?? "Unknown error";
    // Nunca filtrar la connection string en el mensaje de error.
    return NextResponse.json(
      { error: redact(msg) },
      { status: 400 }
    );
  }
}
