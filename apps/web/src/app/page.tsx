"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type ApiError, createApp } from "../lib/api";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const MAX_DESCRIPTION_LENGTH = 300;

export default function HomePage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedDescription = description.trim();
  const slugIsValid = SLUG_PATTERN.test(slug);
  const descriptionIsValid =
    trimmedDescription.length > 0 && trimmedDescription.length <= MAX_DESCRIPTION_LENGTH;
  const canSubmit = slugIsValid && descriptionIsValid && !isSubmitting;

  const slugHint = useMemo(() => {
    if (slug.length === 0 || slugIsValid) {
      return "lowercase letters, numbers, dashes; 3–40 chars";
    }

    return "Use lowercase letters, numbers, and dashes. Start and end with a letter or number.";
  }, [slug, slugIsValid]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const app = await createApp({ slug, description: trimmedDescription });
      router.push(`/apps/${app.id}`);
    } catch (caught) {
      const apiError = caught as ApiError;
      if (apiError.status === 409) {
        setError("That name is taken — try another.");
      } else {
        setError(apiError.message);
      }
      setIsSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">alpha-ten</p>
        <h1>Describe an app. We&apos;ll build it.</h1>
      </section>

      <form className="panel form" onSubmit={onSubmit}>
        <label className="field">
          <span>App name</span>
          <input
            autoComplete="off"
            className={slug.length > 0 && !slugIsValid ? "invalid" : ""}
            name="slug"
            onChange={(event) => setSlug(event.target.value)}
            placeholder="plant-kanban"
            spellCheck={false}
            type="text"
            value={slug}
          />
          <small className={slug.length > 0 && !slugIsValid ? "error-text" : ""}>{slugHint}</small>
        </label>

        <label className="field">
          <span>Description</span>
          <textarea
            maxLength={MAX_DESCRIPTION_LENGTH}
            name="description"
            onChange={(event) => setDescription(event.target.value)}
            placeholder="a kanban board for tracking plant care tasks"
            rows={5}
            value={description}
          />
          <small>{description.length}/{MAX_DESCRIPTION_LENGTH}</small>
        </label>

        {error ? <p className="notice error-panel">{error}</p> : null}

        <button disabled={!canSubmit} type="submit">
          {isSubmitting ? "Starting..." : "Build app"}
        </button>
      </form>
    </main>
  );
}
