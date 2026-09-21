# Auditoría técnica — Sitebot

> Fecha: 18 sep 2026 · Alcance: `api/` (NestJS 11) + `web/` (Next.js 15) + `docker-compose.yml`
> Objetivo del producto: **ser el más barato, fiable para casos simples**.
>
> **Estado**: las fases 0, 1 y 2 están implementadas y verificadas. Este documento se
> ha limpiado de todo lo ya resuelto; solo queda **lo pendiente**. El histórico de
> hallazgos cerrados está en el git log, no aquí.

---

## 1. Qué está cerrado (resumen, sin detalle)

Fases 0-2 completas: cuotas por sitio, coste por modelo, abort de streams,
reconciliación corregida, re-crawl programado, rate limit por sesión, tests del
núcleo (37, en `api/test/`), `JWT_SECRET` fail-fast, prompt por sitio,
conversaciones + analítica, reset de contraseña, marca condicionada al plan,
`/admin` con basic auth, landing en `/`, y el filtro anti-WAF del crawler.

---

## 2. Hallazgos abiertos

Nada crítico. Los hallazgos de la revisión de código del 18 sep 2026 están
corregidos y verificados (ver sección 3). Queda pendiente solo esto:

### 2.1 Baja — crawls en memoria, sin reanudación

`crawler.service.ts`: la cola vive en memoria y `MAX_CONCURRENT_CRAWLS = 2`. Un
reinicio marca el job como `error` (lo hace `StartupService`) pero no lo reanuda.
Correcto para arrancar, insuficiente si un día hay varios operadores. No tocar
hasta que duela: una cola persistente es complejidad real.

### 2.2 Baja — `web/app/dashboard/sites/[id]/page.tsx` sigue en 368 líneas

Mezcla ajustes, costes, playground y estado del crawl. Partirlo en componentes
haría que cada cambio futuro toque un archivo pequeño. Hacerlo cuando se vuelva a
tocar, no como tarea aparte.

### 2.3 Decisión pendiente — el playground no recoge valoraciones

El widget tiene botones 👍/👎; el playground del dashboard no. Es razonable (el
playground es para probar, no para medir), pero conviene que sea una decisión
explícita y no una asimetría accidental.

---

## 3. Corregido en la revisión del 18 sep 2026

| # | Hallazgo | Arreglo | Verificación |
|---|---|---|---|
| 1 | `SessionRateLimiter` crecía sin límite (fuga de memoria) | Barrido de ventanas caducadas cada 500 comprobaciones | Test: 400 sesiones → purga al cruzar el umbral |
| 2 | `chatMinScore` configurado y sin usar | `keepRelevant()` con corte **relativo**, conectado a `retrieve()` | 3213 → 825 tokens de entrada, misma respuesta |
| 3 | `/docs/page` bloqueado por el filtro de rutas | `PAGINATION_PATH` exige número (`/page/2`) | Tests de regresión en `url.test.ts` |
| 4 | `chatSessions` sin caducidad | Purga por antigüedad en el scheduler | `CONVERSATION_RETENTION_DAYS=180` |
| 5 | Sin observabilidad | `GET /health` comprueba la BD | `{"status":"ok","database":"up"}` |
| 6 | Playwright siempre instalado | `CRAWL_RENDER_JS` + import diferido | Chromium no se carga si está en `false` |
| 7 | `money()` triplicado en `/admin` | Extraído a `web/lib/format.ts` | Typecheck limpio |

### 3.1 El hallazgo que cambió al medirlo

`chatMinScore` parecía un filtro de coste a medio conectar. Al conectarlo se vio
que **un umbral absoluto no podía funcionar**: con `multilingual-e5-small` la
similitud coseno entre dos chunks cualesquiera del índice ronda **0.93**, y el
top-10 de una consulta ocupa un rango de solo **0.0085**. Con ese espacio tan
comprimido, un umbral de 0.15 no descarta nada — hasta una pregunta sobre sushi
en un sitio de jubilaciones puntúa ~0.85.

Lo que sí separa es la **distancia al mejor resultado**. De ahí
`chatRelativeMargin` (0.02, del orden del rango real medido, no de la escala
0-1). Resultado medido en producción: una consulta on-topic pasó de **3213 a 825
tokens de entrada (-74 %)** dando la misma respuesta, y las preguntas fuera de
tema siguen respondiendo "no estoy preparado".

La lección para futuras fases: **los umbrales de similitud dependen del modelo de
embeddings y hay que calibrarlos contra el índice real**, no elegirlos a ojo
sobre la escala 0-1. Si algún día se cambia el modelo, hay que volver a medir.

