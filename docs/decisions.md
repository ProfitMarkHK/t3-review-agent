# Decision log

Decisions made while building v1 without stopping to ask. Each one is open for review; the
newest is at the bottom.

## D1 — TypeScript on Bun instead of PowerShell (2026-11-26)

**Decision:** The publisher and any other agent tooling are TypeScript run by Bun, not the
PowerShell 7 script the v1 plan describes.
**Why:** Direct instruction for the build. Bun 1.4.4 is already on the dev box.

## D2 — No runtime dependencies (2026-11-26)

**Decision:** Only `typescript` and `@types/bun` as dev dependencies. Input validation and GitHub
calls are written against the standard library and `fetch`.
**Why:** The publisher's whole job is a handful of REST calls and one validated JSON file. A schema
library or an Octokit client would be most of the installed code.

## D3 — Functional core, imperative shell layout (2026-11-26)

**Decision:** Each component splits into pure modules (parse, decide, render: no I/O, no clock, no
environment) and a thin shell that reads files, calls GitHub and exits. The shell is the only place
that touches the token.
**Why:** Direct instruction for the build; it also keeps the token's reach to one small file.

## D4 — What "documentation" may contain (2026-11-26)

**Decision:** New documentation describes only how to use the product. Design history stays in the
existing `FOUNDING.md`, `docs/v1-plan.md` and `GLOSSARY.md`, which are not extended with build
notes. Facts learned during the build (for example the dedupe key syntax) go in this log instead of
the v1 plan, even where a ticket asked for the plan to be updated.
**Why:** Direct instruction that documentation contain only usage, balanced against not deleting
the agreed design record.

## D5 — Who implements and who reviews (2026-11-26)

**Decision:** Implementation is delegated to free OpenCode models through the OpenCode V2 provider
using only the free `opencode/*` models (never `opencode-go/*`). `opencode/deepseek-v4.1-flash-free`
was the first choice; it hit its free usage limit mid-task, so work moves between the other free
models (`opencode/nemotron-3.5-super-vl-free`, `opencode/mimo-v2.6-flash-free`,
`opencode/big-pickle` and others) as limits are reached. Partial work left by a delegate that hit
a limit is kept and finished rather than redone. Every piece of work is then rubber-ducked by a
second free model with fresh context, and checked again by the orchestrating agent before it is
merged. Work that needs T3's own tools (scheduled tasks, webhook URLs) is done by the
orchestrating agent, because delegates cannot be relied on to have them.
**Why:** Direct instruction to use free models where possible and to rubber-duck all work.

## D6 — Branch per ticket, merge when done-done (2026-11-26)

**Decision:** Each ticket is built on its own branch, committed as it goes, and fast-forwarded or
merged into `main` once the review findings are fixed and the ticket's acceptance criteria are met
or explicitly deferred to an issue. Tickets close when their branch lands on `main`.
**Why:** Direct instruction to commit as we go and merge when done-done.

## D7 — How T3 webhook tasks actually behave (2026-11-26, from #1)

Measured with a throwaway webhook task in this project and hand-signed requests:

- **Template syntax:** `{{headers.<header-name>}}` and `{{body.<dot.path>}}`, mixed freely with
  literal text, for example `{{body.repository.full_name}}#{{body.pull_request.number}}`. A path
  that does not exist renders as an empty string.
- **Replay key:** `{{headers.x-github-delivery}}` drops any later request with the same delivery
  ID, even when its body differs.
- **Coalesce key:** a fixed window that opens at the first request for a key and does not extend.
  When it closes, exactly one run starts and it uses the **latest** request's payload. The run is
  labelled with the first request's delivery. Requests for different keys run independently.
- **Filters on JSON booleans** compare as strings: `equals "false"` matches `false`.
- **The payload is not visible to the run** unless the prompt uses the same `{{…}}` templates.
  T3 wraps each substituted value in `<webhook-data-…>` tags and adds a note telling the agent the
  tagged text is untrusted.
- **Updating `schedule`** replaces the whole schedule: leaving out `signature` removes signature
  checking. Always resend the full schedule.
- **Every run gets its own worktree and `t3/<slug>` branch** in the host project, and T3 does not
  remove them afterwards.
- **Model:** runs use the project's default model; a scheduled task has no model setting.
- **T3 Connect** is enabled on the dev box; creation returned a `relay.t3.codes` URL.

## D8 — Keep repo + PR coalescing with a 120-second window (2026-11-26)

**Decision:** The real task coalesces on `{{body.repository.full_name}}#{{body.pull_request.number}}`
with a 120-second window, as planned.
**Why:** D7 shows coalescing runs on the latest payload, so a burst of pushes becomes one Review Run
on the newest commit. The cost is that every Review Run starts about two minutes after the first
event for that PR. A push that lands after the window closes starts its own Review Run, and the
older one ends as a Superseded Review Run.

