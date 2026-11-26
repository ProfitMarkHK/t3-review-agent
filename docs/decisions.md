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
(`opencode/deepseek-v4.1-flash-free` by default). Every piece of work is then rubber-ducked by a
second free model with fresh context, and checked again by the orchestrating agent before it is
merged. Work that needs T3's own tools (scheduled tasks, webhook URLs) is done by the
orchestrating agent, because delegates cannot be relied on to have them.
**Why:** Direct instruction to use free models where possible and to rubber-duck all work.

## D6 — Branch per ticket, merge when done-done (2026-11-26)

**Decision:** Each ticket is built on its own branch, committed as it goes, and fast-forwarded or
merged into `main` once the review findings are fixed and the ticket's acceptance criteria are met
or explicitly deferred to an issue. Tickets close when their branch lands on `main`.
**Why:** Direct instruction to commit as we go and merge when done-done.