---

## 4. Qué NO conviene tocar

- **La recuperación híbrida (RRF)**: corta, testeada y gratis.
- **`crawler.service.ts:process()`**: largo (200 líneas) pero es un BFS lineal;
  partirlo repartiría el estado mutable compartido y lo haría *más* difícil de
  seguir, no menos.
- **`config.ts` como objeto plano**: simple y suficiente.
- **Los tests con `node:test`**: cero dependencias nuevas, imagen ligera.
- **`sites.service.ts:detail()`**: el SQL crudo es feo pero está aislado y
  funciona; tocarlo sin necesidad solo arriesga los contadores del dashboard.

---

## 5. Fase 3 en detalle — apertura del nicho docs

> Añadido tras completar las fases 0-2. Es **diseño, no implementación**: describe
> cómo abordar "aceptar Markdown/archivo como fuente" y "auto-sync de un repo de
> docs" sin romper la regla de "precio primero".

### 5.1 Por qué esta fase y no otra

Hoy la única fuente es **URL/HTML**. El nicho de documentación suele vivir en un
repo (`/docs/*.md`, MkDocs, Docusaurus, mdBook). Hay dos formas de entrar y solo
una es barata:

- ❌ **Conectores** (Notion, Confluence, Zendesk, GitBook): cada uno es OAuth +
  paginación + mapeo de permisos + mantenimiento perpetuo. Va contra la estrategia.
- ✅ **Markdown directo** (fichero subido o repo público de Git): el pipeline
  `markdown → chunks → embeddings` **ya existe**. Lo único nuevo es *de dónde sale
  el Markdown*. Coste marginal casi nulo y abre el caso "docs" entero.

La clave es que el sistema ya está partido por la mitad correcta:
`crawler` produce Markdown → `ingest.ingestPage()` lo consume. La Fase 3 no toca
el segundo tramo, solo añade productores.

### 5.2 El cambio conceptual: de "sitio" a "fuente"

Hoy `sites` asume implícitamente que su origen es una URL rastreable. Conviene
introducir un discriminador explícito y dejar de tratar la URL como única verdad:

```ts
// schema.ts
export const sourceTypeEnum = pgEnum('source_type', ['web', 'upload', 'git']);

// en sites:
sourceType: sourceTypeEnum('source_type').notNull().default('web'),
sourceConfig: jsonb('source_config').$type<SourceConfig>().notNull().default({}),
```

```ts
type SourceConfig =
  | { kind: 'web' }                                   // lo actual
  | { kind: 'upload' }                                // ficheros subidos
  | { kind: 'git'; repo: string; branch: string;
      docsPath: string; baseUrl?: string };           // repo de docs
```

`sourceType: 'web'` con `sourceConfig: {}` describe **exactamente** el
comportamiento de hoy, así que la migración es puramente aditiva y ningún sitio
existente cambia de conducta.

**Contrato común.** Definir una interfaz que los tres productores cumplen, y que
es lo que `crawler.service.ts` ya produce de facto:

```ts
type SourceDocument = {
  url: string;        // identidad estable: clave de pages_site_url_idx
  title: string | null;
  markdown: string;
};

interface SourceProvider {
  collect(site: Site): AsyncGenerator<SourceDocument>;
}
```

Con esto, `savePage` + `contentHash` + `reconcile` + `ingestPage` se reutilizan
**sin tocarlos**: el re-crawl incremental, el borrado de obsoletos y el cálculo de
coste ya funcionan para las fuentes nuevas el primer día.

### 5.3 Fuente A — fichero Markdown subido (la más barata)

**Alcance**: subir uno o varios `.md`/`.mdx`/`.txt`, o un `.zip` con un árbol de
docs.

- **Endpoint**: `POST /sites/:id/upload` (multipart). Nest ya trae `FileInterceptor`.
- **Identidad de página**: no hay URL real. Usar un esquema sintético estable,
  `file://<ruta-relativa>`, y permitir un `baseUrl` opcional del sitio para que las
  citas del widget enlacen a la doc publicada (`https://docs.tuweb.com/<ruta>.html`).
  Sin `baseUrl`, el widget debe mostrar el título **sin enlace** — hoy `ChatSource`
  asume que `url` es navegable y el prompt obliga a citar con enlace Markdown; eso
  hay que condicionarlo o el bot generará enlaces rotos.
- **Frontmatter**: si el `.md` trae YAML (`---\ntitle: ...\n---`), extraer `title` y
  quitarlo del cuerpo para que no contamine los embeddings.
