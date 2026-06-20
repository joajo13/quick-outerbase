---
title: "I built a one-command, multi-engine database GUI that runs in your terminal (community fork)"
published: false
tags: database, opensource, postgres, dynamodb
canonical_url: https://github.com/joajo13/quick-outerbase
---

> **DRAFT — for human review before publishing. NOT published yet.** Verify every claim, link, and version number against the repo before you hit publish. Adjust tone/tags as needed.

You opened a heavy desktop app, waited for it to boot, clicked through a connection wizard, and re-typed the same credentials you already have in your `.env` — all to look at *one* table. Sound familiar?

That annoyance is why **quick-outerbase** exists: a database GUI you run from your terminal with a single command. You hand it a `DATABASE_URL`, it spins up a local web UI in your browser, and you're poking at your data in seconds. No installer, no account, no cloud.

> **Disclaimer up front:** quick-outerbase is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio), licensed under **AGPL-3.0**. It is **not affiliated with or endorsed by Outerbase.** More on the fork at the end.

## One command, pick your engine

The driver is inferred from the URL scheme — you don't configure anything. Pick the one that matches your stack:

```bash
# PostgreSQL
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"

# MySQL / MariaDB
npx quick-outerbase --url "mysql://user:pass@localhost:3306/mydb"

# SQLite
npx quick-outerbase --url "sqlite:///path/to/db.sqlite"

# libSQL / Turso
npx quick-outerbase --url "libsql://your-db.turso.io?authToken=..."

# DynamoDB
npx quick-outerbase --url "dynamodb://<region>"
```

It binds to `127.0.0.1` (loopback), runs single-user with no auth, and opens a web UI. That's the whole setup.

## What you get

**An ERD diagram, out of the box.** Tables render as cards with their columns, primary and foreign keys, and cardinality between relations. Layout is auto-arranged with [dagre](https://github.com/dagrejs/dagre), so you get a readable map of an unfamiliar schema instead of squinting at `\d+` output.

**Table structure at a glance.** Types, nullability, defaults, comments, and indexes — without writing a single query.

**Browse data without SQL.** A grid with filtering, sorting, and pagination, all done server-side so it doesn't choke on big tables.

**A query editor that actually knows your schema.** Autocomplete is aware of your real tables and columns, not a generic SQL keyword list.

**An optional text-to-SQL assistant.** Describe what you want in plain language and it drafts a query. It supports Anthropic, OpenAI, and Gemini, and your **API key lives only in `localStorage`** — it's never sent to a server we control. For DynamoDB, the assistant generates **PartiQL** instead of SQL, which is the honest way to query a key-value/document store.

That **multi-engine** reach — Postgres, MySQL/MariaDB, SQLite, libSQL/Turso, and **DynamoDB** in one tool — is the part I haven't found elsewhere in a single lightweight launcher.

## How the launcher actually works

The npm package is deliberately thin: a **launcher with zero runtime dependencies**. Here's the flow:

1. You run `npx quick-outerbase`.
2. The launcher downloads a **precompiled `standalone` runtime (~28MB)** from GitHub Releases — **once**.
3. It caches that runtime by **version + platform**, so subsequent runs start in seconds.

Prebuilt bundles ship for **`win32-x64`** and **`linux-x64`**. On macOS there's no prebuilt bundle yet, so you run it straight from source:

```bash
npx github:joajo13/quick-outerbase --url "postgres://..."
```

The upside of this design: installing the npm package doesn't drag a heavy toolchain into your project, and you don't pay the build cost on every invocation.

## Security: supply chain and blast radius

A tool that downloads a binary and connects to your database deserves scrutiny. Here's what v0.5.0 does about it:

- **Verified downloads.** The launcher checks the **SHA-256** of the downloaded bundle against a `checksums.json` that ships **signed inside the npm package**. A tampered bundle won't run.
- **Build provenance.** Bundles are published from CI with **npm provenance** and **GitHub artifact attestations**, so you can trace an artifact back to the workflow that built it.
- **Your `DATABASE_URL` stays put.** It's never persisted, never committed, and it's **redacted in logs**.
- **Local by default.** It binds to `127.0.0.1` and does **not** bind to `0.0.0.0` — your database UI isn't accidentally exposed to your network.

None of this makes it bulletproof, but it narrows the obvious attack surface for a dev tool of this shape.

## How it compares (honestly)

quick-outerbase isn't trying to dethrone anything. Where it fits:

| Tool | quick-outerbase's take |
|------|------------------------|
| **Prisma Studio** | Both are quick local GUIs, but Prisma Studio is tied to your Prisma schema. quick-outerbase is engine-driven (any supported `DATABASE_URL`) and adds an ERD and DynamoDB. |
| **Drizzle Studio** | Similar lightweight spirit; Drizzle Studio is centered on the Drizzle ecosystem. quick-outerbase is ORM-agnostic. |
| **DbGate** | DbGate is a more featureful, mature desktop app. quick-outerbase trades breadth for a single-command, zero-install workflow. |
| **TablePlus** | TablePlus is a polished **native** app with multi-connection management and far more maturity. quick-outerbase does **not** replace it — it's web-based, single-connection-per-run, and younger. |
| **Outerbase Studio (official)** | The upstream/official product has accounts, cloud, and collaboration. This fork has **none of that** — it's local-only and single-user by design. |

The honest summary: if you want a **mature, multi-connection native client**, use TablePlus. If you want **cloud, accounts, and team collaboration**, use Outerbase's official product. If you want to type one command and immediately look at *any* of five engines locally — with an ERD thrown in — that's the niche quick-outerbase is aiming at.

## Try it

```bash
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"
```

- Repo: <https://github.com/joajo13/quick-outerbase>
- npm: <https://www.npmjs.com/package/quick-outerbase>
- Current version: **0.5.0**

## The fork disclaimer (read this)

quick-outerbase is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio), distributed under the **AGPL-3.0** license. It is **not affiliated with, sponsored by, or endorsed by Outerbase.** All credit for the original Studio goes to the upstream project and its maintainers; this fork exists to scratch a specific itch — a fast, local, multi-engine, single-command database GUI — and to share it with anyone who has the same itch.

If you ship modifications of an AGPL-3.0 project, remember the license terms apply to you too. Read the [LICENSE](https://github.com/joajo13/quick-outerbase/blob/main/LICENSE) before you build on it.
