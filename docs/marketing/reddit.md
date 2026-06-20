# DRAFT — REVISIÓN HUMANA REQUERIDA, NO PUBLICADO

> Esto es contenido **DRAFT** generado para evaluación. **Nada de esto está publicado.** Un humano tiene que leerlo, editarlo y postearlo a mano.
>
> **Antes de postear cualquiera de estos:**
> - Leé las reglas del subreddit. Casi todos tienen reglas anti-self-promotion específicas.
> - Muchos exigen **flair** (ej. "I made this", "Project", "Self-promotion") — fijate cuál corresponde.
> - Varios aplican un **ratio de no-promoción** (ej. 9:1 — por cada post tuyo, 9 comentarios/aportes genuinos). Si tu cuenta es nueva o solo postea tu proyecto, te van a banear o filtrar a /new sin que nadie lo vea.
> - Enmarcalo como **"I built / I open-sourced"**, no como anuncio comercial. Respondé comentarios, aceptá críticas.
> - **NO** cross-postees el mismo texto a todos los subs el mismo día. Espaciá días/semanas y adaptá de verdad cada uno.
> - El **disclaimer de fork no oficial** va SIEMPRE, no es opcional.
> - Postea desde una cuenta con historial real, no recién creada.

---

## Disclaimer reutilizable (pegar en todos)

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. It's an early project (v0.5.0) maintained by me — feedback and PRs welcome.

---

## r/node

**Flair sugerido:** algo tipo "Show & Tell" / "I made this" si existe.

**Título sugerido:**
`I built a one-command DB GUI you run with npx — multi-engine (Postgres/MySQL/SQLite/Turso/DynamoDB), zero runtime deps`

**Cuerpo:**

I wanted to peek at my database without opening a heavy desktop app, so I've been working on **quick-outerbase**: a database GUI that runs in your terminal via a single command.

```bash
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"
```

It spins up a local web UI (loopback only, single-user, no auth) and infers the driver from the URL scheme. Engines: PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso, DynamoDB.

A few things that might interest this sub specifically:

- **The npm package is a thin launcher with zero runtime dependencies.** It downloads a precompiled standalone runtime (~28MB) once from GitHub Releases, caches it by version+platform, and boots in seconds. Prebuilt bundles for `win32-x64` and `linux-x64`; on macOS you run from source with `npx github:joajo13/quick-outerbase`.
- **Supply-chain stuff (v0.5.0):** the launcher verifies the downloaded bundle's SHA-256 against a signed `checksums.json` shipped inside the npm package, and bundles are published from CI with **npm provenance + GitHub artifact attestations**. The `DATABASE_URL` is never persisted or committed, and it's redacted in logs.

Features: schema-aware SQL autocomplete, ERD diagram, browse data without writing SQL (server-side filter/sort/paginate), and an optional LLM text-to-SQL assistant (Anthropic/OpenAI/Gemini — API key lives only in localStorage).

Honest scope: it's not a replacement for TablePlus (native, multi-connection, way more mature). It's for when you just want to look at your DB fast without installing anything heavy.

Repo: https://github.com/joajo13/quick-outerbase
npm: https://www.npmjs.com/package/quick-outerbase

Curious what people here think about the thin-launcher + cached-standalone-runtime approach — happy to go into detail on the packaging if anyone's interested.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me — feedback and PRs welcome.

---

## r/PostgreSQL

**Flair sugerido:** "Tools" / "Project" si existe. Ojo: este sub es bastante estricto con la promo, asegurate ratio de aportes.

**Título sugerido:**
`Open-sourced a terminal-launched Postgres GUI with an auto-generated ERD (npx, one command)`

**Cuerpo:**

I've been building **quick-outerbase**, an open-source DB GUI you launch from the terminal. Sharing it here because the Postgres workflow is the one I use most.

```bash
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"
```

It opens a local web UI (127.0.0.1 only, no auth, single-user) — it does **not** bind to 0.0.0.0.

Postgres-relevant bits:

