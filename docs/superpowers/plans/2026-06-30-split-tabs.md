# Split Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar 2 o 3 tabs en simultáneo lado a lado (split horizontal, máx 3), disparado con click derecho sobre una tab → "Split tab".

**Architecture:** Toda la lógica del split vive en un módulo de funciones puras (`split-tabs-state.ts`), testeado con jest. `WindowTabs` consume ese estado y renderiza los paneles con CSS flex usando `order` + `flex-basis`, SIN reparentar los componentes de las tabs (las tabs siguen montadas como hijas estables del mismo contenedor → no se re-montan → no se pierde el estado local de cada tab, p. ej. el SQL a medio escribir). El split es opt-in vía prop `enableSplit` y solo vive en memoria.

**Tech Stack:** Next.js 15 + React 19, TypeScript, jest (`testEnvironment: node`) + @testing-library, Tailwind v4, radix context-menu (`@/components/ui/context-menu`), lucide-react / @phosphor-icons.

## Global Constraints

- **No re-montar tabs:** los componentes de las tabs NO se mueven a otro lugar del árbol React. Se mantienen montados como hijas estables del contenedor de contenido; solo cambia su CSS. (Razón: `query-tab.tsx` guarda `code`/`data`/`name` en `useState` local.)
- **Máximo de paneles:** `MAX_PANES = 3`.
- **Opt-in:** el split solo se activa con la prop `enableSplit` en `WindowTabs`. El uso interno de `WindowTabs` en `query-tab.tsx` (sub-tabs de resultados) NO debe verse afectado (no pasa `enableSplit`).
- **Solo en memoria:** el layout del split se resetea al recargar la página. No se persiste.
- **Solo horizontal, sin drag entre paneles, sin botón aparte del click derecho** (fuera de scope v1).
- **Tests de lógica:** jest sobre funciones puras. Comando: `npm test -- <ruta>`. Typecheck: `npm run typecheck`.
- **Idioma del código:** comentarios cortos en español rioplatense, matchear el estilo del archivo vecino.

---

### Task 1: Módulo de estado del split (estructura de paneles)

Funciones puras que modelan el split. Es el corazón testeable de la feature.

**Files:**
- Create: `src/components/gui/split-tabs-state.ts`
- Test: `src/components/gui/split-tabs-state.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export const MAX_PANES = 3;
  export interface SplitPane { tabKey: string | null } // null = panel vacío (picker)
  export interface SplitState {
    panes: SplitPane[];        // length 1..MAX_PANES
    focusedPaneIndex: number;  // 0..panes.length-1
    sizes: number[];           // length === panes.length; porcentajes que suman ~100
  }
  export function createSplitState(tabKey: string | null): SplitState;
  export function splitTab(state: SplitState, tabKey: string): SplitState;
  export function reconcileSelected(state: SplitState, selectedKey: string | null): SplitState;
  export function setPaneTab(state: SplitState, paneIndex: number, tabKey: string): SplitState;
  export function focusPane(state: SplitState, paneIndex: number): SplitState;
  export function closePane(state: SplitState, paneIndex: number): SplitState;
  export function syncWithTabs(state: SplitState, existingKeys: string[]): SplitState;
  export function evenSizes(count: number): number[];
  ```

- [ ] **Step 1: Escribir el test que falla**

Crear `src/components/gui/split-tabs-state.test.ts`:

```ts
import {
  MAX_PANES,
  createSplitState,
  splitTab,
  reconcileSelected,
  setPaneTab,
  focusPane,
  closePane,
  syncWithTabs,
  evenSizes,
} from "./split-tabs-state";

describe("evenSizes", () => {
  test("reparte 100 entre N paneles", () => {
    expect(evenSizes(1)).toEqual([100]);
    expect(evenSizes(2)).toEqual([50, 50]);
    const three = evenSizes(3);
    expect(three).toHaveLength(3);
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
  });
});

describe("createSplitState", () => {
  test("arranca con un solo panel enfocado", () => {
    const s = createSplitState("query");
    expect(s.panes).toEqual([{ tabKey: "query" }]);
    expect(s.focusedPaneIndex).toBe(0);
    expect(s.sizes).toEqual([100]);
  });

  test("acepta tabKey null", () => {
    expect(createSplitState(null).panes).toEqual([{ tabKey: null }]);
  });
});

describe("splitTab", () => {
  test("desde 1 panel: la tab clickeada queda a la izquierda y agrega picker a la derecha, foco en el picker", () => {
    const s = splitTab(createSplitState("query"), "users");
    expect(s.panes).toEqual([{ tabKey: "users" }, { tabKey: null }]);
    expect(s.focusedPaneIndex).toBe(1);
    expect(s.sizes).toEqual([50, 50]);
  });

  test("desde 2 paneles: agrega un 3er panel picker y lo enfoca", () => {
    const two = splitTab(createSplitState("query"), "users");
    const three = splitTab(two, "chat");
    expect(three.panes).toEqual([
      { tabKey: "users" },
      { tabKey: null },
      { tabKey: null },
    ]);
    expect(three.focusedPaneIndex).toBe(2);
    expect(three.panes).toHaveLength(MAX_PANES);
  });

  test("con MAX_PANES paneles no hace nada", () => {
    const three = splitTab(splitTab(createSplitState("query"), "users"), "chat");
    expect(splitTab(three, "erd")).toBe(three);
  });
});

describe("reconcileSelected", () => {
  test("si la tab ya está visible, solo mueve el foco a ese panel", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }], focusedPaneIndex: 1, sizes: [50, 50] };
    const r = reconcileSelected(s, "a");
    expect(r.focusedPaneIndex).toBe(0);
    expect(r.panes).toEqual(s.panes);
  });

  test("si la tab no está visible, la carga en el panel enfocado", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: null }], focusedPaneIndex: 1, sizes: [50, 50] };
    const r = reconcileSelected(s, "c");
    expect(r.panes).toEqual([{ tabKey: "a" }, { tabKey: "c" }]);
    expect(r.focusedPaneIndex).toBe(1);
  });

  test("selectedKey null es no-op", () => {
    const s = createSplitState("a");
    expect(reconcileSelected(s, null)).toBe(s);
  });
});

describe("setPaneTab", () => {
  test("asigna una tab a un panel puntual (picker open existing)", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: null }], focusedPaneIndex: 1, sizes: [50, 50] };
    expect(setPaneTab(s, 1, "b").panes).toEqual([{ tabKey: "a" }, { tabKey: "b" }]);
  });
});

describe("focusPane", () => {
  test("cambia el panel enfocado", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }], focusedPaneIndex: 0, sizes: [50, 50] };
    expect(focusPane(s, 1).focusedPaneIndex).toBe(1);
  });

  test("ignora índices fuera de rango", () => {
    const s = createSplitState("a");
    expect(focusPane(s, 5)).toBe(s);
  });
});

describe("closePane", () => {
  test("no se puede cerrar el único panel", () => {
    const s = createSplitState("a");
    expect(closePane(s, 0)).toBe(s);
  });

  test("cierra un panel y renormaliza sizes y foco", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }], focusedPaneIndex: 1, sizes: [50, 50] };
    const r = closePane(s, 1);
    expect(r.panes).toEqual([{ tabKey: "a" }]);
    expect(r.sizes).toEqual([100]);
    expect(r.focusedPaneIndex).toBe(0);
  });

  test("clampea el foco si se cierra un panel anterior al enfocado", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }, { tabKey: "c" }], focusedPaneIndex: 2, sizes: [33, 33, 34] };
    const r = closePane(s, 0);
    expect(r.panes).toEqual([{ tabKey: "b" }, { tabKey: "c" }]);
    expect(r.focusedPaneIndex).toBe(1);
  });
});

describe("syncWithTabs", () => {
  test("un panel cuya tab fue cerrada pasa a picker (null)", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }], focusedPaneIndex: 0, sizes: [50, 50] };
    const r = syncWithTabs(s, ["a"]);
    expect(r.panes).toEqual([{ tabKey: "a" }, { tabKey: null }]);
  });

  test("si nada cambió devuelve el mismo objeto", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }], focusedPaneIndex: 0, sizes: [50, 50] };
    expect(syncWithTabs(s, ["a", "b"])).toBe(s);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- src/components/gui/split-tabs-state.test.ts`
Expected: FAIL — `Cannot find module './split-tabs-state'`.

- [ ] **Step 3: Implementar el módulo**

Crear `src/components/gui/split-tabs-state.ts`:

