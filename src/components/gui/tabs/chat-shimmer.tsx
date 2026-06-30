"use client";

// Loader "gooey": grilla 3x3 con una gota líquida que recorre las celdas en serpiente
// (snake) con efecto metaball (feGaussianBlur + feColorMatrix sobre el alpha). Se
// muestra en la burbuja del assistant mientras el stream todavía no emitió texto.
//
// La animación va por SMIL animando la GEOMETRÍA (cx/cy), NO por CSS transform.
// Motivo (bug real): cuando se anima el `transform` (CSS) de los <circle> que son
// hijos de un <g> con filtro SVG, varios motores cachean el resultado del filtro y
// NO lo re-pintan — el DOM se mueve pero el píxel queda congelado. Animar cx/cy
// modifica el SourceGraphic del filtro → fuerza su re-evaluación en cada frame en
// TODOS los navegadores, y además no depende de `transform-box: view-box`.
//
// NOTA accesibilidad: a propósito NO respetamos prefers-reduced-motion. Es un
// indicador de carga (contenido esencial que comunica "estoy trabajando"), no una
// animación decorativa, y se decidió que siempre anime. Es chico (48px) y sutil.

// Trayectoria snake en coordenadas del viewBox (user units). Cada celda está en
// 30/60/90; la gota recorre las 9 celdas y vuelve al inicio.
const CX = "30;60;90;90;60;30;30;60;90;30";
const CY = "30;30;30;60;60;60;90;90;90;30";
const KEY_TIMES = "0;0.1111;0.2222;0.3333;0.4444;0.5556;0.6667;0.7778;0.8889;1";
// 9 segmentos (10 valores) con easing ease-in-out → movimiento orgánico entre celdas.
const KEY_SPLINES = Array(9).fill("0.42 0 0.58 1").join(";");
const DUR = "2.6s";

// La gota con cola: 3 círculos con begin desfasado → estela líquida gooey. El lead
// va más adelantado (begin más negativo) y los de la cola lo siguen. Orden de
// pintado: cola (r chico) primero, lead (r grande) encima.
const BLOBS = [
  { r: 5, begin: "0s" }, // cola (más atrás)
  { r: 6.5, begin: "-0.12s" },
  { r: 8.5, begin: "-0.24s" }, // lead (más adelante)
];

export default function ChatShimmer({
  size = 24,
  label = "Generando…",
}: {
  size?: number;
  label?: string;
} = {}) {
  return (
    <div
      className="chat-gooey-loader flex items-center"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          {/* filterUnits=userSpaceOnUse + región = todo el viewBox (con margen) para
              que la gota NO se recorte al trasladarse por las celdas. Con la región
              por-defecto (160% del bbox de los blobs en su posición inicial) la gota
              se salía del filtro al moverse y desaparecía: se veía solo la grilla. */}
          <filter
            id="chat-goo"
            filterUnits="userSpaceOnUse"
            x="-10"
            y="-10"
            width="140"
            height="140"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="4.5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
              result="goo"
            />
          </filter>
        </defs>

        {/* Las 9 marcas fijas de la grilla (tenues). */}
        <g fill="var(--foreground)" opacity="0.14">
          <circle cx="30" cy="30" r="6" />
          <circle cx="60" cy="30" r="6" />
          <circle cx="90" cy="30" r="6" />
          <circle cx="30" cy="60" r="6" />
          <circle cx="60" cy="60" r="6" />
          <circle cx="90" cy="60" r="6" />
          <circle cx="30" cy="90" r="6" />
          <circle cx="60" cy="90" r="6" />
          <circle cx="90" cy="90" r="6" />
        </g>

        {/* La gota con cola. cx/cy animados (SMIL) → el filtro se re-evalúa siempre. */}
        <g filter="url(#chat-goo)" fill="var(--foreground)">
          {BLOBS.map((blob, i) => (
            <circle key={i} cx="30" cy="30" r={blob.r}>
              <animate
                attributeName="cx"
                dur={DUR}
                begin={blob.begin}
                repeatCount="indefinite"
                calcMode="spline"
                keyTimes={KEY_TIMES}
                keySplines={KEY_SPLINES}
                values={CX}
              />
              <animate
                attributeName="cy"
                dur={DUR}
                begin={blob.begin}
                repeatCount="indefinite"
                calcMode="spline"
                keyTimes={KEY_TIMES}
                keySplines={KEY_SPLINES}
                values={CY}
              />
            </circle>
          ))}
        </g>
      </svg>
    </div>
  );
}