- **ERD diagram:** tables rendered as cards with PK/FK and cardinality, auto-arranged with dagre. Useful for getting a quick mental map of an unfamiliar schema.
- **Structure view:** column types, nullable, defaults, **comments**, and indexes.
- **Data browsing without SQL:** grid with server-side filter / sort / pagination.
- **Query editor** with autocomplete that's aware of your actual schema.
- Optional LLM text-to-SQL assistant (bring your own key; it stays in localStorage).

On the URL handling: the `DATABASE_URL` is never persisted or committed and is redacted in logs. Default bind is loopback.

It's not trying to be a full pgAdmin/DBeaver replacement — no server administration, no role management, etc. It's aimed at "I want to explore/query this database quickly without setting up a heavy client."

Repo: https://github.com/joajo13/quick-outerbase

Would genuinely appreciate feedback from people who stare at Postgres schemas all day — especially on the ERD and what's missing in the structure view.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me — feedback welcome.

---

## r/webdev

**Flair sugerido:** "Showoff Saturday" es ideal acá — r/webdev concentra la self-promo en ese día. **Postealo un sábado** con ese flair, no entre semana.

**Título sugerido:**
`[Showoff Saturday] A DB GUI you run with one npx command — Postgres/MySQL/SQLite/Turso/DynamoDB`

**Cuerpo:**

If you use Prisma or Drizzle and just want to *look* at your database without opening a full desktop client, I made something for that: **quick-outerbase**.

```bash
npx quick-outerbase --url "mysql://user:pass@localhost:3306/mydb"
```

One command → local web UI (loopback, single-user, no auth). The driver is inferred from the URL scheme, so the same command works across PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso, and DynamoDB.

What it does:

- Browse data in a grid (server-side filter/sort/paginate) without writing SQL.
- See table structure: types, nullable, defaults, comments, indexes.
- Auto-generated **ERD** (PK/FK, cardinality, auto-layout).
- Query editor with schema-aware autocomplete.
- Optional text-to-SQL via Anthropic/OpenAI/Gemini — your API key lives only in localStorage.

Under the hood it's a thin npm launcher (zero runtime deps) that fetches a precompiled standalone runtime once and caches it, so startup is fast after the first run.

Honest take: it won't replace TablePlus if you live in a native multi-connection client all day. It's for the "quick peek" use case, and it's open-source (AGPL-3.0).

Repo: https://github.com/joajo13/quick-outerbase

Open to feedback / what feels janky.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me.

---

## r/selfhosted

**Flair sugerido:** "Release" / "Software" según corresponda. Este sub valora open-source, privacidad y que no llame a casa más de lo necesario — sé explícito en eso. Ojo con la regla de "no afiliación/promo encubierta".

**Título sugerido:**
`quick-outerbase: a local, single-user DB GUI (AGPL) — loopback only, BYO LLM key, no telemetry cloud`

**Cuerpo:**

Sharing an open-source project I've been working on for the "I want to inspect my self-hosted database without exposing anything" use case: **quick-outerbase**.

```bash
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"
```

Why it might fit this sub:

