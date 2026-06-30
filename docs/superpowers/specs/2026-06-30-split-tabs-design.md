# Split Tabs — Design

**Fecha:** 2026-06-30
**Estado:** Aprobado (pendiente review del spec)

## Objetivo

Permitir mostrar **2 o 3 tabs en simultáneo** lado a lado (split horizontal), tipo "split view" de Chrome pero con máximo de 3 paneles en vez de 2. El split se dispara con **click derecho sobre una tab → "Split tab"**. Al splitear, la tab queda en el panel izquierdo y a la derecha aparece un **picker** para elegir qué mostrar (crear una tab nueva o elegir una ya abierta).

## Contexto actual (cómo funciona hoy)

- [`database-gui.tsx`](../../../src/components/gui/database-gui.tsx) es el dueño del estado: `tabs: WindowTabItemProps[]` + un único `selectedTabIndex`.
- [`windows-tab.tsx`](../../../src/components/gui/windows-tab.tsx) renderiza el strip horizontal de tabs (drag & drop con dnd-kit) y **una sola** zona de contenido: todas las tabs están montadas siempre, pero solo la seleccionada tiene `display: inherit`, el resto `display: none`. Esto preserva el estado de cada tab al cambiar de una a otra.
- Las tabs se abren por channels (`scc.tabs.openBuiltinQuery/Table/Schema/Chat/...`), que en `database-gui` appendean a `tabs` y setean `selectedTabIndex`.
- Ya existe infra de context menu (radix `ContextMenu` + `context-menu-handler`), pero `SortableTab` hoy **no** tiene click derecho (solo click del medio para cerrar).

## Constraint crítico: no re-montar las tabs

[`query-tab.tsx`](../../../src/components/gui/tabs/query-tab.tsx) guarda el SQL que se está tipeando (`code`), los resultados (`data`), el nombre, etc. en **estado local de React** (`useState`). Si el componente de la tab se re-monta, se pierde todo eso (query a medio escribir, resultados, scroll).

**Conclusión:** el split NO puede reparentar los componentes de las tabs a otro lugar del árbol de React, porque eso los re-monta. Hay que mantenerlas montadas como hijas estables del mismo contenedor y solo cambiarles el CSS.

Esto descarta el enfoque "obvio" de `ResizablePanelGroup` (mete cada tab en un panel separado → reparenta → re-monta).

## Enfoque elegido

**Split adentro de `WindowTabs`, paneles con CSS flex usando `order`, sin reparentar.**

- Todas las tabs siguen montadas como hijas del mismo contenedor. Lo único que cambia por tab es su CSS: qué región (panel) ocupa, o `display: none` si no está visible.
- El layout de paneles se logra con `display: flex` en el contenedor y, en cada wrapper de tab visible, `order` (posición del panel) + `flex-basis` (ancho del panel). Los divisores redimensionables son flex-items con `order` intercalado.
- El estado del split vive en `WindowTabs` (solo en memoria, no persiste). Es **opt-in** vía prop `enableSplit` para no afectar otros usos de `WindowTabs` (p. ej. los sub-tabs de resultados dentro de `query-tab`).

### Por qué no las alternativas

- **B — Subir estado a `database-gui` + `ResizablePanelGroup`:** reparenta → re-monta → pierde estado de la tab. Descartado.
- **C — Posicionamiento absoluto midiendo rects de cada panel:** preserva el montaje pero hay que medir layouts con ResizeObserver y posicionar a mano. Más frágil que el enfoque elegido para el mismo beneficio. Descartado.

## Modelo de estado

Dentro de `WindowTabs` (cuando `enableSplit` está activo):

```ts
type SplitPane = { tabKey: string | null }; // null = panel vacío → muestra el picker
const [panes, setPanes] = useState<SplitPane[]>(...);     // length 1..3
const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
const [paneSizes, setPaneSizes] = useState<number[]>(...); // flex-basis %, para el resize
```

- **Sin split:** `panes = [{ tabKey: <tab seleccionada> }]`, `focusedPaneIndex = 0`. Render idéntico a hoy (una sola zona de contenido).
- Un pane con `tabKey: null` muestra el **picker** (estado vacío "elegí qué va acá").
- Invariante: `1 <= panes.length <= 3`.

### Reconciliación selected → panel enfocado

El prop `selected` (de `database-gui`) representa "qué tab debería estar en el panel enfocado". Un effect reconcilia:

- Si la tab `selected` ya está en algún panel → mover el foco a ese panel (no la duplica). _("Foco")_
- Si no está en ningún panel → asignarla al panel enfocado (`panes[focusedPaneIndex].tabKey = selectedKey`), reemplazando lo que hubiera (otra tab o un picker). _("Reemplaza")_

Esto unifica tres caminos en una sola lógica:
1. Click izquierdo en una tab del strip ("Foco o reemplaza").
2. Crear una tab nueva desde el picker (la tab nueva queda `selected` → cae en el panel enfocado, que es el picker).
3. Comportamiento sin split (idéntico a hoy: `panes[0].tabKey = selected`).

## Interacciones

### Splitear (click derecho → "Split tab")

`SortableTab` agrega `onContextMenu` que abre un menú con el item **"Split tab"**, deshabilitado si ya hay 3 paneles.

- **Desde vista simple (1 pane):** la tab clickeada (X) queda en el panel izquierdo y se agrega un panel vacío a la derecha. `panes = [{ tabKey: X }, { tabKey: null }]`, `focusedPaneIndex = 1`.
- **Desde 2 paneles:** se agrega un 3er panel vacío a la derecha. `focusedPaneIndex = 2`. (El tab sobre el que se hizo click derecho ya está visible o no; en 2→3 simplemente se agrega el picker — no se mueve nada.)

