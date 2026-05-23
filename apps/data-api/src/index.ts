import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { rateLimit } from "./rateLimit.js";
import { documentsRoute } from "./routes/documents.js";

type Variables = {
  appId: string;
};

const port = Number(process.env.PORT ?? 8788);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const app = new Hono<{ Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
    allowHeaders: ["Authorization", "X-App-Id", "Content-Type"]
  })
);

app.get("/health", (c) => c.json({ ok: true }));
app.use("/v1/d/*", auth, rateLimit);
app.route("/v1/d", documentsRoute);

serve({ fetch: app.fetch, port });
console.log(`data-api listening on :${port}`);
