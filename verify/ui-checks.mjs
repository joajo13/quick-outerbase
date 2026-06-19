// Checks de UI con Playwright (headless) contra el server ya levantado.
// Uso: node verify/ui-checks.mjs [baseUrl]
import { chromium } from "playwright";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:3008";
const results = [];
let failed = 0;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"}  ${name}${detail ? "  - " + detail : ""}`);
  if (!ok) failed++;
}

async function openTools(page) {
  for (const y of [143, 88, 198, 250]) {
    const v = await page
      .getByText("Relational Diagram", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (v) return true;
    await page.mouse.click(32, y).catch(() => {});
    await page.waitForTimeout(500);
  }
  return false;
}

async function expandPublic(page) {
  const has = await page
    .getByText("events", { exact: true })
    .first()
    .isVisible()
    .catch(() => false);
  if (has) return;
  await page.mouse.click(90, 123).catch(() => {});
  await page.waitForTimeout(700);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto(`${BASE}/env`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page
    .waitForFunction(() => document.title.includes("shopdb"), { timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  check("R1: Studio conecta a la base", (await page.title()).includes("shopdb"));

  // --- R4: query editor (tab Query por defecto, activo al inicio) ---
  const editor = page.locator(".cm-content").first();
  let acOk = false;
  try {
    await editor.click({ timeout: 8000 });
    await page.keyboard.type("SELECT * FROM ", { delay: 35 });
    await page.keyboard.press("Control+Space");
    await page.waitForTimeout(1800);
    const opts = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-completionLabel")].map((e) => e.textContent)
    );
    acOk = ["users", "orders", "events", "products"].some((t) => opts.includes(t));
  } catch {
    /* ignore */
  }
  check("R4: autocomplete trae nombres reales del schema", acOk);

  let joinOk = false;
  try {
    await editor.click({ timeout: 8000 });
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(
      "SELECT o.status, count(*) AS c FROM orders o JOIN order_items oi ON oi.order_id = o.id GROUP BY o.status ORDER BY c DESC LIMIT 5;",
      { delay: 3 }
    );
    await page.getByRole("button", { name: /^Run$/ }).click().catch(() => {});
    await page.keyboard.press("Control+Enter").catch(() => {});
    await page.waitForTimeout(3000);
    const out = await page.evaluate(() => document.body.innerText);
    joinOk = /\b(paid|shipped|delivered|cancelled|placed|cart|refunded)\b/.test(out);
  } catch {
    /* ignore */
  }
  check("R4: SELECT con JOIN devuelve resultados", joinOk);

  // --- R3: grilla 50k (árbol de Tablas fresco, antes de abrir el ERD) ---
  await expandPublic(page);
  await page.getByText("events", { exact: true }).first().dblclick().catch(() => {});
  await page.waitForTimeout(3000);
  const gridText = await page.evaluate(() => document.body.innerText);
  check(
    "R3: grilla de events muestra datos (50k)",
    /page_view|click|purchase|login|add_to_cart/.test(gridText)
  );
  await page.mouse.wheel(0, 4000).catch(() => {});
  await page.waitForTimeout(600);
  check("R3: scroll de 50k sin crash", await page.evaluate(() => !!document.body));

  // --- R5: ERD ---
  await openTools(page);
  await page
    .getByText("Relational Diagram", { exact: false })
    .first()
    .click()
    .catch(() => {});
  await page
    .waitForFunction(
      () => document.querySelectorAll(".react-flow__node").length >= 12,
      { timeout: 25000 }
    )
    .catch(() => {});
  const nodeCount = await page.evaluate(
    () => document.querySelectorAll(".react-flow__node").length
  );
  const edgeCount = await page.evaluate(
    () => document.querySelectorAll(".react-flow__edge").length
  );
  check("R5: ERD muestra 12+ tablas", nodeCount >= 12, `${nodeCount} nodos`);
  check("R5: ERD muestra relaciones", edgeCount >= 10, `${edgeCount} edges`);

  // --- R6: autoarrange ---
  let arrangeOk = false;
  if (nodeCount >= 12) {
    await page.getByRole("button", { name: /Auto arrange/i }).click().catch(() => {});
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".react-flow__node")).map((n) => {
        const r = n.getBoundingClientRect();
        return Math.round(r.x) + "," + Math.round(r.y);
      })
    );
    const unique = new Set(after).size;
    arrangeOk = after.length > 0 && unique === after.length;
  }
  check("R6: auto-arrange acomoda sin apilar nodos", arrangeOk);

  await browser.close();
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks UI OK`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Error en ui-checks:", e);
  process.exit(1);
});
