"use client";

import { useEffect, useMemo, useState } from "react";
import { type ApiError, type AppRow, type AppStatus, getApp } from "../../../lib/api";

const STEPS: Array<{ label: string; status: AppStatus }> = [
  { label: "Queued", status: "queued" },
  { label: "Generating with Composer 2.5", status: "generating" },
  { label: "Pushing to GitHub", status: "pushing" },
  { label: "Deploying to Render", status: "deploying" },
  { label: "Live", status: "live" }
];

const ACTIVE_STATUSES = new Set<AppStatus>(["queued", "generating", "pushing", "deploying"]);
const STEP_INDEX_BY_STATUS = new Map<AppStatus, number>(STEPS.map((step, index) => [step.status, index]));

export default function AppStatusPage({ params }: { params: { id: string } }) {
  const [app, setApp] = useState<AppRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastActiveStatus, setLastActiveStatus] = useState<AppStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const next = await getApp(params.id);
        if (cancelled) {
          return;
        }

        setApp(next);
        setError(null);

        if (next.status !== "failed") {
          setLastActiveStatus(next.status);
        }

        if (ACTIVE_STATUSES.has(next.status)) {
          timer = setTimeout(load, 3000);
        }
      } catch (caught) {
        if (!cancelled) {
          const apiError = caught as ApiError;
          setError(apiError.message);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [params.id]);

  const currentStepIndex = useMemo(() => {
    if (!app) {
      return 0;
    }

    if (app.status === "failed") {
      return failedStepIndex(app, lastActiveStatus);
    }

    return STEP_INDEX_BY_STATUS.get(app.status) ?? 0;
  }, [app, lastActiveStatus]);

  return (
    <main className="shell">
      <section className="status-head">
        <a className="back-link" href="/">
          New app
        </a>
        <p className="eyebrow">{app?.slug ?? "Loading app"}</p>
        <h1>{app?.description ?? "Checking build status..."}</h1>
        <div className={`status-pill ${app?.status ?? "queued"}`}>{app?.status ?? "queued"}</div>
        {app?.status_message ? <p className="muted">{app.status_message}</p> : null}
        {error ? <p className="notice error-panel">{error}</p> : null}
      </section>

      <section className="panel">
        <ol className="steps">
          {STEPS.map((step, index) => {
            const state =
              app?.status === "failed" && index === currentStepIndex
                ? "failed"
                : index < currentStepIndex
                  ? "done"
                  : index === currentStepIndex
                    ? "current"
                    : "pending";
            return (
              <li className={state} key={step.status}>
                <span>{state === "failed" ? "!" : index + 1}</span>
                <p>{step.label}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="links">
        {app?.repo_url ? (
          <a className="text-link" href={app.repo_url} rel="noreferrer" target="_blank">
            View source ↗
          </a>
        ) : null}
        {app?.github_pr_url ? (
          <a className="text-link" href={app.github_pr_url} rel="noreferrer" target="_blank">
            View PR ↗
          </a>
        ) : null}
      </section>

      {app?.status === "live" && app.preview_url ? (
        <a className="primary-link" href={app.preview_url} rel="noreferrer" target="_blank">
          Open app
        </a>
      ) : null}

      {app?.status === "failed" ? (
        <section className="notice error-panel">
          <strong>Build failed</strong>
          <p>{app.error ?? "The app could not be generated."}</p>
        </section>
      ) : null}
    </main>
  );
}

function failedStepIndex(app: AppRow, lastActiveStatus: AppStatus | null): number {
  if (lastActiveStatus && lastActiveStatus !== "failed" && lastActiveStatus !== "live") {
    return STEP_INDEX_BY_STATUS.get(lastActiveStatus) ?? 0;
  }

  const text = `${app.status_message ?? ""} ${app.error ?? ""}`.toLowerCase();

  if (text.includes("render") || text.includes("deploy")) {
    return STEP_INDEX_BY_STATUS.get("deploying") ?? 0;
  }

  if (text.includes("push") || text.includes("merge") || text.includes("github") || text.includes(" pr")) {
    return STEP_INDEX_BY_STATUS.get("pushing") ?? 0;
  }

  if (text.includes("repo") || text.includes("composer") || text.includes("generat")) {
    return STEP_INDEX_BY_STATUS.get("generating") ?? 0;
  }

  return STEP_INDEX_BY_STATUS.get("queued") ?? 0;
}
