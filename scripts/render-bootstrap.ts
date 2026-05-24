import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const renderBaseUrl = "https://api.render.com/v1";
const repoUrl = "https://github.com/moeghashim/alpha-ten";
const region = "oregon";
const postgresName = "tenwhy-alpha-db";

type Env = Record<string, string>;

type RenderService = {
  id: string;
  name: string;
  dashboardUrl?: string;
  serviceDetails?: {
    url?: string;
  };
};

type RenderPostgres = {
  id: string;
  name: string;
  status?: string;
  dashboardUrl?: string;
};

type CustomDomain = {
  id?: string;
  name: string;
  verificationStatus?: string;
};

type EnvVar = {
  key: string;
  value?: string;
};

const requiredEnv = [
  "RENDER_API_KEY",
  "RENDER_OWNER_ID",
  "CURSOR_API_KEY",
  "GITHUB_TOKEN",
  "GITHUB_OWNER",
  "GITHUB_TEMPLATE_REPO",
  "PLATFORM_BASE_URL",
  "DATA_API_BASE_URL",
  "NEXT_PUBLIC_API_BASE_URL"
];

async function main() {
  const env = loadEnvLocal();
  for (const key of requiredEnv) {
    if (!env[key]) {
      throw new Error(`Missing ${key} in .env.local`);
    }
  }

  const client = new RenderClient(env.RENDER_API_KEY);
  const ownerId = env.RENDER_OWNER_ID;

  console.log("Loading existing Render resources...");
  const services = indexByName(await client.listServices(ownerId));
  let postgres = indexByName(await client.listPostgres(ownerId));

  if (!postgres.has(postgresName)) {
    console.log(`Creating Postgres ${postgresName}...`);
    const created = await client.createPostgres({
      databaseName: "tenwhy_alpha",
      databaseUser: "tenwhy_alpha",
      name: postgresName,
      ownerId,
      plan: "basic_256mb",
      region,
      version: "16"
    });
    postgres.set(created.name, created);
  } else {
    console.log(`Postgres ${postgresName} already exists.`);
  }

  const db = mustGet(postgres, postgresName);
  const databaseUrl = await client.getPostgresInternalConnectionString(db.id);

  await ensureService(client, services, {
    name: "tenwhy-alpha-web",
    domain: "alpha.tenwhy.com",
    envVars: valuesToEnvVars({
      NEXT_PUBLIC_API_BASE_URL: env.NEXT_PUBLIC_API_BASE_URL
    }),
    create: {
      type: "web_service",
      name: "tenwhy-alpha-web",
      ownerId,
      repo: repoUrl,
      branch: "main",
      autoDeploy: "yes",
      rootDir: "apps/web",
      envVars: valuesToEnvVars({
        NEXT_PUBLIC_API_BASE_URL: env.NEXT_PUBLIC_API_BASE_URL
      }),
      serviceDetails: webServiceDetails("/")
    }
  });

  await ensureService(client, services, {
    name: "tenwhy-alpha-api",
    domain: "api.alpha.tenwhy.com",
    envVars: valuesToEnvVars({
      DATABASE_URL: databaseUrl,
      CURSOR_API_KEY: env.CURSOR_API_KEY,
      GITHUB_TOKEN: env.GITHUB_TOKEN,
      GITHUB_OWNER: env.GITHUB_OWNER,
      GITHUB_TEMPLATE_REPO: env.GITHUB_TEMPLATE_REPO,
      RENDER_API_KEY: env.RENDER_API_KEY,
      RENDER_OWNER_ID: ownerId,
      RENDER_REGION: region,
      PLATFORM_BASE_URL: env.PLATFORM_BASE_URL,
      DATA_API_BASE_URL: env.DATA_API_BASE_URL
    }),
    create: {
      type: "web_service",
      name: "tenwhy-alpha-api",
      ownerId,
      repo: repoUrl,
      branch: "main",
      autoDeploy: "yes",
      rootDir: "apps/api",
      envVars: valuesToEnvVars({
        DATABASE_URL: databaseUrl,
        CURSOR_API_KEY: env.CURSOR_API_KEY,
        GITHUB_TOKEN: env.GITHUB_TOKEN,
        GITHUB_OWNER: env.GITHUB_OWNER,
        GITHUB_TEMPLATE_REPO: env.GITHUB_TEMPLATE_REPO,
        RENDER_API_KEY: env.RENDER_API_KEY,
        RENDER_OWNER_ID: ownerId,
        RENDER_REGION: region,
        PLATFORM_BASE_URL: env.PLATFORM_BASE_URL,
        DATA_API_BASE_URL: env.DATA_API_BASE_URL
      }),
      serviceDetails: webServiceDetails("/health")
    }
  });

  await ensureService(client, services, {
    name: "tenwhy-alpha-data",
    domain: "data.alpha.tenwhy.com",
    envVars: valuesToEnvVars({
      DATABASE_URL: databaseUrl,
      MAX_DOCS_PER_APP: "10000",
      MAX_BODY_BYTES: "1048576",
      RATE_LIMIT_PER_SEC: "50"
    }),
    create: {
      type: "web_service",
      name: "tenwhy-alpha-data",
      ownerId,
      repo: repoUrl,
      branch: "main",
      autoDeploy: "yes",
      rootDir: "apps/data-api",
      envVars: valuesToEnvVars({
        DATABASE_URL: databaseUrl,
        MAX_DOCS_PER_APP: "10000",
        MAX_BODY_BYTES: "1048576",
        RATE_LIMIT_PER_SEC: "50"
      }),
      serviceDetails: webServiceDetails("/health")
    }
  });

  const summaryServices = ["tenwhy-alpha-web", "tenwhy-alpha-api", "tenwhy-alpha-data"].map((name) =>
    mustGet(services, name)
  );

  console.log("\nRender bootstrap summary");
  console.log(`- Render resources: ${summaryServices.length + 1} present (3 web services + 1 Postgres)`);
  for (const service of summaryServices) {
    console.log(`- service ${service.name}: ${service.id}${service.serviceDetails?.url ? ` ${service.serviceDetails.url}` : ""}`);
  }
  console.log(`- database ${db.name}: ${db.id}${db.status ? ` ${db.status}` : ""}`);
  console.log("- custom domains: alpha.tenwhy.com, api.alpha.tenwhy.com, data.alpha.tenwhy.com");
}

