# Data Model

PostgreSQL 16 with the `pgvector` extension, managed through Drizzle ORM
(`api/src/db/schema.ts`). All tables use UUID primary keys and cascade
deletes downward from `users`.

## Entity-relationship diagram

```mermaid
erDiagram
    USERS ||--o{ SITES : owns
    USERS ||--o{ PASSWORD_RESET_TOKENS : requests
    SITES ||--o{ PAGES : contains
    SITES ||--o{ CRAWL_JOBS : runs
    SITES ||--o{ CHAT_SESSIONS : hosts
    SITES ||--o{ CHUNKS : indexes
    SITES ||--o{ USAGE_EVENTS : incurs
    PAGES ||--o{ CHUNKS : "split into"
    CHAT_SESSIONS ||--o{ MESSAGES : contains

    USERS {
        uuid id PK
        text email UK
        text password_hash
        enum plan "free | paid"
        timestamp created_at
    }
    SITES {
        uuid id PK
        uuid user_id FK
        text name
        text url
        text domain
        enum status "pending|crawling|ready|error"
        text summary
        text[] allowed_origins
        jsonb settings
        boolean auto_sync
        integer sync_interval_hours
        timestamp last_crawled_at
        integer monthly_message_limit
        double monthly_budget_usd
        text webhook_secret
    }
    PAGES {
        uuid id PK
        uuid site_id FK
        text url
        text title
        text markdown
        text content_hash
        integer status_code
        timestamp crawled_at
    }
    CHUNKS {
        uuid id PK
        uuid site_id FK
        uuid page_id FK
        text content
        integer token_count
        vector embedding "384 dims, HNSW index"
        tsvector search "GIN index"
    }
    CRAWL_JOBS {
        uuid id PK
        uuid site_id FK
        enum status "queued|running|done|error"
        integer pages_found
        integer pages_crawled
        integer pages_changed
        text error
        timestamp started_at
        timestamp finished_at
    }
    CHAT_SESSIONS {
        uuid id PK
        uuid site_id FK
        timestamp created_at
    }
    MESSAGES {
        uuid id PK
        uuid session_id FK
        enum role "user | assistant"
        text content
        jsonb sources
        enum feedback "up | down"
        boolean no_info
    }
    PASSWORD_RESET_TOKENS {
        uuid id PK
        uuid user_id FK
        text token_hash
        timestamp expires_at
        timestamp used_at
    }
    USAGE_EVENTS {
        uuid id PK
        uuid site_id FK
        enum type "embedding|chat|summary"
        integer prompt_tokens
        integer completion_tokens
        integer total_tokens
        double cost
    }
```

## Notable design choices

**Cascading deletes everywhere.** Every foreign key uses
`onDelete: 'cascade'`. Deleting a `user` deletes every `site` they own, which
in turn deletes its `pages`, `chunks`, `crawl_jobs`, `chat_sessions`, and
`messages`. There is no soft-delete layer — this is a deliberate simplicity
trade-off suited to a single-tenant-per-owner model.

**`chunks.embedding` is a 384-dimension vector** (`EMBEDDING_DIM` in
`schema.ts`), matching the local `multilingual-e5-small` model's output size.
Switching to the OpenAI embedding provider (`text-embedding-3-small`, 1536
dims by default) would require a schema migration to change the vector
column's dimensionality — the codebase is currently pinned to 384.

**Two indexes on `chunks` power hybrid retrieval:**
- `chunks_embedding_idx`: an **HNSW** index using `vector_cosine_ops`, for
  fast approximate nearest-neighbor search over embeddings.
- `chunks_search_idx`: a **GIN** index over a generated `tsvector` column,
  for PostgreSQL full-text (lexical) search.

Both are queried per chat request and merged via Reciprocal Rank Fusion — see
[rag-pipeline.md](./rag-pipeline.md).

**`sites.settings` is a typed JSONB blob** (`SiteSettings`), not normalized
columns — widget color, greeting, custom system-prompt addendum, LLM
temperature, and crawl limits (`maxPages`, `maxDepth`) all live there with
defaults in `DEFAULT_SETTINGS`. This avoids a migration for every new
per-site knob at the cost of losing column-level constraints.

**`pages.content_hash`** is a hash of the extracted Markdown. Re-crawling a
page whose hash hasn't changed skips re-ingestion (re-embedding) entirely —
the crawler only re-chunks and re-embeds content that actually changed.

**`messages.no_info`** is set when the LLM's answer matches one of the
"I don't know" phrase markers (`isNoInfoAnswer` in `chat.service.ts`). This
flag drives the admin dashboard's visibility into answer quality without
requiring a separate classification call.
