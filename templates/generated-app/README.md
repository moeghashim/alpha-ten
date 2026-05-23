# tenwhy-generated-app-template

This is the GitHub template repo used by alpha-ten to create generated demo apps. It is a minimal Next.js 14 App Router project with TypeScript and a pre-wired data API SDK.

Every generated app stores shared data through the alpha-ten platform data API. Anyone who opens the same deployed app URL sees the same persisted documents after refresh.

Do not edit `src/lib/db.ts` or anything under `.cursor/`. Those files define the platform contract that Composer must preserve.

## Run locally

```bash
npm install
npm run dev
npm run build
npm run start
```
