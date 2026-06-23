#!/usr/bin/env node
// Launcher fino de quick-outerbase (publicado en npm como `quick-outerbase`).
// NO buildea ni trae dependencias pesadas: detecta tu plataforma, baja UNA vez
// el bundle `standalone` precompilado desde GitHub Releases, lo cachea y corre
// `node server.js`. Primer run: ~descarga + arranque (segundos). Siguientes:
// instantáneo (cacheado por versión+plataforma).
//
// Uso: npx quick-outerbase --url "postgresql://user:pass@host:5432/db?schema=public"
//      (o posicional, o env DATABASE_URL). Flags: --port, --no-open.
//
// Override para testing/offline: QUICK_OUTERBASE_BUNDLE=/ruta/a/bundle.tar.gz
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadExpected, verifyBundleChecksum } from "./checksum.mjs";
import { extractTarGz } from "./extract.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = require("./package.json");
const VERSION = pkg.version;
const REPO = "joajo13/quick-outerbase";
const isWin = process.platform === "win32";

function fail(msg) {
  console.error("\x1b[31m" + msg + "\x1b[0m");
  process.exit(1);
}

// --- Guard de versión de Node (el server.js standalone necesita Node 20.9+) ---
{
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 20 || (maj === 20 && min < 9)) {
    fail(`Necesitás Node 20.9+ (tenés ${process.versions.node}). Actualizá Node y reintentá.`);
  }
}

// --- Parseo de argumentos (mismo contrato que el comando original) ---
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function positionalUrl() {
  return process.argv
    .slice(2)
    .find((a) =>
      /^(postgres|postgresql|mysql|mariadb|sqlite|file|libsql|dynamodb):/i.test(a)
    );
}
const url = getArg("--url") || positionalUrl() || process.env.DATABASE_URL;
const port = getArg("--port") || process.env.PORT || "3008";
const noOpen = process.argv.includes("--no-open");

if (!url) {
  fail(
    "Falta DATABASE_URL. Pasalo con --url <connection-string> o por la env DATABASE_URL.\n" +
      'Ej: npx quick-outerbase --url "postgresql://user:pass@localhost:5432/db?schema=public"'
  );
}

// --- Validación del motor por el scheme ---
const scheme = (url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1]?.toLowerCase();
const SUPPORTED = new Set([
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "file",
  "libsql",
  "dynamodb",
]);
if (!scheme || !SUPPORTED.has(scheme)) {
  fail(
    `Scheme no reconocido: "${scheme || "(ninguno)"}". ` +
      "Motores soportados: postgres://, postgresql://, mysql://, sqlite:/file:, libsql://, dynamodb://<region>"
  );
}

// DynamoDB: la URL lleva SOLO región (+endpoint opcional). Las credenciales NO van
// en la URL: las resuelve el server standalone desde la cadena estándar de AWS
// (env AWS_ACCESS_KEY_ID/SECRET/SESSION_TOKEN, ~/.aws/credentials o IAM role),
// que el launcher deja pasar al server vía la whitelist AWS_* (ver buildChildEnv).
if (scheme === "dynamodb") {
  const hasEnvCreds =
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
  if (!hasEnvCreds) {
    console.warn(
      "\x1b[33m⚠ DynamoDB: no detecté credenciales AWS en el entorno. Si no usás un perfil " +
        "(~/.aws/credentials) ni un IAM role, seteá AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY antes de correr.\x1b[0m"
    );
  }
}

// --- SQLite: resolver path relativo contra el cwd del USUARIO (no el cache) y
//     pasar a libsql una URL file: absoluta (anda en Windows). ---
const userCwd = process.cwd();
function normalizeDbUrl(raw) {
  const m = raw.match(/^(sqlite|file):(.*)$/i);
  if (!m) return raw;
  const p = m[2].replace(/^\/\//, "");
  if (!p) return raw;
  const isAbs = path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p);
  const abs = isAbs ? p : path.resolve(userCwd, p);
  return "file:" + abs.split("\\").join("/");
}
const runUrl = normalizeDbUrl(url);
const redacted = url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
console.log(`▶ quick-outerbase v${VERSION} → ${scheme} (${redacted})`);

