# t3-review-agent

A durable pull-request review agent, orchestrated by **T3 Code** on an always-on dev box and
triggered by **GitHub webhooks**. Reviews run as inspectable T3 threads: a coordinator creates a
worktree at the PR head, fans out narrow-scope reviewers with `delegate_task`, verifies and
dedupes their findings, posts one consolidated GitHub review, and renders a visual report locally.

Start here: [FOUNDING.md](FOUNDING.md) — the founding design, its reasoning, and the rejected
alternatives.

## Shape of v1

| Piece | Choice |
| --- | --- |
| Trigger | GitHub `pull_request` webhook → T3 webhook scheduled task (HMAC, filter, GUID dedupe, repo+PR+SHA coalesce) |
| Host | T3 Code on the always-on dev box (Cloudflare DO only as a relay if it can be down) |
| Isolation | One worktree per PR head; one thread per run |
| Reviewers | Parallel `delegate_task`: correctness/architecture, security/input boundaries, tests/migrations/regression |
| Output | One consolidated GitHub review + local `html_render` findings report |
| Safety | Payload treated as data; head SHA as idempotency key; narrow publisher; read-only reviewers |

## Status

Design captured. Nothing implemented yet.
