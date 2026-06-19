// Checks de UI (Playwright headless) para el DIST-VERIFY contra el studio ya
// levantado apuntando a la base SQLite seedeada (authors/books, 1 FK).
// Valida: (1) el studio conecta y muestra el esquema, (2) "se ven los datos"
// en la grilla, (3) "se ve el diagrama" (ERD con tablas y la relación).
//
// Uso: node verify/dist-ui-check.mjs [baseUrl]   (default http://localhost:3010)
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3010";
let failed = 0;
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failed++;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE}/env`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  // (1) Conecta y muestra el esquema: las tablas seedeadas aparecen en el árbol.
  const bodyText = () => page.evaluate(() => document.body.innerText);
  let txt = await bodyText();
  const seesTables = /authors/i.test(txt) && /books/i.test(txt);
  check("dist: studio conecta y lista las tablas (authors, books)", seesTables);

  // (2) "se ven los datos": abrir la tabla books y ver un título seedeado.
  try {
    // expandir el árbol si hace falta y abrir 'books'
    const booksNode = page.getByText("books", { exact: true }).first();
    if (await booksNode.isVisible().catch(() => false)) {
      await booksNode.dblclick().catch(() => {});
    }
    await page.waitForTimeout(2500);
  } catch {
    /* ignore */
  }
  txt = await bodyText();
  const seesData = /(Rayuela|Ficciones|El Aleph|Bestiario|El entenado)/.test(txt);
  check("dist: la grilla muestra datos reales (títulos seedeados)", seesData);

  // (3) "se ve el diagrama": abrir ERD y contar nodos + relación.
  // Intentar abrir el Relational Diagram por texto/menú; tolerante a layout.
  for (const y of [143, 88, 198, 250, 110]) {
    const v = await page
      .getByText("Relational Diagram", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (v) break;
    await page.mouse.click(32, y).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page
    .getByText("Relational Diagram", { exact: false })
    .first()
    .click()
    .catch(() => {});
  await page
    .waitForFunction(() => document.querySelectorAll(".react-flow__node").length >= 2, {
      timeout: 25000,
    })
    .catch(() => {});
  const nodeCount = await page.evaluate(
    () => document.querySelectorAll(".react-flow__node").length
  );
  const edgeCount = await page.evaluate(
    () => document.querySelectorAll(".react-flow__edge").length
  );
  check("dist: ERD muestra las tablas (>=2 nodos)", nodeCount >= 2, `${nodeCount} nodos`);
  check("dist: ERD muestra la relación books→authors (>=1 edge)", edgeCount >= 1, `${edgeCount} edges`);

  await browser.close();
  console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} checks UI OK`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Error en dist-ui-check:", e);
  process.exit(1);
});