- **Loopback by default.** Binds to `127.0.0.1`, **not** `0.0.0.0`. Single-user, no auth layer (it's meant for *you*, locally — put it behind your own tunnel/VPN if you need remote).
- **Open source, AGPL-3.0.** Self-hostable by design; it's just a local process.
- **Secrets handling:** the `DATABASE_URL` is never persisted or committed, and it's redacted in logs.
- **Supply chain:** the npm launcher verifies the downloaded runtime's SHA-256 against a signed `checksums.json` inside the package, and bundles ship from CI with npm provenance + GitHub artifact attestations. (It does download a ~28MB precompiled runtime once from GitHub Releases and caches it — worth knowing if you want fully air-gapped; on macOS / other setups you can run straight from source.)
- **The LLM assistant is optional and BYO-key** — the key stays in localStorage, nothing is sent anywhere unless you turn it on and provide your own provider key.

Engines: PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso, DynamoDB. Features include an auto-generated ERD, structure view, no-SQL data browsing, and a schema-aware query editor.

Not a multi-user admin panel and not trying to be — no accounts, no cloud, no collaboration. Just a local viewer/editor you launch when you need it.

Repo: https://github.com/joajo13/quick-outerbase

Feedback welcome, especially on the security/privacy defaults.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me.

---

## r/Database

**Flair sugerido:** verificá si pide flair de tipo "Tool"/"Project". Sub más teórico/heterogéneo — enfocá en lo cross-engine y el ERD, evitá sonar a anuncio.

**Título sugerido:**
`Built a cross-engine DB GUI (Postgres/MySQL/SQLite/Turso/DynamoDB) with a single launch command + ERD`

**Cuerpo:**

I've been working on **quick-outerbase**, an open-source database GUI that you launch from the terminal with one command and a connection URL:

```bash
npx quick-outerbase --url "<scheme>://..."
```

The driver is inferred from the URL scheme, and the same workflow spans relational engines (PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso) and a NoSQL one (DynamoDB).

The parts I think are interesting from a "looking at databases" angle:

- **Auto-generated ERD:** tables as cards with PK/FK, cardinality, dagre auto-layout — quick orientation on an unfamiliar schema.
- **Structure view:** types, nullable, defaults, comments, indexes.
- **Data exploration without SQL:** grid with server-side filter/sort/pagination.
- **Schema-aware query editor** with autocomplete based on the real schema.
- For DynamoDB, the optional LLM assistant generates **PartiQL** instead of SQL, since the query model is different.

It runs locally (loopback, single-user, no auth) and is AGPL-3.0.

It's deliberately scoped to exploration/querying/light editing — not administration, tuning, or multi-user management.

Repo: https://github.com/joajo13/quick-outerbase

I'd be interested in how people here think about a single tool spanning relational + NoSQL — where that abstraction helps vs. where it breaks down.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me.

---

## r/aws

**Flair sugerido:** "Discussion" o el que corresponda a proyectos/herramientas. **Ojo:** r/aws es estricto con self-promo — leé las reglas, posible que requieran que no sea tu primer/único post. Enfocá 100% en DynamoDB, no en el resto de motores.

**Título sugerido:**
`Open-sourced a local DynamoDB GUI that runs with one npx command (browse tables, run PartiQL, AI-generated PartiQL)`

**Cuerpo:**

Working with DynamoDB without a decent local viewer can be painful, so I added DynamoDB support to an open-source GUI I've been building, **quick-outerbase**. Sharing the DynamoDB angle specifically here.

You launch it from the terminal:

```bash
npx quick-outerbase --url "dynamodb://<region>"
```

It opens a local web UI (loopback, single-user) for exploring your tables. DynamoDB-specific bits:

- Browse tables and items, see structure, paginate through data without hand-writing queries.
- Run **PartiQL** directly in the query editor.
- The optional LLM assistant generates **PartiQL** (not SQL) for DynamoDB — it's dialect-aware, so it won't hand you relational SQL that doesn't apply.

It also supports a few relational engines, but I'll keep this post focused on DynamoDB since that's the AWS-relevant part.

On credentials/privacy: the connection details aren't persisted or committed and are redacted in logs; the UI binds to `127.0.0.1` only. If you use the AI assistant, the LLM API key stays in localStorage and is opt-in.

Repo: https://github.com/joajo13/quick-outerbase

Genuinely curious what DynamoDB users feel is missing from existing local tooling — single-table-design exploration, GSIs, etc. — so I can prioritize.

> Disclaimer: this is an **unofficial community fork** of [Outerbase Studio](https://github.com/outerbase/studio). Not affiliated with or endorsed by Outerbase. Licensed under **AGPL-3.0**. Early project, maintained by me.

---

## Checklist final antes de postear (para el humano)

- [ ] Leíste las reglas del sub específico y elegiste el flair correcto.
- [ ] Tu cuenta tiene historial / karma suficiente para no caer en spam filter.
- [ ] No estás violando el ratio de self-promo del sub.
- [ ] El disclaimer de fork AGPL/no oficial está presente.
- [ ] No vas a cross-postear todo el mismo día — espacialos.
- [ ] Vas a estar disponible para responder comentarios las primeras horas.
- [ ] Verificaste que los links (repo/npm) funcionan y la versión (0.5.0) es la correcta.
