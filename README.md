# t3-review-agent

A durable pull-request review agent, orchestrated by **T3 Code** on an always-on dev box and
triggered by **GitHub webhooks**. Each Review Run is an inspectable T3 thread: a Coordinator sends
narrow-scope Reviewers into worktrees at the PR head, verifies their Findings, hands them to a narrow
publisher that posts one Published Review, and renders a Findings Report in the thread.

- [FOUNDING.md](FOUNDING.md) — the founding design, its reasoning and the rejected alternatives.
  Kept unchanged as the starting point that later changes are measured against.
- [docs/v1-plan.md](docs/v1-plan.md) — the settled v1 build plan, including where it departs from
  the founding design.
- [GLOSSARY.md](GLOSSARY.md) — the project's vocabulary.

## Shape of v1

| Piece | Choice |
| --- | --- |
| Target | `ProfitMarkHK/MindbodyMCP`; fork and draft PRs skipped |
| Trigger | Repo webhook → one T3 webhook task in this project (HMAC, filters, delivery-ID replay dedupe, repo + PR coalesce) |
| Host | T3 Code on the always-on dev box; one new thread per Review Run |
| Reviewers | Two, via `delegate_task` into the target project's worktrees: correctness & architecture, security & input boundaries |
| Findings | Only problems the diff introduces; Blocker / Important / Minor; verified by the Coordinator |
| Publisher | PowerShell + `gh api`, bot user with a fine-grained PAT; `COMMENT` reviews only |
| Idempotency | Hidden head-SHA marker in each Published Review; skip if the PR head has moved |
| Output | One Published Review on GitHub + a Findings Report rendered in the thread |

## Status

Design settled. Nothing implemented yet.
