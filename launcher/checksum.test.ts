/**
 * Test de seguridad C1: la verificación de integridad del bundle.
 *
 * Ejercita el path de verificación SIN depender de un Release real: arma .tar.gz
 * locales y un mapa de checksums de prueba, y comprueba que:
 *   - ACEPTA un bundle cuyo sha256 matchea el esperado (positivo)
 *   - RECHAZA un bundle alterado (negativo → tira Error)
 *   - RECHAZA si no hay checksum esperado para el target (fail-closed)
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { sha256File, verifyBundleChecksum, loadExpected } from "./checksum.mjs";

const sha256 = (buf: Buffer) =>
  createHash("sha256").update(buf).digest("hex");

describe("C1 — verificación de integridad del bundle", () => {
  let dir: string;
  let goodBundle: string;
  let tamperedBundle: string;
  const goodBytes = Buffer.from("contenido del runtime legitimo v0.5.0");
  const tamperedBytes = Buffer.from("contenido del runtime ALTERADO por un atacante");

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "qob-checksum-"));
    goodBundle = path.join(dir, "good.tar.gz");
    tamperedBundle = path.join(dir, "tampered.tar.gz");
    writeFileSync(goodBundle, goodBytes);
    writeFileSync(tamperedBundle, tamperedBytes);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sha256File calcula el digest correcto y es determinístico", () => {
    const expected = sha256(goodBytes);
    expect(sha256File(goodBundle)).toBe(expected);
    expect(sha256File(goodBundle)).toBe(sha256File(goodBundle));
  });

  it("ACEPTA un bundle cuyo checksum matchea (positivo)", () => {
    const expected = { "win32-x64": sha256(goodBytes) };
    expect(() =>
      verifyBundleChecksum(goodBundle, "win32-x64", expected)
    ).not.toThrow();
    expect(verifyBundleChecksum(goodBundle, "win32-x64", expected)).toBe(
      sha256(goodBytes)
    );
  });

  it("RECHAZA un bundle alterado (negativo)", () => {
    // El mapa dice el sha del bundle bueno, pero le pasamos el alterado.
    const expected = { "win32-x64": sha256(goodBytes) };
    expect(() =>
      verifyBundleChecksum(tamperedBundle, "win32-x64", expected)
    ).toThrow(/no coincide con el checksum esperado/i);
  });

  it("RECHAZA si falta el checksum para el target (fail-closed)", () => {
    const expected = { "linux-x64": sha256(goodBytes) };
    expect(() =>
      verifyBundleChecksum(goodBundle, "win32-x64", expected)
    ).toThrow(/no tengo checksum esperado/i);
  });

  it("RECHAZA con mapa vacío o nulo (fail-closed)", () => {
    expect(() => verifyBundleChecksum(goodBundle, "win32-x64", {})).toThrow();
    expect(() =>
      verifyBundleChecksum(goodBundle, "win32-x64", null as never)
    ).toThrow();
  });

  it("loadExpected parsea un checksums.json bien formado", () => {
    const p = path.join(dir, "checksums.json");
    const map = { "win32-x64": sha256(goodBytes), "linux-x64": sha256(tamperedBytes) };
    writeFileSync(p, JSON.stringify(map));
    const loaded = loadExpected(p);
    expect(loaded).toEqual(map);
    // round-trip: el bundle bueno verifica contra el JSON cargado
    expect(() =>
      verifyBundleChecksum(goodBundle, "win32-x64", loaded)
    ).not.toThrow();
    expect(readFileSync(p, "utf8")).toContain("win32-x64");
  });
});
