import { NextResponse } from "next/server";
import { parseDatabaseUrl } from "@/lib/database-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Devuelve metadata de la conexión inferida de DATABASE_URL.
 * NUNCA devuelve la connection string ni credenciales: solo lo necesario
 * para que el cliente arme el driver correcto y muestre un nombre.
 */
export async function GET() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    return NextResponse.json(
      { error: "DATABASE_URL no está seteado. Pasalo por env o --url." },
      { status: 400 }
    );
  }

  try {
    const parsed = parseDatabaseUrl(url);
    return NextResponse.json({
      engine: parsed.engine,
      dialect: parsed.dialect,
      name: parsed.displayName,
      schema: parsed.schema,
      // DEPRECATED: dynamodb — region/endpoint quedaban para DynamoDB (removido del
      // build). Hoy siempre undefined → JSON.stringify los omite. Ver _deprecated/README.md.
      region: parsed.region,
      endpoint: parsed.endpoint,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
