# quick-outerbase

**A database GUI in your terminal.** Give it a `DATABASE_URL` and spin up a **local web
UI** to browse, query and edit your database with **one command**, in seconds.
An open-source, multi-engine alternative to **Prisma Studio**, **Drizzle Studio**,
**DbGate**, **TablePlus** and **Outerbase Studio**.

```bash
npx quick-outerbase --url "postgresql://user:pass@host:5432/mydb?schema=public"
```

**Engines:** PostgreSQL · MySQL/MariaDB · SQLite · libSQL/Turso · **DynamoDB**.

It's a **thin launcher** (zero dependencies): it compiles nothing on your machine. It
detects your platform, downloads a precompiled runtime (`standalone`, ~28 MB) from
GitHub Releases **once**, caches it and starts. First run: seconds. Subsequent runs:
instant.

> ⚠️ **Unofficial community fork.** Not affiliated with or endorsed by Outerbase.
> Fork of [Outerbase Studio](https://github.com/outerbase/studio), under **AGPL-3.0**.
> Full source code: https://github.com/joajo13/quick-outerbase

## Usage

```bash
# PostgreSQL  (Prisma-style ?schema= → search_path)
npx quick-outerbase --url "postgresql://user:pass@host:5432/db?schema=public"

# MySQL / MariaDB
npx quick-outerbase --url "mysql://user:pass@host:3306/db"

# Turso / libSQL
npx quick-outerbase --url "libsql://my-db.turso.io?authToken=XXXX"

# SQLite  (relative paths resolve against your current folder)
npx quick-outerbase --url "file:./data.sqlite"

# DynamoDB  (credentials do NOT go in the URL: the server resolves them from the AWS chain)
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
  npx quick-outerbase --url "dynamodb://us-east-1"
```

You can also pass the URL via the `DATABASE_URL` env var. Flags: `--port <n>` (default 3008),
`--no-open` (don't open the browser). On **Ctrl+C**, it frees the port with no zombies.

## Requirements

- **Node 20.9+** and `tar` on the PATH (Windows 10+ ships it as `tar.exe`).
- Platforms with a precompiled runtime: `win32-x64`, `linux-x64`.
  For others (macOS included), run from source: `npx github:joajo13/quick-outerbase --url "..."`.

## Useful environment variables

- `QUICK_OUTERBASE_CACHE` — where to cache the runtime (default `~/.cache/quick-outerbase`).
- `QUICK_OUTERBASE_BUNDLE` — use a local `.tar.gz` instead of downloading (offline/testing).

## License

**AGPL-3.0-only.** Fork of Outerbase Studio (license and attribution preserved).
See [`LICENSE`](./LICENSE) and [`AVISO_LICENCIA.md`](./AVISO_LICENCIA.md).
