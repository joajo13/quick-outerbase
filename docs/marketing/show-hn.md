---
DRAFT — para revisión humana. NO publicado. Revisar links, versión y claims antes de mandar a HN.
---

# Show HN draft — quick-outerbase

## Título (elegir uno)

**Opción A (recomendada):**
`Show HN: quick-outerbase – a one-command database GUI for your terminal`

**Opción B:**
`Show HN: One command to get a local DB GUI (Postgres, MySQL, SQLite, Turso, DynamoDB)`

**Opción C:**
`Show HN: A community fork of Outerbase Studio you run with npx + a DATABASE_URL`

---

## Primer comentario del autor

Hola HN.

quick-outerbase es una GUI de base de datos que corrés en tu terminal. Le pasás un `DATABASE_URL` y con un comando levanta una UI web local para explorar, consultar y editar tu base:

```
npx quick-outerbase --url "postgres://user:pass@localhost:5432/mydb"
```

El driver se infiere del scheme del URL. Soporta PostgreSQL, MySQL/MariaDB, SQLite, libSQL/Turso y DynamoDB.

**Por qué lo hice:** uso Prisma y Drizzle todo el día y quería mirar mi base rápido sin abrir una app pesada ni configurar una conexión a mano cada vez. Ya tengo el `DATABASE_URL` en el `.env`; quería pasárselo y listo. También quería algo que manejara DynamoDB al lado de las SQL clásicas sin cambiar de herramienta.

**Cómo funciona:** el paquete de npm es un launcher fino, sin dependencias de runtime. La primera vez baja un runtime precompilado (~28MB, standalone) desde GitHub Releases, lo cachea por versión+plataforma y arranca en segundos. Hay bundles para win32-x64 y linux-x64; en macOS por ahora se corre desde el código con `npx github:joajo13/quick-outerbase`.

**Qué trae:**
- Diagrama ERD (tablas como tarjetas, PK/FK, cardinalidad, auto-arrange con dagre)
- Ver estructura de tablas: tipos, nullable, defaults, comments, índices
- Ver datos sin escribir SQL: grilla con filtro/orden/paginado server-side
- Editor de queries con autocomplete consciente del schema real
- Asistente text-to-SQL opcional (Anthropic/OpenAI/Gemini). La API key vive solo en localStorage del browser. Para DynamoDB genera PartiQL.

**Sobre seguridad (v0.5.0):** el launcher verifica el SHA-256 del bundle bajado contra un `checksums.json` que viaja firmado dentro del paquete de npm. Los bundles se publican desde CI con provenance (npm provenance + GitHub artifact attestations). El `DATABASE_URL` nunca se persiste ni se commitea y se redacta en logs. Por default bindea a loopback `127.0.0.1`, no a `0.0.0.0`. Sin auth, single-user, pensado para correr en tu propia máquina.

**Diferenciador honesto:** un comando, multi-motor (incluido DynamoDB), corre local sin instalar nada pesado, open-source, y trae ERD. No es un reemplazo full de TablePlus, que es nativo, multi-conexión y mucho más maduro; ni tiene cuentas/cloud/colaboración como el Outerbase oficial.

**Disclaimer importante:** esto es un fork NO OFICIAL hecho por la comunidad de [Outerbase Studio](https://github.com/outerbase/studio). No estoy afiliado a Outerbase. Licencia AGPL-3.0 (igual que el upstream).

Repo: https://github.com/joajo13/quick-outerbase
npm: https://www.npmjs.com/package/quick-outerbase

Feedback bienvenido, sobre todo en la parte de seguridad del binario y en los drivers. Gracias por mirar.

---

## Respuestas preparadas (FAQ probable de HN)

**> ¿Por qué un fork y no contribuir upstream?**

Buena pregunta y lo pensé. El foco de Outerbase Studio (y de Outerbase como producto) apunta a un modelo con cuentas/cloud/colaboración. Lo que yo quería era lo opuesto: un binario efímero, single-user, cero-config, que corrés con un comando y matás. Es un caso de uso lo bastante distinto como para que ensuciar el upstream con él no tuviera mucho sentido. Es AGPL, así que el fork respeta la licencia y los créditos van todos al proyecto original. Si algo de acá tiene sentido upstream, feliz de mandarlo como PR.

**> Bajar y ejecutar un binario desde GitHub Releases me da cosa. ¿Por qué debería confiar?**

Totalmente razonable, es la parte que más me preocupa a mí también. Lo que hay hoy: el launcher verifica el SHA-256 del bundle contra un `checksums.json` firmado que viaja dentro del paquete de npm (o sea, la verificación no depende de volver a pegarle a la red). Los bundles se publican desde CI con npm provenance y GitHub artifact attestations, así que podés rastrear el binario hasta el commit y el workflow que lo construyó. Si no querés ejecutar el precompilado, podés correrlo directo desde el código con `npx github:joajo13/quick-outerbase` y te salteás el bundle por completo. Toda crítica a este esquema es muy bienvenida.

**> AGPL. ¿Por qué, y qué implica para mí?**

El upstream es AGPL-3.0, así que el fork también lo es; no hay opción ahí. Para vos como usuario que la corre local para mirar tu base no cambia nada. La AGPL importa si ofrecés el software modificado como servicio en red a terceros: en ese caso tenés que poner a disposición tu código fuente. Para uso local en tu máquina, ni te enterás.

**> ¿En qué se diferencia de TablePlus / DBeaver?**

No compite de igual a igual y no quiero venderlo así. TablePlus y DBeaver son apps nativas, maduras, con multi-conexión, gestión de conexiones guardadas, export/import, y un montón de features que esto no tiene. quick-outerbase apunta a otra cosa: no instalás nada, no guardás conexiones, le pasás el `DATABASE_URL` que ya tenés en el `.env` y arranca. Es para el momento "quiero mirar esta base AHORA" más que para ser tu cliente de DB principal. Si TablePlus te sirve, quedate con TablePlus.

**> ¿Por qué no uso `psql` / `mysql` / la CLI y listo?**

Si vivís cómodo en `psql`, dale, es buenísimo. Esto es para cuando querés algo visual: ver el ERD de un schema que no conocés, navegar datos con filtro/orden/paginado sin escribir SQL, o ver de un vistazo tipos, índices y FKs. Y cubre Postgres, MySQL, SQLite, Turso y DynamoDB con la misma UI, así que no tenés que recordar la CLI específica de cada motor. Es un complemento de la terminal, no un reemplazo.

**> El asistente de IA, ¿manda mi schema/datos a un tercero?**

Solo si vos lo activás y ponés tu propia API key (Anthropic/OpenAI/Gemini). La key vive únicamente en el localStorage de tu browser, no toca el server ni se persiste del lado del launcher. Si no usás el asistente, no sale nada a ningún lado. Es opt-in.

**> ¿Por qué Electron/web y no una app nativa?**

No es Electron: es una UI web que corre en un runtime standalone local y la abrís en tu browser. Esa decisión es la que permite reusar el frontend del upstream y soportar varios motores rápido. El costo es que no es tan liviano ni tan integrado como una app nativa de verdad. Trade-off consciente.

**> ¿Solo lectura o también escribe?**

Escribe: podés editar datos y correr queries. Por eso el default es loopback y single-user sin exponer a la red. Tratalo como una herramienta de tu propia máquina, no como algo para dejar corriendo en un server compartido.
