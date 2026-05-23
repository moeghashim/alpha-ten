import { env } from "../env.js";
import { getApp, updateApp } from "../db.js";
import { runComposer } from "./cursor.js";
import { createRepoFromTemplate, mergePr } from "./github.js";
import { generateAppKey, insertAppKey } from "./keys.js";
import { log } from "./log.js";
import { createService, getLatestDeploy } from "./render.js";

const queue: string[] = [];
const maxActive = 3;
let active = 0;

export function enqueue(appId: string): void {
  queue.push(appId);
  drain();
}

function drain(): void {
  while (active < maxActive && queue.length > 0) {
    const appId = queue.shift();
    if (!appId) {
      return;
    }

    active += 1;
    log("info", "orchestrator job started", { appId, active });
    void runJob(appId)
      .catch((error: unknown) => {
        log("error", "orchestrator job escaped", { appId, error: errorMessage(error) });
      })
      .finally(() => {
        active -= 1;
        log("info", "orchestrator job finished", { appId, active });
        drain();
      });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function prNumberFromUrl(url: string): number {
  const match = url.match(/\/pull\/(\d+)(?:$|[/?#])/);
  if (!match) {
    throw new Error(`could not parse PR number from ${url}`);
  }
  return Number(match[1]);
}

function shortIdFromRepoName(repoName: string): string {
  const repo = repoName.split("/").at(-1) ?? repoName;
  return repo.split("-").at(-1) ?? "app";
}

function remainingBudget(startedAt: number): number {
  return Math.max(0, env.JOB_TIMEOUT_MS - (Date.now() - startedAt));
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

async function runJob(appId: string): Promise<void> {
  const startedAt = Date.now();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), env.JOB_TIMEOUT_MS);

  try {
    const app = await getApp(appId);
    if (!app) {
      throw new Error(`app not found: ${appId}`);
    }

    await updateApp(app.id, { status: "generating", status_message: "creating repo", error: null });
    const { repoUrl, repoName } = await createRepoFromTemplate(app.slug, app.description);
    await updateApp(app.id, { repo_url: repoUrl, repo_name: repoName });

    await updateApp(app.id, { status_message: "composer 2.5 running" });
    const composer = await runComposer({
      repoUrl,
      slug: app.slug,
      description: app.description,
      signal: abortController.signal
    });
    await updateApp(app.id, { cursor_agent_id: composer.agentId, cursor_run_id: composer.runId });

    if (composer.status === "canceled") {
      throw new Error("cancelled by timeout");
    }
    if (composer.status !== "finished") {
      throw new Error(composer.lastMessage ?? "composer failed");
    }

    if (composer.prUrl) {
      await updateApp(app.id, { status: "pushing", github_pr_url: composer.prUrl });
      await mergePr(repoName, prNumberFromUrl(composer.prUrl));
    } else if (composer.branch) {
      throw new Error("composer finished without opening a PR");
    }

    await updateApp(app.id, { status: "deploying", status_message: "creating render service" });
    const plaintextKey = generateAppKey();
    await insertAppKey(app.id, plaintextKey);
    const { serviceId, serviceUrl } = await createService({
      name: `app-${app.slug}-${shortIdFromRepoName(repoName)}`,
      repoUrl,
      envVars: {
        NEXT_PUBLIC_DATA_API_URL: env.DATA_API_BASE_URL,
        NEXT_PUBLIC_APP_ID: app.id,
        NEXT_PUBLIC_APP_KEY: plaintextKey
      }
    });
    await updateApp(app.id, { render_service_id: serviceId, preview_url: serviceUrl });

    while (remainingBudget(startedAt) > 0) {
      const deploy = await getLatestDeploy(serviceId);
      await updateApp(app.id, {
        render_deploy_id: deploy.deployId,
        status_message: `deploy: ${deploy.status}`
      });

      if (deploy.status === "live") {
        await updateApp(app.id, { status: "live" });
        return;
      }

      if (deploy.status.endsWith("_failed") || deploy.status === "canceled") {
        throw new Error(`deploy: ${deploy.status}`);
      }

      await sleep(Math.min(env.DEPLOY_POLL_MS, remainingBudget(startedAt)), abortController.signal);
    }

    throw new Error("cancelled by timeout");
  } catch (error) {
    await updateApp(appId, { status: "failed", error: errorMessage(error) }).catch((updateError: unknown) => {
      log("error", "failed to mark app failed", { appId, error: errorMessage(updateError) });
    });
  } finally {
    clearTimeout(timeout);
  }
}
