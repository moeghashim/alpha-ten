import pg from "pg";
import { env } from "./env.js";

const { Pool } = pg;

export type AppStatus = "queued" | "generating" | "pushing" | "deploying" | "live" | "failed";

export type AppRow = {
  id: string;
  slug: string;
  description: string;
  status: AppStatus;
  status_message: string | null;
  tier: string;
  repo_url: string | null;
  repo_name: string | null;
  github_pr_url: string | null;
  cursor_agent_id: string | null;
  cursor_run_id: string | null;
  render_service_id: string | null;
  render_deploy_id: string | null;
  preview_url: string | null;
  error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
};

export type AppPatch = Partial<{
  status: AppStatus;
  status_message: string | null;
  repo_url: string;
  repo_name: string;
  github_pr_url: string;
  cursor_agent_id: string;
  cursor_run_id: string;
  render_service_id: string;
  render_deploy_id: string;
  preview_url: string;
  error: string | null;
}>;

const allowedPatchKeys = new Set<keyof AppPatch>([
  "status",
  "status_message",
  "repo_url",
  "repo_name",
  "github_pr_url",
  "cursor_agent_id",
  "cursor_run_id",
  "render_service_id",
  "render_deploy_id",
  "preview_url",
  "error"
]);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000
});

export async function getApp(id: string): Promise<AppRow | null> {
  const result = await pool.query<AppRow>("select * from apps where id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function getAppBySlug(slug: string): Promise<AppRow | null> {
  const result = await pool.query<AppRow>("select * from apps where slug = $1", [slug]);
  return result.rows[0] ?? null;
}

export async function insertApp(input: { slug: string; description: string }): Promise<AppRow> {
  const result = await pool.query<AppRow>(
    "insert into apps (slug, description) values ($1, $2) returning *",
    [input.slug, input.description]
  );
  return result.rows[0];
}

export async function updateApp(id: string, patch: AppPatch): Promise<AppRow> {
  const entries = Object.entries(patch).filter((entry): entry is [keyof AppPatch, string | null] => {
    const [key, value] = entry as [keyof AppPatch, string | null | undefined];
    return allowedPatchKeys.has(key) && value !== undefined;
  });

  if (entries.length === 0) {
    const app = await getApp(id);
    if (!app) {
      throw new Error(`app not found: ${id}`);
    }
    return app;
  }

  const setClause = entries.map(([key], index) => `${key} = $${index + 2}`).join(", ");
  const values = entries.map(([, value]) => value);
  const result = await pool.query<AppRow>(`update apps set ${setClause} where id = $1 returning *`, [
    id,
    ...values
  ]);
  const row = result.rows[0];

  if (!row) {
    throw new Error(`app not found: ${id}`);
  }

  return row;
}
