export type AppStatus = "queued" | "generating" | "pushing" | "deploying" | "live" | "failed";

export type AppRow = {
  id: string;
  slug: string;
  description: string;
  status: AppStatus;
  status_message?: string;
  preview_url?: string;
  error?: string;
  repo_url?: string;
  github_pr_url?: string;
  created_at: string;
  updated_at: string;
};

export type ApiError = {
  status: number;
  message: string;
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");

export async function createApp(input: { slug: string; description: string }): Promise<{ id: string }> {
  const response = await fetch(`${API_BASE_URL}/v1/apps`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseResponse<{ id: string }>(response);
}

export async function getApp(id: string): Promise<AppRow> {
  const response = await fetch(`${API_BASE_URL}/v1/apps/${encodeURIComponent(id)}`, {
    cache: "no-store"
  });

  return parseResponse<AppRow>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown; error_code?: unknown; message?: unknown }
    | null;

  if (!response.ok) {
    throw {
      status: response.status,
      message: readableError(payload)
    } satisfies ApiError;
  }

  return payload as T;
}

function readableError(payload: { error?: unknown; error_code?: unknown; message?: unknown } | null): string {
  const code = stringValue(payload?.error_code ?? payload?.error);
  const message = stringValue(payload?.message);

  if (code && message) {
    return `${code}: ${message}`;
  }

  return code ?? message ?? "Request failed";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