## D9 — Pass only GitHub-constrained fields into the prompt (2026-11-26)

**Decision:** The task prompt templates in only the repository full name, PR number, head SHA,
base SHA, action and delivery ID. It never templates the PR title, body, branch names or any other
free text. The Coordinator builds the PR URL from the repository and number and reads anything else
it needs from GitHub.
**Why:** D7 shows the prompt is the only way the payload reaches the run. These fields have formats
GitHub controls, so they cannot carry instructions; free-text fields can.

## D10 — Limit the webhook task to test branches until #7 (2026-11-27)

**Decision:** While #4–#6 are being built, the real webhook task carries one extra filter,
`body.pull_request.head.ref` starts with `t3-review-test/`. It is removed in #7, once the bot
account exists.
**Why:** MindbodyMCP is public and has live PRs, including Dependabot ones. Without the filter, any
push to them during the build would start Review Runs and post reviews under a personal account.

## D11 — Webhook secret stored by T3 without a secret reference (2026-11-27)

**Decision:** The webhook secret was generated locally, set on the GitHub webhook through the API,
and given to the webhook task through the schedule's `secret` field instead of a `secretRef`.
**Why:** `request_secret` hands out a `secretRef` only from an interactive card, and a pasted value
comes back as a file. The secret still never reaches a repository file or a commit, and T3 stores
it. To rotate it, open a `request_secret` card, save the task with the new `secretRef` (resending
the whole schedule, see D7), then update the GitHub webhook.

## D12 — The Coordinator owns the Reviewer checkout (2026-11-27, from #4)

**Decision:** The Coordinator fetches the PR head into the routed local checkout and adds a detached
worktree at the head SHA inside its run directory. It dispatches each Reviewer with no target
project and shared isolation, and the Reviewer reads that path and checks `HEAD` before reviewing.
The Coordinator removes exactly the worktree it created.
**Why:** The first live run showed that `delegate_task` refuses `target.projectId` for a local task
("A local task runs in this thread's project"), with or without an `environmentId`. The plan's
Reviewer worktree in the target project is not possible. Owning the checkout also means cleanup
never has to trust paths read back from other threads.

## D13 — What the first live run showed (2026-11-27, from #4)

- **T3 Connect** was already enabled; the task's webhook URL is on `relay.t3.codes`.
- **Runtime mode:** the Coordinator ran in `full-access` mode on the project default model
  (`claudeAgent`, `claude-opus-5-5`, effort high).
- **Coordinator worktree:** each run gets a worktree and a branch named after the run, such as
  `t3/review-pr-89-synchronize`, and T3 leaves them behind (tracked in #8).
- **Development token:** until the bot account exists (#2), the publisher token file holds the
  repository owner's own `gh` token, so Published Reviews appear under that account.

## D14 — Dedupe on the real task (2026-11-27, from #6)

**Decision:** The real task uses replay key `{{headers.x-github-delivery}}` and coalesce key
`{{body.repository.full_name}}#{{body.pull_request.number}}` with a 120-second window.
**Evidence:**
- Two pushes to PR 89 twenty seconds apart started one Review Run, on the second commit. A PR
  opened in the same window (PR 90) started its own Review Run.
- Re-sending a delivery ID first received after the keys were set started no Review Run.
- Re-sending a delivery ID first received *before* the keys were set did start one. T3 remembers
  only deliveries that arrived while a replay key was configured. That run stopped at the early
  check as already reviewed.
- GitHub's own "Redeliver" needs a token with `admin:repo_hook`, which the development `gh` token
  lacks. The replay was therefore tested by re-sending the same delivery ID with a valid signature,
  which is what a redelivery is.

## D15 — Each Review Run sweeps the worktrees of earlier ones (2026-11-27, from #8)

**Decision:** The Coordinator writes `.t3-review-run` in its own worktree when it starts and
`.t3-review-run-finished` as its last command on every path. At start it runs
`bun run sweep-runs --apply`, which removes other worktrees of this repository on `t3/` branches
that carry the start marker and are either finished or more than 6 hours old, then deletes their
branches. A run's own worktree is therefore removed by the next Review Run.
**Why:** Archiving or settling a finished Review Run thread does not remove its worktree (tested on
two threads). A run cannot remove its own worktree while it is still running in it. Markers make
the sweep safe: it never touches a worktree without the start marker (delegates, issue branches),
the main checkout, its own worktree, or a marked run that is neither finished nor stale.
**Evidence:** The first `--apply` removed five finished Review Run worktrees and their branches. The
sixth, which had finished minutes earlier, could not be deleted because a process still held its
empty directory open. Git had already unregistered it, so the sweep now counts that as removed,
deletes the branch and reports `leftoverDirectory`. A live run after the change wrote both markers.
**Gap:** Reviewer checkouts in the target repository are removed by the Coordinator in section 11.
If a Coordinator dies before then, they are left behind; this is tracked separately.
