import type { Finding, IncompleteScope, Severity } from "./findings";

export interface ReviewBodyInput {
  sha: string;
  owner: string;
  repo: string;
  findings: Finding[];
  incompleteScopes: IncompleteScope[];
}

const maxBodyLength = 60000;

const severitySections: Array<{ severity: Severity; label: string }> = [
  { severity: "blocker", label: "Blocker" },
  { severity: "important", label: "Important" },
  { severity: "minor", label: "Minor" },
];

export function reviewMarker(sha: string): string {
  return `<!-- t3-review-agent sha=${sha} -->`;
}

function longestBacktickRun(value: string): number {
  let longest = 0;
  let current = 0;
  for (const char of value) {
    if (char === "`") {
      current += 1;
      if (current > longest) {
        longest = current;
      }
    } else {
      current = 0;
    }
  }
  return longest;
}

function fencedText(label: string, value: string): string[] {
  const normalized = value.replace(/\r\n|\r/g, "\n");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(normalized) + 1));
  return [`**${label}:**`, "", fence, normalized, fence];
}

function inlineText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F\u0085\u2028\u2029]+/g, " ")
    .replace(/[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/g, (char) => `\\${char}`);
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeSegment).join("/");
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

function locationLine(finding: Finding, input: ReviewBodyInput): string {
  const encodedPath = encodePath(finding.path);
  const displayPath = inlineText(finding.path);
  const url = `https://github.com/${input.owner}/${input.repo}/blob/${input.sha}/${encodedPath}`;
  if (finding.endLine === undefined) {
    return `[${displayPath}:${finding.line}](${url}#L${finding.line})  _(confidence: ${finding.confidence})_`;
  }
  return `[${displayPath}:${finding.line}-${finding.endLine}](${url}#L${finding.line}-L${finding.endLine})  _(confidence: ${finding.confidence})_`;
}

function renderFinding(finding: Finding, input: ReviewBodyInput): string {
  return [
    `#### ${inlineText(finding.title)}`,
    locationLine(finding, input),
    "",
    ...fencedText("Evidence", finding.evidence),
    "",
    ...fencedText("Suggested fix", finding.suggestedFix),
  ].join("\n");
}

function incompleteLines(scopes: IncompleteScope[]): string[] {
  return scopes.map(
    (item) =>
      `> **Incomplete review:** ${inlineText(item.scope)} did not complete (${inlineText(item.reason)}).`,
  );
}

function renderBody(input: ReviewBodyInput, total: number, omitted: number): string {
  const sha7 = input.sha.slice(0, 7);
  const marker = reviewMarker(input.sha);
  const lines: string[] = [];

  if (total === 0) {
    lines.push(`## t3-review-agent: no findings on \`${sha7}\``);
    lines.push("");
    lines.push(...incompleteLines(input.incompleteScopes));
    if (input.incompleteScopes.length > 0) {
      lines.push("");
      lines.push(
        `Reviewed \`${sha7}\`: no verified findings in the scopes that completed.`,
      );
    } else {
      lines.push(`Reviewed \`${sha7}\`: no findings.`);
    }
    lines.push("");
    lines.push(marker);
    return lines.join("\n");
  }

  lines.push(`## t3-review-agent: ${total} finding(s) on \`${sha7}\``);
  lines.push("");
  lines.push(...incompleteLines(input.incompleteScopes));
  if (input.incompleteScopes.length > 0) {
    lines.push("");
  }

  const sorted = sortFindings(input.findings);

  for (const section of severitySections) {
    const group = sorted.filter((finding) => finding.severity === section.severity);
    if (group.length === 0) {
      continue;
    }

    if (section.severity === "minor") {
      lines.push("<details>");
      lines.push(`<summary>${section.label} (${group.length})</summary>`);
      lines.push("");
      for (const [index, finding] of group.entries()) {
        if (index > 0) {
          lines.push("");
        }
        lines.push(renderFinding(finding, input));
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
      continue;
    }

    lines.push(`### ${section.label} (${group.length})`);
    for (const [index, finding] of group.entries()) {
      if (index > 0) {
        lines.push("");
      }
      lines.push(renderFinding(finding, input));
    }
    lines.push("");
  }

  if (omitted > 0) {
    lines.push(`_${omitted} more finding(s) omitted: review body size limit._`);
    lines.push("");
  }

  lines.push(marker);
  return lines.join("\n");
}

export type RenderReviewBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: string };

export function renderReviewBody(input: ReviewBodyInput): RenderReviewBodyResult {
  const full = renderBody(input, input.findings.length, 0);
  if (full.length <= maxBodyLength) {
    return { ok: true, body: full };
  }

  const sorted = sortFindings(input.findings);
  const removalOrder: Finding[] = [];

  for (const severity of ["minor", "important", "blocker"] as const) {
    const group = sorted.filter((finding) => finding.severity === severity);
    for (let index = group.length - 1; index >= 0; index -= 1) {
      const finding = group[index];
      if (finding !== undefined) {
        removalOrder.push(finding);
      }
    }
  }

  const removed = new Set<Finding>();

  for (const finding of removalOrder) {
    removed.add(finding);
    const remaining = input.findings.filter((item) => !removed.has(item));
    const body = renderBody(
      {
        sha: input.sha,
        owner: input.owner,
        repo: input.repo,
        findings: remaining,
        incompleteScopes: input.incompleteScopes,
      },
      input.findings.length,
      removed.size,
    );
    if (body.length <= maxBodyLength) {
      return { ok: true, body };
    }
  }

  const remaining = input.findings.filter((item) => !removed.has(item));
  const body = renderBody(
    {
      sha: input.sha,
      owner: input.owner,
      repo: input.repo,
      findings: remaining,
      incompleteScopes: input.incompleteScopes,
    },
    input.findings.length,
    removed.size,
  );

  if (body.length <= maxBodyLength) {
    return { ok: true, body };
  }

  return {
    ok: false,
    error: `review body is ${body.length} characters, above the ${maxBodyLength}-character limit even after omitting all findings`,
  };
}
