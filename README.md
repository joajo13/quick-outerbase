# quick-outerbase

**Una GUI de base de datos que vive en tu terminal.** Le pasás un `DATABASE_URL` y con
**un solo comando** te levanta una **UI web local** para explorar, consultar y editar tu
base — sin instalar nada pesado, sin cuentas, sin configurar nada. El driver se infiere
del scheme del URL.

```bash
npx quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

Pensado para devs que ya usan **Prisma**, **Drizzle**, **Turso** o **DynamoDB** y quieren
mirar su base al toque, sin abrir una app de escritorio que tarda más en arrancar que la
query. Es una alternativa **open-source** y multi-motor a **Prisma Studio**, **Drizzle
Studio**, **DbGate**, **TablePlus** y **Outerbase Studio**.

**Motores:** PostgreSQL · MySQL/MariaDB · SQLite · libSQL/Turso · DynamoDB.

> ⚠️ **Fork no oficial de la comunidad.** `quick-outerbase` es un fork independiente de
> [Outerbase Studio](https://github.com/outerbase/studio), **no está afiliado ni
> respaldado por Outerbase**. Se distribuye bajo **AGPL-3.0** conservando la licencia y la
> atribución originales (ver [Licencia](#licencia) y [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md)).

## ¿Por qué quick-outerbase? (comparación honesta)

| | quick-outerbase | Prisma Studio | Drizzle Studio | DbGate | TablePlus | Outerbase Studio (oficial) |
|---|---|---|---|---|---|---|
| **Arranque** | `npx`, un comando | atado a tu proyecto Prisma | atado a tu proyecto Drizzle | instalar app/Docker | instalar app nativa | web/app + cuenta |
| **Multi-motor en una herramienta** | ✅ PG, MySQL, SQLite, libSQL, DynamoDB | ❌ (vía Prisma) | ❌ (vía Drizzle) | ✅ muchos | ✅ muchos | ✅ varios |
| **DynamoDB** | ✅ (CRUD + PartiQL) | ❌ | ❌ | parcial | ✅ | ❌ |
| **Diagrama ERD** | ✅ incluido | ❌ | ❌ | ✅ | ✅ | parcial |
| **Asistente LLM (text-to-SQL)** | ✅ (key local) | ❌ | ❌ | ❌ | ✅ (de pago) | ✅ |
| **Corre 100% local / loopback** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (cloud) |
| **Open source** | ✅ AGPL-3.0 | ❌ | ✅ | ✅ | ❌ | ✅ AGPL |
| **Precio** | gratis | gratis | gratis | gratis/Pro | de pago | freemium |

**Siendo honestos:** TablePlus es una app nativa mucho más madura (multi-conexión,
performance, features) — si vivís en un cliente de DB todo el día, pagalo. La Outerbase
Studio **oficial** suma cuentas, cloud y colaboración que este fork **no** tiene.
quick-outerbase brilla cuando querés **mirar/editar una base puntual, rápido, desde la
terminal, sin instalar una app** — y cuando necesitás varios motores (incluido DynamoDB)
con una sola herramienta.

---

## Instalación rápida (recomendada) — `npx quick-outerbase`

Necesitás **Node 20.9+**:

```bash
npx quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

Esto baja **una sola vez** un runtime precompilado (`standalone`, ~28 MB) para tu plataforma
desde GitHub Releases, lo cachea y arranca **en segundos** (no compila nada en tu máquina).
Abre el browser en `http://localhost:3008/env`. Al cortar con **Ctrl+C** libera el puerto sin
zombies. Runs siguientes: instantáneos (cacheado en `~/.cache/quick-outerbase`).

