---
id: api-reference
title: API Reference
sidebar_position: 6
---

# API Reference

Base URL: `API_URL` (default `http://localhost:3001`). All bodies are JSON
unless noted. Source: `api/src/*/*.controller.ts`.

## Auth model

Three independent auth mechanisms coexist:

| Mechanism | Used by | Guard |
|---|---|---|
| JWT Bearer token | Dashboard → owner-scoped endpoints | `AuthGuard` (`auth/auth.guard.ts`) |
| HTTP Basic Auth | `/admin*`, `/admin/queues` (Bull Board) | `AdminBasicGuard` (`admin/admin.guard.ts`) |
| Origin allowlist | `/chat` (public, no token) | `assertOriginAllowed()` in `ChatController` |

A JWT is obtained via `/auth/login` or `/auth/register` and sent as
`Authorization: Bearer <token>`. It encodes `{ sub: userId, email }` and
expires per `JWT_EXPIRES_IN` (default `7d`).

The admin panel and Bull Board queue dashboard use HTTP Basic Auth against
`ADMIN_USER`/`ADMIN_PASSWORD` (and `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD`,
falling back to the admin credentials) — deliberately separate from user
accounts, since these expose platform-wide operator views, not a single
owner's data. **If unset, the guard refuses all requests rather than opening
the panel** (`admin.guard.ts`).

## Endpoints

### Auth (`/auth`) — public except `/me`

| Method | Path | Auth | Body / Notes |
|---|---|---|---|
| POST | `/auth/register` | – | `{ email, password }` → JWT |
| POST | `/auth/login` | – | `{ email, password }` → JWT |
| GET | `/auth/me` | JWT | Current user (id, email, plan) |
| POST | `/auth/forgot-password` | – | Sends a reset email if the address exists (no user enumeration) |
| POST | `/auth/reset-password` | – | `{ token, password }` — one-hour TTL, hashed token, single use |

### Sites (`/sites`) — all JWT-protected, scoped to the caller's own sites

| Method | Path | Notes |
|---|---|---|
| POST | `/sites` | Create a site (`{ name, url }`) |
| GET | `/sites` | List the caller's sites with page/chunk counts |
| GET | `/sites/:id` | Detail: site, latest crawl job, stats |
| PATCH | `/sites/:id` | Update name, allowed origins, or settings |
| DELETE | `/sites/:id` | Cascades to pages, chunks, jobs, sessions |
| POST | `/sites/:id/crawl` | Start a crawl (409 if one is already running) |
| GET | `/sites/:id/status` | Site status + latest crawl job |
| GET | `/sites/:id/pages` | Paginated (`?offset&limit`) |
| GET | `/sites/:id/pages/:pageId` | Full page, including Markdown |
| POST | `/sites/:id/summary` | Regenerate the LLM summary on demand |

Every site-scoped route resolves ownership via `SitesService.findOwned()` /
similar — a JWT for user A can never read or mutate user B's site, even by
guessing a UUID.

### Chat (`/chat`) — public, origin-restricted

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/chat` | Origin check | `{ siteId, question, sessionId? }` → Server-Sent Events stream of answer tokens, ending with a `sources` event |
| POST | `/chat/feedback` | Origin check | `{ siteId, sessionId, messageId, rating: 'up'\|'down' }` |
| GET | `/widget.js` | – | The embeddable widget script (static, served from `api/src/public/`) |

`/chat`'s `Origin` header is validated against the target site's own
`allowedOrigins` plus `DASHBOARD_ORIGINS` (so the dashboard's built-in chat
preview also works). In production (`CORS_RELAXED=false`), a missing or
disallowed Origin is rejected outright.

### Admin (`/admin*`) — HTTP Basic Auth, platform-operator only

Covers cross-tenant views: crawl activity, plan overrides, and Bull Board
(`/admin/queues`) for inspecting the BullMQ job queue directly. Not exposed
to regular dashboard users regardless of JWT.

### Misc

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness check, no auth |
| POST | `/webhook/*` | Site-specific webhook secret validation (`sites.webhookSecret`) |

## Rate limits

| Scope | Limit | Where |
|---|---|---|
| `/chat` per session | `CHAT_SESSION_LIMIT` (default 20/min) | In-memory sliding window, `SessionRateLimiter` |
| `/chat` per IP | `CHAT_IP_LIMIT` (default 60/min) | Broader net against multi-session abuse |
| `/auth/*` | 10/min | Global Nest rate limiter |
| Everything else | 120/min | Global Nest rate limiter |

## Validation

All request bodies pass through a global `ValidationPipe`
(`whitelist: true`, `transform: true`) — unknown fields are silently
stripped rather than rejected (`forbidNonWhitelisted: false`), and DTO
class-validator decorators (`sites.dto.ts`, `auth.dto.ts`, `admin.dto.ts`)
enforce shape and constraints before a controller method runs.
