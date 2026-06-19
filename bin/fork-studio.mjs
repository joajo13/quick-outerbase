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
    .find((a) => /^(postgres|postgresql|mysql|mariadb|sqlite|file|libsql):/i.test(a));
}

const url = getArg("--url") || positionalUrl() || process.env.DATABASE_URL;
const port = getArg("--port") || process.env.PORT || "3008";
const dockerDir = getArg("--docker"); // si se pasa, up/down del compose ahí
const noBuild = process.argv.includes("--no-build");
const noOpen = process.argv.includes("--no-open");

function fail(msg) {
  console.error("\x1b[31m" + msg + "\x1b[0m");
  process.exit(1);
}

if (!url) {
  fail(
    "Falta DATABASE_URL. Pasalo con --url <connection-string> o por la variable de entorno DATABASE_URL.\n" +
      'Ej: node bin/fork-studio.mjs --url "postgresql://user:pass@localhost:5432/db?schema=public"'
  );
}

// Inferencia/validación del motor por el scheme (espejo de src/lib/database-url.ts).
const scheme = (url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1]?.toLowerCase();
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
    `Scheme no reconocido: "${scheme || "(ninguno)"}". ` +
      "Motores soportados: postgres://, postgresql://, mysql://, sqlite:/file:, libsql://"
  );
}
const redacted = url.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
console.log(`▶ Fork-Outerbase Studio → ${scheme} (${redacted})`);

const npmCmd = isWin ? "npm.cmd" : "npm";

// 1) Instalar dependencias si faltan.
if (!existsSync(path.join(projectDir, "node_modules"))) {
  console.log("• Instalando dependencias…");
  const r = spawnSync(npmCmd, ["install"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: isWin,
  });
  if (r.status !== 0) fail("npm install falló.");
}

// 2) Levantar el contenedor de prueba si se pidió.
let dockerStarted = false;
if (dockerDir) {
  console.log(`• Levantando contenedor de prueba (${dockerDir})…`);
  const r = spawnSync("docker", ["compose", "up", "-d"], {
    cwd: dockerDir,
    stdio: "inherit",
    shell: isWin,
  });
  if (r.status !== 0) fail("docker compose up falló.");
  dockerStarted = true;
}

// 3) Build de producción si no existe (la primera vez). Producción = "se siente rápido".
const buildId = path.join(projectDir, ".next", "BUILD_ID");
if (!noBuild && !existsSync(buildId)) {
  console.log("• Compilando build de producción (primera vez, puede tardar)…");
  const r = spawnSync(npmCmd, ["run", "build"], {
    cwd: projectDir,
    stdio: "inherit",
    shell: isWin,
    env: {
      ...process.env,
      DATABASE_URL: url,
      NEXT_TELEMETRY_DISABLED: "1",
      FORK_LOCAL: "1",
    },
  });
  if (r.status !== 0) fail("next build falló.");
}

// 4) Arrancar el server de producción como hijo directo (node), para poder matar el árbol.
const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  cwd: projectDir,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, PORT: port, FORK_LOCAL: "1" },
});

let tearingDown = false;
function teardown(code = 0) {
  if (tearingDown) return;
  tearingDown = true;
  console.log("\n• Cerrando…");

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

  // Bajar el contenedor de prueba si lo levantamos nosotros.
  if (dockerStarted && dockerDir) {
    console.log("• Bajando contenedor de prueba…");
    spawnSync("docker", ["compose", "down", "-v"], {
      cwd: dockerDir,
      stdio: "ignore",
      shell: isWin,
    });
  }

  console.log("• Listo. Puerto liberado, sin procesos zombie.");
  process.exit(code);
}

process.on("SIGINT", () => teardown(0));
process.on("SIGTERM", () => teardown(0));
child.on("exit", (code) => {
  if (!tearingDown) teardown(code ?? 0);
});

// 5) Esperar a que el server responda y abrir el browser.
if (!noOpen) {
  const target = `http://localhost:${port}/env`;
  const started = Date.now();
  const poll = setInterval(() => {
    if (tearingDown) return clearInterval(poll);
    const req = http.get(
      { host: "localhost", port: Number(port), path: "/env", timeout: 2000 },
      (res) => {
        res.destroy();
        clearInterval(poll);
        console.log(`✔ Listo en ${target}`);
        openBrowser(target);
      }
    );
    req.on("error", () => {
      if (Date.now() - started > 120000) {
        clearInterval(poll);
        console.warn("No se pudo confirmar el arranque; abrí manualmente " + target);
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
