# Sitebot

Generates a RAG chatbot for any website: it scans the site, saves the
content in Markdown, indexes it in PostgreSQL + pgvector, and gives you a
snippet to embed the chat on your site.

## Stack

- **API** (`api/`): NestJS + Drizzle ORM + Playwright (fallback) + OpenAI-compatible chat
- **Local embeddings** (`Xenova/multilingual-e5-small`, 384 dims, CPU) via transformers.js
- **Web** (`web/`): Next.js 15 (dashboard with login)
- **DB**: PostgreSQL 16 + pgvector (Docker)
- **Node 24** (`.nvmrc`)

`api` and `web` are independent projects, each with its own `node_modules` and lockfile.

📚 **Full technical documentation**: see [`/docs`](./docs) (Markdown, with
diagrams) or run the Docusaurus site in [`/docs-site`](./docs-site)
(`cd docs-site && pnpm install && pnpm start`).

## 🚀 Quick start (Docker, single command)

The simplest way to get the whole project running locally. All you need is
Docker and an OpenAI API key (or any compatible provider).

```bash
git clone <repo-url> sitebot && cd sitebot
cp .env.example .env
```

Edit `.env` and set your real key:

```bash
OPENAI_API_KEY=sk-your-key-here
```

(the rest of the variables already have default values that work locally
without touching anything else). Then:

```bash
docker compose --profile full up --build
```

Wait until the 4 services (`db`, `dragonfly`, `api`, `web`) are "healthy" and
go to **http://localhost:3000**. Register from there, or if you want an
admin user already created, run once:

```bash
docker compose exec api pnpm seed:admin
```

and log in with `admin@sitebot.local` / `password1234`.

To stop everything: `docker compose down` (add `-v` if you also want to
delete the database data).

> This mode also runs `api` and `web` inside Docker (`full` profile).
> It's the easiest path, but it rebuilds the images on every code change —
> to develop with hot reload, use the section below.

## Requirements (local development without full Docker)

- Node 24 (`nvm use`)
- pnpm 10
- Docker

## Getting started

```bash
# 0. Node 24
nvm use

# 1. Environment variables
cp .env.example .env            # edit OPENAI_API_KEY and JWT_SECRET
cp web/.env.example web/.env.local

# 2. Database
docker compose up -d db

# 3. API (terminal 1)
nvm use
cd api
pnpm install
pnpm exec playwright install chromium   # only for the JS fallback
pnpm db:migrate
pnpm seed:admin                        # creates the admin with SEED_ADMIN_*
pnpm dev                               # http://localhost:3001

# 4. Web (terminal 2)
nvm use
cd web
pnpm install
pnpm dev                               # http://localhost:3000
```

Everything in Docker (`full` profile):

```bash
OPENAI_API_KEY=sk-... JWT_SECRET=... docker compose --profile full up --build
```

## Usage

1. Log in at http://localhost:3000 (by default `admin@sitebot.local` /
   `password1234` if you ran `pnpm seed:admin`), or sign up.
2. Enter the site URL and create it.
3. Click **Scan site** (up to `CRAWL_MAX_PAGES` pages and `CRAWL_MAX_DEPTH`
   levels). The content is indexed with local embeddings (no cost).
4. Open **View landing** to preview a landing page (title, URL, summary)
   with the widget injected.
5. Copy the snippet and paste it into your site:

```html
<script src="http://localhost:3001/widget.js" data-site-id="YOUR_SITE_ID" defer></script>
```

Widget options: `data-color`, `data-title`, `data-greeting`, `data-position`
(`left`/`right`) and `data-api` (defaults to the script's origin).

## How it works

1. **Discover**: reads `robots.txt` and `sitemap.xml` (including indexes). If
   there's no sitemap, it crawls internal links of the same domain up to
   `maxDepth`.
2. **Extract**: `fetch` + Readability/Turndown (cheerio-first). If the page is
   a JS shell, it's rendered with Playwright as a fallback.
3. **Index**: the Markdown is split into chunks (~375 tokens) and
   `multilingual-e5-small` embeddings (384 dims, CPU) are generated into
   `chunks.embedding`. Re-crawling is incremental (by `contentHash`) and
   reconciles deleted pages.
4. **Respond**: `POST /chat` searches for the closest chunks by similarity,
   builds the prompt and streams the response via SSE, with sources.

## Security (minimal, single-instance)

- **Auth**: `users` + JWT. Admin routes (`/sites*`, `/auth/me`) require
  `Authorization: Bearer <token>`. Public: `/chat` (widget) and `/widget.js`.
- **Origin**: `/chat` validates `Origin` against `allowedOrigins` + `DASHBOARD_ORIGINS`
  (`CORS_RELAXED=false` in prod).
- **Rate limiting**: `/chat` 15 req/min per IP, `/auth` 10/min, rest 120/min.
- **SSRF**: the crawler rejects hosts that resolve to private/loopback/metadata IPs.

## Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | no | Create user |
| POST | `/auth/login` | no | Login → JWT |
| GET | `/auth/me` | yes | Current user |
| POST | `/sites` | yes | Create site |
| GET | `/sites` | yes | List sites (with counts) |
| GET | `/sites/:id` | yes | Detail: site, last job, stats |
| PATCH | `/sites/:id` | yes | Name, origins, settings |
| DELETE | `/sites/:id` | yes | Delete site |
| POST | `/sites/:id/crawl` | yes | Start crawl + indexing |
| GET | `/sites/:id/status` | yes | Site status and last job |
| GET | `/sites/:id/pages` | yes | Indexed pages (paginated `?offset&limit`) |
| GET | `/sites/:id/pages/:pageId` | yes | Page with Markdown |
| POST | `/sites/:id/summary` | yes | Regenerate summary |
| POST | `/chat` | no | RAG with SSE streaming (public) |
| GET | `/widget.js` | no | Embeddable script |

## Main entity: `Site`

`users` → `sites` → `pages` → `chunks` (vectors) · `crawl_jobs` · `chat_sessions` → `messages`.
Deleting a user or site cascades and removes all its content.

## Scripts

**api**: `dev`, `build`, `start`, `typecheck`, `db:generate`, `db:migrate`, `db:push`, `seed:admin`
**web**: `dev`, `build`, `start`, `typecheck`
</content>
</invoke>
