# Marketing drafts — quick-outerbase (NO publicado)

> ⚠️ **Todo lo que hay en esta carpeta son DRAFTS para revisión humana.**
> Nada está publicado. Es contenido *outward* (lo lee gente real): un humano tiene que
> leerlo, ajustarlo y publicarlo **a mano** desde sus propias cuentas. Claude **no** abre
> PRs a repos de terceros ni postea en ninguna plataforma de forma autónoma.

## Archivos

| Archivo | Canal | Qué hacer |
|---|---|---|
| [`awesome-lists.md`](./awesome-lists.md) | PRs a awesome-lists | Verificar owner/repo y sección de cada lista, cumplir mínimos de stars/madurez, abrir PRs a mano. |
| [`blogpost.md`](./blogpost.md) | dev.to / blog | Revisar claims, setear `published: true`, ajustar tags/canonical. |
| [`show-hn.md`](./show-hn.md) | Hacker News | Elegir título, postear, estar disponible para responder. |
| [`reddit.md`](./reddit.md) | r/node, r/PostgreSQL, r/webdev, r/selfhosted, r/Database, r/aws | Un post por sub, espaciados, respetando reglas y flair de cada uno. |

## Checklist de pasos manuales (orden sugerido)

1. [ ] Revisar que la **v0.5.0 esté publicada en npm** y el README del repo esté pulido (es la landing).
2. [ ] Confirmar que los **links** (repo, npm) y la **versión** (0.5.0) sean correctos en cada draft.
3. [ ] **blogpost** primero (dev.to): genera un canonical/backlink propio para citar después.
4. [ ] **Show HN**: postear en un horario de tráfico (mañana ET, días de semana), estar atento a comentarios.
5. [ ] **Reddit**: NO cross-postear el mismo día. Empezar por el sub donde tengas más historial/karma. Leer reglas + flair de cada uno (varios exigen ratio anti-self-promo).
6. [ ] **awesome-lists**: dejar para cuando haya algo de tracción (stars/issues/releases). Empezar por listas de nicho (Postgres/MySQL/DynamoDB/db-tools), no por awesome-nodejs (muy estricta).
7. [ ] En **todos**: mantener el disclaimer de fork no oficial AGPL.

## Notas de la auditoría (hallazgos diferidos / aceptados)

Estos hallazgos del reporte de auditoría **no** se implementan en este release, por decisión:

- **B1 — extracción sin depender del `tar` del sistema:** *riesgo bajo, aceptado.* El launcher
  usa el `tar` del PATH (Windows 10+ lo trae como `tar.exe`). Implementar extracción en
  proceso (tar-stream + `node:zlib`) rompería el principio de **cero dependencias de
  runtime** del launcher. Se mantiene como está y se documenta en el README (sección
  "Modelo de red y seguridad").
- **B2 — renombrar a un scope npm:** *no se hace.* No se renombra el paquete. La mitigación
  acordada es el **disclaimer de "fork no oficial de la comunidad"** en el README (repo +
  npm) y en `SECURITY.md`, ya implementado en v0.5.0.
