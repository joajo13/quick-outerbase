# quick-outerbase

Reemplazo personal de Prisma Studio que **se siente rápido**. Le pasás un `DATABASE_URL`
y con **un comando** levanta una UI web local apuntada a esa base, sin configurar nada más.
Es **agnóstico al motor**: el driver se infiere del scheme del URL.

Fork de [Outerbase Studio](https://github.com/outerbase/studio), bajo **AGPL-3.0**
(ver [Licencia](#licencia) y [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md)).

---

## Instalación y uso — directo desde GitHub con `npx`

No hace falta clonar nada a mano. Necesitás **Node 20+** y npm:

```bash
npx -y github:joajo13/quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

`npx` clona el repo a un cache temporal, corre `npm install` (que dispara el build de
producción en el lifecycle `prepare`) y arranca la app apuntada a tu `DATABASE_URL`,
abriendo el browser en `http://localhost:3008/env`. Al cortar con **Ctrl+C** hace teardown
limpio: mata el árbol de procesos y libera el puerto, sin zombies.

> La primera vez tarda (instala dependencias y compila el build de producción). `npx`
> cachea el resultado por commit, así que las siguientes corridas arrancan al toque.

### Ejemplos por motor (el scheme define el driver)

```bash
# PostgreSQL  (postgres:// o postgresql://)   — ?schema= estilo Prisma → search_path
npx -y github:joajo13/quick-outerbase --url "postgresql://user:pass@host:5432/db?schema=public"

# MySQL / MariaDB  (mysql://)
npx -y github:joajo13/quick-outerbase --url "mysql://user:pass@host:3306/db"

# Turso / libSQL  (libsql://)
npx -y github:joajo13/quick-outerbase --url "libsql://mi-db.turso.io?authToken=XXXX"

# SQLite  (sqlite: o file:)  — el path relativo se resuelve contra tu carpeta actual
npx -y github:joajo13/quick-outerbase --url "file:./datos.sqlite"
```

Si el scheme no se reconoce, el comando aborta con un error claro y no levanta nada.
El `DATABASE_URL` siempre lo ponés vos; **nunca** se guarda ni se commitea.

### Flags

- `--url <connection-string>` — el `DATABASE_URL` (o usá la env `DATABASE_URL`, o pasalo posicional).
- `--port <n>` — puerto (default 3008).
- `--no-build` — no recompilar (reusa el build existente).
- `--no-open` — no abrir el browser.
- `--docker <dir>` — `docker compose up -d` en `<dir>` al arrancar y `down -v` al cortar.

## Qué podés hacer en la UI

- **Diagrama ERD** estilo Liam (tablas como tarjetas, PK/FK marcadas, relaciones con
  cardinalidad, tema claro/oscuro) con **auto-arrange** (layout dagre).
- **Estructura de tablas**: columnas, tipos, nullable, defaults, COMMENTs, PK/FK/unique/check
  e índices (coincide con `\d` de psql en Postgres).
- **Ver datos sin escribir SQL**: click en una tabla → grilla con filtro, orden y paginado server-side.
- **Editor de queries** con highlighting, **autocomplete consciente del schema real** y multi-statement.
- **Asistente LLM** (text-to-SQL y explicaciones) — Anthropic / OpenAI / Gemini.

## Configurar el LLM (opcional)

1. En la UI, abrí el dialog de **AI Assistant Setting**.
2. Elegí el **provider** (Anthropic, OpenAI o Gemini), opcionalmente el **model**, y pegá tu **API key**.
3. Guardá. La key vive **solo en el `localStorage` de tu navegador** — nunca se commitea, ni se
   loguea, ni se manda a ningún servidor nuestro.

Defaults: Anthropic `claude-opus-4-8`, OpenAI `gpt-4o-mini`, Gemini `gemini-2.0-flash`.

## Correr desde un clone (desarrollo)

Si querés hackear el código en vez de usar `npx`:

```bash
git clone https://github.com/joajo13/quick-outerbase.git
cd quick-outerbase
npm install                 # instala deps y buildea (prepare). Para saltear el build: SKIP_PREPARE_BUILD=1 npm install
npm run studio -- --url "postgresql://user:pass@localhost:5432/midb?schema=public"
# o `npm run dev` para el server de desarrollo de Next (hot-reload)
```

El build de producción se hace con `FORK_LOCAL=1` (lo maneja `bin/prepare-build.mjs` y el bin).
Sin eso, Next quedaría en modo `standalone` y `next start` rompería con
`Cannot find module './vendor-chunks/...'`.

## Verificación

El gate de distribución vive en el repo de desarrollo (`verify-dist.sh`): clona este repo a una
carpeta temporal limpia, corre `npm install` (→ `prepare` → build), arranca el bin contra una
SQLite de prueba y valida conexión, datos, diagrama (ERD) y teardown limpio del puerto.

```bash
bash verify-dist.sh
```

## Camino futuro: publicar en npm

El esqueleto de publicación ya está (`name`, `bin`, `files`, `engines`, `prepare` que buildea en
el install). Una vez publicado, sólo cambia el comando de uso:

```bash
# hoy (desde GitHub)
npx -y github:joajo13/quick-outerbase --url "..."

# tras `npm publish`
npx -y quick-outerbase --url "..."
# o instalado global:
npm i -g quick-outerbase && quick-outerbase --url "..."
```

> ⚠️ **Antes de `npm publish` hay UN cambio necesario.** El flujo `github:` funciona porque un
> git-install instala también las `devDependencies`, y `prepare` compila con ellas. Pero un
> consumidor que instala **desde el registry de npm** recibe sólo las `dependencies` (npm omite
> las devDeps del paquete instalado), y `next build` necesita en build-time `typescript`,
> `tailwindcss`/`@tailwindcss/postcss`/`postcss`, `shiki`/`showdown` y `eslint`/`eslint-config-next`
> — hoy en `devDependencies`. Sin moverlas, el `prepare` del consumidor del registry fallaría.
> Dos opciones antes de publicar:
> 1. Mover esas deps de build a `dependencies`, **o**
> 2. Sacar typescript+eslint del build con `typescript.ignoreBuildErrors: true` y
>    `eslint.ignoreDuringBuilds: true` en `next.config.js`, y mover sólo `tailwindcss`/`postcss`/
>    `shiki`/`showdown` a `dependencies`.
>
> Verificalo de verdad con `npm pack` + instalar el tarball en un temp con `npm install --omit=dev`
> (simula el registry), no sólo con el clone de GitHub. **El flujo `github:` documentado arriba NO
> está afectado por esto.**

Pasos de publicación: `npm login` → `npm publish --access public`. El campo `files` controla qué
entra al tarball. No se incluye ningún `.env`, credencial ni base de prueba.

## Troubleshooting

- **`next start` da "Cannot find module './vendor-chunks/...'"**: el build se hizo en modo
  `standalone`. Recompilá con `FORK_LOCAL=1` (el bin y `prepare` ya lo hacen). Borrá `.next` y reintentá.
- **Puerto 3008 ocupado**: usá `--port 3009`, o el comando libera el puerto al cortar con Ctrl+C.
- **SQLite vía `npx`**: el bin resuelve el path **relativo** contra **tu carpeta actual** (donde
  corriste el comando), no contra el cache de `npx`, y le pasa a libsql una URL `file:` absoluta.
  Así `--url "file:./datos.sqlite"` apunta a `./datos.sqlite` de tu cwd en todas las plataformas
  (incluido Windows). También podés pasar un path absoluto directo
  (`file:/home/me/db.sqlite` o `file:C:/Users/me/db.sqlite`). El bin loguea la ruta absoluta
  resuelta al arrancar (`• SQLite → file:...`) para que veas qué archivo abre.
- **Postgres y `?schema=`**: si no pasás `?schema=`, se usa `public` (se aplica al `search_path`).
- **No conecta**: revisá el `DATABASE_URL`. El error se muestra en `/env` sin filtrar la credencial.

## Licencia

**AGPL-3.0-only.** Este es un fork de [Outerbase Studio](https://github.com/outerbase/studio),
que se distribuye bajo AGPL-3.0. Se conserva la licencia original sin relicenciar, se mantiene la
atribución a Outerbase y el código fuente completo está disponible públicamente en este repositorio.
Ver [`LICENSE`](./LICENSE) (texto íntegro de la AGPL) y [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md)
(atribución, modificaciones del fork y obligaciones de copyleft).
