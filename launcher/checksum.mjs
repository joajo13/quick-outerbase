// Verificación de integridad del bundle (cadena de confianza de quick-outerbase).
//
// El runtime (server.js standalone) viaja por GitHub Releases, un canal SIN firmar.
// El paquete npm, en cambio, está firmado por npm. Para atar los dos mundos, el CI
// embebe `checksums.json` (sha256 de cada bundle) DENTRO del paquete npm firmado.
// El launcher lee ese JSON local y verifica el .tar.gz descargado ANTES de extraer.
// Si alguien altera el asset del Release, el sha256 no matchea y abortamos.
//
// Cero dependencias de runtime: solo `node:crypto` y `node:fs`.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** sha256 hex de un archivo (lectura completa a memoria; los bundles son ~28 MB). */
export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Carga y parsea el mapa { "<plat>-<arch>": "<sha256hex>" } desde checksums.json. */
export function loadExpected(checksumsPath) {
  return JSON.parse(readFileSync(checksumsPath, "utf8"));
}

/**
 * Verifica que el bundle `file` coincida con el checksum esperado para `target`.
 * Lanza Error (con mensaje claro) si falta el checksum o no matchea.
 * Devuelve el sha256 calculado si todo OK.
 */
export function verifyBundleChecksum(file, target, expected) {
  const want = expected && expected[target];
  if (!want) {
    throw new Error(
      `No tengo checksum esperado para "${target}" en checksums.json. ` +
        "Aborto por seguridad (no puedo verificar la integridad del runtime)."
    );
  }
  const got = sha256File(file);
  if (got !== want) {
    throw new Error(
      `El runtime descargado NO coincide con el checksum esperado (${target}).\n` +
        `  esperado=${want}\n` +
        `  obtenido=${got}\n` +
        "Abortado por seguridad: el bundle pudo ser alterado o corromperse en la descarga."
    );
  }
  return got;
}
