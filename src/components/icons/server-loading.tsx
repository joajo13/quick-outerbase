import { cn } from "@/lib/utils";

// Loader "circulación líquida": una database con dos unidades apiladas y gotas
// gooey (metaball) que bajan por un carril (izquierda) y suben por el otro
// (derecha), entrando y saliendo de cada unidad.
//
// POR QUÉ SMIL Y NO CSS @keyframes (dos motivos, ambos a propósito):
//
// 1) Bug del filtro cacheado: animar el `transform` (CSS) de los <circle> que son
//    hijos de un <g> con filtro SVG hace que varios motores cacheen el resultado
//    del filtro y NO lo re-pinten — el DOM se mueve pero el píxel queda congelado.
//    Animar la GEOMETRÍA (cy/r) modifica el SourceGraphic del filtro → fuerza su
//    re-evaluación en cada frame, en TODOS los navegadores. (Mismo criterio que
//    chat-shimmer.tsx, donde ya nos comimos este bug.)
//
// 2) prefers-reduced-motion: SMIL <animate> NO está afectado por la media query de
//    CSS, así que la animación SIEMPRE corre aunque el usuario tenga "reduce"
//    activado. Es un indicador de carga (contenido esencial que comunica "estoy
//    conectando"), no decoración. Es la forma robusta de FORZARLA sin depender de
//    que ningún reset global la apague.

const DUR = "1.6s";
// keyTimes/keySplines equivalentes al ease-in-out del diseño original (0%,12%,88%,100%).
const KEY_TIMES = "0;0.12;0.88;1";
const KEY_SPLINES = ["0.42 0 0.58 1", "0.42 0 0.58 1", "0.42 0 0.58 1"].join(";");
// La gota nace a escala 0.25 (r≈1.5) desde el blob fuente, crece a r6 mientras viaja
// y vuelve a 1.5 al fundirse en el blob destino → con el filtro goo da el pinch líquido.
const R_VALUES = "1.5;6;6;1.5";
// 3 gotas por carril, desfasadas un tercio del ciclo. begin NEGATIVO → el carril ya
// arranca poblado en el frame 0 (la animación nació "en el pasado").
const BEGINS = ["0s", "-0.53s", "-1.06s"];

export default function ServerLoadingAnimation({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      className={cn("h-44 w-auto", className)}
      viewBox="0 0 200 170"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <symbol id="db-unit" viewBox="0 0 76 30" width="76" height="30">
          <rect x="0.5" y="0.5" width="75" height="29" rx="7" fill="var(--muted)" />
          <rect
            x="6"
            y="5"
            width="64"
            height="20"
            rx="4"
            fill="var(--card)"
            stroke="var(--border)"
          />
          <rect x="12" y="10" width="26" height="3.2" rx="1.6" fill="var(--muted-foreground)" />
          <rect
            x="12"
            y="17"
            width="16"
            height="3.2"
            rx="1.6"
            fill="var(--muted-foreground)"
            opacity="0.5"
          />
          <rect x="50" y="10" width="3" height="10" rx="1.5" fill="var(--muted-foreground)" />
          <rect x="56" y="10" width="3" height="10" rx="1.5" fill="var(--muted-foreground)" />
          <rect x="62" y="10" width="3" height="10" rx="1.5" fill="var(--muted-foreground)" />
        </symbol>

        {/* Filtro metaball: blur + umbral en el alpha (feColorMatrix) → las gotas se
            funden entre sí y con los blobs fuente. Región amplia para no recortar. */}
        <filter id="db-goo" x="-60%" y="-20%" width="220%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3.5" result="b" />
          <feColorMatrix
            in="b"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
          />
        </filter>
      </defs>

      {/* Dos unidades de servidor apiladas. */}
      <use href="#db-unit" x="62" y="28" />
      <use href="#db-unit" x="62" y="112" />

      <g filter="url(#db-goo)" fill="var(--foreground)">
        {/* Blobs fuente fijos: anclan el líquido en el borde de cada unidad para que
            las gotas parezcan nacer/fundirse ahí. */}
        <circle cx="90" cy="58" r="5.5" />
        <circle cx="90" cy="112" r="5.5" />
        <circle cx="110" cy="58" r="5.5" />
        <circle cx="110" cy="112" r="5.5" />

        {/* Carril izquierdo (cx=90): bajan de la unidad de arriba a la de abajo. */}
        {BEGINS.map((begin, i) => (
          <circle key={`dn-${i}`} cx="90" cy="58" r="1.5">
            <animate
              attributeName="cy"
              dur={DUR}
              begin={begin}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes={KEY_TIMES}
              keySplines={KEY_SPLINES}
              values="58;64;106;112"
            />
            <animate
              attributeName="r"
              dur={DUR}
              begin={begin}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes={KEY_TIMES}
              keySplines={KEY_SPLINES}
              values={R_VALUES}
            />
          </circle>
        ))}

        {/* Carril derecho (cx=110): suben de la unidad de abajo a la de arriba. */}
        {BEGINS.map((begin, i) => (
          <circle key={`up-${i}`} cx="110" cy="112" r="1.5">
            <animate
              attributeName="cy"
              dur={DUR}
              begin={begin}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes={KEY_TIMES}
              keySplines={KEY_SPLINES}
              values="112;106;64;58"
            />
            <animate
              attributeName="r"
              dur={DUR}
              begin={begin}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes={KEY_TIMES}
              keySplines={KEY_SPLINES}
              values={R_VALUES}
            />
          </circle>
        ))}
      </g>
    </svg>
  );
}
