import { env } from "../env.js";

export type DeployStatus =
  | "created"
  | "queued"
  | "build_in_progress"
  | "pre_deploy_in_progress"
  | "update_in_progress"
  | "live"
  | "build_failed"
  | "pre_deploy_failed"
  | "update_failed"
  | "canceled";

const renderBaseUrl = "https://api.render.com/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function renderFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const response = await fetch(`${renderBaseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Bearer ${env.RENDER_API_KEY}`
    }
  });

  if (response.status === 429 && retry) {
    const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "1");
    await sleep(Math.max(1, retryAfterSeconds) * 1_000);
    return renderFetch(path, init, false);
  }

  if (!response.ok) {
    throw new Error(`Render API ${response.status}: ${await response.text()}`);
  }

  return response;
}

export async function createService(opts: {
  name: string;
  repoUrl: string;
  envVars: Record<string, string>;
}): Promise<{ serviceId: string; serviceUrl: string }> {
  const response = await renderFetch("/services", {
    method: "POST",
    body: JSON.stringify({
      type: "web_service",
      name: opts.name,
      ownerId: env.RENDER_OWNER_ID,
      repo: opts.repoUrl,
      branch: "main",
      autoDeploy: "yes",
      serviceDetails: {
        runtime: "node",
        plan: env.RENDER_PLAN,
        region: env.RENDER_REGION,
        numInstances: 1,
        healthCheckPath: "/api/health",
        envSpecificDetails: {
          buildCommand: "npm ci && npm run build",
          startCommand: "npm run start"
        },
        renderSubdomainPolicy: "enabled"
      },
      envVars: Object.entries(opts.envVars).map(([key, value]) => ({ key, value }))
    })
  });
  const body = asRecord(await response.json());
  const service = asRecord(body.service ?? body);
  const serviceDetails = asRecord(service.serviceDetails);
  const serviceId = typeof service.id === "string" ? service.id : "";

  if (!serviceId) {
    throw new Error("Render create service response did not include a service id");
  }

  return {
    serviceId,
    serviceUrl:
      typeof serviceDetails.url === "string" && serviceDetails.url.length > 0
        ? serviceDetails.url
        : `https://${opts.name}.onrender.com`
  };
}

export async function getLatestDeploy(serviceId: string): Promise<{ deployId: string; status: DeployStatus }> {
  const response = await renderFetch(`/services/${serviceId}/deploys?limit=1`);
  const body = await response.json();
  const bodyRecord = asRecord(body);
  const deploys = bodyRecord.deploys;
  const first = Array.isArray(body) ? body[0] : Array.isArray(deploys) ? deploys[0] : body;
  const deploy = asRecord(asRecord(first).deploy ?? first);
  const deployId = typeof deploy.id === "string" ? deploy.id : "";
  const status = typeof deploy.status === "string" ? deploy.status : "";

  if (!deployId || !isDeployStatus(status)) {
    throw new Error("Render latest deploy response did not include a valid deploy id and status");
  }

  return { deployId, status };
}

function isDeployStatus(status: string): status is DeployStatus {
  return [
    "created",
    "queued",
    "build_in_progress",
    "pre_deploy_in_progress",
    "update_in_progress",
    "live",
    "build_failed",
    "pre_deploy_failed",
    "update_failed",
    "canceled"
  ].includes(status);
}
