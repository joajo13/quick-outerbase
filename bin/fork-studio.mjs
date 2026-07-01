#!/usr/bin/env node
// Comando único: toma un DATABASE_URL, instala lo que falte, levanta la app
// (build de producción) apuntada a esa base y abre el browser. Al cortar
// (Ctrl+C / SIGINT) hace teardown limpio: mata el árbol de procesos, libera
// el puerto y, si se usó, baja el contenedor de prueba.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const isWin = process.platform === "win32";

// Guard de versión: Next 15 + React 19 necesitan Node 20.9+. Fallar temprano y claro
// (en vez de reventar adentro de next build con un error críptico).
{
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 20 || (maj === 20 && min < 9)) {
    console.error(
      `\x1b[31mYou need Node 20.9+ to run this (you have ${process.versions.node}). ` +
        "Please update Node and try again.\x1b[0m"
    );
    process.exit(1);
  }
}

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// El URL puede venir como --url <url>, como argumento posicional
// (npm a veces se come el --url al usar `npm run studio -- --url ...`),
// o por la variable de entorno DATABASE_URL.
function positionalUrl() {
  return process.argv
    .slice(2)
    .find((a) =>
      /^(postgres|postgresql|mysql|mariadb|sqlite|file|libsql):/i.test(a)
    );
}

const url = getArg("--url") || positionalUrl() || process.env.DATABASE_URL;
const port = getArg("--port") || process.env.PORT || "3008";
const dockerDir = getArg("--docker"); // si se pasa, up/down del compose ahí
const noBuild = process.argv.includes("--no-build");
const noOpen = process.argv.includes("--no-open");
// --verbose/--debug: mostrar la salida cruda de Next y npm (build/install/start)
// tal cual. Por defecto la silenciamos y mostramos una salida propia y limpia.
const verbose = process.argv.includes("--verbose") || process.argv.includes("--debug");
const isTTY = Boolean(process.stdout.isTTY);

function fail(msg) {
  console.error("\x1b[31m" + msg + "\x1b[0m");
  process.exit(1);
}