### Picker pane (panel con `tabKey: null`)

Nuevo componente `split-pane-picker.tsx`. Dos secciones:

- **New:** "Query", "Table" (si el driver soporta create/update table), "Chat" — dispara los mismos `scc.tabs.openBuiltin*` que usa el dropdown "+ New" actual. La tab creada cae en este panel vía la reconciliación selected→panel.
- **Open existing:** lista las tabs abiertas que **no** estén ya en otro panel. Click → asigna esa tab a este panel (`panes[i].tabKey = key`).
- Tiene una **✕** para cancelar (cierra ese panel, ver "Cerrar panel").

### Click izquierdo en el strip ("Foco o reemplaza")

Sin cambios en cómo el strip dispara la selección: sigue llamando `onSelectChange(idx)` → `database-gui` actualiza `selectedTabIndex` → la reconciliación hace foco-o-reemplaza. Sin split, se comporta exactamente como hoy.

### Cerrar panel / salir del split

- Con split activo (>1 panel), cada panel muestra una **✕** chica en la esquina superior. Cerrarlo lo saca de `panes`.
- Si al cerrar queda 1 panel → se sale del split (vista normal). Hay que ajustar `focusedPaneIndex` para que siga siendo válido.
- Cerrar una tab desde el strip (la ✕ existente): si esa tab estaba en un panel, ese panel pasa a `tabKey: null` (picker) si quedan >1 paneles, o se colapsa el split si era el único contenido. La lógica de cierre de tabs en `database-gui` no cambia; `WindowTabs` reacciona a que la `key` desapareció de `tabs`.

### Strip con split activo

- El tab del panel **enfocado** se ve como el "primario" (alto, blanco — el estilo `selected` actual).
- Los tabs de los **otros** paneles visibles llevan un marcador sutil (p. ej. un ✦ / dot / borde) para indicar "está abierto en un panel".
- El drag & drop de reordenar el strip sigue funcionando igual.

### Divisores redimensionables

- Entre paneles hay un handle (flex-item con `order` intercalado: paneles en `order` 0,2,4 y handles en 1,3).
- Drag del handle ajusta `paneSizes` (flex-basis en %). Default: paneles parejos.
- Mínimo de ancho por panel para que no colapsen.

## Componentes y archivos

| Archivo | Cambio |
|---|---|
| `src/components/gui/windows-tab.tsx` | El grueso: estado de split (`panes`, `focusedPaneIndex`, `paneSizes`), render de paneles flex con `order`, reconciliación selected→panel, handles de resize, prop `enableSplit`. |
| `src/components/gui/sortable-tab.tsx` | Agregar `onContextMenu` con el item "Split tab" (callback `onSplit` desde `WindowTabs`). Marcador visual ✦ para tabs en paneles no enfocados. |
| `src/components/gui/split-pane-picker.tsx` (nuevo) | UI del panel vacío: secciones New / Open existing + ✕ cancelar. |
| `src/components/gui/database-gui.tsx` | Cambio mínimo: pasar `enableSplit` al `WindowTabs` principal. |

## Flujo de datos

```
Right-click tab X → "Split tab"
   └─ WindowTabs: panes=[{X},{null}], focusedPaneIndex=1
        └─ render: pane0=componente de X | divisor | pane1=<SplitPanePicker>

Picker "New Query"
   └─ scc.tabs.openBuiltinQuery() → channel → database-gui appendea tab + setSelectedTabIndex(nuevo)
        └─ WindowTabs effect: selected=nuevo, no está en panel → panes[1].tabKey=nuevo (panel enfocado)
             └─ render: pane1 = componente de la query nueva

Picker "Open existing → Users"
   └─ WindowTabs: panes[1].tabKey="users"
        └─ render: pane1 = componente de Users

Click izq en strip sobre tab ya visible
   └─ onSelectChange → selected cambia → effect: ya está en panel p → focusedPaneIndex=p (solo foco)
```

## Manejo de errores / edge cases

- **Tab cerrada mientras está en un panel:** `WindowTabs` detecta que la `key` ya no está en `tabs`; ese panel pasa a picker (si quedan >1) o se colapsa el split.
- **Última tab / tabs vacío:** mantener el comportamiento actual; el split solo existe si hay tabs.
- **Intentar splitear con 3 paneles:** item "Split tab" deshabilitado.
- **`focusedPaneIndex` fuera de rango** tras cerrar paneles: clamp a `[0, panes.length-1]`.
- **Misma tab en dos paneles:** no se permite; el picker "Open existing" excluye tabs ya visibles, y la reconciliación hace foco en vez de duplicar.
- **Reload de la página:** el split se resetea (in-memory only, por diseño).

## Testing

- **Unit (lógica de reducer/estado del split):** extraer la lógica de `panes`/`focusedPaneIndex` a funciones puras testeables:
  - split desde 1 panel → `[{X},{null}]`, foco en 1.
  - split desde 2 → agrega 3er panel, foco en 2; no permite 4to.
  - reconciliación: tab ya visible → solo foco; tab nueva → reemplaza panel enfocado.
  - cerrar panel → clamp de foco; bajar a 1 panel sale del split.
  - cerrar tab que está en panel → panel pasa a picker / colapsa.
- **Manual (en el browser, puerto 3008, con Claude in Chrome):**
  - splitear una query, escribir SQL, splitear de nuevo → el SQL no se pierde (no re-montó).
  - picker: crear nueva + elegir existente.
  - resize de divisores.
  - cerrar paneles y volver a vista simple.

## Fuera de scope (v1 — YAGNI)

- Persistencia del split tras reload.
- Drag de tabs entre paneles.
- Split vertical (solo horizontal).
- Más de 3 paneles.
- Botón de split aparte del click derecho.
