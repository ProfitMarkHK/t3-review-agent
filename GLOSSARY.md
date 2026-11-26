# t3-review-agent

An unattended pull-request review agent: GitHub tells it a PR changed, it reviews that exact
commit, and it reports what it found back to the PR and to a human-inspectable report.

## Language

**Review Run**:
One review of one PR at one head SHA, carried out in its own thread.
_Avoid_: review, job, session

**Coordinator**:
The agent that owns a Review Run: it scopes the work, dispatches Reviewers, verifies their Findings, and hands the result on.
_Avoid_: orchestrator, lead, main agent

**Reviewer**:
A child agent with one narrow review scope inside a Review Run.
_Avoid_: subagent, worker, review agent

**Finding**:
One reported problem with the PR, carrying a severity, a location, evidence, a confidence and a suggested fix.
_Avoid_: issue, comment, note

**Superseded Review Run**:
A Review Run whose head SHA is no longer the PR's head by the time it finishes; it produces a Findings Report but no Published Review.
_Avoid_: stale review, outdated run

**Published Review**:
The single GitHub review a Review Run posts to the PR.
_Avoid_: review comment, result, output

**Findings Report**:
The local visual report of a Review Run's Findings, for human inspection.
_Avoid_: dashboard, HTML report

## Severity

**Blocker**:
A Finding that must be fixed before the PR merges.
_Avoid_: critical, high

**Important**:
A Finding that should be fixed, but does not on its own stop a merge.
_Avoid_: major, medium, warning

**Minor**:
A Finding worth knowing about that the author may reasonably ignore.
_Avoid_: nit, low, info