```ts
// Estado puro del split de tabs. Sin React: todo testeable.
export const MAX_PANES = 3;

export interface SplitPane {
  tabKey: string | null; // null = panel vacío → muestra el picker
}

export interface SplitState {
  panes: SplitPane[]; // length 1..MAX_PANES
  focusedPaneIndex: number; // 0..panes.length-1
  sizes: number[]; // length === panes.length; porcentajes (~100 en total)
}

// Reparte 100% parejo entre N paneles.
export function evenSizes(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

export function createSplitState(tabKey: string | null): SplitState {
  return { panes: [{ tabKey }], focusedPaneIndex: 0, sizes: [100] };
}

// Click derecho "Split tab".
export function splitTab(state: SplitState, tabKey: string): SplitState {
  if (state.panes.length >= MAX_PANES) return state;

  if (state.panes.length === 1) {
    // La tab clickeada va a la izquierda; picker vacío a la derecha.
    const panes = [{ tabKey }, { tabKey: null }];
    return { panes, focusedPaneIndex: 1, sizes: evenSizes(2) };
  }

  // Desde 2 paneles: sumá un picker a la derecha.
  const panes = [...state.panes, { tabKey: null }];
  return { panes, focusedPaneIndex: panes.length - 1, sizes: evenSizes(panes.length) };
}

// "Foco o reemplaza".
export function reconcileSelected(
  state: SplitState,
  selectedKey: string | null
): SplitState {
  if (selectedKey == null) return state;

  const visibleIndex = state.panes.findIndex((p) => p.tabKey === selectedKey);
  if (visibleIndex >= 0) {
    if (visibleIndex === state.focusedPaneIndex) return state;
    return { ...state, focusedPaneIndex: visibleIndex };
  }

  const panes = state.panes.map((p, i) =>
    i === state.focusedPaneIndex ? { tabKey: selectedKey } : p
  );
  return { ...state, panes };
}

export function setPaneTab(
  state: SplitState,
  paneIndex: number,
  tabKey: string
): SplitState {
  if (paneIndex < 0 || paneIndex >= state.panes.length) return state;
  const panes = state.panes.map((p, i) => (i === paneIndex ? { tabKey } : p));
  return { ...state, panes, focusedPaneIndex: paneIndex };
}

export function focusPane(state: SplitState, paneIndex: number): SplitState {
  if (paneIndex < 0 || paneIndex >= state.panes.length) return state;
  if (paneIndex === state.focusedPaneIndex) return state;
  return { ...state, focusedPaneIndex: paneIndex };
}

export function closePane(state: SplitState, paneIndex: number): SplitState {
  if (state.panes.length <= 1) return state;
  if (paneIndex < 0 || paneIndex >= state.panes.length) return state;

  const panes = state.panes.filter((_, i) => i !== paneIndex);
  let focusedPaneIndex = state.focusedPaneIndex;
  if (focusedPaneIndex >= paneIndex) {
    focusedPaneIndex = Math.max(0, focusedPaneIndex - 1);
  }
  focusedPaneIndex = Math.min(focusedPaneIndex, panes.length - 1);
  return { panes, focusedPaneIndex, sizes: evenSizes(panes.length) };
}

// Cuando se cierran tabs desde el strip: el panel que apuntaba a una tab
// inexistente pasa a picker (null). Devuelve el mismo objeto si nada cambió.
export function syncWithTabs(
  state: SplitState,
  existingKeys: string[]
): SplitState {
  let changed = false;
  const panes = state.panes.map((p) => {
    if (p.tabKey !== null && !existingKeys.includes(p.tabKey)) {
      changed = true;
      return { tabKey: null };
    }
    return p;
  });
  if (!changed) return state;
  return { ...state, panes };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- src/components/gui/split-tabs-state.test.ts`
Expected: PASS — todos los `describe` en verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/gui/split-tabs-state.ts src/components/gui/split-tabs-state.test.ts
git commit -m "feat(tabs): modulo de estado puro del split de tabs"
```

---

### Task 2: Función pura de resize de paneles

Cálculo del nuevo reparto de anchos al draggear un divisor. Aislado para testear el clamp del mínimo.

**Files:**
- Modify: `src/components/gui/split-tabs-state.ts` (agregar `resizePanes` y `MIN_PANE_PERCENT`)
- Test: `src/components/gui/split-tabs-state.test.ts` (agregar describe)

**Interfaces:**
- Consumes: `SplitState` de Task 1.
- Produces:
  ```ts
  export const MIN_PANE_PERCENT = 15;
  // Mueve el divisor entre el panel dividerIndex y dividerIndex+1.
  // deltaPercent > 0 agranda el panel izquierdo. Respeta MIN_PANE_PERCENT en ambos.
  export function resizePanes(sizes: number[], dividerIndex: number, deltaPercent: number): number[];
  ```

- [ ] **Step 1: Escribir el test que falla**

Agregar a `src/components/gui/split-tabs-state.test.ts`:

```ts
import { MIN_PANE_PERCENT, resizePanes } from "./split-tabs-state";

