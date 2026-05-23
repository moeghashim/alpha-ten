# Task 03 — Orchestrator clients (`github`, `cursor`, `render`)

## Goal
Build three thin, testable client modules used by the orchestrator. No HTTP routes in this task. No orchestration logic.

## Inputs to read first
- `PRD.md` §4.1 (API), §5 (orchestrator flow), §6 (prompt), §7 (Render API)
- The existing `apps/api/package.json` (already scaffolded)

## Deliverables
```
apps/api/tsconfig.json
apps/api/src/env.ts
apps/api/src/lib/github.ts
apps/api/src/lib/cursor.ts
apps/api/src/lib/render.ts
apps/api/src/lib/log.ts
```

You may not yet create `index.ts` or `routes/*` — that is task 04.

## Implementation notes

### `env.ts`
- Parse and validate process.env with `zod`.
- Required: `DATABASE_URL`, `CURSOR_API_KEY`, `GITHUB_TOKEN`, `GITHUB_ORG`, `GITHUB_TEMPLATE_REPO`, `RENDER_API_KEY`, `RENDER_OWNER_ID`, `DATA_API_BASE_URL`.
- Optional with defaults: `PORT=8787`, `RENDER_REGION=oregon`, `RENDER_PLAN=starter`, `JOB_TIMEOUT_MS=900000` (15 min), `DEPLOY_POLL_MS=12000`.
- Fail fast on missing values; print the missing keys.

### `log.ts`
- Single export `log(level, msg, meta?)`. Levels: `info|warn|error`.
- Plain JSON line to stdout. No external dep.

### `github.ts` (uses `@octokit/rest`)
Exports:
```ts
createRepoFromTemplate(slug: string, description: string): Promise<{
  repoUrl: string;   // https URL
  repoName: string;  // org/repo
}>;
getOpenPr(repo: string): Promise<{ number: number; url: string } | null>;
mergePr(repo: string, prNumber: number): Promise<void>;
```

- `createRepoFromTemplate` calls `POST /repos/{template_owner}/{template_repo}/generate` with `owner=GITHUB_ORG`, `name=app-{slug}-{shortId}` (use `nanoid(6)`), `private=true`, `include_all_branches=false`, `description=<truncated>`.
- Poll `GET /repos/{owner}/{name}` until it returns 200 (max 30 s, 1 s interval) — generating a repo is async.
- `mergePr` uses `PUT /repos/{owner}/{repo}/pulls/{n}/merge` with `merge_method: "squash"`.

### `cursor.ts` (uses `@cursor/sdk`)
Exports:
```ts
runComposer(opts: {
  repoUrl: string;
  slug: string;
  description: string;
  signal?: AbortSignal;
}): Promise<{
  agentId: string;
  runId: string;
  prUrl: string | null;
  branch: string | null;
  status: "finished" | "failed";
  lastMessage?: string;
}>;
```

- `Agent.create({ apiKey, model:{ id:"composer-2.5" }, mode:"agent", cloud:{ repos:[{ url:repoUrl, startingRef:"main" }], autoCreatePR:true }, name:`appgen:${slug}` })`.
- `agent.send(buildPrompt(slug, description))`.
- Iterate `run.stream()` purely to surface events to `log`. Do not mutate DB here.
- `await run.wait()`; read `result.git?.branches?.[0]?.prUrl` and `.branch`.
- Honour `signal` (use to call `run.cancel()` if available; otherwise let the orchestrator's timer kill the job).
- Export `buildPrompt(slug, description): string` — exact text from `PRD.md` §6.1.

### `render.ts`
Plain `fetch` against `https://api.render.com/v1`, header `Authorization: Bearer ${RENDER_API_KEY}`.

```ts
createService(opts: {
  name: string;
  repoUrl: string;
  envVars: Record<string,string>;
}): Promise<{ serviceId: string; serviceUrl: string }>;

getLatestDeploy(serviceId: string): Promise<{
  deployId: string;
  status: "created"|"queued"|"build_in_progress"|"pre_deploy_in_progress"|"update_in_progress"|"live"|"build_failed"|"pre_deploy_failed"|"update_failed"|"canceled";
}>;
```

- `createService` posts the body from `PRD.md` §7.2 with `branch:"main"`, `autoDeploy:"yes"`, `serviceDetails.runtime:"node"`, `plan:RENDER_PLAN`, `region:RENDER_REGION`, `numInstances:1`, `healthCheckPath:"/api/health"`, build `npm ci && npm run build`, start `npm run start`, `renderSubdomainPolicy:"enabled"`.
- Return `serviceId` from response; `serviceUrl` from `serviceDetails.url` (fallback to constructing `https://{name}.onrender.com` if absent).
- Retry once on `429` with `Retry-After` honoured.

## Acceptance criteria

- [ ] `tsc --noEmit` clean inside `apps/api`.
- [ ] `npm --workspace apps/api run build` succeeds.
- [ ] No file under `apps/api/src/routes` or `apps/api/src/index.ts` is created (next task).
- [ ] No client calls happen at module load — all are inside exported functions.
- [ ] `env.ts` fails fast with a readable message when a key is missing (test by running `node -e "import('./dist/env.js')"` with an empty env).
- [ ] Smoke (optional, with real keys): a tiny scratch script importing `createRepoFromTemplate` actually creates a repo and `mergePr` merges a manual PR.

## Out of scope
- Orchestrator loop, routes, DB writes.
- Retry/backoff beyond 1× on 429.
- Webhooks.

## Review gate
Open PR titled **"task 03 — orchestrator clients"**. Note any deviation from `PRD.md` §7.2 schema in the "Decisions" section.