// ── Salida limpia ────────────────────────────────────────────────────────────
// Spinner sin dependencias. En TTY anima; en no-TTY (o --verbose) degrada a un
// log estático de una línea. Se registra en `activeSpinner` para poder limpiarlo
// en el teardown (Ctrl+C) y restaurar el cursor.
let activeSpinner = null;
function startSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const anim = isTTY && !verbose;
  if (!anim) {
    console.log("• " + text);
    return {
      succeed: (m) => m && console.log("✔ " + m),
      fail: (m) => m && console.error("✖ " + m),
      stop() {},
      update() {},
    };
  }
  let i = 0;
  process.stdout.write("\x1b[?25l"); // ocultar cursor
  const timer = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r\x1b[36m${frames[i]}\x1b[0m ${text}`);
  }, 80);
  const clear = () => {
    clearInterval(timer);
    process.stdout.write("\r\x1b[K\x1b[?25h"); // limpiar línea + restaurar cursor
    if (activeSpinner === sp) activeSpinner = null;
  };
  const sp = {
    succeed: (m) => {
      clear();
      console.log(`\x1b[32m✔\x1b[0m ${m || text}`);
    },
    fail: (m) => {
      clear();
      console.error(`\x1b[31m✖\x1b[0m ${m || text}`);
    },
    stop: clear,
    update: (t) => {
      text = t;
    },
  };
  activeSpinner = sp;
  return sp;
}

// Corre un comando con salida silenciada + spinner. Si falla, vuelca lo capturado
// para poder diagnosticar y aborta. Con --verbose hereda la terminal (sin filtro).
function runQuiet(cmd, cmdArgs, opts, spinnerText, doneText) {
  return new Promise((resolve) => {
    const sp = startSpinner(spinnerText);
    const child = spawn(cmd, cmdArgs, {
      ...opts,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    if (!verbose) {
      child.stdout?.on("data", (d) => (buf += d));
      child.stderr?.on("data", (d) => (buf += d));
    }
    child.on("error", (e) => {
      sp.fail(`Could not run ${cmd}`);
      fail(String((e && e.message) || e));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        sp.succeed(doneText);
        return resolve();
      }
      sp.fail(`${spinnerText.replace(/…$/, "")} failed`);
      if (!verbose && buf.trim()) process.stderr.write("\n" + buf.trim() + "\n");
      fail(`${cmd} exited with code ${code}.`);
    });
  });
}

// ── Branding ─────────────────────────────────────────────────────────────────
// Puro cosmético: wordmark con gradiente 24-bit (cyan → violeta) y taglines.
// Degrada a texto plano cuando no hay TTY. El ✦ es la "marca" que se repite.
const BRAND_FROM = [34, 211, 238]; // #22d3ee
const BRAND_TO = [167, 139, 250]; // #a78bfa
function gradient(text, from = BRAND_FROM, to = BRAND_TO) {
  if (!isTTY) return String(text);
  const chars = [...String(text)];
  const n = Math.max(chars.length - 1, 1);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const t = i / n;
    const r = Math.round(from[0] + (to[0] - from[0]) * t);
    const g = Math.round(from[1] + (to[1] - from[1]) * t);
    const b = Math.round(from[2] + (to[2] - from[2]) * t);
    out += `\x1b[38;2;${r};${g};${b}m${chars[i]}`;
  }
  return out + "\x1b[0m";
}
const bold = (s) => (isTTY ? `\x1b[1m${s}\x1b[0m` : String(s));
const dim = (s) => (isTTY ? `\x1b[2m${s}\x1b[0m` : String(s));
function printBanner() {
  if (!isTTY) {
    console.log("\nquick-outerbase — database GUI in your terminal\n");
    return;
  }
  console.log("");
  console.log(`  ${gradient("✦")} \x1b[1m${gradient("quick-outerbase")}\x1b[0m`);
  console.log(`    ${gradient("▔".repeat(15))}`);
  console.log("    \x1b[2mdatabase GUI in your terminal · one command away\x1b[0m");
  console.log("");
}
function printReady(base) {
  if (!isTTY) {
    console.log("✔ Ready → " + base);
    return;
  }
  console.log("");
  console.log(`  ${gradient("✦")} \x1b[1mYour database is ready!\x1b[0m`);
  console.log(`    ${gradient("→")} \x1b[1m\x1b[4m${gradient(base)}\x1b[0m`);
  console.log("");
}

printBanner();

if (!url) {
  fail(
    "Missing DATABASE_URL. Pass it with --url <connection-string> or via the DATABASE_URL environment variable.\n" +
      'Example: node bin/fork-studio.mjs --url "postgresql://user:pass@localhost:5432/db?schema=public"'
  );
}

// Inferencia/validación del motor por el scheme (espejo de src/lib/database-url.ts).
const scheme = (url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1]?.toLowerCase();
// DEPRECATED: dynamodb — scheme y guard de credenciales AWS removidos del build del CLI.
// Reversible: ver _deprecated/README.md.
const SUPPORTED = new Set([
  "postgres",
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "file",
  "libsql",
]);
if (!scheme || !SUPPORTED.has(scheme)) {
  fail(
    `Unrecognized scheme: "${scheme || "(none)"}". ` +
      "Supported engines: postgres://, postgresql://, mysql://, sqlite:/file:, libsql://"
  );
}
const redacted = url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
console.log(`  ${gradient("●")} ${bold(scheme)}  ${dim(redacted)}`);

// SQLite/file: resolver el path contra el cwd del USUARIO (donde se corrió el
// comando), no contra el del proyecto. Vía `npx` el server corre con cwd = cache
// de npx; sin esto, un `file:./mi.db` apuntaría a esa cache en lugar de a tu
// carpeta. libsql acepta una URL file: ABSOLUTA (incl. Windows con drive-letter,
// verificado), así que normalizamos a absoluta con forward-slashes.
const userCwd = process.cwd();
function normalizeDbUrl(raw) {
  const m = raw.match(/^(sqlite|file):(.*)$/i);
  if (!m) return raw; // postgres/mysql/libsql: sin cambios
  const p = m[2].replace(/^\/\//, "");
  if (!p) return raw; // sqlite en memoria u otro caso raro
  const isAbs = path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p);
  const abs = isAbs ? p : path.resolve(userCwd, p);
  return "file:" + abs.split("\\").join("/");
}
const runUrl = normalizeDbUrl(url);
if (runUrl !== url) {
  console.log(`    ${dim("↳ " + runUrl)}`);
}

const npmCmd = isWin ? "npm.cmd" : "npm";

// 1) Instalar dependencias si faltan.
if (!existsSync(path.join(projectDir, "node_modules"))) {
  await runQuiet(
    npmCmd,
    ["install"],
    { cwd: projectDir, shell: isWin },
    "Setting things up for the first time…",
    "Dependencies ready"
  );
}

// 2) Levantar el contenedor de prueba si se pidió.
let dockerStarted = false;
if (dockerDir) {
  await runQuiet(
    "docker",
    ["compose", "up", "-d"],
    { cwd: dockerDir, shell: isWin },
    "Starting the test database…",
    "Test database ready"
  );
  dockerStarted = true;
}

// 3) Build de producción si no existe (la primera vez). Producción = "se siente rápido".
const buildId = path.join(projectDir, ".next", "BUILD_ID");
if (!noBuild && !existsSync(buildId)) {
  await runQuiet(
    npmCmd,
    ["run", "build"],
    {
      cwd: projectDir,
      shell: isWin,
      env: {
        ...process.env,
        DATABASE_URL: runUrl,
        NEXT_TELEMETRY_DISABLED: "1",
        FORK_LOCAL: "1",
      },
    },
    "Tuning the engines so it flies…",
    "Optimized and ready"
  );
}

// 4) Arrancar el server de producción como hijo directo (node), para poder matar el árbol.
const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: projectDir,
  // Silenciamos la salida cruda de Next (banner ▲, "Ready in…", warnings) y la
  // reemplazamos por una salida propia. Guardamos lo último por si crashea, para
  // poder mostrarlo. Con --verbose la dejamos pasar tal cual.
  stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
  env: { ...process.env, DATABASE_URL: runUrl, PORT: port, FORK_LOCAL: "1" },
});

// Ring buffer con lo último que escupió Next; sólo se muestra si el server muere.
let serverLog = "";
if (!verbose) {
  const capture = (d) => {
    serverLog = (serverLog + d).slice(-8000);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);
}
const bootSpinner = startSpinner("Connecting to your database…");

let tearingDown = false;
function teardown(code = 0) {
  if (tearingDown) return;
  tearingDown = true;
  activeSpinner?.stop();
  console.log("\n• Shutting down…");

  // Matar el árbol de procesos del server (Windows: taskkill /T).
  try {
    if (isWin) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(child.pid, "SIGTERM");
    }
  } catch {
    /* ya muerto */
  }

  // Cinturón y tiradores (Windows): matar cualquier resto que siga escuchando en
  // el puerto. taskkill /T mata el árbol del child, pero si un worker se reparenta
  // el puerto podría quedar tomado; esto lo libera igual (mismo patrón que verify).
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
      for (const pid of pids) {
        spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
      }
    } catch {
      /* best-effort */
    }
  }

  // Bajar el contenedor de prueba si lo levantamos nosotros.
  if (dockerStarted && dockerDir) {
    console.log("• Stopping the test database…");
    spawnSync("docker", ["compose", "down", "-v"], {
      cwd: dockerDir,
      stdio: "ignore",
      shell: isWin,
    });
  }

  console.log(`${gradient("✦")} ${dim("Port released. See you next time!")}`);
  process.exit(code);
}

process.on("SIGINT", () => teardown(0));
process.on("SIGTERM", () => teardown(0));
child.on("exit", (code) => {
  if (tearingDown) return;
  bootSpinner.fail("The server stopped unexpectedly");
  if (!verbose && code && serverLog.trim()) {
    process.stderr.write("\n" + serverLog.trim() + "\n");
  }
  teardown(code ?? 0);
});

// 5) Esperar a que el server responda; abrir el browser salvo --no-open.
{
  const base = `http://localhost:${port}`;
  const target = `${base}/env`;
  const started = Date.now();
  // Guard contra doble apertura: puede haber varios requests del poll en vuelo
  // antes de que el primero responda, y cada respuesta OK abría el navegador.
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
        bootSpinner.stop();
        printReady(base);
        if (!noOpen) openBrowser(target);
      }
    );
    req.on("error", () => {
      if (Date.now() - started > 120000) {
        clearInterval(poll);
        bootSpinner.fail("Could not confirm startup");
        console.warn("  Try opening it manually: " + base);
      }
    });
    req.on("timeout", () => req.destroy());
  }, 1000);
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
