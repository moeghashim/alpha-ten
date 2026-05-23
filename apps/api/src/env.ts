import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CURSOR_API_KEY: z.string().min(1),
  GITHUB_TOKEN: z.string().min(1),
  GITHUB_OWNER: z.string().min(1),
  GITHUB_TEMPLATE_REPO: z.string().min(1),
  RENDER_API_KEY: z.string().min(1),
  RENDER_OWNER_ID: z.string().min(1),
  DATA_API_BASE_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().default(8787),
  RENDER_REGION: z.string().min(1).default("oregon"),
  RENDER_PLAN: z.string().min(1).default("starter"),
  JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  DEPLOY_POLL_MS: z.coerce.number().int().positive().default(12_000)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const keys = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))];
  const message = `Missing or invalid environment variables: ${keys.join(", ")}`;
  console.error(message);
  throw new Error(message);
}

export const env = parsed.data;
