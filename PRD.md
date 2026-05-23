# Product Requirements Document — alpha-ten

**Status:** approved for build  
**Owner:** Moe Ghashim  
**Reviewer of all PRs/critique:** the human reviewer who hands you this repo  
**Executing agent:** see [AGENTS.md](AGENTS.md) for working rules and review protocol

---

## 1. Product

A public demo at **`alpha.tenwhy.com`** that turns one form submission into a deployed web app.

### 1.1 User journey
1. User opens `alpha.tenwhy.com`.
2. User enters:
   - **App name** (slug, e.g. `plant-kanban`).
   - **Description** (≤300 chars, e.g. `"a kanban board for tracking plant care tasks"`).
3. User submits → redirected to a status page.
4. Status page shows progress: `queued → generating → pushing → deploying → live` (or `failed`).
5. When status is `live`, the page shows an **Open app** button linking to the deployed URL.

### 1.2 Generated app expectations
- Anyone with the URL can use the app.
- Data the user creates is **persisted on the server** and visible to anyone they share the link with.
- No login required for the demo.

### 1.3 Non-goals (for v1)
- No user accounts on `alpha.tenwhy.com`.
- No auth inside generated apps.
- No vanity subdomains (`<slug>.alpha.tenwhy.com`) — use the Render-issued `.onrender.com` URL.
- No paid tier, no quotas UI, no app deletion UI.
- No SSE streaming; polling is fine.
- No realtime sync between users (writes propagate next time a client refetches).

---

## 2. Architecture

```
┌────────────────────────────┐
│ User browser               │
│ alpha.tenwhy.com           │
└─────────────┬──────────────┘
              │
              ▼
┌────────────────────────────┐
│ Next.js web (Render)       │
│ apps/web                   │
└─────────────┬──────────────┘
              │ REST
              ▼
┌──────────────────────────────────────────────┐
│ Hono API + orchestrator (Render)            │
│ apps/api                                     │
│ POST /v1/apps                                │
│ GET  /v1/apps/:id                            │
└──┬──────────────┬──────────────┬─────────────┘
   │              │              │
   ▼              ▼              ▼
┌───────────┐ ┌───────────┐ ┌───────────────────┐
│ Render PG │ │ GitHub    │ │ Cursor SDK Cloud  │
│ apps,     │ │ org +     │ │ composer-2.5      │
│ documents │ │ template  │ │ clones repo, PR   │
└───────────┘ └─────┬─────┘ └──────────┬────────┘
                    │                  │
                    └────────┬─────────┘
                             ▼
                    ┌────────────────────┐
                    │ Render API         │
                    │ create web service │
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │ Generated app      │
                    │ <slug>.onrender.com│
                    │  └ calls data-api  │
                    └─────────┬──────────┘
                              ▼
                    ┌────────────────────┐
                    │ data-api (Render)  │
                    │ data.alpha.tenwhy. │
                    │ com                │
                    │  └ Render PG       │
                    └────────────────────┘
```

### 2.1 Platform services on Render

| Service | Path | Domain | Purpose |
|---|---|---|---|
| `tenwhy-alpha-web`  | `apps/web`      | `alpha.tenwhy.com`      | Next.js form + status pages |
| `tenwhy-alpha-api`  | `apps/api`      | `api.alpha.tenwhy.com`  | Orchestrator (GitHub + Cursor + Render clients), runs the in-process job loop |
| `tenwhy-alpha-data` | `apps/data-api` | `data.alpha.tenwhy.com` | Multi-tenant document store API used by every generated app |
| `tenwhy-alpha-db`   | Postgres        | —                       | Shared Postgres: `apps`, `app_keys`, `documents` |

### 2.2 Why Cursor SDK Cloud (and not Sapiom/Blaxel)
The `@cursor/sdk` Cloud runtime already provides: dedicated VM per run, repo clone, durable session state, streaming events, and auto-PR. That's exactly what a Sapiom/Blaxel sandbox would have provided. Using Cursor SDK Cloud removes a layer.

---

## 3. Data model (Postgres)

