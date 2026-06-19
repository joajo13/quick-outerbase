"use client";

import { useLocalMode } from "@/lib/local-mode";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import NavigationLayout from "./nav-layout";
import { ResourceItemList } from "./resource-item-helper";
import { useSession } from "./session-provider";
import { useWorkspaces } from "./workspace-provider";

export default function OuterbaseMainPage() {
  const router = useRouter();
  const { localMode, isLoading: localModeLoading } = useLocalMode();
  const { isLoading: sessionLoading, session } = useSession();
  const { workspaces, loading: workspaceLoading } = useWorkspaces();

  useEffect(() => {
    // Esperamos a saber el modo para no parpadear a una pantalla de cloud.
    if (localModeLoading) return;

    // Modo local/standalone: la raíz va directo al visor de la DB, sin cloud.
    if (localMode) {
      router.replace("/env");
      return;
    }

    if (sessionLoading) return;

    // Invalid session, go to local connection
    if (!session) {
      router.push("/local");
    }

    if (workspaceLoading) return;
    if (!workspaces) return;

    // Redirect to the first workspace
    if (workspaces.length > 0) {
      router.push(`/w/${workspaces[0].short_name}`);
    } else {
      router.push("/local");
    }
  }, [
    localMode,
    localModeLoading,
    session,
    sessionLoading,
    workspaceLoading,
    workspaces,
    router,
  ]);

  return (
    <NavigationLayout>
      <div className="flex flex-1 flex-col content-start gap-4 overflow-x-hidden overflow-y-auto p-4">
        <ResourceItemList boards={[]} bases={[]} loading />
      </div>
    </NavigationLayout>
  );
}
