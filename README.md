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
| Reviewers | Two, run in parallel via `delegate_task`, each reading its own detached checkout of the target repository at the head SHA: correctness & architecture, security & input boundaries |
| Findings | Only problems the diff introduces; Blocker / Important / Minor; verified by the Coordinator |
| Publisher | TypeScript on Bun, GitHub REST via `fetch`; bot user with a fine-grained PAT; `COMMENT` reviews only |
| Idempotency | Hidden head-SHA marker in each Published Review; skip if the PR head has moved |
| Output | One Published Review on GitHub + a Findings Report rendered in the thread |

## Running the review pipeline

Render one Reviewer's task text:

```bash
bun run reviewer-task --scope correctness --repo owner/name --pr 42 --head <40-hex> --base <40-hex> --checkout <absolute path>
```

It prints the task to stdout. `--scope` must be a known scope id; `correctness` or `security`.
`--checkout <absolute path>` is the detached checkout the Reviewer reads.

Render a Findings Report:

```bash
bun run findings-report --repo owner/name --pr 42 --sha <40-hex> --outcome posted --findings findings.json --review-url https://github.com/owner/name/pull/42#pullrequestreview-123 --out report.html
```

`--outcome` is one of `posted`, `already-reviewed`, `superseded`, `would-post` or `failed`.
`--findings` is optional and renders an empty Findings list when omitted. `--review-url` must be a
GitHub URL and is used with `posted`. `--note` adds a short explanatory line. The report is written
to `--out` and its absolute path is printed.

Both commands exit 2 for invalid arguments.

## Cleaning up Review Run worktrees

Each Review Run works in its own git worktree on a `t3/` branch. Worktrees are not removed automatically
when a thread is archived or settled. Two commands handle cleanup:

Dry run (default) lists what would be removed without touching anything:

```sh
bun run sweep-runs
```

Apply the plan:

```sh
bun run sweep-runs --apply
```

Override the staleness threshold (default 6 hours, maximum 168):

```sh
bun run sweep-runs --apply --stale-hours 12
```

Mark the current Review Run's worktree (run by the Coordinator):

```sh
bun run mark-run --started
bun run mark-run --finished
```

Only worktrees on `t3/` branches carrying the `.t3-review-run` marker are removed, and only when they
are finished (`.t3-review-run-finished` present) or older than the stale limit. The main checkout and the
current worktree are never removed. Exit code 2 means bad arguments; exit code 1 means listing worktrees
failed.

With `--apply`, each removed entry reports `leftoverDirectory: true` when Git unregistered the
worktree but another process still held its directory open, leaving an empty directory behind.
Entries in `failed` are still registered and are tried again by the next sweep.

Sweep Reviewer checkouts in a target repository by passing its absolute checkout path (repeatable,
at most 10):

```sh
bun run sweep-runs --target E:/MindbodyMCP
bun run sweep-runs --apply --target E:/MindbodyMCP --target E:/OtherRepo
```

Only detached `checkout-<scope>` worktrees under the temp `t3-review-agent` directory older than the
stale limit are removed. The target's main checkout and any branch-carrying worktree are never
removed. A target whose listing fails is reported as `{ target, error }` and does not change the
exit code.

## Status

Publisher and review pipeline implemented; the bot account and production rollout are in progress.

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
