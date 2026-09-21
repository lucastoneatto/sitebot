# Sitebot

Genera un chatbot RAG para cualquier sitio web: escanea el sitio, guarda el
contenido en Markdown, lo indexa en PostgreSQL + pgvector y entrega un snippet
para embeber el chat en tu web.

## Stack

- **API** (`api/`): NestJS + Drizzle ORM + Playwright (fallback) + OpenAI-compatible chat
- **Embeddings locales** (`Xenova/multilingual-e5-small`, 384 dims, CPU) vía transformers.js
- **Web** (`web/`): Next.js 15 (dashboard con login)
- **DB**: PostgreSQL 16 + pgvector (Docker)
- **Node 24** (`.nvmrc`)

`api` y `web` son proyectos independientes, con su propio `node_modules` y lockfile.

📚 **Documentación técnica completa**: ver [`/docs`](./docs) (Markdown, con
diagramas) o levantar el sitio Docusaurus en [`/docs-site`](./docs-site)
(`cd docs-site && pnpm install && pnpm start`).

## 🚀 Puesta en marcha rápida (Docker, un solo comando)

La forma más simple de levantar todo el proyecto en local. Solo necesitás
Docker y una API key de OpenAI (o cualquier proveedor compatible).

```bash
git clone <url-del-repo> sitebot && cd sitebot
cp .env.example .env
```

Editá `.env` y poné tu clave real:

```bash
OPENAI_API_KEY=sk-tu-clave-aqui
```

(el resto de las variables ya tienen valores por defecto que funcionan en
local sin tocar nada más). Después:

```bash
docker compose --profile full up --build
```

Esperá a que los 4 servicios (`db`, `dragonfly`, `api`, `web`) queden
"healthy" y entrá a **http://localhost:3000**. Registrate desde ahí, o si
querés un usuario admin ya creado corré una sola vez:

```bash
docker compose exec api pnpm seed:admin
```

y entrá con `admin@sitebot.local` / `password1234`.

Para parar todo: `docker compose down` (agregá `-v` si además querés borrar
los datos de la base).

> Este modo levanta también `api` y `web` dentro de Docker (perfil `full`).
> Es el camino más fácil, pero recompila las imágenes en cada cambio de
> código — para desarrollar con recarga en caliente, usá la sección
> siguiente.

## Requisitos (desarrollo local sin Docker completo)

- Node 24 (`nvm use`)
- pnpm 10
- Docker

## Puesta en marcha

```bash
# 0. Node 24
nvm use

# 1. Variables de entorno
cp .env.example .env            # edita OPENAI_API_KEY y JWT_SECRET
cp web/.env.example web/.env.local

# 2. Base de datos
docker compose up -d db

# 3. API (terminal 1)
nvm use
cd api
pnpm install
pnpm exec playwright install chromium   # solo para el fallback JS
pnpm db:migrate
pnpm seed:admin                        # crea el admin con SEED_ADMIN_*
pnpm dev                               # http://localhost:3001

# 4. Web (terminal 2)
nvm use
cd web
pnpm install
pnpm dev                               # http://localhost:3000
```

Todo en Docker (perfil `full`):

```bash
OPENAI_API_KEY=sk-... JWT_SECRET=... docker compose --profile full up --build
```

## Uso

1. Inicia sesión en http://localhost:3000 (por defecto `admin@sitebot.local` /
   `password1234` si usaste `pnpm seed:admin`), o regístrate.
2. Ingresa la URL del sitio y créalo.
3. Pulsa **Escanear sitio** (hasta `CRAWL_MAX_PAGES` páginas y `CRAWL_MAX_DEPTH`
   niveles). El contenido se indexa con embeddings locales (sin costo).
4. Abre **Ver landing** para previsualizar una landing (título, URL, resumen)
   con el widget inyectado.
5. Copia el snippet y pégalo en tu sitio:

```html
<script src="http://localhost:3001/widget.js" data-site-id="TU_SITE_ID" defer></script>
```

Opciones del widget: `data-color`, `data-title`, `data-greeting`, `data-position`
(`left`/`right`) y `data-api` (por defecto, el origen del script).

## Cómo funciona

1. **Descubrir**: lee `robots.txt` y `sitemap.xml` (incluye índices). Si no hay
   sitemap, navega enlaces internos del mismo dominio hasta `maxDepth`.
2. **Extraer**: `fetch` + Readability/Turndown (cheerio-first). Si la página es un
   shell JS, se renderiza con Playwright como fallback.
3. **Indexar**: el Markdown se divide en chunks (~375 tokens) y se generan
   embeddings `multilingual-e5-small` (384 dims, CPU) en `chunks.embedding`.
   El re-crawl es incremental (por `contentHash`) y reconcilia páginas borradas.
4. **Responder**: `POST /chat` busca los chunks más cercanos por similitud, arma
   el prompt y transmite la respuesta por SSE, con fuentes.

## Seguridad (mínima, single-instance)

- **Auth**: `users` + JWT. Las rutas admin (`/sites*`, `/auth/me`) requieren
  `Authorization: Bearer <token>`. Públicas: `/chat` (widget) y `/widget.js`.
- **Origen**: `/chat` valida `Origin` contra `allowedOrigins` + `DASHBOARD_ORIGINS`
  (`CORS_RELAXED=false` en prod).
- **Rate limiting**: `/chat` 15 req/min por IP, `/auth` 10/min, resto 120/min.
- **SSRF**: el crawler rechaza hosts que resuelven a IPs privadas/loopback/metadata.

## Endpoints

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/register` | no | Crear usuario |
| POST | `/auth/login` | no | Login → JWT |
| GET | `/auth/me` | sí | Usuario actual |
| POST | `/sites` | sí | Crear sitio |
| GET | `/sites` | sí | Listar sitios (con conteos) |
| GET | `/sites/:id` | sí | Detalle: sitio, último job, stats |
| PATCH | `/sites/:id` | sí | Nombre, orígenes, ajustes |
| DELETE | `/sites/:id` | sí | Eliminar sitio |
| POST | `/sites/:id/crawl` | sí | Iniciar rastreo + indexado |
| GET | `/sites/:id/status` | sí | Estado del sitio y último job |
| GET | `/sites/:id/pages` | sí | Páginas indexadas (paginado `?offset&limit`) |
| GET | `/sites/:id/pages/:pageId` | sí | Página con Markdown |
| POST | `/sites/:id/summary` | sí | Regenerar resumen |
| POST | `/chat` | no | RAG con streaming SSE (público) |
| GET | `/widget.js` | no | Script embebible |

## Entidad principal: `Site`

`users` → `sites` → `pages` → `chunks` (vectores) · `crawl_jobs` · `chat_sessions` → `messages`.
Borrar un usuario o sitio elimina en cascada todo su contenido.

## Scripts

**api**: `dev`, `build`, `start`, `typecheck`, `db:generate`, `db:migrate`, `db:push`, `seed:admin`
**web**: `dev`, `build`, `start`, `typecheck`
