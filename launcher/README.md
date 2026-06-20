# quick-outerbase

**Una GUI de base de datos en tu terminal.** Tomá un `DATABASE_URL` y levantá una **UI web
local** para explorar, consultar y editar tu base con **un comando**, en segundos.
Alternativa open-source y multi-motor a **Prisma Studio**, **Drizzle Studio**, **DbGate**,
**TablePlus** y **Outerbase Studio**.

```bash
npx quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

**Motores:** PostgreSQL · MySQL/MariaDB · SQLite · libSQL/Turso · **DynamoDB**.

Es un **launcher fino** (cero dependencias): no compila nada en tu máquina. Detecta tu
plataforma, baja **una sola vez** un runtime precompilado (`standalone`, ~28 MB) desde
GitHub Releases, lo cachea y arranca. Primer run: segundos. Siguientes: instantáneo.

> ⚠️ **Fork no oficial de la comunidad.** No está afiliado ni respaldado por Outerbase.
> Fork de [Outerbase Studio](https://github.com/outerbase/studio), bajo **AGPL-3.0**.
> Código fuente completo: https://github.com/joajo13/quick-outerbase

## Uso

```bash
# PostgreSQL  (?schema= estilo Prisma → search_path)
npx quick-outerbase --url "postgresql://user:pass@host:5432/db?schema=public"

# MySQL / MariaDB
npx quick-outerbase --url "mysql://user:pass@host:3306/db"

# Turso / libSQL
npx quick-outerbase --url "libsql://mi-db.turso.io?authToken=XXXX"

# SQLite  (el path relativo se resuelve contra tu carpeta actual)
npx quick-outerbase --url "file:./datos.sqlite"

# DynamoDB  (las creds NO van en la URL: las resuelve el server desde la cadena AWS)
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  npx quick-outerbase --url "dynamodb://us-east-1"
```

También podés pasar el URL por la env `DATABASE_URL`. Flags: `--port <n>` (default 3008),
`--no-open` (no abrir el browser). Al cortar con **Ctrl+C**, libera el puerto sin zombies.

## Requisitos

- **Node 20.9+** y `tar` en el PATH (Windows 10+ lo trae como `tar.exe`).
- Plataformas con runtime precompilado: `win32-x64`, `linux-x64`.
  Para otras (incluido macOS), corré desde el código: `npx github:joajo13/quick-outerbase --url "..."`.

## Variables de entorno útiles

- `QUICK_OUTERBASE_CACHE` — dónde cachear el runtime (default `~/.cache/quick-outerbase`).
- `QUICK_OUTERBASE_BUNDLE` — usar un `.tar.gz` local en vez de descargar (offline/testing).

## Licencia

**AGPL-3.0-only.** Fork de Outerbase Studio (se conserva la licencia y la atribución).
Ver [`LICENSE`](./LICENSE) y [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md).