- **Reconciliación**: en una subida completa, el conjunto subido **es** el universo
  de URLs conocidas → `computeStaleUrls` borra lo que ya no venga. Encaja sin cambios.

**Límites que hay que poner desde el principio** (son protección de margen, igual
que las cuotas de la Fase 0): tamaño máximo por fichero, número máximo de ficheros,
y rechazar `.zip` con rutas `../` (zip-slip) o ratios de descompresión absurdos.

**Coste estimado**: 1-2 días. Es la pieza con mejor relación valor/esfuerzo.

### 5.4 Fuente B — repo de docs con auto-sync

**Alcance**: repo público de GitHub/GitLab, rama y subcarpeta (`docs/`).

Dos estrategias, y la barata no es la obvia:

| | `git clone` | API de árbol (tarball) |
|---|---|---|
| Dependencia | binario `git` en la imagen | solo `fetch` |
| Coste incremental | `git pull` es muy eficiente | descarga el tarball entero |
| Privados | SSH keys / tokens | token |

**Recomendación: tarball vía HTTPS** (`https://codeload.github.com/<repo>/tar.gz/<ref>`).
Evita meter `git` en la imagen (la Fase 0 ya señalaba a Playwright como lastre; no
conviene añadir otro) y un repo de docs pesa poca cosa. Se descomprime en un
directorio temporal, se recorre `docsPath`, se emiten los `SourceDocument` y se borra.

**Detección de cambios sin descargar nada**: guardar el SHA del último commit
sincronizado. Antes de bajar el tarball, consultar el commit de la rama
(`GET /repos/{owner}/{repo}/commits/{branch}`, ~1 petición). Si el SHA no cambió,
**no se descarga nada y no se reindexa nada**. Esto hace que el auto-sync diario de
un repo cueste literalmente una petición HTTP. Es la misma idea del `contentHash`
por página, un nivel más arriba.

**Reutilización del scheduler**: `CrawlSchedulerService` ya recorre los sitios con
`autoSync` y respeta `syncIntervalHours`. Basta con que despache según `sourceType`
en vez de llamar siempre al crawler web. El resto (cola, concurrencia, recuperación
de jobs huérfanos en `StartupService`) no cambia.

**Mapeo a URLs públicas**: `docs/guia/inicio.md` → `${baseUrl}/guia/inicio/`. Las
convenciones difieren entre generadores (Docusaurus quita `index`, MkDocs usa
directorios). Empezar con una regla simple y configurable; no intentar soportar
todos los generadores.

**Coste estimado**: 3-5 días, la mayor parte en el mapeo de URLs y en el manejo de
errores de red.

### 5.5 Riesgos concretos detectados al revisar el código

1. **El prompt asume que toda fuente es un enlace navegable**
   (`chat.service.ts`, instrucción de citar con `[ver más](URL)`). Con ficheros
   subidos sin `baseUrl`, el modelo inventará enlaces. Hay que variar la
   instrucción según `sourceType`. **Es el punto que más degradaría la calidad
   percibida si se pasa por alto.**
2. **`pages.url` es la clave de identidad** (`pages_site_url_idx`). Si el esquema
   sintético de URLs cambia entre versiones, se duplica todo el índice. Conviene
   fijarlo y documentarlo antes de la primera release.
3. **Playwright y SSRF sobran en estas fuentes**: `upload` y `git` no deben pasar
   por `fetchHtml` ni por el fallback de navegador. Separar bien los productores
   evita arrastrar ese coste (y confirma que Playwright puede ser opt-in, como ya
   señalaba 4.3.5).
4. **Límite de tamaño**: un repo de docs grande puede superar ampliamente el
   `maxPages` pensado para web. Revisar que la cuota por sitio siga teniendo sentido
   en esta fuente.

### 5.6 Orden sugerido

1. `sourceType` + `sourceConfig` en el esquema (migración aditiva, sin cambio de conducta).
2. Extraer el productor web actual detrás de la interfaz `SourceProvider` — refactor
   puro, cubierto por los tests de `reconcile` y `chunker` que ya existen.
3. Fuente `upload` (incluye resolver el tema de las citas sin URL navegable).
4. Fuente `git` + SHA de commit + despacho en el scheduler.
5. UI: selector de tipo de fuente al crear el sitio.

Los pasos 1 y 2 no aportan valor visible al usuario, pero sin ellos los pasos 3 y 4
se convierten en dos ramas paralelas de código de crawling duplicado.
