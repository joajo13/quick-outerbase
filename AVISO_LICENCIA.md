# Aviso de licencia y atribución

Este proyecto (**quick-outerbase**) es un fork de **Outerbase Studio**.

- **Proyecto original:** Outerbase Studio
- **Repositorio upstream:** https://github.com/outerbase/studio
- **Copyright:** © Outerbase y colaboradores
- **Licencia:** GNU Affero General Public License v3.0 (**AGPL-3.0**)

## Licencia: AGPL-3.0 (sin relicenciar)

Outerbase Studio se distribuye bajo **AGPL-3.0** (no MIT). El texto íntegro de la licencia
que cubre el código original se conserva **sin modificar** en [`./LICENSE`](./LICENSE).

Este fork **mantiene la misma licencia AGPL-3.0**. No se relicencia bajo otra cosa.

## Este fork SÍ se distribuye → cumplimos el copyleft

A diferencia de versiones previas (que eran de uso estrictamente local), **este fork ahora se
distribuye públicamente** vía GitHub y `npx` (`npx github:joajo13/quick-outerbase`). La AGPL-3.0
es copyleft fuerte e incluye la cláusula de red (sección 13). Por eso, para cumplir:

- **El código fuente completo está disponible**, públicamente, en
  https://github.com/joajo13/quick-outerbase — incluidas estas modificaciones.
- **Se conserva la licencia AGPL-3.0** y todos los avisos de copyright del original.
- **Se conserva esta atribución** a Outerbase Studio.
- Cualquiera que reciba o use este software por red tiene derecho a obtener su código fuente
  correspondiente, que es exactamente el de este repositorio.

Si redistribuís o desplegás este fork como servicio accesible por red, **debés** seguir
cumpliendo lo mismo: mantenerlo bajo AGPL-3.0, publicar el código fuente correspondiente
(incluyendo tus cambios) y conservar estos avisos.

## Modificaciones de este fork

Las modificaciones respecto del upstream (flujo agnóstico por `DATABASE_URL`, comando único
distribuible vía `npx`, mejoras de introspección/ERD/performance, integración con LLMs, etc.)
están descriptas en el [`README.md`](./README.md) y quedan cubiertas por la **misma licencia
AGPL-3.0** del original.

## No incluido en la distribución

Este paquete **no** incluye ni debe incluir credenciales, archivos `.env`, API keys ni datos
de bases de prueba. El `DATABASE_URL` siempre lo provee el usuario en tiempo de ejecución.
