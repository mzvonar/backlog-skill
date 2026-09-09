# backlog

A backlog that lives in the repository, in markdown, and stays workable past a few hundred items.
Packaged as a Claude Code skill.

## Why

A single append-only list works until it doesn't. Measured on a real one before adoption:
**3,622 lines, 251 items, 85 sections.** Every pass over it read the whole file to answer one
question about a handful of items, and every concurrent branch collided on the same trailing lines.

After: **416 lines read instead of 3,622**, closed items filtered rather than skimmed past, and the
full record for an item one file away.

## Shape

```
<dir>/deferred-work.md      index: one entry per item + a `detail:` pointer
<dir>/deferred-work/        one file per item: frontmatter + the full record
```

Required per item: `id`, `summary`, `status`. Anything else — `priority`, `size`, `owner` — is free;
unknown fields are ignored. The index never repeats frontmatter, so the two cannot disagree, and it
keeps its original path so tools that append to it keep working.

## Policies

A policy says what makes an item **actionable**. Declared in the index's own frontmatter:

| policy | actionable when | requires |
|---|---|---|
| *(none)* | you pick it | `id`, `summary`, `status` |
| `deferred-work` | its `trigger` has fired | the above + `trigger` on open items |

Use no policy for an ordinary backlog you pick work from. Use `deferred-work` for work parked with a
reason — debt, follow-ups, review deferrals — where the question is *"has this become relevant yet?"*
rather than *"what is next?"*. An unrecognised policy is refused, never ignored.

## Use

```bash
node scripts/backlog.mjs  <dir>/deferred-work          # open items, one line each
node scripts/backlog.mjs  <dir>/deferred-work --all    # include DONE / KILLED
node scripts/validate.mjs <dir>                        # structure, pointers, policy
python3 scripts/migrate.py <dir>/deferred-work.md <out>   # adopt an existing monolith
```

`migrate.py` is lossless by construction: every item's original block is copied verbatim, and
frontmatter is derived from it, never invented. Fields the source does not state are emitted empty
and counted, so the gaps are visible.

**Read `reference/migration-traps.md` before adopting.** Seven silent corruptions were live in this
migrator against a real ledger; all seven ship as fixtures, and each was found only by cross-checking
against an independent extraction and refusing a near-match. Diff the two as SETS: the first
adoption compared counts, called 40 close enough, and shipped a number that was wrong by four.

## Install

```bash
git clone https://github.com/mzvonar/backlog-skill.git
./sync-skill.sh /path/to/consumer-repo --ref main
```

Vendors `skills/backlog` into `<consumer>/.claude/skills/` and writes a pin file. Commit the copy and
the pin. `./sync-skill.sh --from <consumer>` pulls edits made in a consumer back here.

## Tests

```bash
./tests/run.sh
```

node stdlib + python3. No install, no network.