describe("resizePanes", () => {
  test("mueve ancho entre dos paneles vecinos", () => {
    expect(resizePanes([50, 50], 0, 10)).toEqual([60, 40]);
    expect(resizePanes([50, 50], 0, -10)).toEqual([40, 60]);
  });

  test("no deja a un panel por debajo del mínimo", () => {
    const r = resizePanes([50, 50], 0, 100);
    expect(r[0]).toBe(100 - MIN_PANE_PERCENT);
    expect(r[1]).toBe(MIN_PANE_PERCENT);
  });

  test("no toca paneles que no son vecinos del divisor", () => {
    const r = resizePanes([33, 34, 33], 1, 10);
    expect(r[0]).toBe(33);
    expect(r[1]).toBe(44);
    expect(r[2]).toBe(24);
  });

  test("dividerIndex inválido devuelve los mismos sizes", () => {
    const sizes = [50, 50];
    expect(resizePanes(sizes, 5, 10)).toBe(sizes);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test -- src/components/gui/split-tabs-state.test.ts -t resizePanes`
Expected: FAIL — `resizePanes is not a function`.

- [ ] **Step 3: Implementar**

Agregar al final de `src/components/gui/split-tabs-state.ts`:

```ts
export const MIN_PANE_PERCENT = 15;

export function resizePanes(
  sizes: number[],
  dividerIndex: number,
  deltaPercent: number
): number[] {
  if (dividerIndex < 0 || dividerIndex >= sizes.length - 1) return sizes;

  const left = sizes[dividerIndex];
  const right = sizes[dividerIndex + 1];
  const pair = left + right;

  let newLeft = left + deltaPercent;
  newLeft = Math.max(MIN_PANE_PERCENT, Math.min(pair - MIN_PANE_PERCENT, newLeft));
  const newRight = pair - newLeft;

  const next = [...sizes];
  next[dividerIndex] = newLeft;
  next[dividerIndex + 1] = newRight;
  return next;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test -- src/components/gui/split-tabs-state.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/gui/split-tabs-state.ts src/components/gui/split-tabs-state.test.ts
git commit -m "feat(tabs): resize puro de paneles del split"
```

---

### Task 3: Componente SplitPanePicker

UI presentacional del panel vacío. Sin estado propio: recibe callbacks. Se verifica por typecheck (los tests del proyecto no cubren componentes; verificación visual en Task 6).

**Files:**
- Create: `src/components/gui/split-pane-picker.tsx`

**Interfaces:**
- Consumes: `WindowTabItemProps` de `./windows-tab`.
- Produces:
  ```ts
  export interface SplitPanePickerProps {
    availableTabs: WindowTabItemProps[]; // tabs abiertas que NO están en otro panel
    createMenu: { text: string; onClick: () => void }[]; // mismas opciones que "+ New"
    onPickExisting: (tabKey: string) => void;
    onCancel: () => void;
  }
  export default function SplitPanePicker(props: SplitPanePickerProps): JSX.Element;
  ```

- [ ] **Step 1: Crear el componente**

Crear `src/components/gui/split-pane-picker.tsx`:

```tsx
import { cn } from "@/lib/utils";
import { LucidePlus, LucideX } from "lucide-react";
import { WindowTabItemProps } from "./windows-tab";

export interface SplitPanePickerProps {
  availableTabs: WindowTabItemProps[];
  createMenu: { text: string; onClick: () => void }[];
  onPickExisting: (tabKey: string) => void;
  onCancel: () => void;
}

export default function SplitPanePicker({
  availableTabs,
  createMenu,
  onPickExisting,
  onCancel,
}: SplitPanePickerProps) {
  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 bg-white p-6 dark:bg-neutral-950">
      <button
        onClick={onCancel}
        title="Cancelar split"
        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-control text-neutral-500 transition hover:bg-neutral-200 hover:text-black dark:hover:bg-neutral-800 dark:hover:text-white"
      >
        <LucideX className="h-4 w-4" />
      </button>

      <div className="flex w-full max-w-xs flex-col gap-2">
        <div className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
          New
        </div>
        {createMenu.map((item, idx) => (
          <button
            key={idx}
            onClick={item.onClick}
            className="flex items-center gap-2 rounded-panel border border-neutral-200 px-3 py-2 text-left text-sm transition hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
          >
            <LucidePlus className="h-4 w-4 shrink-0 text-neutral-500" />
            {item.text}
          </button>
        ))}
      </div>

      {availableTabs.length > 0 && (
        <div className="flex w-full max-w-xs flex-col gap-2">
          <div className="text-xs font-medium tracking-wide text-neutral-500 uppercase">
            Open existing
          </div>
          <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onPickExisting(tab.key)}
                className={cn(
                  "flex items-center gap-2 rounded-panel px-3 py-2 text-left text-sm transition",
                  "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-900"
                )}
              >
                <tab.icon className="h-4 w-4 shrink-0 text-neutral-500" />
                <span className="line-clamp-1">{tab.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS — sin errores de tipos en `split-pane-picker.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/gui/split-pane-picker.tsx
git commit -m "feat(tabs): componente SplitPanePicker (estado vacio del panel)"
```

---

### Task 4: Click derecho "Split tab" + marcador visual en SortableTab

Agregar el menú contextual radix sobre cada tab y un marcador para tabs visibles en paneles no enfocados.

**Files:**
- Modify: `src/components/gui/sortable-tab.tsx`

**Interfaces:**
- Consumes: `ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem` de `@/components/ui/context-menu`.
- Produces: `SortableTab` con dos props nuevas opcionales:
  ```ts
  onSplit?: () => void;     // undefined → no se muestra el item "Split tab"
  splitMarked?: boolean;    // true → marcador ✦ (visible en panel no enfocado)
  ```

- [ ] **Step 1: Agregar las props y el marcador al botón**

En `src/components/gui/sortable-tab.tsx`, extender `WindowTabItemButtonProps` y el render del botón. Reemplazar la firma del tipo:

```tsx
type WindowTabItemButtonProps = ButtonProps & {
  selected?: boolean;
  title: string;
  icon: LucideIcon;
  onClose?: () => void;
  isDragging?: boolean;
  splitMarked?: boolean;
};
```

Dentro de `WindowTabItemButton`, desestructurar `splitMarked` junto al resto (`const { icon: Icon, selected, title, onClose, isDragging, splitMarked, ...rest } = props;`) y, justo después del `<div className="line-clamp-1 grow px-2">{title}</div>`, agregar el marcador:

```tsx
{splitMarked && !selected && (
  <span
    className="mr-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70"
    title="Visible en un panel del split"
  />
)}
```

- [ ] **Step 2: Envolver SortableTab en el context menu**

Reemplazar la firma e implementación de `SortableTab`:

```tsx
interface SortableTabProps {
  tab: WindowTabItemProps;
  selected: boolean;
  onSelectChange: () => void;
  onClose?: () => void;
  onSplit?: () => void;
  splitMarked?: boolean;
}

export function SortableTab({
  tab,
  selected,
  onSelectChange,
  onClose,
  onSplit,
  splitMarked,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    transition,
    transform,
    isDragging,
    setNodeRef,
  } = useSortable({ id: tab.key });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const button = (
    <WindowTabItemButton
      ref={setNodeRef}
      icon={tab.icon}
      title={tab.title}
      onClick={onSelectChange}
      selected={selected}
      onClose={onClose}
      splitMarked={splitMarked}
      style={style}
      isDragging={isDragging}
      {...attributes}
      {...listeners}
    />
  );

  if (!onSplit) return button;

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onSplit}>Split tab</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

Agregar el import arriba del archivo:

```tsx
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
```

- [ ] **Step 3: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS — `onSplit`/`splitMarked` son opcionales, así que el uso actual de `SortableTab` en `windows-tab.tsx` sigue compilando.

- [ ] **Step 4: Commit**

```bash
git add src/components/gui/sortable-tab.tsx
git commit -m "feat(tabs): click derecho 'Split tab' y marcador en SortableTab"
```

---

### Task 5: Integrar el split en WindowTabs

El grueso. Estado del split, render de paneles flex con `order`, reconciliación con `selected`/`tabs`, resize, y el item "Split tab" cableado. Todo detrás de `enableSplit`.

**Files:**
- Modify: `src/components/gui/windows-tab.tsx`

**Interfaces:**
- Consumes: todo `split-tabs-state.ts` (Task 1–2), `SplitPanePicker` (Task 3), `SortableTab` con `onSplit`/`splitMarked` (Task 4).
- Produces: `WindowTabsProps` con una prop nueva:
  ```ts
  enableSplit?: boolean; // default false. Activa el split en este WindowTabs.
  ```

- [ ] **Step 1: Imports y prop nueva**

En `src/components/gui/windows-tab.tsx`, agregar imports:

```tsx
import {
  SplitState,
  createSplitState,
  splitTab,
  reconcileSelected,
  setPaneTab,
  focusPane,
  closePane,
  syncWithTabs,
  resizePanes,
  MAX_PANES,
} from "./split-tabs-state";
import SplitPanePicker from "./split-pane-picker";
```

Agregar `enableSplit?: boolean` a `WindowTabsProps` y a la desestructuración de props de `WindowTabs` (con default: `enableSplit = false`).

- [ ] **Step 2: Estado del split y sincronización**

Dentro de `WindowTabs`, después de los `useRef` existentes, agregar el estado y los effects de sincronización. `selectedKey` se deriva de `tabs[selected]`:

```tsx
const selectedKey = tabs[selected]?.key ?? null;

const [split, setSplit] = useState<SplitState>(() =>
  createSplitState(selectedKey)
);

// Reconciliar cuando cambia la tab seleccionada (click en strip, tab nueva, etc.).
const lastSelectedKey = useRef<string | null>(selectedKey);
useEffect(() => {
  if (!enableSplit) return;
  if (selectedKey === lastSelectedKey.current) return;
  lastSelectedKey.current = selectedKey;
  setSplit((s) => reconcileSelected(s, selectedKey));
}, [enableSplit, selectedKey]);

// Sincronizar paneles cuando cambian las tabs (cierres desde el strip).
const tabKeys = useMemo(() => tabs.map((t) => t.key), [tabs]);
useEffect(() => {
  if (!enableSplit) return;
  setSplit((s) => syncWithTabs(s, tabKeys));
}, [enableSplit, tabKeys]);
```

- [ ] **Step 3: Handlers del split**

Agregar dentro de `WindowTabs` (antes del `return`):

```tsx
const handleSplitTab = useCallback((tabKey: string) => {
  setSplit((s) => splitTab(s, tabKey));
}, []);

const handleClosePane = useCallback((paneIndex: number) => {
  setSplit((s) => closePane(s, paneIndex));
}, []);

const handleFocusPane = useCallback((paneIndex: number) => {
  setSplit((s) => focusPane(s, paneIndex));
}, []);

const handlePickExisting = useCallback((paneIndex: number, tabKey: string) => {
  setSplit((s) => setPaneTab(s, paneIndex, tabKey));
}, []);

const handleResize = useCallback((dividerIndex: number, deltaPercent: number) => {
  setSplit((s) => ({ ...s, sizes: resizePanes(s.sizes, dividerIndex, deltaPercent) }));
}, []);

// Map tabKey -> índice de panel donde se ve (para CSS order y marcadores).
const paneIndexByKey = useMemo(() => {
  const map = new Map<string, number>();
  if (enableSplit) {
    split.panes.forEach((p, i) => {
      if (p.tabKey) map.set(p.tabKey, i);
    });
  }
  return map;
}, [enableSplit, split.panes]);

const isSplitActive = enableSplit && split.panes.length > 1;
```

- [ ] **Step 4: Cablear el strip (onSplit + marcador)**

En el `.map` de `SortableTab` dentro del `SortableContext`, pasar las props nuevas (solo cuando `enableSplit`):

```tsx
<SortableTab
  key={tab.key}
  tab={tab}
  selected={idx === selected}
  splitMarked={
    enableSplit &&
    paneIndexByKey.has(tab.key) &&
    paneIndexByKey.get(tab.key) !== split.focusedPaneIndex
  }
  onSplit={
    enableSplit && split.panes.length < MAX_PANES
      ? () => handleSplitTab(tab.key)
      : undefined
  }
  onSelectChange={() => {
    onSelectChange(idx);
  }}
  onClose={
    hideCloseButton
      ? undefined
      : () => {
          const newTabs = tabs.filter((t) => t.key !== tab.key);
          if (selected >= idx) {
            onSelectChange(newTabs.length - 1);
          }
          if (onTabsChange) {
            onTabsChange(newTabs);
          }
        }
  }
/>
```

- [ ] **Step 5: Render del área de contenido en modo split**

Reemplazar SOLO el bloque del área de contenido (el `<div className="relative grow overflow-hidden rounded-t-panel ...">...</div>`) por un render condicional. Si NO está activo el split, dejar el render actual idéntico. Si está activo, usar flex con `order`:

```tsx
{!isSplitActive ? (
  <div className="relative grow overflow-hidden rounded-t-panel bg-white dark:bg-neutral-950">
    {tabs.map((tab, tabIndex) => (
      <CurrentWindowTab.Provider
        key={tab.key}
        value={{ isActiveTab: tabIndex === selected }}
      >
        <div
          className="absolute top-0 right-0 bottom-0 left-0"
          style={{ display: tabIndex === selected ? "inherit" : "none" }}
        >
          {tab.component}
        </div>
      </CurrentWindowTab.Provider>
    ))}
  </div>
) : (
  <div className="relative flex grow overflow-hidden rounded-t-panel bg-white dark:bg-neutral-950">
    {/* Tabs: montadas siempre, ubicadas por CSS order. Las no visibles: display none. */}
    {tabs.map((tab) => {
      const paneIdx = paneIndexByKey.get(tab.key);
      const visible = paneIdx !== undefined;
      return (
        <CurrentWindowTab.Provider
          key={tab.key}
          value={{ isActiveTab: paneIdx === split.focusedPaneIndex }}
        >
          <div
            onMouseDownCapture={
              visible ? () => handleFocusPane(paneIdx!) : undefined
            }
            className={cn(
              "relative min-w-0 overflow-hidden",
              visible &&
                paneIdx === split.focusedPaneIndex &&
                "ring-1 ring-inset ring-primary/40"
            )}
            style={
              visible
                ? {
                    order: paneIdx! * 2,
                    flexGrow: 0,
                    flexShrink: 0,
                    flexBasis: `${split.sizes[paneIdx!]}%`,
                  }
                : { display: "none" }
            }
          >
            {/* botón de cerrar panel */}
            <button
              onClick={() => handleClosePane(paneIdx!)}
              title="Cerrar panel"
              className="absolute top-1 right-1 z-30 flex h-6 w-6 items-center justify-center rounded-control bg-white/70 text-neutral-500 transition hover:bg-neutral-200 hover:text-black dark:bg-neutral-950/70 dark:hover:bg-neutral-800 dark:hover:text-white"
            >
              <LucideX className="h-3.5 w-3.5" />
            </button>
            {tab.component}
          </div>
        </CurrentWindowTab.Provider>
      );
    })}

    {/* Pickers: un panel por cada pane con tabKey null. */}
    {split.panes.map((pane, paneIdx) =>
      pane.tabKey === null ? (
        <div
          key={`picker-${paneIdx}`}
          onMouseDownCapture={() => handleFocusPane(paneIdx)}
          className={cn(
            "relative min-w-0 overflow-hidden",
            paneIdx === split.focusedPaneIndex &&
              "ring-1 ring-inset ring-primary/40"
          )}
          style={{
            order: paneIdx * 2,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: `${split.sizes[paneIdx]}%`,
          }}
        >
          <SplitPanePicker
            availableTabs={tabs.filter((t) => !paneIndexByKey.has(t.key))}
            createMenu={menu ?? []}
            onPickExisting={(tabKey) => handlePickExisting(paneIdx, tabKey)}
            onCancel={() => handleClosePane(paneIdx)}
          />
        </div>
      ) : null
    )}

    {/* Divisores: uno antes de cada panel a partir del segundo. */}
    {split.panes.slice(1).map((_, i) => {
      const dividerIndex = i; // entre panel i e i+1
      return (
        <SplitDivider
          key={`divider-${dividerIndex}`}
          order={dividerIndex * 2 + 1}
          onResize={(deltaPercent) => handleResize(dividerIndex, deltaPercent)}
        />
      );
    })}
  </div>
)}
```

Agregar el import de `LucideX` y `cn` si no están ya (`cn` viene de `@/lib/utils`; `LucideX` de `lucide-react`).

- [ ] **Step 6: Componente SplitDivider (en el mismo archivo)**

Agregar al final de `windows-tab.tsx`, antes del `export default` no — después de él está bien; definirlo como función nombrada en el módulo:

```tsx
function SplitDivider({
  order,
  onResize,
}: {
  order: number;
  onResize: (deltaPercent: number) => void;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const parentWidth =
      e.currentTarget.parentElement?.getBoundingClientRect().width ?? 1;

    const onMove = (ev: PointerEvent) => {
      const deltaPercent = ((ev.clientX - startX) / parentWidth) * 100;
      onResize(deltaPercent);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      style={{ order, flexGrow: 0, flexShrink: 0, flexBasis: 6 }}
      onPointerDown={onPointerDown}
      className="z-20 cursor-col-resize bg-neutral-100 transition-colors hover:bg-primary/40 dark:bg-black"
    />
  );
}
```

Nota: el `onResize` del divisor usa el delta acumulado desde el `startX`, pero `resizePanes` aplica delta sobre el `sizes` ACTUAL. Para que el drag sea estable, cambiar el handler a delta incremental: en `SplitDivider`, trackear el último `clientX` y mandar el delta entre movimientos:

```tsx
    let lastX = startX;
    const onMove = (ev: PointerEvent) => {
      const deltaPercent = ((ev.clientX - lastX) / parentWidth) * 100;
      lastX = ev.clientX;
      onResize(deltaPercent);
    };
```

(Usar esta versión incremental de `onMove`, no la primera.)

- [ ] **Step 7: Verificar typecheck y tests**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm test -- src/components/gui/split-tabs-state.test.ts`
Expected: PASS (sin regresiones).

- [ ] **Step 8: Commit**

```bash
git add src/components/gui/windows-tab.tsx
git commit -m "feat(tabs): render de paneles split en WindowTabs (flex order, resize, picker)"
```

---

### Task 6: Activar el split en DatabaseGui + verificación end-to-end

Prender `enableSplit` en el `WindowTabs` principal y verificar todo el flujo en el browser.

**Files:**
- Modify: `src/components/gui/database-gui.tsx:219-225`

**Interfaces:**
- Consumes: `WindowTabs` con `enableSplit` (Task 5).
- Produces: nada (es el wiring final).

- [ ] **Step 1: Pasar enableSplit**

En `src/components/gui/database-gui.tsx`, en el `<WindowTabs ...>` principal, agregar la prop:

```tsx
<WindowTabs
  enableSplit
  menu={tabSideMenu}
  tabs={tabs}
  selected={selectedTabIndex}
  onSelectChange={setSelectedTabIndex}
  onTabsChange={setTabs}
/>
```

- [ ] **Step 2: Verificar typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Verificación manual en el browser**

El server ya corre en el puerto 3008. Con Claude in Chrome (no Playwright), abrir `http://localhost:3008`, conectar a una base, y verificar:

1. **Split básico:** click derecho en la tab "Query" → "Split tab". La query queda a la izquierda y aparece el picker a la derecha. ✓
2. **Picker → existing:** abrir 2-3 tabs primero (New Query, Chat). Splitear una y, en el picker, "Open existing" lista las otras; clickear una la carga en el panel derecho. ✓
3. **Picker → new:** en el picker, "New Query" crea una query nueva que cae en ese panel. ✓
4. **Preservación de estado (crítico):** escribir SQL en una query, splitear, escribir en otro panel. El SQL del primer panel NO se pierde (no se re-montó). ✓
5. **Tercer panel:** con 2 paneles, click derecho en una tab → "Split tab" agrega un 3er panel. Con 3 paneles el item "Split tab" queda deshabilitado. ✓
6. **Foco o reemplaza:** con split activo, click en una tab del strip que ya está visible → solo cambia el foco (ring). Click en una que no está visible → reemplaza el panel enfocado. ✓
7. **Resize:** draggear el divisor entre paneles cambia los anchos; no colapsan por debajo del mínimo. ✓
8. **Cerrar panel:** la ✕ de un panel lo saca; al volver a 1 panel se sale del split (vista normal). ✓
9. **Cerrar tab en split:** cerrar desde el strip una tab que está en un panel → ese panel pasa a picker. ✓
10. **No regresión:** los sub-tabs de resultados dentro de una query (Result/Explain) NO tienen "Split tab" en el click derecho (no usan `enableSplit`). ✓

- [ ] **Step 4: Commit**

```bash
git add src/components/gui/database-gui.tsx
git commit -m "feat(tabs): activar split de tabs en DatabaseGui"
```

---

## Self-Review (completado por el autor del plan)

**Spec coverage:**
- Modelo de estado (`panes`/`focusedPaneIndex`/`sizes`, picker = tabKey null) → Task 1.
- Resize redimensionable → Task 2 (lógica) + Task 5 (UI divisor).
- Picker (New / Open existing / cancelar) → Task 3 + cableado en Task 5.
- Click derecho "Split tab" + deshabilitado en MAX_PANES → Task 4 + Task 5 (step 4).
- Reconciliación "Foco o reemplaza" → Task 1 (`reconcileSelected`) + Task 5 (effect).
- Marcador ✦ en tabs de paneles no enfocados → Task 4 + Task 5.
- Cerrar panel / salir del split → Task 1 (`closePane`) + Task 5.
- Tab cerrada mientras está en panel → Task 1 (`syncWithTabs`) + Task 5 (effect).
- No re-montar (constraint crítico) → render flex sin reparentar en Task 5; verificado en Task 6 step 3.4.
- Opt-in `enableSplit`, no afecta query-tab → Task 5 + Task 6; verificado en Task 6 step 3.10.
- Solo en memoria → no se agrega persistencia en ningún task. ✓

**Type consistency:** las firmas de `split-tabs-state.ts` (Task 1–2) se usan idénticas en Task 5. `SplitPanePickerProps` (Task 3) coincide con el cableado en Task 5 step 5. `onSplit`/`splitMarked` (Task 4) coinciden con el uso en Task 5 step 4.

**Placeholder scan:** sin TBD/TODO; todo el código está completo.
