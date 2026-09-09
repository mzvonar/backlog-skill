# Migration traps

Five defects that were live in this migrator, found against a real 3,622-line corpus. Each is a
silent corruption: the migration completes, the counts look plausible, and items are misfiled.

They are recorded because they are properties of *hand-written markdown ledgers in general*, not of
one repo's file. Anyone adopting this format will meet them.

**Catch them the same way they were caught: cross-check the migrator's status count against an
independent count of the source, and refuse a near-match.** The sequence on the real corpus was
11 → 42 → 39 → 40 → **44**, and every intermediate number looked reasonable.

That `40` is the point of this page. It shipped as "the independently verified answer" and was
wrong by four. It survived because the cross-check compared *counts*: two numbers four apart still
read as "roughly agreeing, close enough". **Compare the SETS.** The four missing items were named
in seconds once the two extractors' outputs were diffed as sets rather than sized, and each was then
confirmed by reading the item.

---

## 1. The status marker is written many ways

Expected `**DONE (2026-08-04)**`. Actually present, all in one file:

| form | note |
|---|---|
| `**DONE (2026-08-04)**` | the documented one |
| `**✅ DONE (2026-08-04, story 3-5)**` | emoji prefix, second field inside the parens |
| `**DONE upstream (2026-08-31, …)**` | a word between the marker and the paren |
| `**DONE in-story (2026-08-25, …)**` | another word, and it wraps — see trap 4 |
| `**KILLED (2026-08-04, story 3-5 …)**` | |
| `- ~~struck through~~` | no marker at all |

And two shapes that must **not** match:

- `HALF DONE (2026-07-20)` — a progress note, not a status.
- ``mark it `**DONE (YYYY-MM-DD)**` `` — prose *documenting the convention*. A ledger that explains
  its own format contains its own format.

A strict pattern found 10 of 44. A loose one found 48, including both false positives.

## 2. A character window reaches into sub-bullets

Scoping the status search to "the first 200 characters of the item" pulls in nested bullets when the
headline is short — so an item whose **child** was marked killed inherits the child's status.
Misfiled 2 of 42.

Scope to the item's **own text**, which ends at its first sub-bullet. Sub-bullets are context for
the parent, never a status.

> Not "the first line". An earlier revision of this page said "the item's own bullet line", the
> migrator read that as `block.split("\n")[0]`, and traps 4 and 5 are what that cost. An item's own
> text is its bullet line **plus the continuation lines under it** — markdown lets the author break
> a line anywhere, so where the text ends is a structural question, not a positional one.

## 3. The status parenthetical wraps onto the next line

```markdown
- **DONE (2026-08-31, chore/sync-run-story-skills-fc0498c — a deliberate pipeline-shape MR, which is this
  very thing) …
```

The closing `)` is two lines down. A pattern requiring it silently drops the item — line-spanning
data under a per-line pattern. Make the closing paren optional and take the date.

## 4. The marker is not at the head of the item

Two shapes, one cause. An item retired **in place** keeps its original text as the record and gets
its marker appended at the END of the body:

```markdown
- **`DeletePortShapeGuardTest.DOMAIN_ROOT` still scans only the legacy `domain/` directory** for the
  KDoc half. Nothing is missed while every port lives there …
  **DONE (2026-09-07)** — Run B: `AuditPort` moved, and the root became `LayerDirectories…`.
```

And a marker that *starts* on the bullet line can have its parenthetical **open** on the next one:

```markdown
- **Sanitize `transactionId` at the MDC source (`TransactionIdMdcFilter`).** **DONE in-story
  (2026-08-25, review round 1):** `sanitizeForLog` now runs before `MDC.put` …
```

Trap 3 made the *closing* paren optional and stopped there — the class was named and one member of
it was closed. Four items on the real corpus migrated `open` while their own body said DONE, and
three were then reported as untriaged, i.e. as needing a trigger for work already finished.

The fixture set is why it survived: it contained the wraps its author had seen. **Normalise the
zone — flatten the item's own text — rather than adding a pattern per observed wrap.**

## 5. An item's block contains what follows it

An item runs to the next top-level bullet, so its block also holds anything sitting between them at
the **left margin** — typically a trailing `###` sub-heading and the paragraph under it, which
belong to the next group and carry a marker of their own:

```markdown
- **An open item.** …

### A following sub-heading — **DONE (2026-09-03)**

**✅ DONE (2026-09-03) — this retires the heading above, not the bullet before it.**
```

This one appeared *while fixing trap 4*: widening the zone from one line to the whole block retired
an open item with a DONE written eleven lines below it about something else. A continuation line of
a bullet is indented; anything at the left margin has left the item.

---

## The general rule

All five are the same mistake at different scales: **anchoring on the layout the author imagined
rather than the layout the corpus contains.** A hand-maintained ledger accretes formatting over
years and nothing ever validated it, because until now nothing read it mechanically.

Two corollaries, both bought the expensive way:

- **A fixture set demonstrates a closure; it does not achieve one.** Traps 4 and 5 each passed a
  suite that already had a row for "the marker wraps". Rows prove the scanner fires on the shapes
  someone thought of — normalising the input is what covers the ones nobody did.
- **Widening a scope opens a boundary.** Trap 4's fix made trap 5 reachable. Whenever a zone grows,
  ask what it now touches that it did not before, and add the fixture before believing the count.

So: parse loosely, normalise before matching, restrict scope structurally, and **report what was
inferred instead of deciding silently**. `migrate.py` prints an ambiguous count for exactly this
reason — those are the entries a person should read before the migration is committed.