Schema is authoritative in [`infra/sql/001_init.sql`](infra/sql/001_init.sql). Summary:

### `apps`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text unique | regex `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$` |
| `description` | text | ≤300 chars enforced at API |
| `status` | enum | `queued` `generating` `pushing` `deploying` `live` `failed` |
| `status_message` | text | human-readable current step |
| `tier` | text | `free` default — future-proofing for quotas |
| `repo_url`, `repo_name`, `github_pr_url` | text | GitHub artifacts |
| `cursor_agent_id`, `cursor_run_id` | text | for resume / inspection |
| `render_service_id`, `render_deploy_id` | text | |
| `preview_url` | text | the final live URL |
| `error` | text | last error message if `failed` |
| `attempt_count` | int | retries |
| `created_at`, `updated_at` | timestamptz | |

### `app_keys`
Bearer keys (hashed) the data API uses to authenticate generated apps. One+ per app.

### `documents`  (the multi-tenant document store)
| Column | Type | Notes |
|---|---|---|
| `app_id` | uuid FK | scope key |
| `collection` | text | regex `^[a-z0-9][a-z0-9_-]{0,62}$` |
| `doc_id` | text | client-generated (nanoid/uuid) |
| `body` | jsonb | arbitrary |
| `deleted_at` | timestamptz nullable | soft-delete |
| `updated_at` | timestamptz | |
| PK | `(app_id, collection, doc_id)` | shard key by `app_id` later if needed |

**Postgres Row-Level Security** enabled on `documents`: every connection used by the data API must `set_config('app.current_id', <app_id>::text, true)` before any read/write. Defense in depth on top of API-level scoping.

---

## 4. APIs

### 4.1 Orchestrator API (`apps/api`)

Base: `https://api.alpha.tenwhy.com`

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| `GET` | `/health` | — | `{ok:true}` | |
| `POST` | `/v1/apps` | `{slug, description}` | `{id, slug, status}` 202 | Validates inputs, creates row, schedules job |
| `GET` | `/v1/apps/:id` | — | full app row + derived `preview_url` | Used by status page polling |
| `GET` | `/v1/apps` | — | list of recent apps | Optional/admin |

**Validation:**
- `slug`: matches schema regex, 3–40 chars, not in a reserved list (`api`, `data`, `admin`, `www`, `app`, `apps`, `alpha`).
- `description`: 1–300 chars; reject if any URL is detected, or if a small denylist of obvious abuse keywords appears.
- Reject on slug collision (409).

### 4.2 Data API (`apps/data-api`)

Base: `https://data.alpha.tenwhy.com`

