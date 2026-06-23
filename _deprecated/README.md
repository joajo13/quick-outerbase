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
