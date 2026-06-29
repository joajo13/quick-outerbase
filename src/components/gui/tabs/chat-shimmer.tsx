"use client";
import { Sparkle } from "@phosphor-icons/react";

// Loader estilo Gemini: un sparkle que pulsa + un texto con gradiente que barre
// (shimmer sweep). Se muestra mientras el stream todavía no emitió texto; el chat
// tab le pasa label="Razonando…" cuando llega reasoning. CSS puro (background-position
// animado) inline para que el componente sea autocontenido — sin tocar globals.css.
export default function ChatShimmer({
  label = "Generando…",
}: {
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <Sparkle className="h-4 w-4 animate-pulse opacity-80" weight="fill" />
      <span className="chat-shimmer-text text-sm font-medium">{label}</span>
      <style>{`
        .chat-shimmer-text {
          background: linear-gradient(
            90deg,
            var(--muted-foreground) 0%,
            var(--foreground) 50%,
            var(--muted-foreground) 100%
          );
          background-size: 200% auto;
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: chat-shimmer-sweep 1.4s linear infinite;
        }
        @keyframes chat-shimmer-sweep {
          to {
            background-position: -200% center;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .chat-shimmer-text {
            animation: none;
            color: var(--muted-foreground);
            -webkit-text-fill-color: currentColor;
          }
        }
      `}</style>
    </div>
  );
}
