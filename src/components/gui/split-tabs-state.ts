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
  // Si se cierra un panel en/antes del enfocado, corré el foco un lugar atrás.
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

export const MIN_PANE_PERCENT = 15;

// Mueve el divisor entre el panel dividerIndex y dividerIndex+1.
// deltaPercent > 0 agranda el panel izquierdo. Respeta MIN_PANE_PERCENT en ambos.
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
