import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Indica si el server corre en modo local/standalone (hay DATABASE_URL seteado).
 * El cliente lo usa para apagar el chrome de Outerbase Cloud (avatar "Guest",
 * workspaces, banners de signin) y para redirigir la raíz directo al visor /env.
 */
export async function GET() {
  return NextResponse.json({ local: !!process.env.DATABASE_URL });
}
