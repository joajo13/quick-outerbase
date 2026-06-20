# DRAFT — para revisión humana, NO publicar todavía

> Este archivo es un borrador generado para preparar PRs a awesome-lists. NADA de esto está publicado.
> Un humano debe revisarlo, verificar que el proyecto cumpla los mínimos de cada lista (stars, antigüedad, README) y ajustar el wording antes de abrir cualquier PR.
> **Disclaimer obligatorio en todo material:** quick-outerbase es un fork NO OFICIAL de la comunidad de [Outerbase Studio](https://github.com/outerbase/studio), no está afiliado a Outerbase, y se distribuye bajo licencia **AGPL-3.0**.

---

## Línea lista para copiar (formato awesome-list)

Versión estándar (una línea, termina en punto):

```
[quick-outerbase](https://github.com/joajo13/quick-outerbase) - Terminal-launched local web GUI for PostgreSQL, MySQL, SQLite, libSQL/Turso and DynamoDB; one `npx` command, ERD, schema-aware query editor and text-to-SQL. Unofficial AGPL fork of Outerbase Studio.
```

Variante corta (para listas que exigen descripciones muy breves):

```
[quick-outerbase](https://github.com/joajo13/quick-outerbase) - One-command local web database GUI (Postgres/MySQL/SQLite/libSQL/DynamoDB). Unofficial AGPL fork of Outerbase Studio.
```

> Nota de wording: muchas awesome-lists prohíben empezar la descripción con mayúscula redundante o terminar sin punto. Las dos variantes ya respetan "guion + espacio, una frase, punto final". Ajustar a la convención puntual de cada lista (algunas usan `–` en vez de `-`, o no quieren punto final).

---

## A qué listas apuntar

| Lista (owner/repo) | Sección / categoría sugerida | Encaje | Notas |
|---|---|---|---|
| `sindresorhus/awesome-nodejs` | "Command-line apps" o "Command-line utilities" | Medio | Es una CLI/launcher npm. awesome-nodejs es MUY estricto: pide proyectos con tracción real y rechaza casi todo. Riesgo alto de rechazo si los stars son bajos. |
| `dhamaniasad/awesome-postgres` | "GUI" / "Tools" / "Utilities" | Alto | Encaja como GUI client de Postgres. Revisar la sección exacta vigente en el README. |
| `shlomi-noach/awesome-mysql` o `Imaginatorix/awesome-mysql` (verificar el fork activo) | "GUI" / "Tools" | Alto | Confirmar cuál es el repo mantenido hoy; awesome-mysql tuvo varios forks. |
| `dhamaniasad/awesome-database-tools` *(o la lista de DB tools activa)* | "GUI Clients" / "Database management" | Alto | Verificar que el repo siga mantenido; si no, buscar la alternativa viva. |
| `awesome-selfhosted/awesome-selfhosted` | "Database Management" | Medio-bajo | Encaja temáticamente (corrés tu propia GUI local), pero awesome-selfhosted pide software pensado para self-hosting *server* con criterios estrictos (licencia OSS ✓ AGPL, pero esto es single-user/loopback, no un servicio multiusuario). Posible rechazo por no ser "hosteable" en el sentido clásico. Evaluar antes de mandar. |
| `bnusunny/awesome-dynamodb` *(o la lista de DynamoDB con más tracción — verificar)* | "Tools" / "GUI" / "Clients" | Alto | Diferenciador fuerte: GUI local para DynamoDB con PartiQL asistido. Confirmar el repo canónico. |
| `dbeaver/awesome-db-tools` *(si existe/activa)* | "GUI" | Medio | Opcional, verificar existencia y mantenimiento. |
| `tobiasbueschel/awesome-pocket` / listas de Turso/libSQL | "Tools" | Medio | Si hay una awesome-list de Turso/libSQL o de "edge databases", encaja por el soporte libSQL/Turso. Buscar la canónica. |

> Importante: los owners/repos de varias de estas listas cambian seguido (forks, mantenedores que rotan). **Verificar manualmente cada `owner/repo` y la sección exacta en el README vigente antes de abrir el PR.** No confiar en esta tabla a ciegas.

---

## Reglas típicas de contribución a awesome-lists (a respetar)

- **Una sola entrada por PR**, salvo que el CONTRIBUTING de la lista diga lo contrario.
- **Orden alfabético** dentro de la sección (la mayoría lo exige; algunas ordenan por popularidad o cronología — leer el CONTRIBUTING).
- **Una línea, formato exacto:** `[nombre](url) - descripción.` con guion-espacio y punto final (salvo que la lista use otra convención).
- **Descripción objetiva, sin hype**: nada de "the best", "blazing fast", "revolutionary". Describí qué hace, no por qué es genial.
- **Sin self-promotion agresiva**: declarar que sos el autor/mantenedor si el CONTRIBUTING lo pide. Ser honesto. No spamear varias listas el mismo día con copy idéntico.
- **El proyecto debe tener tracción y un README decente**: README claro, instalación documentada, screenshots/GIF, licencia visible, releases recientes. Algunas listas piden explícitamente esto.
- **Mínimos de madurez/stars**: varias listas (sobre todo awesome-nodejs y awesome-selfhosted) piden **mínimos de stars, antigüedad y/o actividad**. *Nota honesta:* si el fork todavía no tiene esa tracción, es probable que rechacen el PR — conviene esperar a tener más stars/issues/releases antes de mandar a las listas más estrictas, y empezar por las de nicho (Postgres, MySQL, DynamoDB, DB-tools) que suelen ser más permisivas.
- **Respetar el template del PR** (muchas listas tienen checklist obligatorio en la plantilla de PR).
- **Pasar el linter**: varias listas corren `awesome-lint` en CI. Probar el formato localmente si se puede.
- **Disclaimer del fork**: como es un fork no oficial AGPL, dejarlo claro en la descripción (ya está en la línea) para no inducir a error de que es el Outerbase oficial.

---

## Mini-checklist para abrir cada PR (manual)

1. [ ] Abrir el README de la lista destino y confirmar **owner/repo** y **sección exacta** (la tabla de arriba es orientativa, verificar a mano).
2. [ ] Leer el `CONTRIBUTING.md` / `contributing.md` de esa lista entera. Anotar reglas particulares (orden, formato del guion, punto final, máximo de stars, etc.).
3. [ ] Confirmar que quick-outerbase **cumple los mínimos** de esa lista (stars, releases, README, screenshots). Si no, **no abrir el PR todavía**.
4. [ ] Fork de la lista + branch nuevo (`add-quick-outerbase`).
5. [ ] Insertar la línea en la **posición alfabética** correcta dentro de la sección elegida. Adaptar el formato (`-` vs `–`, punto final) a la convención de esa lista.
6. [ ] Correr el linter de la lista si tiene (`npx awesome-lint` o el script del repo). Que pase.
7. [ ] Commit con mensaje claro (ej: `Add quick-outerbase`).
8. [ ] Abrir el PR llenando **toda** la plantilla/checklist de PR de la lista.
9. [ ] En la descripción del PR: declarar honestamente que es un fork no oficial AGPL de Outerbase Studio y, si la lista lo pide, que estás afiliado al proyecto (sos mantenedor del fork).
10. [ ] No abrir todas las listas el mismo día con copy idéntico. Espaciar y adaptar cada descripción al contexto de la lista.

---

## Apéndice: datos del proyecto para llenar plantillas de PR

- **Repo:** https://github.com/joajo13/quick-outerbase
- **npm:** https://www.npmjs.com/package/quick-outerbase (`npx quick-outerbase --url "..."`)
- **Versión actual:** 0.5.0
- **Licencia:** AGPL-3.0
- **Qué es:** GUI de base de datos que corrés desde la terminal con un comando; levanta una UI web local (loopback `127.0.0.1`, sin auth, single-user). El driver se infiere del scheme del `DATABASE_URL`.
- **Motores:** PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso, DynamoDB.
- **Features clave:** diagrama ERD (auto-arrange dagre), inspección de estructura de tablas, grilla de datos con filtro/orden/paginado server-side, editor de queries con autocomplete consciente del schema, asistente LLM text-to-SQL (Anthropic/OpenAI/Gemini, API key solo en localStorage; PartiQL para DynamoDB).
- **Seguridad (v0.5.0):** verificación SHA-256 del bundle contra `checksums.json` firmado dentro del paquete npm; bundles publicados desde CI con npm provenance + GitHub artifact attestations; `DATABASE_URL` nunca se persiste ni se commitea (redactado en logs); default loopback, no bindea a `0.0.0.0`.
- **Plataformas con bundle precompilado:** win32-x64, linux-x64 (~28MB, se baja una vez y se cachea). macOS: correr desde código con `npx github:joajo13/quick-outerbase`.
- **Alternativa honesta a:** Prisma Studio, Drizzle Studio, DbGate, TablePlus, Outerbase Studio. NO reemplaza un cliente nativo maduro como TablePlus ni ofrece cuentas/cloud/colaboración como Outerbase oficial.
