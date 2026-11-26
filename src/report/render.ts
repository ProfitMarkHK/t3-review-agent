import type { Finding, IncompleteScope, Severity } from "../publisher/findings";

export type ReportOutcome =
  | "posted"
  | "already-reviewed"
  | "superseded"
  | "would-post"
  | "failed";

export interface FindingsReportInput {
  owner: string;
  repo: string;
  pr: number;
  sha: string;
  outcome: ReportOutcome;
  findings: Finding[];
  incompleteScopes: IncompleteScope[];
  reviewUrl?: string;
  note?: string;
}

const severitySections: Array<{ severity: Severity; label: string }> = [
  { severity: "blocker", label: "Blocker" },
  { severity: "important", label: "Important" },
  { severity: "minor", label: "Minor" },
];

const outcomeLabels: Record<ReportOutcome, string> = {
  posted: "Posted",
  "already-reviewed": "Already reviewed",
  superseded: "Superseded",
  "would-post": "Would post",
  failed: "Failed",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.path < b.path) {
      return -1;
    }
    if (a.path > b.path) {
      return 1;
    }
    return a.line - b.line;
  });
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { blocker: 0, important: 0, minor: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

function renderLocation(finding: Finding, input: FindingsReportInput): string {
  const base = `https://github.com/${input.owner}/${input.repo}/blob/${input.sha}/${encodePath(finding.path)}`;
  const fragment =
    finding.endLine === undefined
      ? `L${finding.line}`
      : `L${finding.line}-L${finding.endLine}`;
  const label =
    finding.endLine === undefined
      ? `${finding.path}:${finding.line}`
      : `${finding.path}:${finding.line}-${finding.endLine}`;
  return `<a href="${escapeHtml(base)}#${fragment}">${escapeHtml(label)}</a>`;
}

function renderFinding(finding: Finding, input: FindingsReportInput): string {
  const severity = severitySections.find((section) => section.severity === finding.severity);
  const label = severity === undefined ? finding.severity : severity.label;
  return [
    `<article class="card card-${finding.severity}">`,
    `<div class="card-head">`,
    `<span class="badge badge-${finding.severity}">${escapeHtml(label)}</span>`,
    `<h4>${escapeHtml(finding.title)}</h4>`,
    `</div>`,
    `<p class="location">${renderLocation(finding, input)}<span class="confidence">confidence: ${escapeHtml(finding.confidence)}</span></p>`,
    `<h5>Evidence</h5>`,
    `<pre>${escapeHtml(finding.evidence)}</pre>`,
    `<h5>Suggested fix</h5>`,
    `<pre>${escapeHtml(finding.suggestedFix)}</pre>`,
    `</article>`,
  ].join("\n");
}

function renderOutcome(input: FindingsReportInput): string {
  const link =
    input.outcome === "posted" && input.reviewUrl !== undefined
      ? ` <a href="${escapeHtml(input.reviewUrl)}">View review</a>`
      : "";
  const note =
    input.note === undefined ? "" : `\n<p class="note">${escapeHtml(input.note)}</p>`;
  return `<p class="outcome outcome-${input.outcome}">${escapeHtml(outcomeLabels[input.outcome])}${link}</p>${note}`;
}

function renderCounts(findings: Finding[]): string {
  const counts = countBySeverity(findings);
  const badges = severitySections.map(
    (section) =>
      `<span class="badge badge-${section.severity}">${escapeHtml(section.label)}: ${counts[section.severity]}</span>`,
  );
  return `<div class="counts">${badges.join("\n")}</div>`;
}

function renderIncompleteScopes(incompleteScopes: IncompleteScope[]): string {
  if (incompleteScopes.length === 0) {
    return "";
  }

  const items = incompleteScopes.map(
    (item) =>
      `<li><strong>${escapeHtml(item.scope)}</strong>: ${escapeHtml(item.reason)}</li>`,
  );
  return [
    `<aside class="banner">`,
    `<h2>Incomplete review</h2>`,
    `<ul>`,
    ...items,
    `</ul>`,
    `</aside>`,
  ].join("\n");
}

function renderFindings(input: FindingsReportInput): string {
  if (input.findings.length === 0) {
    return `<p class="empty">No findings.</p>`;
  }

  const sorted = sortFindings(input.findings);
  const blocks: string[] = [];

  for (const section of severitySections) {
    const group = sorted.filter((finding) => finding.severity === section.severity);
    if (group.length === 0) {
      continue;
    }

    blocks.push(`<h3>${escapeHtml(section.label)} (${group.length})</h3>`);
    for (const finding of group) {
      blocks.push(renderFinding(finding, input));
    }
  }

  return blocks.join("\n");
}

export function renderFindingsReport(input: FindingsReportInput): string {
  const prUrl = `https://github.com/${input.owner}/${input.repo}/pull/${input.pr}`;
  const title = `${input.owner}/${input.repo}#${input.pr}`;
  const sha7 = input.sha.slice(0, 7);

  return [
    `<!DOCTYPE html>`,
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(title)} — Findings Report</title>`,
    `<style>`,
    `:root {`,
    `  color-scheme: light dark;`,
    `  --bg: #f6f7f9;`,
    `  --surface: #ffffff;`,
    `  --text: #1b1f24;`,
    `  --muted: #59636e;`,
    `  --border: #d8dee4;`,
    `  --link: #0b5cad;`,
    `  --blocker-bg: #ffebe9;`,
    `  --blocker-fg: #a40e26;`,
    `  --important-bg: #fff4d6;`,
    `  --important-fg: #7a5300;`,
    `  --minor-bg: #eef1f4;`,
    `  --minor-fg: #44515e;`,
    `}`,
    `@media (prefers-color-scheme: dark) {`,
    `  :root {`,
    `    --bg: #0d1117;`,
    `    --surface: #161b22;`,
    `    --text: #e6edf3;`,
    `    --muted: #9da7b3;`,
    `    --border: #30363d;`,
    `    --link: #6cb6ff;`,
    `    --blocker-bg: #3d1418;`,
    `    --blocker-fg: #ffb3ba;`,
    `    --important-bg: #3a2d0b;`,
    `    --important-fg: #ffd97a;`,
    `    --minor-bg: #21262d;`,
    `    --minor-fg: #c3ccd6;`,
    `  }`,
    `}`,
    `* { box-sizing: border-box; }`,
    `body { margin: 0; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }`,
    `main { max-width: 860px; margin: 0 auto; }`,
    `a { color: var(--link); }`,
    `h1 { font-size: 1.4rem; margin: 0 0 8px; overflow-wrap: anywhere; }`,
    `h2 { font-size: 1.15rem; margin: 28px 0 12px; }`,
    `h3 { font-size: 1rem; margin: 20px 0 10px; }`,
    `h4 { font-size: 1rem; margin: 0; overflow-wrap: anywhere; }`,
    `h5 { margin: 16px 0 6px; font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }`,
    `p { margin: 0 0 10px; overflow-wrap: anywhere; }`,
    `.meta { color: var(--muted); }`,
    `.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px; margin: 0 0 12px; }`,
    `.card-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }`,
    `.badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .78rem; font-weight: 600; white-space: nowrap; }`,
    `.badge-blocker { background: var(--blocker-bg); color: var(--blocker-fg); }`,
    `.badge-important { background: var(--important-bg); color: var(--important-fg); }`,
    `.badge-minor { background: var(--minor-bg); color: var(--minor-fg); }`,
    `.counts { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0 0; }`,
    `.location { margin-top: 8px; font-size: .92rem; }`,
    `.confidence { color: var(--muted); margin-left: 8px; }`,
    `.outcome { margin: 8px 0 0; font-weight: 600; }`,
    `.note { color: var(--muted); }`,
    `.banner { background: var(--important-bg); border: 1px solid var(--border); color: var(--important-fg); border-radius: 8px; padding: 12px 14px; margin: 20px 0 0; }`,
    `.banner h2 { margin: 0 0 6px; font-size: 1rem; color: inherit; }`,
    `.banner ul { margin: 0; padding-left: 20px; }`,
    `pre { margin: 0; padding: 10px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .88rem; }`,
    `.empty { color: var(--muted); }`,
    `@media (max-width: 480px) { body { padding: 12px; } .card { padding: 12px; } }`,
    `</style>`,
    `</head>`,
    `<body>`,
    `<main>`,
    `<header>`,
    `<h1><a href="${escapeHtml(prUrl)}">${escapeHtml(title)}</a></h1>`,
    `<p class="meta">Reviewed commit <code title="${escapeHtml(input.sha)}">${escapeHtml(sha7)}</code></p>`,
    renderOutcome(input),
    renderCounts(input.findings),
    `</header>`,
    renderIncompleteScopes(input.incompleteScopes),
    `<section>`,
    `<h2>Findings</h2>`,
    renderFindings(input),
    `</section>`,
    `</main>`,
    `</body>`,
    `</html>`,
  ].join("\n");
}
