import { Agent, type SDKMessage } from "@cursor/sdk";
import { env } from "../env.js";
import { log } from "./log.js";

export type ComposerResult = {
  agentId: string;
  runId: string;
  prUrl: string | null;
  branch: string | null;
  status: "finished" | "failed";
  lastMessage?: string;
};

export function buildPrompt(slug: string, description: string): string {
  return `You are generating a complete runnable demo web app in this repository.

APP SLUG: ${slug}
USER DESCRIPTION: ${description}

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
9. Before finishing, run \`npm run build\` and fix any errors.
10. Commit and open a PR.

Do NOT:
 - ask follow-up questions
 - leave TODOs, placeholders, or commented-out code
 - require additional environment variables
 - modify src/lib/db.ts or any file under .cursor/
 - generate unsafe, malicious, or credential-harvesting functionality`;
}

function summarizeMessage(message: SDKMessage): string {
  return JSON.stringify(message).slice(0, 1_000);
}

export async function runComposer(opts: {
  repoUrl: string;
  slug: string;
  description: string;
  signal?: AbortSignal;
}): Promise<ComposerResult> {
  const agent = await Agent.create({
    apiKey: env.CURSOR_API_KEY,
    model: { id: "composer-2.5" },
    cloud: {
      repos: [{ url: opts.repoUrl, startingRef: "main" }],
      autoCreatePR: true
    },
    name: `appgen:${opts.slug}`
  });

  const run = await agent.send(buildPrompt(opts.slug, opts.description));
  const abort = () => {
    void run.cancel().catch((error: unknown) => {
      log("warn", "cursor run cancel failed", { error: String(error), runId: run.id });
    });
  };

  opts.signal?.addEventListener("abort", abort, { once: true });

  try {
    let lastMessage: string | undefined;

    for await (const message of run.stream()) {
      lastMessage = summarizeMessage(message);
      log("info", "cursor event", {
        agentId: agent.agentId,
        runId: run.id,
        message: lastMessage
      });
    }

    const result = await run.wait();
    const gitBranch = result.git?.branches[0];

    return {
      agentId: agent.agentId,
      runId: run.id,
      prUrl: gitBranch?.prUrl ?? null,
      branch: gitBranch?.branch ?? null,
      status: result.status === "finished" ? "finished" : "failed",
      lastMessage
    };
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    agent.close();
  }
}
