# Security

MIT-licensed software with no warranty clause is not a statement that nobody cares. This file is the
documented half of `PRD.md` §6.2 — *"Automated scanning of transitive dependencies, with a documented triage
path — including for findings that originate inside a peer's own bundle and cannot be fixed by changing our
range."* The machine half is [`scripts/check-deps.mjs`](./scripts/check-deps.mjs) and
[`security/dependency-triage.json`](./security/dependency-triage.json).

## Reporting

Open a [GitHub security advisory](https://github.com/princegoel0/pdfjs-react-reader/security/advisories/new)
rather than a public issue. One maintainer reads everything; an advisory reaches them without telling the
world how to hit a reader's document first.

## What the surface actually is

`package.json` declares **no runtime dependencies**. The viewer's engine (`pdfjs-dist`), its optional writer
(`@cantoo/pdf-lib`) and React are **peer** dependencies, so they enter a consumer's tree by the consumer's
choice, not by ours, and nothing in this package's published files pulls a third-party module along. That is
why the scan runs twice:

| Surface | Command | Question it answers |
| :--- | :--- | :--- |
| production | `npm audit --omit=dev` | "what does someone installing `pdfjs-react-reader` resolve?" |
| development | `npm audit` | "what does this laptop and what does a CI runner execute?" |

A finding in the first row can never be excused as a development detail, and the gate enforces that instead
of trusting the ledger's arithmetic: an entry recorded `accepted-dev-only` against something the production
audit reports is a failure, not a judgement call.

## The scanning

```bash
npm run check:deps        # both surfaces, matched against the triage ledger
npm run check:deps -- --selftest   # proves each rule fires, against synthetic trees, writing nothing
```

It runs inside `npm run verify` and as its own step in the `verify` job of CI, so a scan happens on every
push whether or not anyone remembers to ask for one. Three behaviours are deliberate:

* **A scan that cannot execute is a failure, not a skip.** §6.2 makes scanning an obligation; "no network
  today" is how obligations quietly stop being automated, so an unparseable or absent audit report exits 2
  and says which audit broke.
* **Every finding the registry reports must be decided somewhere.** An untriaged advisory is red with its id,
  severity, surface and the packages it reaches.
* **A decision stays bound to the facts it was made about.** `severity`, `affectedRange`, the set of
  `packages` and the `surface` are re-read on every run, so an advisory that escalates from moderate to high
  or widens to cover a new path reopens the decision rather than riding along under an old signature. An entry
  whose review date has passed is red, and a finding that has gone away takes its entry with it — a stale
  triage record reads like a live risk.

## The triage path

Work down the list; the first rung that fits is the `decision`, and the `reason` has to say why that rung.

1. **It ships.** If the production audit reports it, the only honest answers are a floor change, a range
   change, or a peer decision (rung 5). There is no "accepted, it is only a dev tool" at this rung, and the
   gate refuses one if written.
2. **A fix exists inside the ranges already declared.** Record `upgrade-now` with a `reviewBy` no more than
   30 days out. A published fix sitting behind a year-long review date is called what it is: accepted.
3. **A fix exists but no range change here reaches it** — a holder pins an older line, or the answer is a
   major version of the tooling. Record `upgrade-blocked`, and name the holder and the range it declares in
   the reason, so the next reader can see the shape of the block instead of re-deriving it.
4. **It is confined to the development tree and to no published file.** `accepted-dev-only` is legal only here
   and only while the production audit is clean for that advisory; the reason states what the code path is and
   where it runs (a local dev server on one platform is not the same exposure as a CI job).
5. **It originates inside a peer's own bundle** — §6.2's hardest case, and the one a range change in this
   repository cannot close. The answer is a published floor at the first release the advisory does not cover,
   executed rather than asserted (the `browser` and `consumer` jobs install the floor and the latest supported
   6.x on every push), and the deprecation of any already-published line whose range permits a forbidden
   pairing. `GHSA-hq66-cqwq-w95j` / `CVE-2026-16633` is recorded in the ledger as the precedent, with the
   `pdfjs-dist: ^6.2.108` floor and the `0.1.0`/`0.1.1` deprecation as its two halves. A peer finding does not
   get to end at a comment.

Adopting a new engine release stays governed by §2's compatibility policy — a decision, a regression pass and
a documented range change — never an automated dependency merge, and the changelog records the version each
measurement was taken on.

## What is open right now

Not copied into this file. A hand-tallied list of advisories goes stale the week upstream moves, and this
repository has watched enough stale tallies become claims
([`ROADMAP.md`](./ROADMAP.md)'s W9 row and `check:docs`' prohibition rules are the evidence). Read the live
set with `npm run check:deps`, which prints each finding with its decision and its review date, or open
[`security/dependency-triage.json`](./security/dependency-triage.json) for the reasons.