> Plataformas con bundle precompilado: `win32-x64`, `linux-x64`. En macOS, corré desde el
> código: `npx github:joajo13/quick-outerbase --url "..."`.
> El paquete `quick-outerbase` es un **launcher fino** (sin dependencias); el código fuente
> completo vive en este repo (se buildea por plataforma en cada release, ver [Releases](#releasing)).

## Alternativa — desde el código con `npx github:` (dev / plataformas sin bundle)

Si querés correr **desde el código** (hackear, o una plataforma sin bundle precompilado):

```bash
npx -y github:joajo13/quick-outerbase --url "postgresql://user:pass@host:5432/midb?schema=public"
```

`npx` clona el repo, corre `npm install` (que dispara el build de producción en el lifecycle
`prepare`) y arranca. Mismo resultado, pero **la primera vez tarda varios minutos** (instala
deps + compila). `npx` cachea por commit, así que las siguientes corridas en esa máquina
arrancan al toque.

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

# DynamoDB  (dynamodb://<region>)  — las CREDENCIALES NO van en la URL: las resuelve el
# server desde la cadena estándar de AWS (env AWS_ACCESS_KEY_ID/SECRET, ~/.aws o IAM role).
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  npx -y github:joajo13/quick-outerbase --url "dynamodb://us-east-1"
# DynamoDB Local (Docker): pasá el endpoint en la query
npx -y github:joajo13/quick-outerbase --url "dynamodb://us-east-1?endpoint=http://localhost:8000"
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

## Modelo de red y seguridad

quick-outerbase es una herramienta **local de un solo usuario**. Tené en cuenta:

- **Bind a loopback por default.** El server escucha en `127.0.0.1` (`HOSTNAME=127.0.0.1`)
  y **no tiene autenticación** — algo correcto para una herramienta local. **No** lo
  expongas en `0.0.0.0` ni en una interfaz pública sin poner tu propia auth/reverse-proxy
  delante. Si lo hacés, cualquiera en la red podría operar tu base.
- **Tu `DATABASE_URL` es tuyo.** Nunca se persiste ni se commitea; la credencial se
  **redacta** en los logs y no se manda a ningún servidor nuestro.
- **API keys del LLM** viven **solo** en el `localStorage` de tu navegador.
- **Integridad del runtime (desde v0.5.0).** El paquete npm es un launcher fino que baja
  el runtime precompilado desde GitHub Releases. El launcher **verifica el SHA-256** del
  bundle descargado contra un `checksums.json` que viaja **firmado dentro del paquete
  npm**, y los bundles se publican **desde CI con provenance** (npm provenance + GitHub
  artifact attestations). Si el bundle no matchea el checksum esperado, el launcher
  **aborta** antes de ejecutar nada. El override `QUICK_OUTERBASE_BUNDLE` (testing/offline)
  saltea la verificación a propósito: usalo solo con bundles en los que confiás.
- **Subset de entorno.** Al runtime se le pasa solo un subset whitelisteado de variables
  de entorno (AWS\_\*, Node/Next y lo del sistema), no todo `process.env`.
- **Riesgo bajo aceptado:** la extracción del bundle usa el `tar` del PATH del sistema
  (Windows 10+ lo trae). Se mantiene así para preservar el principio de **cero
  dependencias de runtime** del launcher.

Para reportar un problema de seguridad, ver [`SECURITY.md`](./SECURITY.md).

## Verificación

El gate de distribución vive en el repo de desarrollo (`verify-dist.sh`): clona este repo a una
carpeta temporal limpia, corre `npm install` (→ `prepare` → build), arranca el bin contra una
SQLite de prueba y valida conexión, datos, diagrama (ERD) y teardown limpio del puerto.

```bash
bash verify-dist.sh
```

<a name="releasing"></a>
## Releasing (cómo se publica la vía rápida)

La vía rápida tiene dos piezas:
1. **El launcher** (`launcher/`, paquete npm `quick-outerbase`): fino, sin deps, sin build. Es lo
   único que se publica a npm. Baja el bundle precompilado de tu plataforma.
2. **Los bundles `standalone`** precompilados por plataforma, subidos como **assets de un GitHub
   Release**, generados por el workflow [`.github/workflows/release-bundles.yml`](./.github/workflows/release-bundles.yml).

> La app de este repo raíz es `"private": true` a propósito: **no** se publica a npm (su build
> necesita las `devDependencies` y eso rompería un install desde el registry). El launcher la
> reemplaza como paquete npm. El flujo `npx github:` sigue andando para correr desde el código.

Para cortar una versión `X.Y.Z` (deben coincidir el tag, `launcher/package.json` y la app):

```bash
# 1) bump de versión en ambos package.json a X.Y.Z (app raíz + launcher/)
# 2) commit + tag + push del tag → dispara el CI que buildea los bundles por plataforma
git tag vX.Y.Z && git push origin vX.Y.Z
#    (el workflow crea el Release vX.Y.Z y sube quick-outerbase-<plat>-<arch>.tar.gz)
# 3) publicar el launcher a npm (necesita cuenta en npmjs.com + npm login)
cd launcher && npm publish --access public
```

Después, `npx quick-outerbase@X.Y.Z --url "..."` baja el bundle del Release vX.Y.Z. El launcher
no incluye ningún `.env`, credencial ni base; el `DATABASE_URL` siempre lo provee el usuario.

Probá el launcher localmente (sin release real) contra un bundle armado a mano:

```bash
NEXT_TELEMETRY_DISABLED=1 npx next build          # genera .next/standalone
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
tar -czf /tmp/sa.tgz -C .next/standalone .
bash launcher/verify-launcher.sh /tmp/sa.tgz       # E2E: arranque + datos + teardown
```

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
