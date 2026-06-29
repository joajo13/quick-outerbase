"use client";
import { createDialog } from "@/components/create-dialog";
import { Loader } from "@/components/orbit/loader";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchProviderModels } from "@/lib/agent-models";
import {
  getAgentFromLocalStorage,
  patchAgentConfig,
} from "@/lib/ai-agent-storage";
import { cn } from "@/lib/utils";
import { Check, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

// Dialog para elegir el modelo activo. Fetchea la lista live del provider (con
// fallback curado) y muestra buscador + loader + badge "lista offline". Al elegir,
// hace un update PARCIAL de la config (solo model) reusando patchAgentConfig, que
// mutea el SWR `/local-agent-setting` → el header y el driver se re-arman solos.
export const modelPickerDialog = createDialog(({ close }) => {
  // Snapshot de la config al abrir (provider + token para el fetch, model para marcar
  // el activo). useMemo([]) → se lee una vez al montar el dialog.
  const current = useMemo(() => getAgentFromLocalStorage(), []);

  const [models, setModels] = useState<string[]>([]);
  const [fromFallback, setFromFallback] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!current) {
      setLoading(false);
      return;
    }

    // alive: evita el setState si el dialog se cierra mientras el fetch está en vuelo.
    let alive = true;
    setLoading(true);
    fetchProviderModels(current.provider, current.token)
      .then((res) => {
        if (!alive) return;
        setModels(res.models);
        setFromFallback(res.fromFallback);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [current]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, search]);

  const onPick = (model: string) => {
    patchAgentConfig({ model });
    close(undefined);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Elegí un modelo</DialogTitle>
        <DialogDescription>
          {current
            ? `Modelos de ${PROVIDER_LABEL[current.provider] ?? current.provider}.`
            : "Configurá un proveedor y una API key primero."}
          {fromFallback && (
            <span className="ml-2 inline-flex items-center rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              lista offline
            </span>
          )}
        </DialogDescription>
      </DialogHeader>

      {current && (
        <div className="flex flex-col gap-3">
          <div className="border-input flex items-center gap-2 rounded-md border px-2">
            <MagnifyingGlass className="h-4 w-4 opacity-50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              placeholder="Buscar modelo…"
              autoFocus
              className="h-9 grow bg-transparent text-sm outline-none"
            />
          </div>

          <div className="max-h-[320px] overflow-y-auto rounded-md border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm opacity-70">
                <Loader size={16} />
                Cargando modelos…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-sm opacity-60">
                No hay modelos que coincidan con “{search}”.
              </div>
            ) : (
              filtered.map((model) => {
                const active = model === current.model;
                return (
                  <button
                    key={model}
                    onClick={() => onPick(model)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900",
                      active && "font-medium"
                    )}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        active ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="truncate">{model}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
});
