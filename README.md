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
| Publisher | TypeScript on Bun, GitHub REST via `fetch`; bot user with a fine-grained PAT; `COMMENT` reviews only |
| Idempotency | Hidden head-SHA marker in each Published Review; skip if the PR head has moved |
| Output | One Published Review on GitHub + a Findings Report rendered in the thread |

## Status

Publisher implemented; the review pipeline is in progress.

## Publishing a review by hand

Run the publisher from the repository root:

```sh
bun run publish-review --findings examples/findings.sample.json --repo owner/name --pr 42 --sha 0123456789abcdef0123456789abcdef01234567
```

| Flag | Meaning |
| --- | --- |
| `--findings <file>` | Findings file to publish. `examples/findings.sample.json` shows the format. Not needed with `--check`. |
| `--repo <owner/name>` | Repository that owns the pull request. |
| `--pr <number>` | Pull request number. |
| `--sha <sha>` | Full 40-character lowercase head SHA the findings were produced for. |
| `--token-file <path>` | GitHub token file. |
| `--dry-run` | Print the rendered review body to stdout without reading the token or calling GitHub. |
| `--check` | Read GitHub and report whether the head SHA is already reviewed or superseded, without posting. Ignores `--findings`, so it does not check the review body. Cannot be combined with `--dry-run`. |

The token is read from `--token-file` when given. Otherwise it is read from
`%LOCALAPPDATA%\t3-review-agent\publisher.token`, then
`$XDG_DATA_HOME/t3-review-agent/publisher.token`, then
`~/.local/share/t3-review-agent/publisher.token`. Surrounding whitespace is ignored; a missing or
empty token is an error.

Without `--dry-run`, the publisher writes exactly one JSON line to stdout:

```json
{"outcome":"posted","reviewId":123,"url":"https://github.com/owner/name/pull/42#pullrequestreview-123"}
{"outcome":"skipped","reason":"already-reviewed"}
{"outcome":"skipped","reason":"superseded"}
{"outcome":"would-post"}
```

`would-post` is printed only with `--check`.

Exit codes: `0` when a review was posted or skipped, `2` for invalid arguments or an invalid
findings file, and `1` for any other failure.
