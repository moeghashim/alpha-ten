import { Octokit } from "@octokit/rest";
import { nanoid } from "nanoid";
import { env } from "../env.js";

type RepoParts = {
  owner: string;
  repo: string;
};

function createOctokit(): Octokit {
  return new Octokit({ auth: env.GITHUB_TOKEN });
}

function splitRepoName(repoName: string): RepoParts {
  const [owner, repo] = repoName.split("/");

  if (!owner || !repo) {
    throw new Error(`Expected repo name in owner/repo form, got: ${repoName}`);
  }

  return { owner, repo };
}

function templateRepoParts(): RepoParts {
  if (env.GITHUB_TEMPLATE_REPO.includes("/")) {
    return splitRepoName(env.GITHUB_TEMPLATE_REPO);
  }

  return { owner: env.GITHUB_OWNER, repo: env.GITHUB_TEMPLATE_REPO };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function createRepoFromTemplate(
  slug: string,
  description: string
): Promise<{ repoUrl: string; repoName: string }> {
  const octokit = createOctokit();
  const template = templateRepoParts();
  const name = `app-${slug}-${nanoid(6)}`;

  await octokit.repos.createUsingTemplate({
    template_owner: template.owner,
    template_repo: template.repo,
    owner: env.GITHUB_OWNER,
    name,
    private: true,
    include_all_branches: false,
    description: description.slice(0, 350)
  });

  const deadline = Date.now() + 30_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const repo = await octokit.repos.get({ owner: env.GITHUB_OWNER, repo: name });
      return {
        repoUrl: repo.data.html_url,
        repoName: `${env.GITHUB_OWNER}/${name}`
      };
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }

  throw new Error(`Timed out waiting for generated repo ${env.GITHUB_OWNER}/${name}: ${String(lastError)}`);
}

export async function getOpenPr(repoName: string): Promise<{ number: number; url: string } | null> {
  const octokit = createOctokit();
  const repo = splitRepoName(repoName);
  const result = await octokit.pulls.list({
    owner: repo.owner,
    repo: repo.repo,
    state: "open",
    per_page: 1
  });
  const pr = result.data[0];

  return pr ? { number: pr.number, url: pr.html_url } : null;
}

export async function mergePr(repoName: string, prNumber: number): Promise<void> {
  const octokit = createOctokit();
  const repo = splitRepoName(repoName);

  await octokit.pulls.merge({
    owner: repo.owner,
    repo: repo.repo,
    pull_number: prNumber,
    merge_method: "squash"
  });
}
