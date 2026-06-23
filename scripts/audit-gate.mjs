#!/usr/bin/env node
// audit-gate.mjs — gate de seguridad M1 (ENFORCED).
//
// Corre `npm audit --omit=dev --json` (solo deps de PRODUCCIÓN: es lo que viaja
// en el bundle standalone y lo que realmente expone al usuario; el tooling de
// dev — eslint/jest/etc — no se publica). Ignora las advisories listadas en
// `.audit-allowlist.json` (backlog conocido, con issue de burn-down) y FALLA si
// aparece CUALQUIER CVE high+ NUEVO.
//
// Filosofía: el gate bloquea REGRESIONES, no el backlog histórico. Cada entrada
// del allowlist lleva motivo + fecha; al saldar el issue de burn-down hay que
// sacarlas (el gate avisa cuáles ya no aplican).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const allowPath = path.join(__dirname, "..", ".audit-allowlist.json");
const SEVERITIES = new Set(["high", "critical"]);

function loadAllow() {
  if (!existsSync(allowPath)) return new Set();
  try {
    const j = JSON.parse(readFileSync(allowPath, "utf8"));
    const ids = (j.allow || []).map((e) => (typeof e === "string" ? e : e && e.id));
    return new Set(ids.filter(Boolean));
  } catch (e) {
    console.error("No pude leer .audit-allowlist.json:", e.message);
    process.exit(2);
  }
}

function runAudit() {
  // npm audit sale con código != 0 cuando encuentra vulns: capturamos el stdout
  // igual (trae el JSON), no lo tratamos como error del comando.
  const isWin = process.platform === "win32";
  try {
    // En Windows `npm` es un .cmd → requiere shell. Los args son flags fijos
    // (sin input externo), así que el shell no agrega superficie de inyección.
    return execFileSync(isWin ? "npm.cmd" : "npm", ["audit", "--omit=dev", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      shell: isWin,
    });
  } catch (e) {
    // npm sale != 0 cuando HAY vulns y trae el JSON en stdout: eso es válido.
    // Pero stdout vacío/whitespace = fallo real del comando → fail-closed.
    if (e.stdout && e.stdout.trim()) return e.stdout;
    console.error("npm audit no devolvió salida utilizable:", e.message);
    process.exit(2);
  }
}

function ghsaFromUrl(url) {
  const m = (url || "").match(/GHSA-[0-9a-z-]+/i);
  return m ? m[0] : null;
}

const allow = loadAllow();

// Parseo fail-closed: cualquier salida que NO sea un reporte de auditoría real
// (error de registry/red, offline, JSON inválido, sin metadata) → exit 2. Un
// hiccup del registry NO puede desactivar el gate en silencio.
let report;
try {
  report = JSON.parse(runAudit());
} catch (e) {
  console.error("npm audit devolvió JSON inválido (fail-closed):", e.message);
  process.exit(2);
}
if (!report || typeof report !== "object" || report.error || report.message) {
  console.error(
    "npm audit reportó un error en vez de un reporte (¿offline/registry caído?). Fail-closed."
  );
  if (report && (report.message || report.error)) {
    console.error("  npm:", report.message || JSON.stringify(report.error));
  }
  process.exit(2);
}
if (
  typeof report.vulnerabilities !== "object" ||
  report.vulnerabilities === null ||
  !report.metadata ||
  typeof report.metadata.dependencies === "undefined"
) {
  // `vulnerabilities: {}` (objeto vacío) = escaneó y no encontró nada → OK.
  // Ausencia del campo o de metadata = NO se auditó nada → fail-closed.
  console.error("npm audit no produjo un reporte completo (sin vulnerabilities/metadata). Fail-closed.");
  process.exit(2);
}
const vulns = report.vulnerabilities;

// Junta las advisories high+ reales. Identidad: GHSA si lo hay (para que el
// allowlist por GHSA siga funcionando); si no, fallback al `source` numérico
// (siempre presente en los via-objects de npm audit) o name|title. NUNCA se
// descarta una advisory por no tener GHSA: sin GHSA no se puede allowlistear,
// así que cae en "sin permitir" y bloquea (fail-closed).
const found = new Map(); // key -> { severity, title, pkg, ghsa|null }
for (const [pkg, v] of Object.entries(vulns)) {
  for (const via of v.via || []) {
    if (typeof via !== "object") continue; // string = arista transitiva; la hoja trae el advisory
    if (!SEVERITIES.has(via.severity)) continue;
    const ghsa = ghsaFromUrl(via.url);
    const key =
      ghsa ||
      (via.source != null ? `source:${via.source}` : `name:${via.name || pkg}|${via.title || ""}`);
    if (!found.has(key)) {
      found.set(key, { severity: via.severity, title: via.title, pkg: via.name || pkg, ghsa });
    }
  }
}

const allowedHit = [...found.entries()].filter(([, info]) => info.ghsa && allow.has(info.ghsa));
const unallowed = [...found.entries()].filter(([, info]) => !(info.ghsa && allow.has(info.ghsa)));

console.log(
  `Audit gate (prod, high+): ${found.size} advisories detectadas — ` +
    `${allowedHit.length} en allowlist, ${unallowed.length} sin permitir.`
);

if (allowedHit.length) {
  console.log("\nEn allowlist (backlog conocido, ver issue de burn-down):");
  for (const [, info] of allowedHit) {
    console.log(`  · ${info.ghsa} [${info.severity}] ${info.pkg}: ${info.title}`);
  }
}

const foundGhsas = new Set([...found.values()].map((i) => i.ghsa).filter(Boolean));
const stale = [...allow].filter((id) => !foundGhsas.has(id));
if (stale.length) {
  console.log(`\n⚠ Allowlist con entradas ya resueltas (sacalas de .audit-allowlist.json): ${stale.join(", ")}`);
}

if (unallowed.length) {
  console.error("\n✖ CVE high+ NUEVO en deps de producción (no está en el allowlist):");
  for (const [key, info] of unallowed) {
    console.error(`  · ${info.ghsa || key} [${info.severity}] ${info.pkg}: ${info.title}`);
    if (info.ghsa) console.error(`    https://github.com/advisories/${info.ghsa}`);
  }
  console.error(
    "\nArreglá la dep (`npm audit fix`), o si es aceptado/sin fix, sumalo a " +
      ".audit-allowlist.json con motivo + fecha."
  );
  process.exit(1);
}

console.log("\n✔ Sin CVE high+ nuevos en producción. Gate OK.");
process.exit(0);
