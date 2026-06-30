"use client";
import { localSettingDialog } from "@/app/(outerbase)/local-setting-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { fetchProviderModels } from "@/lib/agent-models";
import {
  AgentProvider,
  DEFAULT_MODEL_BY_PROVIDER,
  LocalAgentType,
  getAgentFromLocalStorage,
  patchAgentConfig,
} from "@/lib/ai-agent-storage";
import { cn } from "@/lib/utils";
import { CaretDown, Check, CircleNotch } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { PROVIDER_LABEL, ProviderLogo } from "./provider-logos";

const PROVIDERS: AgentProvider[] = ["anthropic", "openai", "gemini"];

// Selector de proveedor inline (Radix Select). Trigger y opciones muestran el LOGO
// del provider — sin ícono genérico. Replica los side-effects del viejo dialog: al
// cambiar de proveedor resetea el modelo al default, LIMPIA el token (la config guarda
// una sola key, la anterior es de otro provider) y abre el dialog de key.
function ProviderSelect({ config }: { config: LocalAgentType }) {
  const onChange = (next: string) => {
    const provider = next as AgentProvider;
    const changed = provider !== config.provider;
    patchAgentConfig({
      provider,
      model: DEFAULT_MODEL_BY_PROVIDER[provider],
      ...(changed ? { token: "" } : {}),
    });
    if (changed || !config.token) {
      localSettingDialog.show({}).then().catch();
    }
  };

  return (
    <Select value={config.provider} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Proveedor"
        className="h-8 w-auto gap-1.5 rounded-control px-2.5 text-xs font-medium shadow-none"
      >
        {/* !flex: el SelectTrigger aplica [&>span]:line-clamp-1 al span hijo directo,
            que setea display:-webkit-box y pisa el flex → logo y nombre se desalinean.
            Forzamos el flex con !important para que queden inline y centrados. */}
        <span className="!flex items-center gap-1.5">
          <ProviderLogo
            provider={config.provider}
            className="h-3.5 w-3.5 shrink-0"
          />
          {PROVIDER_LABEL[config.provider]}
        </span>
      </SelectTrigger>
      <SelectContent>
        {PROVIDERS.map((p) => (
          <SelectItem key={p} value={p} className="text-xs">
            <span className="flex items-center gap-2">
              <ProviderLogo provider={p} className="h-4 w-4" />
              {PROVIDER_LABEL[p]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Selector de modelo inline: Popover + Command (cmdk) con buscador. Fetchea la lista
// live del provider al abrir (con fallback curado offline), igual que el viejo modal,
// pero como dropdown. Al elegir, update parcial de la config (solo model).
function ModelCombobox({ config }: { config: LocalAgentType }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromFallback, setFromFallback] = useState(false);

  useEffect(() => {
    if (!open) return;

    // alive: evita el setState si el popover se cierra mientras el fetch está en vuelo.
    let alive = true;
    setLoading(true);
    fetchProviderModels(config.provider, config.token)
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
  }, [open, config.provider, config.token]);

  const onPick = (model: string) => {
    patchAgentConfig({ model });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Cambiar modelo"
          className="border-input flex h-8 max-w-[190px] items-center gap-1.5 rounded-control border px-2.5 text-xs transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <span className="truncate">{config.model}</span>
          <CaretDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Buscar modelo…" className="text-xs" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs opacity-70">
                <CircleNotch className="h-4 w-4 animate-spin" />
                Cargando modelos…
              </div>
            ) : (
              <>
                <CommandEmpty className="py-6 text-center text-xs opacity-60">
                  Sin modelos.
                </CommandEmpty>
                <CommandGroup>
                  {models.map((m) => {
                    const active = m === config.model;
                    return (
                      <CommandItem
                        key={m}
                        value={m}
                        onSelect={() => onPick(m)}
                        className="text-xs"
                      >
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            active ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="truncate">{m}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
                {fromFallback && (
                  <div className="border-t px-3 py-1.5 text-[11px] opacity-50">
                    lista offline
                  </div>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Fila de selectores que vive DEBAJO del input del chat. Lee la config vía el MISMO
// SWR `/local-agent-setting` que el resto del chat, así se re-renderiza solo cuando se
// guarda desde cualquiera de los controles. Si no hay config usable, no renderiza nada
// (el chat ya muestra el CTA de "configurá IA" en ese caso).
export default function ChatModelControls() {
  const { data: config } = useSWR(
    "/local-agent-setting",
    getAgentFromLocalStorage
  );

  if (!config) return null;

  return (
    <div className="flex items-center gap-2">
      <ProviderSelect config={config} />
      <ModelCombobox config={config} />
    </div>
  );
}
