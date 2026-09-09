---
name: backlog
description: >-
  Keep a checked-in markdown backlog readable as it grows past a few hundred items. Splits a
  monolithic list into an index plus one detail file per item, with the fields that decide what to
  work on in each item's frontmatter, and reads the whole thing through one script instead of a
  3000-line file. Use when picking what to do next, when grooming a backlog against a piece of work
  being scoped, when a review defers a finding, when adopting the format in a new repo, or when the
  list has grown past the point of being read in full.
---

# backlog

A backlog that lives in the repository, in markdown, and stays workable past a few hundred items.

## The problem

A single append-only list works until it doesn't. Measured on a real one before adoption:
**3,622 lines, 251 items, 85 sections.** Every pass over it read the whole file to answer one
question about a handful of items, and every concurrent branch collided on the same trailing lines.

## The shape

```
<dir>/deferred-work.md      the index: one entry per item, plus a `detail:` pointer
<dir>/deferred-work/        one file per item — frontmatter + the full record
```

The index keeps whatever path and filename it already had, because tools may append to it (see
**Coexisting with generators**). Only the layout changes.

A detail file:

```markdown
---
id: dw-014
summary: 'One sentence stating the item.'
status: open
trigger: 'the first change that touches the audit vocabulary'   # deferred-work policy only
---

- **The full record**, verbatim — evidence, anchors, measured numbers, the shape of the fix.
  Sub-bullets are context for the parent, not separate items.
```

Required on every item: `id`, `summary`, `status`. Everything else is free — the validator ignores
fields it does not know, so a repo can carry `priority`, `size`, `owner` or anything else without
changing this skill.

The index carries `summary` and `detail:` and **never repeats** the frontmatter fields, so the two
cannot disagree.

## Reading it

```bash
node scripts/backlog.mjs <dir>/deferred-work          # open items, one line each
node scripts/backlog.mjs <dir>/deferred-work --all    # include DONE / KILLED
node scripts/backlog.mjs <dir>/deferred-work --json   # for tooling
```

Frontmatter only — bodies are never read. On the real corpus above that is **402 lines against
3,622**, with closed items filtered rather than skimmed past. Open an item's detail file once you
have selected it.

## Policies

A policy says what makes an item **actionable**, and nothing else. It is declared in the index's own
frontmatter, so it is visible where you already look and there is no second config file to find:

```markdown
---
policy: deferred-work
---
```

| policy | an item is actionable when | requires |
|---|---|---|
| *(none — a plain backlog)* | you pick it | `id`, `summary`, `status` |
| `deferred-work` | its `trigger` has fired | the above, plus `trigger` on every open item |

An unrecognised policy is refused, not ignored — a typo must not silently drop the rules the author
was relying on.

### The `deferred-work` policy

For work parked with a reason rather than queued: debt, follow-ups, review deferrals. Sort every
open item into exactly one bucket:

| bucket | when | action |
|---|---|---|
| **promote-now** | the trigger fired and the item is in the current work's blast radius | fold into scope |
| **promote-separately** | trigger fired but the item is cross-cutting (lint rule, test infra, schema-wide) | surface as its own piece of work |
| **keep-deferred** | the trigger has not occurred | leave it; say which trigger is being waited on |
| **kill** | contradicted by the current code | `status: KILLED (date)`, name what superseded it |

Two rules that matter more than the buckets:

- **A deferred entry is not a trustworthy primary source.** It records what was true when written.
  Verify against the code before promoting — an item can be silently already-done.
- **An open item with no `trigger` cannot be classified.** It is not "keep-deferred", it is
  **untriaged**, and the fix is to give it a trigger. Expect many on first adoption: the real corpus
  above had **101 of 200** open items without one, which the monolith hid and this surfaces.

## Coexisting with generators

Some tools append to the index directly. BMad's `bmad-build` / `bmad-quick-dev` and
`bmad-code-review` all hardcode `{implementation_artifacts}/deferred-work.md`. **The shape depends
on the version installed — check `_bmad/_config/manifest.yaml`, do not assume the newest:**

```markdown
6.12+   - source_spec: `<spec>`        6.9    - <one bullet per finding, with description>
          summary: <one sentence>
          evidence: <why this is real>
```

That is why the index keeps its path and stays **hand-maintained rather than generated**: a
generated index would silently eat those appends on the next regeneration.

Either shape has no detail file, so no `status` and no `trigger`. Treat it as **open and
untriaged**; grooming promotes it into a detail file. `scripts/validate.mjs` reports both
(`UNPROMOTED_APPENDS` for the keyed shape, `RAW_APPEND` for the bare one) — it keyed only on the
newer shape until a repo running the older one showed that an append could land in the index with
nothing reporting it at all.

**No executable in the BMad package reads the file** — every reference is an instruction to an
agent (checked on 6.9.0 and 6.12.0). Extra frontmatter fields and a changed index shape break
nothing.

## Adopting it

Migrate to a **scratch directory**, prove nothing was lost, then move it into place. The source is
the only copy of the thing you are checking against, so never migrate over it.

```bash
LEDGER=<dir>/deferred-work.md; OUT=$(mktemp -d)

python3 scripts/migrate.py "$LEDGER" "$OUT"           # index + detail files
node scripts/verify-migration.mjs "$LEDGER" "$OUT"    # ← the gate. non-zero = do not commit
node scripts/validate.mjs "$OUT"                      # structure, pointers, policy
```

`migrate.py` is **lossless for items by construction** — every item's block is written verbatim into
its detail file, and frontmatter is derived from that block, never invented. A field the source does
not state is emitted empty and counted, so gaps are visible rather than guessed. It also prints what
it refuses to decide: untriaged items, sections with no bullets, and open items under a retired
heading. Each of those lines is a task, not a statistic.

`verify-migration.mjs` asks the two questions the counts cannot. **Does every byte of the source
appear somewhere in the output?** — item bodies read a clean 251/251 on the real corpus while 23
section intros and one whole item were on the floor. **Does a second extractor agree on WHICH items
are closed?** — the two disagreed 44 against 40, and diffing them as *sets* rather than sizes is
what turned a plausible near-match into four named items.

Both of those fired on the first real adoption. **`reference/adopting.md` is the runbook** — the
order, what to do with each reported count, and the two decisions to make explicitly.
`reference/migration-traps.md` is why: nine silent corruptions, each live against a real ledger —
including one the gate itself could not see, because both extractors were missing the same word.
