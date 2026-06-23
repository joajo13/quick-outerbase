# `_deprecated/` — maquinaria cloud del upstream, fuera del build del CLI npx

Esta carpeta junta código y config del upstream Outerbase Studio que el flujo del CLI
`npx quick-outerbase` (ruta `/env`) **no usa**. Nada se borró: todo está movido acá y
excluido del typecheck (`tsconfig.json` → `exclude`), del lint (fuera de `src/`), del
jest (`testPathIgnorePatterns`) y del build de Next (Next solo rutea/compila lo que vive
en `src/app`). El prefijo del directorio no es `_` por casualidad: Next ignora carpetas
`_`-prefijadas, así que aunque algo quedara bajo `src/app` no se rutearía.

Todo es **100% reversible**: mover de vuelta + revertir los edits puntuales (ver abajo).

## 1. Deploy a Cloudflare (`cloudflare-deploy/`)
Movidos: `wrangler.jsonc`, `open-next.config.ts`, `Dockerfile`, `.dockerignore`.
- Sacados de `package.json`: scripts `preview` y `deploy`; devDeps `@opennextjs/cloudflare` y `wrangler`.
- **Reactivar:** mover los 4 archivos a la raíz, reponer scripts/devDeps, `npm i`.
- El release a npm (`release-bundles.yml`) NO usa Cloudflare → esto no lo rompe.

## 2. Agent Cloudflare Workers AI (`src/drivers/agent/cloudflare.ts`)
El assistant quedó como BYO (Anthropic/OpenAI/Gemini). Se sacó el free-tier de Cloudflare.
- **Reactivar:** mover `cloudflare.ts` de vuelta a `src/drivers/agent/`, descomentar el import,
  el registro del `dict` y el grupo `cloudflare` en `src/drivers/agent/list.tsx`.

## 3. DynamoDB (corte activo)
Era el único lastre cableado al flujo `/env`, así que se cortó activamente con marcadores
`// DEPRECATED: dynamodb` en cada branch (buscables con grep). Archivos movidos acá:
`src/drivers/dynamodb/*`, `src/drivers/database/dynamodb-queryable.ts`, `src/app/proxy/dynamodb/`,
`src/lib/dynamodb-credentials.ts` (+ tests). Se sacaron `@aws-sdk/{client,lib,util}-dynamodb`.
- Puntos de corte (KEEP, reversibles por git): `lib/env-driver.ts`, `lib/database-url.ts`
  (SCHEME_MAP), `app/api/env-database/route.ts`, `bin/fork-studio.mjs`, `lib/build-table-result.ts`,
  `components/gui/sql-editor/index.tsx`, `drivers/base-driver.ts` (tipo SupportedDialect conserva
  "dynamodb" a propósito).
- **Reactivar:** revertir esos marcadores, mover los archivos de vuelta, reponer `@aws-sdk/*`.

## 4. Lastre upstream (rutas/componentes/drivers cloud)
Movidos a `_deprecated/src/...` preservando estructura: rutas `(outerbase)` (salvo
`local-setting-dialog.tsx`), `(dark-only)`, `(public)`, `(theme)/{client,playground,embed}`,
`(theme)/connect/saved-connection-storage.ts`, `storybook`, `proxy/d1`; componentes `board`,
`chart`, `mdx`, `picker`, extras de `orbit`, listview de `gui`; `outerbase-cloud`; extensions
`outerbase/data-catalog/dolt/local-setting-sidebar`; drivers de nicho (cloudflare-d1/wae,
starbasedb, rqlite, valtown, sqljs, iframe, helpers, mysql-playground). Se agregó
`src/app/page.tsx` (redirect `/`→`/env`, antes lo servía `(outerbase)/page.tsx`).
- Deps sacadas: `echarts`, `react-grid-layout`, `react-color` (+ @types).
- **Reactivar:** mover `_deprecated/src/<path>` de vuelta a `src/<path>` y reponer deps.

## 5. MDX (docs/storybook)
No quedan páginas `.mdx` en el build. `next.config.js` ya no usa `@next/mdx` ni el pageExtension
`mdx`. Deps sacadas: `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `@types/mdx`; devDeps `shiki`,
`@types/sql.js`. (`showdown` se mantiene: lo usa `build-dialect.js`.)
- **Reactivar:** reponer `withMDX` + `"mdx"` en `next.config.js` y las deps mdx.

## Mecanismo de exclusión (todo reversible)
`tsconfig.json` → `exclude: ["node_modules","_deprecated"]`; `jest.config.ts` →
`testPathIgnorePatterns` incluye `_deprecated`; Next no rutea/compila fuera de `src/app`.
