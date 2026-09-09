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

Frontmatter only — bodies are never read. On the real corpus above that is **416 lines against
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
  above had **108 of 207** open items without one, which the monolith hid and this surfaces.

## Coexisting with generators

Some tools append to the index directly. BMad's `bmad-build` and `bmad-code-review` both hardcode
`{implementation_artifacts}/deferred-work.md` and write:

```markdown
- source_spec: `<spec>`
  summary: <one sentence>
  evidence: <why this is real>
```

That is why the index keeps its path and stays **hand-maintained rather than generated**: a
generated index would silently eat those appends on the next regeneration.

Such an entry has no detail file, so no `status` and no `trigger`. Treat it as **open and
untriaged**; grooming promotes it into a detail file. `scripts/validate.mjs` counts them.

Verified against BMad 6.12.0: **no executable in the package reads the file** — every reference is an
instruction to an agent. Extra frontmatter fields and a changed index shape break nothing.

## Adopting it

```bash
python3 scripts/migrate.py <dir>/deferred-work.md <output-dir>   # index + detail files
node scripts/validate.mjs <dir>                                  # structure, pointers, policy
```

`migrate.py` is **lossless by construction** — every item's original block is written verbatim into
its detail file, and frontmatter is derived from that block, never invented. A field the source does
not state is emitted empty and counted, so gaps are visible rather than guessed. It writes
`policy: deferred-work` into the index; delete that line to run a plain backlog.

**Check the migration against an independent count before committing it.** Adoption is the one
moment the old format's inconsistencies must be parsed, and they are worse than they look — see
`reference/migration-traps.md` for the seven that corrupted this migrator before they were found.
