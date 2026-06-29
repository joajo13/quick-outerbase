# FIXES_PROGRESS

Tracking the 3 bug fixes in quick-outerbase. Working one at a time, in order.

## Environment / shipping facts (verified)
- Dev server: `npm run dev` → `next dev -p 3008` (http://localhost:3008).
- Deps installed with `npm install --ignore-scripts` (CI uses `npm ci --ignore-scripts`).
- Release trigger: **push a git tag `vX.Y.Z`** → `.github/workflows/release-bundles.yml` builds standalone bundle + publishes `launcher/` to npm. The `launcher/package.json` version MUST equal the tag (minus `v`).
- Version convention: bump BOTH `package.json` and `launcher/package.json` (both at 0.7.0 now → next patch 0.7.1).
- Quality gates (must pass before shipping): `npm run typecheck`, `npm run lint`, `npm run test` (jest). `npm run staged` runs all three.
- Verification: browser automation against the running dev server. Each bug must be reproduced BEFORE and confirmed fixed AFTER, in the browser.

## Bug 1 — AI tab + inline AI block crash: `Cannot read properties of null (reading 'replace')`
- Status: **DONE** ✅ (browser-verified on Postgres: inline AI generated a real JOIN query; Chat tab returned a real conversational answer with SQL. Both previously crashed. agent.test.ts: 23 passed.)
- Repro (browser, Postgres): inline AI (Ctrl+B) → "list all books..." → `TypeError: Cannot read properties of null (reading 'replace')`. Does NOT happen on SQLite. Requires a **cross-schema foreign key** (test DB: `analytics.events.book_id` → `public.books(id)`).
- Root cause (traced to source): `PostgresLikeDriver.schemas()` builds FK metadata from `information_schema` with `LEFT JOIN constraint_column_usage ccu ON ccu.table_schema = kcu.table_schema`. For a FK whose referenced table lives in **another schema**, that join fails → `reference_column_name`/`reference_table_name` come back **null**. `schemas()` then stores `foreignKey.foreignColumns = [null]` and `foreignTableName = null`. The agent DDL builder `convertTableToDDLContent` (src/drivers/agent/common.ts) does `foreignColumns.map(escapeId)`; `escapeId` is `id.replace(/"/g,'""')` (postgres-driver.ts:128) → `null.replace` → crash. Both AI surfaces (chat-tab + inline PromptWidget) funnel through this builder, so both crash identically.
- Fix (minimal, scoped to the AI DDL builder): in `convertTableToDDLContent`, when emitting FOREIGN KEY clauses (both column-level and table-level), filter out null/empty column names and **skip** any FK that lacks a target table or columns, instead of passing null to `escapeId`. Produces valid DDL (omits the incomplete FK) and never crashes. Introspection data bug (cross-schema FK metadata) left untouched — out of scope for the AI crash.
- Test: `src/drivers/agent/agent.test.ts` — added a case with a strict postgres-like `escapeId` (calls `.replace`, throws on null) + a FK with `foreignColumns:[null]`/`foreignTableName:null`; asserts no throw and no malformed `REFERENCES ""`.
- Verify: open AI tab + trigger inline AI block on the multi-schema Postgres; neither crashes AND both produce a real response.

## Bug 2 — Schema scoping by connection URL
- Status: **DONE** ✅ (browser-verified: `?schema=app` → sidebar shows ONLY `app` (with its `customers` table); no `?schema=` → shows all 3: analytics, app, public.)
- Root cause: `?schema=` (Prisma) is parsed (database-url.ts) and threaded into `PostgresLikeDriver(_schema)` via env-driver.ts:54, but `schemas()` ignored `_schema` and always listed every non-system schema (explicitly by old design).
- Fix (minimal): at the end of `PostgresLikeDriver.schemas()` (src/drivers/postgres/postgres-driver.ts), when `this._schema` is set, return `{ [this._schema]: schemas[this._schema] ?? [] }` (scope to that schema only — tree, ERD and autocomplete all scoped). When unset, return all schemas (unchanged). Updated the now-stale comments in postgres-driver.ts (constructor + schemas()) and env-driver.ts to describe the new behavior.
- Verify: tested two connections against the same embedded Postgres — both behave correctly.

## Bug 3 — AI chat input misaligned with submit button
- Status: **DONE** ✅ (browser-verified, pixel-measured)
- Repro: in the Chat tab, the `Enviar` button (`h-9` = 36px) was shorter than the 2-row textarea (~50px) and, under `items-end`, hugged the textarea's bottom — leaving a gap above it (top edges didn't line up).
- Root cause: row was `flex items-end gap-2`; the Button's default size variant hardcodes `h-9`, so it never matched the taller textarea.
- Fix (minimal, src/components/gui/tabs/chat-tab.tsx): row → `flex items-stretch gap-2` and Button gets `className="h-auto"` (twMerge overrides the variant `h-9`), so the button stretches to the textarea's height. Both edges now line up.
- Verify: measured `getBoundingClientRect()` of textarea vs button at widths 320 / 380 / 480 / 1568 px — top delta = bottom delta = height delta = **0** at every width; both 50px tall, side by side. Visual zoom confirmed the matched-height input bar.

