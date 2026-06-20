/**
 * @jest-environment jsdom
 *
 * Regresión del bail-out de igualdad en useTableVisibilityRecalculation.
 *
 * getVisibleCellRange devuelve SIEMPRE un objeto nuevo. Sin bail-out, cada
 * medición fuerza un re-render aunque el rango visible no cambie, lo que en el
 * browser real alimenta el feedback recalculate→re-render→re-suscripción del
 * ResizeObserver→initial observation síncrona→recalculate… (freeze del main
 * thread sin error de React, observado al abrir tablas DynamoDB).
 *
 * El bail-out devuelve el MISMO objeto por identidad cuando el rango no cambió,
 * para que React (Object.is) NO re-renderice.
 */
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";
import useTableVisibilityRecalculation from "./use-visibility-calculation";
import type { OptimizeTableHeaderWithIndexProps } from ".";
import type OptimizeTableState from "./optimize-table-state";

// State mínimo: el hook solo usa getHeaderWidth(), gutterColumnWidth y
// setHeaderWidth(). Evitamos importar la clase real (arrastra ESM de iconos).
function makeState(colWidth: number, cols: number, rows: number): OptimizeTableState {
  const widths = Array.from({ length: cols }, () => colWidth);
  return {
    gutterColumnWidth: 40,
    getHeaderWidth: () => widths,
    setHeaderWidth: (idx: number, w: number) => {
      widths[idx] = w;
    },
    getRowsCount: () => rows,
  } as unknown as OptimizeTableState;
}

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

function makeContainer(width = 800, height = 600): HTMLDivElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => height });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => 0, set: () => {} });
  Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => 0, set: () => {} });
  el.getBoundingClientRect = () =>
    ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }) as DOMRect;
  return el;
}

function makeHeaders(n: number): OptimizeTableHeaderWithIndexProps[] {
  return Array.from({ length: n }, (_, index) => ({ index })) as OptimizeTableHeaderWithIndexProps[];
}

test("recalculateVisible: bail-out devuelve el MISMO rango si no cambió (sin churn)", () => {
  const headers = makeHeaders(9);
  const state = makeState(120, 9, 3);
  const container = makeContainer();

  const { result } = renderHook(() => {
    const containerRef = useRef<HTMLDivElement>(container);
    return useTableVisibilityRecalculation({
      containerRef,
      headers,
      renderAhead: 20,
      rowHeight: 35,
      totalRowCount: 3,
      state,
    });
  });

  // Forzamos el cálculo inicial.
  act(() => {
    result.current.onHeaderResize(0, 120);
  });
  const first = result.current.visibileRange;

  // Recalcular con la MISMA geometría no debe cambiar el objeto del rango.
  act(() => {
    result.current.onHeaderResize(0, 120);
  });
  const second = result.current.visibileRange;

  // Identidad estable → React no re-renderiza por este recálculo (anti-feedback).
  expect(second).toBe(first);
});
