/**
 * Test de B1: extracción in-process del bundle (gunzip + parser ustar propio),
 * el reemplazo del viejo `tar -xzf` que dependía del binario del PATH.
 *
 * Arma tarballs en memoria (sin depender del `tar` del sistema) y comprueba que:
 *   - parsea y extrae archivos regulares y directorios (round-trip de contenido)
 *   - resuelve nombres largos vía GNU longname ('L') y vía prefix ustar
 *   - RECHAZA path traversal (../) — defensa contra tarballs maliciosos
 *   - RECHAZA symlinks que escapan del directorio destino
 *   - RECHAZA un header corrupto / no-tar
 *   - RECHAZA un .gz inválido
 */
import { gzipSync } from "node:zlib";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseTar, extractTarGz, extractEntries } from "./extract.mjs";

const BLOCK = 512;
const isWin = process.platform === "win32";

// --- Mini-builder de tar ustar en memoria (para fixtures sin `tar` del sistema) ---
function octalField(value: number, len: number): string {
  return value.toString(8).padStart(len - 1, "0") + "\0";
}

interface EntryOpts {
  name: string;
  size?: number;
  type?: string;
  mode?: number;
  linkname?: string;
  prefix?: string;
}

function makeHeader(opts: EntryOpts): Buffer {
  const { name, size = 0, type = "0", mode = 0o644, linkname = "", prefix = "" } = opts;
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 100, "utf8");
  h.write(octalField(mode, 8), 100, "ascii");
  h.write(octalField(0, 8), 108, "ascii"); // uid
  h.write(octalField(0, 8), 116, "ascii"); // gid
  h.write(octalField(size, 12), 124, "ascii");
  h.write(octalField(0, 12), 136, "ascii"); // mtime
  h.write(type, 156, "ascii");
  if (linkname) h.write(linkname, 157, 100, "utf8");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  if (prefix) h.write(prefix, 345, 155, "utf8");
  // checksum: campo (148-155) como espacios, sumar, y escribir "NNNNNN\0 "
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function makeData(data: Buffer): Buffer {
  const padded = Math.ceil(data.length / BLOCK) * BLOCK;
  const b = Buffer.alloc(padded);
  data.copy(b);
  return b;
}

function makeTar(entries: Array<EntryOpts & { data?: Buffer }>): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const size = e.data ? e.data.length : e.size ?? 0;
    blocks.push(makeHeader({ ...e, size }));
    if (e.data) blocks.push(makeData(e.data));
  }
  blocks.push(Buffer.alloc(BLOCK * 2)); // dos bloques cero = fin
  return Buffer.concat(blocks);
}

function makeTarGz(entries: Array<EntryOpts & { data?: Buffer }>): Buffer {
  return gzipSync(makeTar(entries));
}