async function ensureService(
  client: RenderClient,
  services: Map<string, RenderService>,
  opts: { name: string; domain: string; envVars: Array<{ key: string; value: string }>; create: Record<string, unknown> }
) {
  let service = services.get(opts.name);

  if (!service) {
    console.log(`Creating service ${opts.name}...`);
    service = await client.createService(opts.create);
    services.set(service.name, service);
  } else {
    console.log(`Service ${opts.name} already exists.`);
  }

  await client.ensureEnvVars(service.id, opts.envVars);
  await client.ensureCustomDomain(service.id, opts.domain);
}

function webServiceDetails(healthCheckPath: string) {
  return {
    runtime: "node",
    plan: "starter",
    region,
    numInstances: 1,
    healthCheckPath,
    envSpecificDetails: {
      buildCommand: "npm ci && npm run build",
      startCommand: "npm run start"
    },
    renderSubdomainPolicy: "enabled"
  };
}

function valuesToEnvVars(values: Record<string, string>) {
  return Object.entries(values).map(([key, value]) => ({ key, value }));
}

class RenderClient {
  constructor(private readonly apiKey: string) {}

  async listServices(ownerId: string): Promise<RenderService[]> {
    const body = await this.request("GET", `/services?ownerId=${encodeURIComponent(ownerId)}&limit=100`);
    return collection(body, "service");
  }

  async listPostgres(ownerId: string): Promise<RenderPostgres[]> {
    const body = await this.request("GET", `/postgres?ownerId=${encodeURIComponent(ownerId)}&limit=100`);
    return collection(body, "postgres");
  }

  async createPostgres(body: Record<string, unknown>): Promise<RenderPostgres> {
    return this.request("POST", "/postgres", body);
  }

  async createService(body: Record<string, unknown>): Promise<RenderService> {
    const response = await this.request("POST", "/services", body);
    return response.service ?? response;
  }

  async getPostgresInternalConnectionString(postgresId: string): Promise<string> {
    const body = await this.request("GET", `/postgres/${postgresId}/connection-info`);
    if (typeof body.internalConnectionString !== "string" || body.internalConnectionString.length === 0) {
      throw new Error("Render Postgres connection-info response did not include internalConnectionString");
    }

    return body.internalConnectionString;
  }

  async ensureCustomDomain(serviceId: string, domain: string): Promise<void> {
    const encodedDomain = encodeURIComponent(domain);
    const existing = await this.request("GET", `/services/${serviceId}/custom-domains?name=${encodedDomain}&limit=100`);
    const domains = collection<CustomDomain>(existing, "customDomain");

    if (domains.some((customDomain) => customDomain.name === domain)) {
      console.log(`Custom domain ${domain} already exists.`);
      return;
    }

    console.log(`Adding custom domain ${domain}...`);
    await this.request("POST", `/services/${serviceId}/custom-domains`, { name: domain }, [201, 409]);
  }

  async ensureEnvVars(serviceId: string, envVars: Array<{ key: string; value: string }>): Promise<void> {
    const existing = await this.request("GET", `/services/${serviceId}/env-vars?limit=100`);
    const existingKeys = new Set(collection<EnvVar>(existing, "envVar").map((envVar) => envVar.key));

    for (const envVar of envVars) {
      if (existingKeys.has(envVar.key)) {
        continue;
      }

      console.log(`Adding env var ${envVar.key}...`);
      await this.request(
        "PUT",
        `/services/${serviceId}/env-vars/${encodeURIComponent(envVar.key)}`,
        { value: envVar.value }
      );
    }
  }

  private async request(method: string, path: string, body?: unknown, okStatuses = [200, 201, 202, 204]) {
    const response = await fetch(`${renderBaseUrl}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { "Content-Type": "application/json" } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!okStatuses.includes(response.status)) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Render API ${method} ${redactPath(path)} failed with ${response.status}: ${redactSecrets(errorBody)}`
      );
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }
}

function loadEnvLocal(): Env {
  const envPath = resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    throw new Error(".env.local not found at repo root");
  }

  const env: Env = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equals = trimmed.indexOf("=");
    if (equals === -1) {
      continue;
    }

    const key = trimmed.slice(0, equals).trim();
    env[key] = unquote(trimmed.slice(equals + 1).trim());
  }

  return env;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function collection<T>(body: unknown, key: string): T[] {
  if (!Array.isArray(body)) {
    return [];
  }

  return body.map((item) => {
    if (item && typeof item === "object" && key in item) {
      return (item as Record<string, T>)[key];
    }

    return item as T;
  });
}

function indexByName<T extends { name: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function mustGet<T>(map: Map<string, T>, name: string): T {
  const value = map.get(name);
  if (!value) {
    throw new Error(`${name} was not found after bootstrap`);
  }

  return value;
}

function redactPath(path: string): string {
  return path.replace(/([?&](?:ownerId|name)=)[^&]+/g, "$1[redacted]");
}

function redactSecrets(text: string): string {
  return text
    .replace(/rnd_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/cur_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/postgres(?:ql)?:\/\/[^"'\s]+/g, "[redacted-postgres-url]");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
