# Task 04 — Orchestrator flow + `/v1/apps` routes

## Goal
Wire the clients from task 03 into a single in-process orchestrator and expose the public API: `POST /v1/apps`, `GET /v1/apps/:id`.

## Inputs to read first
- `PRD.md` §4.1 (API contract), §5 (flow), §8 (failure handling)
- `infra/sql/001_init.sql` (statuses, `app_keys`)

## Deliverables
```
apps/api/src/db.ts
apps/api/src/index.ts
apps/api/src/routes/apps.ts
apps/api/src/lib/orchestrator.ts
apps/api/src/lib/validate.ts
apps/api/src/lib/keys.ts
```

## Implementation notes

### `db.ts`
- Single `pg.Pool`.
- Export typed helpers: `getApp(id)`, `getAppBySlug(slug)`, `insertApp({slug, description})`, `updateApp(id, patch)` — patch is `Partial<{status, status_message, repo_url, repo_name, github_pr_url, cursor_agent_id, cursor_run_id, render_service_id, render_deploy_id, preview_url, error}>`.
- All writes touch `updated_at` via trigger; do not set it manually.

### `keys.ts`
- `generateAppKey()`: `nanoid(32)` returning plaintext.
- `hashKey(plain): string`: `crypto.createHash('sha256').update(plain).digest('hex')`.
- `insertAppKey(appId, plain)`: stores `(appId, sha256(plain))` into `app_keys`.

### `validate.ts`
- `validateCreateApp(input): { slug, description }` — uses zod.
- Slug regex must match the SQL `apps_slug_format` check exactly: `^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`.
- Reserved slugs (reject 400): `api`, `data`, `admin`, `www`, `app`, `apps`, `alpha`, `health`.
- `description`: trim, length 1..300; reject if it contains any URL (`/\bhttps?:\/\//i`) or any abuse keyword from a small denylist: `["porn","casino","weapon","malware","phishing","keylogger","creditcard"]` (case-insensitive substring).

### `orchestrator.ts`
Exports `enqueue(appId: string): void`.

- Maintain an in-memory **concurrency cap of 3**. If at capacity, queue the appId; drain when a slot frees.
- Run `runJob(appId)` with an `AbortController` whose timeout is `JOB_TIMEOUT_MS`.

`runJob(appId)`:
```
1. app = getApp(appId)
2. updateApp(id, { status: 'generating', status_message: 'creating repo' })
3. { repoUrl, repoName } = github.createRepoFromTemplate(app.slug, app.description)
   updateApp(id, { repo_url: repoUrl, repo_name: repoName })

4. updateApp(id, { status_message: 'composer 2.5 running' })
   result = cursor.runComposer({ repoUrl, slug, description, signal })
   updateApp(id, { cursor_agent_id, cursor_run_id })
   if (result.status !== 'finished') throw

5. if (result.prUrl) {
     updateApp(id, { status: 'pushing', github_pr_url: result.prUrl })
     github.mergePr(repoName, prNumberFromUrl(result.prUrl))
   } else if (result.branch) {
     throw new Error('composer finished without opening a PR')
   }

6. updateApp(id, { status: 'deploying', status_message: 'creating render service' })
   plaintextKey = generateAppKey(); insertAppKey(appId, plaintextKey)
   { serviceId, serviceUrl } = render.createService({
     name: `app-${slug}-${shortIdFromRepoName(repoName)}`,
     repoUrl,
     envVars: {
       NEXT_PUBLIC_DATA_API_URL: env.DATA_API_BASE_URL,
       NEXT_PUBLIC_APP_ID: appId,
       NEXT_PUBLIC_APP_KEY: plaintextKey,
     }
   })
   updateApp(id, { render_service_id: serviceId, preview_url: serviceUrl })

7. loop every DEPLOY_POLL_MS, budget JOB_TIMEOUT_MS - elapsed:
   d = render.getLatestDeploy(serviceId)
   updateApp(id, { render_deploy_id: d.deployId, status_message: `deploy: ${d.status}` })
   if d.status === 'live' → updateApp(id, { status: 'live' }); return
   if d.status ends with '_failed' or 'canceled' → throw

8. on any throw or timeout → updateApp(id, { status: 'failed', error: message }).
```

Never let an unhandled rejection escape the worker — wrap in try/catch.

### `routes/apps.ts`
- `POST /v1/apps` —
  - validate body, check slug collision (`getAppBySlug` → 409 with `{error:'slug_taken'}`).
  - `insertApp(...)` → `enqueue(id)` → return 202 `{id, slug, status:'queued'}`.
- `GET /v1/apps/:id` —
  - 404 if missing; otherwise return the row plus a derived `health_url = preview_url + '/api/health'` if `preview_url`.

### `index.ts`
- Build Hono app, mount `/health` (always 200 `{ok:true}`), mount `routes/apps.ts`.
- CORS: allow `PLATFORM_BASE_URL` and `http://localhost:3000`; methods `GET, POST`; headers `Content-Type`.
- `serve({fetch: app.fetch, port: env.PORT})`.

## Acceptance criteria

Run against local Postgres + a `templates/generated-app` already pushed somewhere if you want to actually exercise it; otherwise stub Cursor/Render via env (do NOT add a feature flag — just don't run the real call and document in the PR).

- [ ] `tsc --noEmit` clean.
- [ ] `npm --workspace apps/api run build` succeeds.
- [ ] `curl -X POST localhost:8787/v1/apps -d '{"slug":"plant-kanban","description":"a kanban for plants"}' -H 'Content-Type: application/json'` returns `202 {id, slug, status:"queued"}`.
- [ ] Submitting the same slug a second time returns `409`.
- [ ] `curl localhost:8787/v1/apps/<id>` returns the row with status advancing past `queued` (you can verify in the DB even if external calls are not made).
- [ ] Submitting `slug:"admin"` returns `400`.
- [ ] Submitting description containing `https://` returns `400`.
- [ ] Posting concurrency-cap test: enqueue 5 jobs → at most 3 run simultaneously (log lines).
- [ ] On simulated failure at step 3, the row ends as `failed` with a non-empty `error`.

## Out of scope
- Retries.
- Webhook callbacks.
- Persistent queue (in-process is fine for v1).
- Admin endpoints.
- Auth on the orchestrator API (open for the demo).

## Review gate
Open PR titled **"task 04 — orchestrator flow"**. In the "Decisions" section, list how you handled Cursor/Render calls during local testing (stub vs real).
