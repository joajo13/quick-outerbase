"use client";

import useSWR from "swr";

async function fetchLocalMode(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    const j = (await r.json()) as { local?: boolean };
    return !!j.local;
  } catch {
    return false;
  }
}

/**
 * ¿Estamos en modo local/standalone? (server arrancado con DATABASE_URL).
 *
 * En modo cloud devuelve `localMode: false` y el chrome de Outerbase se comporta
 * exactamente como siempre — este hook es 100% aditivo para ese flujo.
 *
 * `isLoading` permite evitar el flash a pantallas cloud mientras se resuelve el
 * modo (ej. el redirect de la raíz espera a saberlo antes de decidir a dónde ir).
 */
export function useLocalMode(): { localMode: boolean; isLoading: boolean } {
  const { data, isLoading } = useSWR("/api/local-mode", fetchLocalMode, {
    revalidateOnFocus: false,
  });
  return { localMode: !!data, isLoading };
}
