# Task 06 — Render Blueprint deploy + end-to-end smoke

## Goal
Get the platform live on Render and prove the full loop end-to-end against real Cursor + real GitHub + real Render.

## Inputs to read first
- `PRD.md` §7, §10 (acceptance)
- `render.yaml`

## Pre-task checklist (must be done by the human reviewer — do not attempt)
- [ ] DNS for `alpha`, `api.alpha`, `data.alpha` `.tenwhy.com` is ready to be pointed.
- [ ] `tenwhy-generated-app-template` repo is created under `github.com/moeghashim` with the contents of `templates/generated-app/` (push it as a separate repo, **set "Template repository" = true** in repo settings).
- [ ] Cursor GitHub integration is installed on the `moeghashim` account with access to all repos (or at least the template + generated `app-*` repos).
- [ ] Render workspace is connected to the same GitHub account.
- [ ] Secrets set in Render (do not commit):
      - `CURSOR_API_KEY`, `GITHUB_TOKEN`, `GITHUB_OWNER=moeghashim`, `GITHUB_TEMPLATE_REPO=tenwhy-generated-app-template`,
        `RENDER_API_KEY`, `RENDER_OWNER_ID`, `PLATFORM_BASE_URL=https://alpha.tenwhy.com`,
        `DATA_API_BASE_URL=https://data.alpha.tenwhy.com`,
        `NEXT_PUBLIC_API_BASE_URL=https://api.alpha.tenwhy.com`

## Deliverables
```
docs/SMOKE.md
```
(everything else already exists from tasks 02–05)

`docs/SMOKE.md` is a short report (paste-friendly) the executor fills in with: timestamps, URLs created, deploy timings, screenshots/links of the three smoke runs.

## Implementation notes

### Deploy
1. Open a PR titled **"task 06 — deploy"** that contains only `docs/SMOKE.md` (initially empty headings).
2. On merge to `main`, Render Blueprint should reconcile and create:
   - `tenwhy-alpha-web`
   - `tenwhy-alpha-api`
   - `tenwhy-alpha-data`
   - `tenwhy-alpha-db`
3. Wait for all three web services to go `live` and Postgres `available`.
4. From a workstation with `DATABASE_URL` of the Render DB, run `npm run db:init`.
5. Point DNS:
   - `alpha.tenwhy.com` → `tenwhy-alpha-web`
   - `api.alpha.tenwhy.com` → `tenwhy-alpha-api`
   - `data.alpha.tenwhy.com` → `tenwhy-alpha-data`
6. Verify Render shows all three custom domains "verified" with HTTPS issued.

### Smoke

Run **three** end-to-end submissions through the live UI and record results in `docs/SMOKE.md`:

| # | slug              | description                                                  |
|---|-------------------|--------------------------------------------------------------|
| 1 | `plant-kanban`    | a kanban board for tracking plant care tasks and watering    |
| 2 | `recipe-bin`      | a list of recipes I can add, edit, and tag by cuisine        |
| 3 | `habit-streak`    | a daily habit tracker that shows my current streak per habit |

For each run, record:
- timestamps for each status transition,
- GitHub repo URL + PR URL,
- Render service URL + first live URL,
- whether opening the URL in two different browsers shows shared data (PRD §10 #7),
- any errors and how they were handled.

## Acceptance criteria
- [ ] All three smoke runs reach `status=live`.
- [ ] Each generated app's `/api/health` returns 200.
- [ ] In each app, creating a record from browser A is visible after refresh in browser B.
- [ ] No 5xx logged from `tenwhy-alpha-data` during the smoke window.
- [ ] No secrets visible in any commit or in any deploy log.
- [ ] `docs/SMOKE.md` is filled in and committed.

## Out of scope
- Vanity subdomains.
- Cleanup of smoke apps (manual).
- Load testing.

## Review gate
Open PR titled **"task 06 — deploy + smoke"** with `docs/SMOKE.md` filled in. The reviewer signs off only after personally reproducing the third smoke run from `alpha.tenwhy.com`.
