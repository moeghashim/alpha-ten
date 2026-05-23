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