describe("B1 — extracción in-process del bundle", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "qob-extract-"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parsea archivos regulares y directorios", () => {
    const entries = parseTar(
      makeTar([
        { name: "app/", type: "5" },
        { name: "app/server.js", data: Buffer.from("console.log(1)") },
      ])
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("5");
    expect(entries[1].name).toBe("app/server.js");
    expect(entries[1].data?.toString()).toBe("console.log(1)");
  });

  it("extrae a disco con el contenido intacto (round-trip)", () => {
    const dest = path.join(dir, "rt");
    const serverBytes = Buffer.from("// server\nmodule.exports = 42;\n");
    const written = extractTarGz(
      makeTarGzPath(dest, [
        { name: "./", type: "5" },
        { name: "./server.js", data: serverBytes },
        { name: "./.next/", type: "5" },
        { name: "./.next/chunk.js", data: Buffer.from("var x = 1;") },
      ]),
      dest
    );
    expect(written).toBe(2); // 2 archivos (los dirs no cuentan)
    expect(readFileSync(path.join(dest, "server.js"))).toEqual(serverBytes);
    expect(readFileSync(path.join(dest, ".next/chunk.js")).toString()).toBe("var x = 1;");
  });

  it("crea directorios padre faltantes aunque no haya entry de dir", () => {
    const dest = path.join(dir, "nodir");
    extractTarGz(
      makeTarGzPath(dest, [
        { name: "deep/nested/path/file.txt", data: Buffer.from("hola") },
      ]),
      dest
    );
    expect(readFileSync(path.join(dest, "deep/nested/path/file.txt")).toString()).toBe("hola");
  });

  it("resuelve nombres largos vía GNU longname ('L')", () => {
    const longPath = "node_modules/" + "a".repeat(120) + "/index.js";
    const entries = parseTar(
      makeTar([
        { name: "././@LongLink", type: "L", data: Buffer.from(longPath + "\0") },
        { name: "node_modules/aaaa-truncado/index.js", data: Buffer.from("X") },
      ])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(longPath);
  });

  it("resuelve nombres largos vía prefix ustar", () => {
    const entries = parseTar(
      makeTar([{ name: "index.js", prefix: "a/very/long/prefix/dir", data: Buffer.from("Y") }])
    );
    expect(entries[0].name).toBe("a/very/long/prefix/dir/index.js");
  });

  it("RECHAZA path traversal con '..' (no escribe fuera del destino)", () => {
    const dest = path.join(dir, "trav");
    expect(() =>
      extractEntries(
        [{ name: "../evil.txt", type: "0", mode: 0o644, size: 4, linkname: "", data: Buffer.from("evil") }],
        dest
      )
    ).toThrow(/traversal/i);
    expect(existsSync(path.join(dir, "evil.txt"))).toBe(false);
  });

  it("RECHAZA un nombre con path absoluto que escapa del destino", () => {
    const dest = path.join(dir, "abs");
    const outside = isWin ? "C:/Windows/evil.txt" : "/tmp/qob-evil-absolute.txt";
    expect(() =>
      extractEntries(
        [{ name: outside, type: "0", mode: 0o644, size: 1, linkname: "", data: Buffer.from("x") }],
        dest
      )
    ).toThrow(/traversal/i);
  });

  it("RECHAZA un symlink que apunta fuera del destino", () => {
    const dest = path.join(dir, "sym");
    expect(() =>
      extractEntries(
        [{ name: "link", type: "2", mode: 0o777, size: 0, linkname: "../../etc/passwd", data: null }],
        dest
      )
    ).toThrow(/escapa/i);
  });

  it("acepta un symlink relativo que queda dentro del destino", () => {
    const dest = path.join(dir, "sym-ok");
    // link en sub/ que apunta a ../target.txt → dest/target.txt (dentro). No tira.
    expect(() =>
      extractEntries(
        [
          { name: "target.txt", type: "0", mode: 0o644, size: 2, linkname: "", data: Buffer.from("ok") },
          { name: "sub/link", type: "2", mode: 0o777, size: 0, linkname: "../target.txt", data: null },
        ],
        dest
      )
    ).not.toThrow();
    // En Windows symlinkSync puede no tener permisos: ahí solo exigimos que no tire.
    if (!isWin) {
      expect(lstatSync(path.join(dest, "sub/link")).isSymbolicLink()).toBe(true);
    }
  });

  it("RECHAZA un PAX header con size negativo (bundle malicioso)", () => {
    // Record PAX "11 size=-4\n" (11 chars exactos) → size negativo inyectado.
    expect(() =>
      parseTar(
        makeTar([
          { name: "PaxHeader", type: "x", data: Buffer.from("11 size=-4\n") },
          { name: "file.txt", data: Buffer.from("data") },
        ])
      )
    ).toThrow(/PAX inválido|negativo/i);
  });

  it("RECHAZA un header corrupto / que no es un tar", () => {
    const garbage = Buffer.alloc(BLOCK, 0xff); // no es bloque cero ni header válido
    expect(() => parseTar(garbage)).toThrow(/checksum|corrupto|tar/i);
  });

  it("RECHAZA un .gz inválido", () => {
    const dest = path.join(dir, "badgz");
    const p = path.join(dir, "bad.tar.gz");
    writeFileSync(p, Buffer.from("esto no es gzip"));
    expect(() => extractTarGz(p, dest)).toThrow(/gzip/i);
  });

  // Helper: arma un .tar.gz en disco y devuelve su path.
  function makeTarGzPath(forDest: string, entries: Array<EntryOpts & { data?: Buffer }>): string {
    const p = forDest + ".tar.gz";
    writeFileSync(p, makeTarGz(entries));
    return p;
  }
});