// --- Plataforma → nombre del asset del release ---
const ARCH = process.arch; // x64 | arm64
const PLAT = process.platform; // win32 | linux | darwin
// Bundles precompilados: solo Linux y Windows. macOS quedó fuera a propósito
// (los runners de macOS alargan mucho el CI). En Mac, corré desde el código.
const SUPPORTED_TARGETS = new Set(["win32-x64", "linux-x64"]);
const target = `${PLAT}-${ARCH}`;
if (!SUPPORTED_TARGETS.has(target)) {
  fail(
    `No hay bundle precompilado para tu plataforma (${target}).\n` +
      "Soportadas: win32-x64, linux-x64.\n" +
      "Alternativa: corré desde el código con `npx github:" + REPO + "`."
  );
}
const assetName = `quick-outerbase-${target}.tar.gz`;
const assetUrl = `https://github.com/${REPO}/releases/download/v${VERSION}/${assetName}`;

// --- Cache por versión+plataforma ---
const cacheRoot =
  process.env.QUICK_OUTERBASE_CACHE ||
  path.join(os.homedir() || os.tmpdir(), ".cache", "quick-outerbase");
const bundleDir = path.join(cacheRoot, `${VERSION}-${target}`);
const serverJs = path.join(bundleDir, "server.js");

async function ensureBundle() {
  if (existsSync(serverJs)) return; // ya cacheado
  mkdirSync(bundleDir, { recursive: true });
  const innerTgz = path.join(bundleDir, "_bundle.tar.gz");

  const localOverride = process.env.QUICK_OUTERBASE_BUNDLE;
  if (localOverride) {
    // Canal de testing/offline: confiás en TU bundle local, se saltea la verificación.
    if (!existsSync(localOverride)) fail(`QUICK_OUTERBASE_BUNDLE no existe: ${localOverride}`);
    copyFileSync(localOverride, innerTgz);
  } else {
    await download(assetUrl, innerTgz);
    // --- Cadena de confianza (C1): verificar el sha256 del bundle ANTES de extraer.
    // checksums.json viaja DENTRO del paquete npm firmado; el bundle viene de un
    // Release sin firmar. Si no matchea, abortamos y borramos el tgz corrupto.
    let expected;
    try {
      expected = loadExpected(path.join(__dirname, "checksums.json"));
    } catch {
      rmSync(innerTgz, { force: true });
      fail(
        "No encontré checksums.json en el paquete: no puedo verificar la integridad del runtime.\n" +
          "Reinstalá quick-outerbase desde npm (npm i -g quick-outerbase@latest o npx -y quick-outerbase@latest)."
      );
    }
    try {
      verifyBundleChecksum(innerTgz, target, expected);
    } catch (e) {
      rmSync(innerTgz, { force: true });
      fail(e.message);
    }
  }
  // Extracción in-process (gunzip + parser ustar propio): sin depender del
  // binario `tar` del PATH. Rechaza path traversal y links que escapen del dir.
  try {
    extractTarGz(innerTgz, bundleDir);
  } catch (e) {
    // Borramos TODO el bundleDir, no solo el tgz: una extracción a medias deja
    // server.js escrito (va al principio del tar) y el próximo run cortocircuitaría
    // en existsSync(serverJs) sobre un árbol incompleto → server roto que no se
    // autocura. rmSync recursivo también se lleva el innerTgz.
    rmSync(bundleDir, { recursive: true, force: true });
    fail("Falló la extracción del bundle: " + (e?.message || e));
  }
  try {
    rmSync(innerTgz, { force: true });
  } catch {
    /* noop */
  }
}

async function download(fromUrl, toFile) {
  let res;
  try {
    res = await fetch(fromUrl, { redirect: "follow" });
  } catch (e) {
    fail(`No pude descargar el runtime (${fromUrl}): ${e.message}`);
  }
  if (!res.ok) {
    fail(
      `No pude descargar el runtime (HTTP ${res.status}) de:\n  ${fromUrl}\n` +
        `¿Existe el release v${VERSION} con el asset ${assetName}?`
    );
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(toFile));
}

