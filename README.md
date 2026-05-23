# alpha-ten

Demo platform at **alpha.tenwhy.com**. A user submits an app name + short description; the system generates a full web app with **Cursor Composer 2.5**, deploys it to **Render**, and returns a live URL. All generated apps share a single, multi-tenant **document store API** so that any link a user shares shows the same data to their friend.

This repo is the **platform** (form/UI + orchestrator API + data API + Postgres schema). The **generated apps' template** lives in [`templates/generated-app`](templates/generated-app) and gets pushed to a separate GitHub repo (see `PRD.md` §6).

## Start here

| Read | Purpose |
|---|---|
| [PRD.md](PRD.md) | Full product + technical spec. Source of truth. |
| [AGENTS.md](AGENTS.md) | How the executing agent should work, including the review protocol. |
| [tasks/](tasks) | Ordered, atomic, reviewable work units. Execute in numeric order. |

## Quick stack summary

| Layer | Tech |
|---|---|
| Frontend (form + status) | Next.js on Render → `alpha.tenwhy.com` |
| Orchestrator API | Node 20 + Hono on Render → `api.alpha.tenwhy.com` |
| Multi-tenant data API | Node 20 + Hono on Render → `data.alpha.tenwhy.com` |
| Database | Single Render Postgres (apps + documents tables) |
| Codegen | `@cursor/sdk` Cloud, model `composer-2.5` |
| Repo host | GitHub user `moeghashim`, one repo per generated app |
| App hosting | One Render web service per generated app, public URL = `<service>.onrender.com` |

## Local dev

```bash
cp .env.example .env   # fill values
npm install
npm run db:init        # runs infra/sql/001_init.sql against $DATABASE_URL
npm run dev:api        # http://localhost:8787
npm run dev:data       # http://localhost:8788
npm run dev:web        # http://localhost:3000
```

## Deploy

Deploy via Render Blueprint using [`render.yaml`](render.yaml). DNS: point `alpha`, `api.alpha`, `data.alpha` at the matching Render services.