All endpoints require:
- `Authorization: Bearer <APP_PUBLIC_KEY>`
- `X-App-Id: <app_id>` (must match the bearer's app)
- CORS: allow any origin; allow `GET POST PUT DELETE`; allow headers `Authorization, X-App-Id, Content-Type`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/health` | — | `{ok:true}` |
| `GET` | `/v1/d/:appId/:col` | — | `{docs: [...], next: cursor?}` paginated newest-first, limit 100 |
| `GET` | `/v1/d/:appId/:col/:id` | — | `{id, body, updated_at}` or 404 |
| `PUT` | `/v1/d/:appId/:col/:id` | `{body: ...}` | `{id, body, updated_at}` upsert |
| `DELETE` | `/v1/d/:appId/:col/:id` | — | 204 (soft delete: set `deleted_at`) |

**Limits enforced server-side:**
- Body ≤ `MAX_BODY_BYTES` (default 1 MB).
- Per-app doc count ≤ `MAX_DOCS_PER_APP` (default 10 000); reject PUT with 413.
- Per-app rate limit `RATE_LIMIT_PER_SEC` (default 50) — in-process token bucket keyed by app_id.

**Connection handling:**
- Use a single `pg.Pool`.
- Per request, `BEGIN; SELECT set_config('app.current_id', $1, true); …; COMMIT;` so RLS scopes the query.

### 4.3 Generated-app SDK (`templates/generated-app/src/lib/db.ts`)

The template ships with a tiny SDK the agent uses verbatim:

```ts
export const db = createDb({
  baseUrl: process.env.NEXT_PUBLIC_DATA_API_URL!,
  appId:   process.env.NEXT_PUBLIC_APP_ID!,
  key:     process.env.NEXT_PUBLIC_APP_KEY!,
});

await db.collection("recipes").put(id, { ... });
const all = await db.collection("recipes").list();
```

The orchestrator sets `NEXT_PUBLIC_DATA_API_URL`, `NEXT_PUBLIC_APP_ID`, `NEXT_PUBLIC_APP_KEY` as env vars on the generated app's Render service. **Composer must not modify `db.ts` or add other backends.**

---

## 5. Orchestrator flow

```
POST /v1/apps
  └─ validate input
  └─ insert apps row (status=queued)
  └─ fire-and-forget job(appId)
  └─ return {id, slug, status:queued}  ◀── responds in <200 ms

job(appId):
  1. set status=generating
  2. github.createRepoFromTemplate(slug, description)
       └─ store repo_url, repo_name
  3. cursor.startGeneration({ repoUrl, slug, description })
       └─ Agent.create({ model:{id:"composer-2.5"}, cloud:{repos:[{url, startingRef:"main"}], autoCreatePR:true} })
       └─ stream events; persist cursor_agent_id, cursor_run_id
       └─ await run; on completion get prUrl
  4. set status=pushing; github.mergePR(prUrl)
  5. set status=deploying
       └─ generate APP_PUBLIC_KEY (nanoid 32); insert app_keys row with hash
       └─ render.createService({
            repo, branch:"main",
            env: { NEXT_PUBLIC_DATA_API_URL, NEXT_PUBLIC_APP_ID, NEXT_PUBLIC_APP_KEY }
          })
       └─ poll latest deploy every 12 s, max 15 min
  6. on live: set status=live, preview_url=<serviceUrl>
  7. on failure at any step: set status=failed, error=<msg>
```

**No retries in v1** — `attempt_count` exists but stays 0. Failure surfaces directly to the user.

---

## 6. Cursor Composer 2.5 prompt contract

The orchestrator sends a **single prompt**. The template repo also pins rules in `.cursor/skills/app-builder.md`. Both must agree.

### 6.1 Prompt (assembled by `apps/api/src/lib/cursor.ts`)

```
You are generating a complete runnable demo web app in this repository.

APP SLUG: {{slug}}
USER DESCRIPTION: {{description}}

Hard requirements:
1. Build a single-service Next.js (App Router) + TypeScript app only.
2. Persist all user data using the pre-installed SDK at src/lib/db.ts via
   db.collection(name).{list, get, put, delete}. Do not import any other
   database, add migrations, or fetch the data API directly.
3. Do not add auth, payments, email, Docker, infra files, or any new env vars.
4. The app must build and run with:
     npm ci
     npm run build
     npm run start
5. src/app/api/health/route.ts must return HTTP 200 with JSON {"ok":true}.
6. Replace src/app/page.tsx (and add components as needed) with a polished UI
   and working interactions that match the user's description.
7. Keep dependencies minimal; do not add UI libraries unless essential.
8. Update README.md with: what the app does, how to run, and the limitation
   that all visitors share the same data (it is a demo).
9. Before finishing, run `npm run build` and fix any errors.
10. Commit and open a PR.

Do NOT:
 - ask follow-up questions
 - leave TODOs, placeholders, or commented-out code
 - require additional environment variables
 - modify src/lib/db.ts or any file under .cursor/
 - generate unsafe, malicious, or credential-harvesting functionality
```

### 6.2 Template repo (`tenwhy-generated-app-template`)
The orchestrator creates new generated-app repos from this GitHub template repo. Contents come from [`templates/generated-app/`](templates/generated-app):

- `package.json` — Next.js 14, react, react-dom, typescript, nanoid; `build`/`start` scripts
- `next.config.js`, `tsconfig.json`
- `src/app/layout.tsx`, `src/app/page.tsx` (placeholder)
- `src/app/api/health/route.ts` → `{ok:true}`
- `src/lib/db.ts` — the data-API SDK described in §4.3
- `README.md` — instructions, plus a "DO NOT EDIT db.ts" note
- `.cursor/skills/app-builder.md` — duplicates the hard rules from §6.1
- `.gitignore`

---

## 7. Render deployment

### 7.1 Platform — via Blueprint
`render.yaml` declares `web`, `api`, `data-api`, and `postgres`. Push to `main` ⇒ Render redeploys.

### 7.2 Generated apps — via Render REST API
`POST https://api.render.com/v1/services`
```json
{
  "type": "web_service",
  "name": "app-{slug}-{shortId}",
  "ownerId": "{RENDER_OWNER_ID}",
  "repo": "https://github.com/{org}/{repo}",
  "branch": "main",
  "autoDeploy": "yes",
  "serviceDetails": {
    "runtime": "node",
    "plan": "starter",
    "region": "oregon",
    "numInstances": 1,
    "healthCheckPath": "/api/health",
    "envSpecificDetails": {
      "buildCommand": "npm ci && npm run build",
      "startCommand": "npm run start"
    },
    "renderSubdomainPolicy": "enabled"
  },
  "envVars": [
    { "key": "NEXT_PUBLIC_DATA_API_URL", "value": "https://data.alpha.tenwhy.com" },
    { "key": "NEXT_PUBLIC_APP_ID",       "value": "<app_id>" },
    { "key": "NEXT_PUBLIC_APP_KEY",      "value": "<scoped key>" }
  ]
}
```
Poll `GET /v1/services/{id}/deploys?limit=1`; live when `status == "live"`. Reasonable poll interval: **12 seconds**, total budget **15 minutes**.

---

## 8. Failure modes and guardrails

| Risk | Mitigation |
|---|---|
| Cursor agent hangs | Timebox: cancel run after 15 min, set `status=failed` with reason |
| Generated app fails to build | Render deploy fails → orchestrator sees deploy `build_failed` → mark failed |
| App crashes after deploy | Health check `/api/health` failing → Render marks `update_failed` → mark failed |
| Slug collision | DB unique constraint → API returns 409 before scheduling job |
| Abusive description | Server-side denylist + URL detector; reject 400 |
| Secret leakage to Composer | Orchestrator never passes `RENDER_API_KEY`, `GITHUB_TOKEN`, or DB creds to Cursor SDK. Only the repo URL goes to Cursor. |
| Cross-app data read | API enforces `X-App-Id` matches the bearer; Postgres RLS enforces it again |
| Render API rate limits | Poll at 12 s; cap concurrent in-flight jobs to 3 in v1 |
| Service sprawl / cost | Out-of-scope for v1; manual cleanup. Add admin in v2 |

---

## 9. Out of scope (explicit non-features)

- Vanity subdomains `<slug>.alpha.tenwhy.com`
- Authenticated users / accounts
- SSE / WebSocket streaming
- Realtime collaboration inside generated apps
- Per-app dedicated database
- Retries / self-healing
- Background worker as a separate Render service
- Admin UI / app deletion
- Billing
- Multiple template families (only `next-single-service` exists)

---

## 10. Acceptance criteria for the whole demo

Submitting `slug=plant-kanban, description="a kanban board for tracking plant care tasks"` from `alpha.tenwhy.com` must:

1. Insert an `apps` row and return 202 with the id within 1 second.
2. Cause a new GitHub repo to be created in `tenwhy-apps/plant-kanban-<shortid>`.
3. Cause a Cursor cloud run to open a PR in that repo within ~5 minutes.
4. Merge the PR automatically.
5. Create a Render web service that finishes deploying within ~10 minutes.
6. Show a live `https://app-plant-kanban-<shortid>.onrender.com` URL on the status page.
7. Visiting that URL twice from different browsers shows the **same** data; adding a card in one browser shows up in the other after a refresh.

When all seven happen reliably for three different descriptions in a row, the demo is shippable.
