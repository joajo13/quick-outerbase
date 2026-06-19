"use client";

import { Edge } from "@xyflow/react";
import {
  createContext,
  PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * Foco interactivo del ERD: qué tabla o columna-FK está seleccionada para
 * resaltar sus relaciones. Vive en un contexto aparte para que nodos, columnas
 * y edges consuman los sets ya calculados (O(1) por lookup) sin que index.tsx
 * tenga que recomputar el `data` de cada nodo en cada cambio de foco.
 */
export type ERDFocusState =
  | { type: "node"; table: string }
  | { type: "column"; table: string; column: string };

interface ERDDerived {
  active: boolean;
  highlightedNodes: Set<string>;
  highlightedEdges: Set<string>;
  // claves `${table}.${column}` de las columnas involucradas en las relaciones
  // resaltadas (la FK de un lado y la PK referenciada del otro).
  highlightedColumns: Set<string>;
}

interface ERDFocusContextValue extends ERDDerived {
  focus: ERDFocusState | null;
  setFocus: (focus: ERDFocusState | null) => void;
}

const EMPTY_DERIVED: ERDDerived = {
  active: false,
  highlightedNodes: new Set(),
  highlightedEdges: new Set(),
  highlightedColumns: new Set(),
};

const ERDFocusContext = createContext<ERDFocusContextValue>({
  ...EMPTY_DERIVED,
  focus: null,
  setFocus: () => {},
});

function computeDerived(
  focus: ERDFocusState | null,
  edges: Edge[]
): ERDDerived {
  if (!focus) return EMPTY_DERIVED;

  const highlightedNodes = new Set<string>();
  const highlightedEdges = new Set<string>();
  const highlightedColumns = new Set<string>();

  // Resalta un edge y ambos extremos (tablas + columnas FK/PK).
  const addEdge = (e: Edge) => {
    highlightedEdges.add(e.id);
    highlightedNodes.add(e.source);
    highlightedNodes.add(e.target);
    if (e.sourceHandle) highlightedColumns.add(`${e.source}.${e.sourceHandle}`);
    if (e.targetHandle) highlightedColumns.add(`${e.target}.${e.targetHandle}`);
  };

  highlightedNodes.add(focus.table);

  if (focus.type === "node") {
    // Tabla: todas sus relaciones + tablas vecinas.
    for (const e of edges) {
      if (e.source === focus.table || e.target === focus.table) addEdge(e);
    }
  } else {
    // Columna FK (o columna PK referenciada): solo la(s) relación(es) de esa
    // columna y la tabla del otro extremo.
    for (const e of edges) {
      const isSource =
        e.source === focus.table && e.sourceHandle === focus.column;
      const isTarget =
        e.target === focus.table && e.targetHandle === focus.column;
      if (isSource || isTarget) addEdge(e);
    }
    highlightedColumns.add(`${focus.table}.${focus.column}`);
  }

  return { active: true, highlightedNodes, highlightedEdges, highlightedColumns };
}

export function ERDFocusProvider({
  edges,
  children,
}: PropsWithChildren<{ edges: Edge[] }>) {
  const [focus, setFocus] = useState<ERDFocusState | null>(null);

  // El cálculo pesado depende de focus + edges; se memoiza para no rehacerlo en
  // renders que no cambian el foco (auto-arrange, hover de tooltips, etc.).
  const derived = useMemo(() => computeDerived(focus, edges), [focus, edges]);

  const value = useMemo<ERDFocusContextValue>(
    () => ({ ...derived, focus, setFocus }),
    [derived, focus]
  );

  return (
    <ERDFocusContext.Provider value={value}>
      {children}
    </ERDFocusContext.Provider>
  );
}

export function useERDFocus() {
  return useContext(ERDFocusContext);
}

/** Estado visual de un nodo/tabla: resaltado, atenuado o normal. */
export function useNodeFocusState(table: string): "on" | "dim" | "none" {
  const { active, highlightedNodes } = useERDFocus();
  if (!active) return "none";
  return highlightedNodes.has(table) ? "on" : "dim";
}

/** ¿Esta columna concreta participa de la relación resaltada? */
export function useColumnHighlighted(table: string, column: string): boolean {
  const { active, highlightedColumns } = useERDFocus();
  return active && highlightedColumns.has(`${table}.${column}`);
}

/** Estado visual de un edge: resaltado, atenuado o normal. */
export function useEdgeFocusState(id: string): "on" | "dim" | "none" {
  const { active, highlightedEdges } = useERDFocus();
  if (!active) return "none";
  return highlightedEdges.has(id) ? "on" : "dim";
}
