import type { GitHubPr, GitHubCommit, GitHubFile, GitHubIssue } from "./types";

const GITHUB_API_BASE = "https://api.github.com";

function createGithubHeaders(): Record<string, string> {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("Missing GITHUB_TOKEN");
  }

  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-team-memory",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubGet<T>(path: string, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${GITHUB_API_BASE}${path}`, {
        headers: createGithubHeaders(),
      });

      if (response.status === 403 || response.status === 429) {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const waitMs = resetHeader
          ? Math.max(Number(resetHeader) * 1000 - Date.now(), 1000)
          : 60000;
        const cappedWait = Math.min(waitMs, 60000);
        console.log(`Rate limited, waiting ${Math.round(cappedWait / 1000)}s...`);
        await sleep(cappedWait);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`GitHub API ${response.status}: ${text}`);
      }

      return (await response.json()) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < retries && message.includes("fetch failed")) {
        console.log(`Fetch failed for ${path}, retry ${attempt}/${retries}...`);
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`Failed after ${retries} retries for ${path}`);
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("repo must be in the format owner/name");
  }
  return { owner: parts[0], name: parts[1] };
}

export async function fetchPullRequests(repo: string, limit = 20): Promise<GitHubPr[]> {
  const { owner, name } = parseRepo(repo);
  const perPage = Math.min(Math.max(limit, 1), 100);
  return githubGet<GitHubPr[]>(
    `/repos/${owner}/${name}/pulls?state=all&sort=created&direction=desc&per_page=${perPage}`
  );
}

export async function fetchPrCommits(repo: string, prNumber: number): Promise<GitHubCommit[]> {
  const { owner, name } = parseRepo(repo);
  return githubGet<GitHubCommit[]>(
    `/repos/${owner}/${name}/pulls/${prNumber}/commits?per_page=100`
  );
}

export async function fetchPrFiles(repo: string, prNumber: number): Promise<GitHubFile[]> {
  const { owner, name } = parseRepo(repo);
  return githubGet<GitHubFile[]>(
    `/repos/${owner}/${name}/pulls/${prNumber}/files?per_page=100`
  );
}

export async function fetchIssues(repo: string, limit = 30): Promise<GitHubIssue[]> {
  const { owner, name } = parseRepo(repo);
  const perPage = Math.min(Math.max(limit, 1), 100);
  return githubGet<GitHubIssue[]>(
    `/repos/${owner}/${name}/issues?state=all&sort=created&direction=desc&per_page=${perPage}`
  );
}