// --- Subset whitelisteado de env para el server (A2: defensa en profundidad) ---
// El runtime corre en otro proceso; no tiene por qué heredar TODO process.env (que
// puede traer tokens de CI, claves de otros servicios, etc.). Pasamos solo lo que el
// server standalone, Node/Next y el AWS SDK necesitan. OJO: NO movemos la resolución
// de credenciales acá; solo dejamos pasar las AWS_* para que el server (proxy) las
// resuelva server-side como hasta ahora (autoconnect de dynamodb:// intacto).
function buildChildEnv() {
  // Match case-insensitive: en Windows las claves vienen con case impredecible.
  const PREFIXES = ["AWS_", "NODE_", "NEXT_", "NPM_", "UV_"];
  const EXACT = new Set([
    // PATH / home / temp — Node y cualquier spawn del runtime los necesitan
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "PWD",
    // locale / timezone
    "LANG", "LC_ALL", "LC_CTYPE", "TZ",
    // Windows: imprescindibles para que Node y las DLLs del sistema resuelvan
    "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE",
    "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES",
    "USERPROFILE", "USERNAME", "USERDOMAIN", "HOMEDRIVE", "HOMEPATH",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
    // red / proxy / TLS — para que el AWS SDK salga a internet (incluido detrás de proxy)
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
    // app: lo que el server standalone lee de su propio entorno
    "DATABASE_AUTH_TOKEN", "BASE_URL",
  ]);
  const out = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    const up = k.toUpperCase();
    if (EXACT.has(up) || PREFIXES.some((p) => up.startsWith(p))) out[k] = v;
  }
  return out;
}

// --- Arranque del server standalone + teardown limpio ---
async function main() {
  await ensureBundle();
  if (!existsSync(serverJs)) fail(`No encontré server.js en ${bundleDir} tras extraer.`);

  const child = spawn(process.execPath, [serverJs], {
    cwd: bundleDir,
    stdio: "inherit",
    env: {
      ...buildChildEnv(),
      // El launcher fija estos explícitamente (pisan cualquier valor heredado):
      DATABASE_URL: runUrl,
      PORT: String(port),
      HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
      FORK_LOCAL: "1",
    },
  });

  let tearingDown = false;
  function teardown(code = 0) {
    if (tearingDown) return;
    tearingDown = true;
    console.log("\n• Cerrando…");
    try {
      if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(child.pid, "SIGTERM");
    } catch {
      /* ya muerto */
    }
    if (isWin) {
      try {
        const out = spawnSync("netstat", ["-ano"], { encoding: "utf8" }).stdout || "";
        const pids = new Set();
        for (const line of out.split(/\r?\n/)) {
          if (line.includes(":" + port + " ") && /LISTENING/i.test(line)) {
            const pid = line.trim().split(/\s+/).pop();
            if (pid && /^\d+$/.test(pid)) pids.add(pid);
          }
        }
        for (const pid of pids) spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* best-effort */
      }
    }
    console.log("• Listo. Puerto liberado, sin procesos zombie.");
    process.exit(code);
  }
  process.on("SIGINT", () => teardown(0));
  process.on("SIGTERM", () => teardown(0));
  child.on("exit", (code) => {
    if (!tearingDown) teardown(code ?? 0);
  });

  if (!noOpen) {
    const targetUrl = `http://localhost:${port}/env`;
    const started = Date.now();
    // Puede haber varios requests del poll en vuelo a la vez (el server tarda más
    // que el intervalo en responder el primero). Sin este guard, dos respuestas OK
    // abrían el navegador dos veces. `opened` asegura una sola apertura.
    let opened = false;
    const poll = setInterval(() => {
      if (tearingDown) return clearInterval(poll);
      const req = http.get(
        { host: "localhost", port: Number(port), path: "/env", timeout: 2000 },
        (res) => {
          res.destroy();
          clearInterval(poll);
          if (opened) return;
          opened = true;
          console.log(`✔ Listo en ${targetUrl}`);
          openBrowser(targetUrl);
        }
      );
      req.on("error", () => {
        if (Date.now() - started > 60000) {
          clearInterval(poll);
          console.warn("No confirmé el arranque; abrí manualmente " + targetUrl);
        }
      });
      req.on("timeout", () => req.destroy());
    }, 800);
  }
}

function openBrowser(u) {
  try {
    if (isWin) spawn("cmd", ["/c", "start", "", u], { stdio: "ignore", detached: true });
    else if (process.platform === "darwin") spawn("open", [u], { stdio: "ignore", detached: true });
    else spawn("xdg-open", [u], { stdio: "ignore", detached: true });
  } catch {
    /* sin browser, no es fatal */
  }
}

main().catch((e) => fail("Error: " + (e?.message || e)));
