"use client";

import { ThemeProvider } from "next-themes";
import { PropsWithChildren } from "react";

/**
 * Provider de tema para todo el grupo (theme) — incluye /env (el Studio).
 *
 * Sin esto, useTheme()/setTheme() no tienen contexto: el toggle de tema no
 * persiste ni aplica la clase `.dark`, y el editor SQL cae siempre a la rama
 * por defecto. Montamos SOLO el ThemeProvider (TooltipProvider ya vive en
 * main-connection; Toaster/PageTracker no van acá para no duplicarlos).
 *
 * `attribute="class"` => la clase `.dark` se aplica en <html> (por eso el
 * RootLayout tiene suppressHydrationWarning). defaultTheme="light" mantiene el
 * arranque claro de siempre; enableSystem habilita la opción "System" del toggle.
 */
export default function ThemeGroupLayout({ children }: PropsWithChildren) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      enableColorScheme
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
