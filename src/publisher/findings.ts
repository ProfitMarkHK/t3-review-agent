export type Severity = "blocker" | "important" | "minor";

export type Confidence = "high" | "medium";

export interface Finding {
  severity: Severity;
  confidence: Confidence;
  title: string;
  path: string;
  line: number;
  endLine?: number;
  evidence: string;
  suggestedFix: string;
}

export interface IncompleteScope {
  scope: string;
  reason: string;
}

export interface FindingsFile {
  version: 1;
  findings: Finding[];
  incompleteScopes: IncompleteScope[];
}

export type ParseFindingsResult =
  | { ok: true; value: FindingsFile }
  | { ok: false; errors: string[] };

const rootKeys = new Set(["version", "findings", "incompleteScopes"]);
const findingKeys = new Set([
  "severity",
  "confidence",
  "title",
  "path",
  "line",
  "endLine",
  "evidence",
  "suggestedFix",
]);
const scopeKeys = new Set(["scope", "reason"]);
const severities = new Set<string>(["blocker", "important", "minor"]);
const confidences = new Set<string>(["high", "medium"]);

const maxFindings = 100;
const maxIncompleteScopes = 10;
const maxTitleLength = 200;
const maxPathLength = 500;
const maxEvidenceLength = 4000;
const maxSuggestedFixLength = 2000;
const maxScopeLength = 100;
const maxReasonLength = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prefix(path: string, key: string): string {
  return path.length === 0 ? key : `${path}.${key}`;
}

function checkUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
  errors: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`${prefix(path, key)} is not a known key`);
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function relativePathProblem(value: string): string | null {
  if (value.startsWith("/")) {
    return "must not start with /";
  }
  if (value.includes("\\")) {
    return "must not contain backslashes";
  }
  if (value.split("/").some((segment) => segment === "..")) {
    return "must not contain .. segments";
  }
  return null;
}

function parseFinding(value: unknown, path: string, errors: string[]): Finding | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  checkUnknownKeys(value, findingKeys, path, errors);

  let severity: Severity | null = null;
  if (typeof value.severity === "string" && severities.has(value.severity)) {
    severity = value.severity as Severity;
  } else {
    errors.push(`${path}.severity must be one of blocker, important, minor`);
  }

  let confidence: Confidence | null = null;
  if (typeof value.confidence === "string" && confidences.has(value.confidence)) {
    confidence = value.confidence as Confidence;
  } else {
    errors.push(`${path}.confidence must be one of high, medium`);
  }

  let title: string | null = null;
  if (!isNonEmptyString(value.title)) {
    errors.push(`${path}.title must be a non-empty string`);
  } else if (value.title.length > maxTitleLength) {
    errors.push(`${path}.title must be at most ${maxTitleLength} characters`);
  } else {
    title = value.title;
  }

  let findingPath: string | null = null;
  if (!isNonEmptyString(value.path)) {
    errors.push(`${path}.path must be a non-empty string`);
  } else if (value.path.length > maxPathLength) {
    errors.push(`${path}.path must be at most ${maxPathLength} characters`);
  } else {
    const problem = relativePathProblem(value.path);
    if (problem === null) {
      findingPath = value.path;
    } else {
      errors.push(`${path}.path ${problem}`);
    }
  }

  let line: number | null = null;
  if (isPositiveInteger(value.line)) {
    line = value.line;
  } else {
    errors.push(`${path}.line must be a positive integer`);
  }

  let endLine: number | null = null;
  if (value.endLine !== undefined) {
    if (!isPositiveInteger(value.endLine)) {
      errors.push(`${path}.endLine must be a positive integer`);
    } else if (line !== null && value.endLine < line) {
      errors.push(`${path}.endLine must be greater than or equal to line`);
    } else {
      endLine = value.endLine;
    }
  }

  let evidence: string | null = null;
  if (!isNonEmptyString(value.evidence)) {
    errors.push(`${path}.evidence must be a non-empty string`);
  } else if (value.evidence.length > maxEvidenceLength) {
    errors.push(`${path}.evidence must be at most ${maxEvidenceLength} characters`);
  } else {
    evidence = value.evidence;
  }

  let suggestedFix: string | null = null;
  if (!isNonEmptyString(value.suggestedFix)) {
    errors.push(`${path}.suggestedFix must be a non-empty string`);
  } else if (value.suggestedFix.length > maxSuggestedFixLength) {
    errors.push(`${path}.suggestedFix must be at most ${maxSuggestedFixLength} characters`);
  } else {
    suggestedFix = value.suggestedFix;
  }

  if (
    severity === null ||
    confidence === null ||
    title === null ||
    findingPath === null ||
    line === null ||
    evidence === null ||
    suggestedFix === null
  ) {
    return null;
  }

  const finding: Finding = {
    severity,
    confidence,
    title,
    path: findingPath,
    line,
    evidence,
    suggestedFix,
  };

  if (endLine !== null) {
    finding.endLine = endLine;
  }

  return finding;
}

function parseIncompleteScope(
  value: unknown,
  path: string,
  errors: string[],
): IncompleteScope | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }

  checkUnknownKeys(value, scopeKeys, path, errors);

  let scope: string | null = null;
  if (!isNonEmptyString(value.scope)) {
    errors.push(`${path}.scope must be a non-empty string`);
  } else if (value.scope.length > maxScopeLength) {
    errors.push(`${path}.scope must be at most ${maxScopeLength} characters`);
  } else {
    scope = value.scope;
  }

  let reason: string | null = null;
  if (!isNonEmptyString(value.reason)) {
    errors.push(`${path}.reason must be a non-empty string`);
  } else if (value.reason.length > maxReasonLength) {
    errors.push(`${path}.reason must be at most ${maxReasonLength} characters`);
  } else {
    reason = value.reason;
  }

  if (scope === null || reason === null) {
    return null;
  }

  return { scope, reason };
}

export function parseFindingsFile(input: unknown): ParseFindingsResult {
  if (!isRecord(input)) {
    return { ok: false, errors: ["findings file must be a JSON object"] };
  }

  const errors: string[] = [];
  checkUnknownKeys(input, rootKeys, "", errors);

  if (input.version !== 1) {
    errors.push("version must be 1");
  }

  const findings: Finding[] = [];
  if (!Array.isArray(input.findings)) {
    errors.push("findings must be an array");
  } else {
    if (input.findings.length > maxFindings) {
      errors.push(`findings must contain at most ${maxFindings} entries`);
    }
    for (const [index, entry] of input.findings.slice(0, maxFindings).entries()) {
      const finding = parseFinding(entry, `findings[${index}]`, errors);
      if (finding !== null) {
        findings.push(finding);
      }
    }
  }

  const incompleteScopes: IncompleteScope[] = [];
  if (!Array.isArray(input.incompleteScopes)) {
    errors.push("incompleteScopes must be an array");
  } else {
    if (input.incompleteScopes.length > maxIncompleteScopes) {
      errors.push(`incompleteScopes must contain at most ${maxIncompleteScopes} entries`);
    }
    for (const [index, entry] of input.incompleteScopes.slice(0, maxIncompleteScopes).entries()) {
      const incompleteScope = parseIncompleteScope(entry, `incompleteScopes[${index}]`, errors);
      if (incompleteScope !== null) {
        incompleteScopes.push(incompleteScope);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: { version: 1, findings, incompleteScopes } };
}