---

# Session 2 — follow-ups (shipping as v0.7.2)

## Bug 4 — AI Chat tab: `Cannot read properties of undefined (reading '0')`
- Status: **FIX IMPLEMENTED + UNIT-TESTED; browser verification of a real OpenAI response is BLOCKED** (see note).
- Repro path (code-traced + partially browser-confirmed): the OpenAI/ChatGPT driver (`src/drivers/agent/chatgpt.ts`) did `jsonResponse.choices[0].message.content` with NO error handling. When OpenAI returns an error response (`{error:{message}}`, no `choices`), `choices[0]` throws exactly "Cannot read properties of undefined (reading '0')". Anthropic & Gemini drivers already handle `json.error`; ChatGPT did not.
- Why OpenAI errored for the user (most likely): the driver **hardcoded `model: "gpt-4o-mini"`** and IGNORED the user's configured model (`gpt-5.1-2025-11-13` seen in the AI Settings dialog). `buildProviderDriver` (list.tsx) never passed `config.model` to `ChatGPTDriver`. If the user's key has no access to gpt-4o-mini (or it's retired), OpenAI returns `{error}` → no choices → crash.
- Fix (minimal, mirrors Anthropic/Gemini):
  - `chatgpt.ts`: constructor now takes `model` (default "gpt-4o-mini") and `query()` sends `this.model`; checks `if (json.error) throw new Error(json.error.message)`; guards `choices?.[0]?.message?.content` and throws a readable error if absent.
  - `list.tsx`: `buildProviderDriver` passes `config.model` to `new ChatGPTDriver(...)`.
- Tests: `agent.test.ts` — 4 new cases (mock fetch): sends the CONFIGURED model (not gpt-4o-mini); `{error}` → readable throw, NOT "reading '0'"; no-choices → defensive throw; success → returns content. 27/27 agent tests pass.
- Browser repro caveat: in the Playwright sandbox, `api.openai.com` is **CORS-blocked** (no `Access-Control-Allow-Origin`) — `httpbin` and `api.anthropic.com` ARE reachable, so it's OpenAI-specific, not a network outage. So a dummy key here yields "Failed to fetch", while the user's Chrome (where OpenAI IS reachable) yields the `{error}`→"reading '0'". I cannot get a real OpenAI response from the test browser, and the user's Chrome extension (Claude-in-Chrome) disconnected → **needs user input to complete the in-browser "real response" verification.**

## JSX → React.JSX migration (fix the failing Dependabot `Check`)
- Status: **DONE** ✅ (tsc verified green under BOTH @types/react 18.3.31 AND 19.2.17 / @types/react-dom 19.2.3)
- Why: Dependabot's `minor-and-patch` PR bumps `@types/react`→19.2.x, which removed the global `JSX` namespace (now `React.JSX`) and made `useRef<T>(null)` return `RefObject<T | null>`. That broke the PR's typecheck (TS2503 `Cannot find namespace 'JSX'` ×5, TS2322 RefObject ×1). The release of v0.7.1 itself was fine; these are the 2 red Dependabot runs.
- Fix (backward-compatible with 18, forward-compatible with 19):
  - `JSX.Element` → `React.JSX.Element` in 5 files (channel-builtin.tsx, selectable-table.tsx, windows-tab.tsx, query-placeholder.tsx, saved-doc-tab/index.tsx), adding a React import where missing.
  - RefObject: widened `containerRef` param (use-visibility-calculation.ts) and `useElementResize` `ref` param to `RefObject<T | null>` (≡ `RefObject<T>` under @types/react 18); used the already-narrowed `ref` const instead of `containerRef.current` at the addEventListener line; updated the hook test's `useRef<HTMLDivElement | null>(container)`.
- Verify: `tsc --noEmit` exit 0 under 18.3.31 (committed lockfile) AND under 19.2.17 (installed via `--no-save`, then reverted). package.json/lock left on ^18 — Dependabot's PR does the actual bump; our code is now compatible so its Check will pass once it rebases onto main.

## Shipping (v0.7.2)
- Bump root + launcher package.json to 0.7.2, commit, push tag `v0.7.2` (only AFTER browser verification of the chat fix).
