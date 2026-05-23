import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env.js";
import { appsRoute } from "./routes/apps.js";

const app = new Hono();
const platformBaseUrl = process.env.PLATFORM_BASE_URL;

app.use(
  "*",
  cors({
    origin: platformBaseUrl ? [platformBaseUrl, "http://localhost:3000"] : ["http://localhost:3000"],
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type"]
  })
);

app.get("/health", (c) => c.json({ ok: true }));
app.route("/v1/apps", appsRoute);

serve({ fetch: app.fetch, port: env.PORT });
console.log(`api listening on :${env.PORT}`);
