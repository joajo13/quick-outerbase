#!/usr/bin/env node
// Build de producción local, pensado para correr en el lifecycle `prepare`
// (npm install) — incluido el flujo `npx github:joajo13/quick-outerbase`, que
// clona el repo, corre `npm install` (dispara este script) y después el bin.
//
// Por qué un wrapper en Node y no `cross-env FORK_LOCAL=1 next build`:
//   - Setea FORK_LOCAL=1 vía process.env → cross-platform sin agregar deps.
//     (FORK_LOCAL=1 ⇒ next.config usa output normal en vez de "standalone";
//      sin eso, `next start` rompe con "Cannot find module './vendor-chunks/...'").
//   - Es best-effort: si el build falla acá, NO abortamos el install — el bin
//     (fork-studio.mjs) reintenta el build on-first-run. Cinturón y tiradores.
//   - Guard por .next/BUILD_ID: no rebuildea al pedo en installs repetidos.
//
// Flags / env:
//   --force              → buildea aunque ya exista .next/BUILD_ID
//   SKIP_PREPARE_BUILD=1 → saltea el build en prepare (útil para devs que solo
//                          quieren `next dev`, o para CI que buildea aparte)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const force = process.argv.includes("--force");

function log(msg) {
  console.log(`[prepare-build] ${msg}`);
}

if (process.env.SKIP_PREPARE_BUILD === "1") {
  log("SKIP_PREPARE_BUILD=1 → salteo el build (el bin lo hará on-first-run).");
  process.exit(0);
}

const buildId = path.join(projectDir, ".next", "BUILD_ID");
if (!force && existsSync(buildId)) {
  log("ya existe .next/BUILD_ID → no rebuildeo (usá --force para forzar).");
  process.exit(0);
}

const nextBin = path.join(projectDir, "node_modules", "next", "dist", "bin", "next");
if (!existsSync(nextBin)) {
  // En un install normal `next` ya está cuando corre prepare. Si no está
  // (caso raro: --ignore-scripts en deps, instalación parcial), no abortamos:
  // el bin buildea on-first-run.
  log("no encontré node_modules/next todavía → salteo (el bin buildeará luego).");
  process.exit(0);
}

log("compilando build de producción (FORK_LOCAL=1)… puede tardar la primera vez.");
const r = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: projectDir,
  stdio: "inherit",
  env: {
    ...process.env,
    FORK_LOCAL: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

if (r.status !== 0) {
  // Best-effort: avisamos fuerte pero NO rompemos el install. El bin reintenta.
  log(
    "\x1b[33mel build en prepare falló — no aborto el install. " +
      "El comando reintentará el build on-first-run.\x1b[0m"
  );
  process.exit(0);
}

log("build de producción listo (.next).");
process.exit(0);
