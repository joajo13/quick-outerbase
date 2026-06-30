// Genera 3 prompts sugeridos para el estado vacío del chat. Dinámicas a partir de los
// nombres de tabla del schema actual; si no hay tablas (schema vacío o sin cargar), cae
// a 3 prompts genéricos. Pura → testeable sin React ni schema real.
export function buildChatSuggestions(tableNames: string[]): string[] {
  if (tableNames.length === 0) {
    return [
      "¿Qué tablas tiene mi base?",
      "Generá un SELECT de ejemplo",
      "Explicame el schema de mi base",
    ];
  }

  const [t0, t1] = tableNames;
  return [
    `Mostrame las primeras 10 filas de ${t0}`,
    `¿Cuántos registros hay en ${t1 ?? t0}?`,
    t1 ? `Relacioná ${t0} con ${t1}` : `Describime la estructura de ${t0}`,
  ];
}
