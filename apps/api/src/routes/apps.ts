import { Hono } from "hono";
import { ZodError } from "zod";
import { getApp, getAppBySlug, insertApp } from "../db.js";
import { enqueue } from "../lib/orchestrator.js";
import { validateCreateApp } from "../lib/validate.js";

export const appsRoute = new Hono();

appsRoute.post("/", async (c) => {
  let input: { slug: string; description: string };

  try {
    input = validateCreateApp(await c.req.json());
  } catch (error) {
    const message =
      error instanceof ZodError ? (error.issues[0]?.message ?? "bad request") : errorMessage(error);
    return c.json({ error: "bad_request", message }, 400);
  }

  const existing = await getAppBySlug(input.slug);
  if (existing) {
    return c.json({ error: "slug_taken" }, 409);
  }

  let app: Awaited<ReturnType<typeof insertApp>>;
  try {
    app = await insertApp(input);
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      return c.json({ error: "slug_taken" }, 409);
    }

    throw error;
  }
  enqueue(app.id);

  return c.json({ id: app.id, slug: app.slug, status: "queued" }, 202);
});

appsRoute.get("/:id", async (c) => {
  const app = await getApp(c.req.param("id"));
  if (!app) {
    return c.json({ error: "not_found" }, 404);
  }

  return c.json({
    ...app,
    health_url: app.preview_url ? `${app.preview_url}/api/health` : null
  });
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPgUniqueViolation(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23505"
  );
}
