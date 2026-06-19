# quick-outerbase

Tomá un `DATABASE_URL` y levantá una **UI web local** para tu base
(PostgreSQL / MySQL / SQLite / libSQL-Turso) con **un comando**, en segundos.

```bash
npx quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

Es un **launcher fino**: no compila nada en tu máquina. Detecta tu plataforma, baja
**una sola vez** un runtime precompilado (`standalone`, ~28 MB) desde GitHub Releases,
lo cachea y arranca. Primer run: segundos. Siguientes: instantáneo.

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
```

También podés pasar el URL por la env `DATABASE_URL`. Flags: `--port <n>` (default 3008),
`--no-open` (no abrir el browser). Al cortar con **Ctrl+C**, libera el puerto sin zombies.

## Requisitos

- **Node 20.9+** y `tar` en el PATH (Windows 10+ lo trae como `tar.exe`).
- Plataformas con runtime precompilado: `win32-x64`, `linux-x64`, `darwin-arm64`, `darwin-x64`.
  Para otras, corré desde el código: `npx github:joajo13/quick-outerbase --url "..."`.

## Variables de entorno útiles

- `QUICK_OUTERBASE_CACHE` — dónde cachear el runtime (default `~/.cache/quick-outerbase`).
- `QUICK_OUTERBASE_BUNDLE` — usar un `.tar.gz` local en vez de descargar (offline/testing).

## Licencia

**AGPL-3.0-only.** Fork de Outerbase Studio (se conserva la licencia y la atribución).
Ver [`LICENSE`](./LICENSE) y [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md).
