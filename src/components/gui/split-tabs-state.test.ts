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
  MIN_PANE_PERCENT,
  resizePanes,
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

  test("enfoca el panel al asignarle una tab (picker open existing)", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: null }], focusedPaneIndex: 0, sizes: [50, 50] };
    expect(setPaneTab(s, 1, "b").focusedPaneIndex).toBe(1);
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

  test("al cerrar el panel enfocado, el foco cae en un panel valido", () => {
    const s = { panes: [{ tabKey: "a" }, { tabKey: "b" }, { tabKey: "c" }], focusedPaneIndex: 0, sizes: [33, 33, 34] };
    const r = closePane(s, 0);
    expect(r.panes).toEqual([{ tabKey: "b" }, { tabKey: "c" }]);
    expect(r.focusedPaneIndex).toBeGreaterThanOrEqual(0);
    expect(r.focusedPaneIndex).toBeLessThan(r.panes.length);
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
    expect(r[2]).toBe(23);
  });

  test("dividerIndex inválido devuelve los mismos sizes", () => {
    const sizes = [50, 50];
    expect(resizePanes(sizes, 5, 10)).toBe(sizes);
  });
});
