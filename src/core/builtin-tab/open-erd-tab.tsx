import { TreeStructure } from "@phosphor-icons/react";
import dynamic from "next/dynamic";
import { createTabExtension } from "../extension-tab";

// Lazy-load del ERD: @xyflow/react + dagre son pesados y solo se necesitan
// al abrir el diagrama, así no entran en el bundle de primer paint (perf R7).
const RelationalDiagramTab = dynamic(
  () => import("@/components/gui/tabs/relational-diagram-tab"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm opacity-60">
        Cargando diagrama…
      </div>
    ),
  }
);

export const builtinOpenERDTab = createTabExtension({
  name: "erd",
  key: () => "",
  generate: () => ({
    title: "Relational Diagram",
    component: <RelationalDiagramTab />,
    icon: TreeStructure,
  }),
});
