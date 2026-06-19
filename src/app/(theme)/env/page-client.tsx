"use client";

import { Studio } from "@/components/gui/studio";
import { StudioExtensionManager } from "@/core/extension-manager";
import {
  createMySQLExtensions,
  createPostgreSQLExtensions,
  createSQLiteExtensions,
  createStandardExtensions,
} from "@/core/standard-extension";
import { SupportedDialect } from "@/drivers/base-driver";
import { createEnvDriver } from "@/lib/env-driver";
import { useAvailableAIAgents } from "@/lib/ai-agent-storage";
import { useEffect, useMemo, useState } from "react";

interface EnvDbInfo {
  engine: string;
  dialect: SupportedDialect;
  name: string;
  schema: string;
}

export default function EnvPageBody() {
  const [info, setInfo] = useState<EnvDbInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/env-database")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || "Error desconocido");
        setInfo(j as EnvDbInfo);
      })
      .catch((e) => setError(e.message));
  }, []);

  const driver = useMemo(() => {
    if (!info) return null;
    return createEnvDriver(info.dialect);
  }, [info]);

  const extensions = useMemo(() => {
    if (!driver) return null;
    const dialect = driver.getFlags().dialect;
    if (dialect === "mysql")
      return new StudioExtensionManager(createMySQLExtensions());
    if (dialect === "sqlite")
      return new StudioExtensionManager(createSQLiteExtensions());
    if (dialect === "postgres")
      return new StudioExtensionManager(createPostgreSQLExtensions());
    return new StudioExtensionManager(createStandardExtensions());
  }, [driver]);

  const agentDriver = useAvailableAIAgents(driver);

  if (error) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold text-red-500">
          No se pudo conectar
        </h1>
        <p className="max-w-lg text-sm opacity-80">{error}</p>
        <p className="max-w-lg text-xs opacity-60">
          Verificá la variable de entorno <code>DATABASE_URL</code> o el flag{" "}
          <code>--url</code>.
        </p>
      </div>
    );
  }

  if (!driver || !info || !extensions) {
    return (
      <div className="flex h-screen w-screen items-center justify-center text-sm opacity-70">
        Conectando a la base de datos…
      </div>
    );
  }

  return (
    <Studio
      extensions={extensions}
      driver={driver}
      name={info.name}
      color="blue"
      agentDriver={agentDriver}
    />
  );
}
