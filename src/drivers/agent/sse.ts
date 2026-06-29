// Parser mínimo de Server-Sent Events sobre un ReadableStream de fetch.
// Lo usan los queryStream() de cada provider (OpenAI/Anthropic/Gemini): los tres
// mandan payloads de una sola línea `data: ...` por evento, así que alcanza con
// ir cortando por '\n' y procesar las líneas `data:` completas. No metemos
// dependencias nuevas (la consigna es no sumar libs): TextDecoder + getReader().

export type SSEDataHandler = (
  data: string
) => void | "stop" | Promise<void | "stop">;

/**
 * Lee el stream SSE y llama a onData con el contenido de cada línea `data:`
 * (ya sin el prefijo). Ignora líneas `event:`, comentarios `:` y líneas vacías.
 * Si onData devuelve "stop" (p.ej. al ver `[DONE]`), corta y libera el reader.
 *
 * Es resiliente a chunks partidos: acumula en un buffer y solo procesa hasta el
 * último '\n' completo; lo que queda sin newline espera al próximo chunk.
 */
export async function readSSEStream(
  stream: ReadableStream<Uint8Array>,
  onData: SSEDataHandler
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nlIndex: number;
      while ((nlIndex = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, nlIndex);
        buffer = buffer.slice(nlIndex + 1);

        const signal = await handleLine(rawLine, onData);
        if (signal === "stop") return;
      }
    }

    // Flush final: por si el stream cerró sin un '\n' al final de la última línea.
    if (buffer.length > 0) {
      await handleLine(buffer, onData);
    }
  } catch (err) {
    // Path de error (p.ej. el callback tira ante un evento "error" del provider):
    // cancelamos el body para no dejar la conexión colgada antes de re-lanzar.
    try {
      await reader.cancel();
    } catch {
      // el stream ya pudo haberse cerrado: lo ignoramos
    }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Lee el cuerpo de error de una respuesta de streaming fallida y devuelve un
 * mensaje legible. Los providers mandan el error como JSON {error:{message}} antes
 * de abrir el stream; si no se puede leer, cae al status HTTP. Compartido por los
 * queryStream() de los tres providers.
 */
export async function readStreamError(
  response: Response,
  provider: string
): Promise<string> {
  try {
    const raw = await response.text();
    if (raw) {
      try {
        const json = JSON.parse(raw);
        const message = json?.error?.message ?? json?.message;
        if (message) return message;
      } catch {
        // no era JSON: devolvemos el texto crudo recortado
        return raw.slice(0, 300);
      }
    }
  } catch {
    // ignoramos y caemos al status
  }
  return `${provider} respondió ${response.status} ${response.statusText}`.trim();
}

async function handleLine(
  rawLine: string,
  onData: SSEDataHandler
): Promise<void | "stop"> {
  // Normalizamos CRLF y espacios al final de línea.
  const line = rawLine.replace(/\r$/, "");
  if (!line.startsWith("data:")) return; // ignoramos event:/comentarios/vacías

  // `data:foo` y `data: foo` son equivalentes en SSE: el primer espacio opcional
  // tras los dos puntos no es parte del dato.
  const data = line.slice(5).replace(/^ /, "");
  if (!data) return;

  return await onData(data);
}
