export interface GitHubTarget {
  token: string;
  owner: string;
  repo: string;
  pr: number;
}

export interface PostedReview {
  id: number;
  url: string;
}

const apiBase = "https://api.github.com";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    Authorization: `Bearer ${token}`,
    "User-Agent": "t3-review-agent",
  };
}

async function githubFailure(response: Response): Promise<Error> {
  let message = response.statusText.length > 0 ? response.statusText : "request failed";
  try {
    const data: unknown = await response.json();
    if (isRecord(data) && typeof data.message === "string" && data.message.length > 0) {
      message = data.message;
    }
  } catch {
    message = response.statusText.length > 0 ? response.statusText : "request failed";
  }
  return new Error(`GitHub API request failed with status ${response.status}: ${message}`);
}

function reviewsUrl(target: GitHubTarget): string {
  return `${apiBase}/repos/${target.owner}/${target.repo}/pulls/${target.pr}/reviews`;
}

function pullUrl(target: GitHubTarget): string {
  return `${apiBase}/repos/${target.owner}/${target.repo}/pulls/${target.pr}`;
}

export async function listReviewBodies(target: GitHubTarget): Promise<string[]> {
  const bodies: string[] = [];
  let page = 1;

  while (true) {
    const url = `${reviewsUrl(target)}?per_page=100&page=${page}`;
    const response = await fetch(url, {
      method: "GET",
      headers: requestHeaders(target.token),
    });

    if (!response.ok) {
      throw await githubFailure(response);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("GitHub API returned an unexpected reviews payload");
    }

    for (const item of data) {
      if (isRecord(item) && typeof item.body === "string") {
        bodies.push(item.body);
      } else {
        bodies.push("");
      }
    }

    if (data.length < 100) {
      break;
    }

    page += 1;
  }

  return bodies;
}

export async function getPullHeadSha(target: GitHubTarget): Promise<string> {
  const response = await fetch(pullUrl(target), {
    method: "GET",
    headers: requestHeaders(target.token),
  });

  if (!response.ok) {
    throw await githubFailure(response);
  }

  const data: unknown = await response.json();
  if (
    !isRecord(data) ||
    !isRecord(data.head) ||
    typeof data.head.sha !== "string" ||
    data.head.sha.length === 0
  ) {
    throw new Error("GitHub API returned an unexpected pull request payload");
  }

  return data.head.sha;
}

export async function postReview(
  target: GitHubTarget,
  sha: string,
  body: string,
): Promise<PostedReview> {
  const response = await fetch(reviewsUrl(target), {
    method: "POST",
    headers: {
      ...requestHeaders(target.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ commit_id: sha, event: "COMMENT", body }),
  });

  if (!response.ok) {
    throw await githubFailure(response);
  }

  const data: unknown = await response.json();
  if (!isRecord(data) || typeof data.id !== "number" || typeof data.html_url !== "string") {
    throw new Error("GitHub API returned an unexpected review payload");
  }

  return { id: data.id, url: data.html_url };
}
