#!/usr/bin/env python3
"""Split a monolithic deferred-work.md into an index + one detail file per item.

Lossless by construction: every item's original block is written verbatim into its
detail file's body. The frontmatter is DERIVED from that block, never invented — a
field the source does not state is emitted empty and reported, not guessed.
"""
import re, sys, pathlib

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
(out / "deferred-work").mkdir(parents=True, exist_ok=True)
lines = src.read_text().split("\n")
secs = [i for i, l in enumerate(lines) if l.startswith("## ")]

def slug(s):
    s = re.sub(r'`[^`]*`', '', s)
    s = re.sub(r'[^a-zA-Z0-9]+', '-', s).strip('-').lower()
    return (s[:52].rstrip('-')) or "item"

# A section heading can carry a status of its own, and the prose under it can say things no item
# repeats — provenance, cross-references, "do not action". Both are content: neither is an item, so
# neither reaches a detail file, and dropping them is silent.
SECTION_MARK = re.compile(r'\*\*\s*(?:[^\w\s]\s*)?(DONE|KILLED|RETIRED)\b')

items, no_trigger, closed_n, ambiguous, sections, section_open = [], 0, 0, [], [], []
for a, b in zip(secs, secs[1:] + [len(lines)]):
    head = lines[a][3:].strip()
    body = lines[a+1:b]
    idx = [i for i, l in enumerate(body) if re.match(r'^- ', l)]
    intro = "\n".join(body[:idx[0]] if idx else body).strip()
    sections.append(dict(head=head, intro=intro, has_items=bool(idx)))
    sm = SECTION_MARK.search(head)
    for j, s in enumerate(idx):
        e = idx[j+1] if j+1 < len(idx) else len(body)
        block = "\n".join(body[s:e]).rstrip()
        if not block.strip():
            continue
        # The status marker has many spellings and two lookalikes that must not match; the table in
        # reference/migration-traps.md is the authority. Detect loosely, scope deliberately, exclude
        # the literal placeholder, and REPORT anything inferred rather than deciding silently.
        #
        # The zone is the item's OWN TEXT, flattened — its bullet line plus the continuation lines
        # under it. Where it ENDS is structural, not positional, and both ends cost a real defect:
        #   a child bullet ends it, or a killed sub-bullet retires its parent (misread 2 of 42);
        #   the left margin ends it, or a trailing `### ` heading and the paragraph under it — which
        #   belong to the next group and carry their own marker — get read as this item's status.
        # Flattening is what makes the zone independent of where the author happened to wrap: at the
        # head, appended at the END when an item is retired in place, or with the parenthetical
        # opening on the next line are all one status, and line 1 saw only the first.
        #
        # Measured on the real ledger: scoping to line 1 migrated four DONE items as `open`, three
        # then reported as untriaged; widening to the whole block retired an open item with a DONE
        # written eleven lines below it about something else.
        own = []
        for k, ln in enumerate(block.split("\n")):
            if k and re.match(r'^\s+[-*] ', ln):
                break                                   # a child bullet: context, not status
            if k and ln.strip() and not ln[0].isspace():
                break                                   # left margin: no longer this item's text
            own.append(ln)
        head_zone = " ".join(" ".join(own).split())
        # The closing paren stays OPTIONAL: it can fall outside the zone when the parenthetical runs
        # past the item's own text. Take the date and stop.
        m = re.search(r'\*\*[^*]{0,4}(?<!HALF )(DONE|KILLED)[^(*]{0,12}\((?P<d>[^)\n]*)\)?', head_zone)
        if m and re.search(r'Y{4}|MM-DD', m.group('d')):
            m = None
        struck = block.lstrip().startswith("- ~~")
        if m:
            status = f"{m.group(1)} ({m.group('d').split(',')[0].strip()})"
        elif struck:
            status = "KILLED (date unknown)"
            ambiguous.append((block[:70], "struck through, no date"))
        else:
            status = "open"
        if status != "open":
            closed_n += 1
        tm = re.search(r'\*\*Trigger:?\*\*:?\s*(.+?)(?:\n\s*\n|\Z)', block, re.S)
        trigger = " ".join(tm.group(1).split())[:200] if tm else ""
        if not trigger and status == "open":
            no_trigger += 1
        hm = re.match(r'^- \*\*(.+?)\*\*', block, re.S) or re.match(r'^- (.+?)[.\n]', block, re.S)
        summary = " ".join((hm.group(1) if hm else block[2:60]).split())[:180]
        if sm and status == "open":
            # Reported, never applied: a retired SECTION usually means its items are done, but a
            # DONE section can still hold one live item and only a person can tell. The one this
            # found had a heading reading "do not action" — grooming would have re-read it as open,
            # which is the very thing that heading was written to stop.
            section_open.append((f"{head[:58]}…", block.split("\n")[0][:80]))
        items.append(dict(head=head, sec=len(sections)-1, block=block, status=status,
                          trigger=trigger, summary=summary))

index = ["---",
         "# The migrated ledger is deferred work: an open item must say when it becomes",
         "# actionable. Drop this line to run a plain backlog, where items are actionable",
         "# when picked and `trigger` is optional.",
         "policy: deferred-work",
         "---",
         "",
         "# Deferred work — index",
         "",
         "One entry per item. `detail:` points at the file holding the full record; that file's",
         "frontmatter is the source of truth for `trigger` and `status`. Entries appended here by a",
         "tool with no `detail:` are untriaged — grooming promotes them.",
         ""]
# Grouped under the original headings, with each section's intro prose kept verbatim. The index
# is the whole file's reduction, not just its bullets — a heading that says "do not action" has to
# survive somewhere a reader looks. Readers of this file match on `id:`/`detail:` lines, so prose
# and headings between entries cost them nothing.
# Walked by SECTION, not by item, so a section carrying no bullets at all still reaches the index.
# One exists in the wild: the newest entry on the real corpus is a `### ` heading with Trigger /
# What / Why / Owner paragraphs and no bullet anywhere, which an item-driven walk drops whole —
# a live item with a stated trigger, silently absent from a migration billed as lossless.
n = 0
for si, sec in enumerate(sections):
    index += ["", f"## {sec['head']}", ""]
    if sec["intro"]:
        index += [sec["intro"], ""]
    for it in [i for i in items if i["sec"] == si]:
        n += 1
        iid = f"dw-{n:03d}"
        fn = f"{iid}-{slug(it['summary'])}.md"
        fm = ["---", f"id: {iid}", f"source_section: {it['head']!r}",
              f"summary: {it['summary']!r}", f"trigger: {it['trigger']!r}",
              f"status: {it['status']}", "---", ""]
        (out / "deferred-work" / fn).write_text("\n".join(fm) + it["block"] + "\n")
        index += [f"- id: {iid}", f"  summary: {it['summary']}", f"  detail: `deferred-work/{fn}`"]
(out / "deferred-work.md").write_text("\n".join(index) + "\n")
print(f"  items written      : {len(items)}  ({closed_n} closed, {len(items)-closed_n} open)")
bulletless = [s["head"] for s in sections if not s["has_items"]]
if bulletless:
    print(f"  sections with NO bullet items: {len(bulletless)}  <- content kept in the index, promote by hand")
    for h in bulletless:
        print(f"      {h[:78]}")
print(f"  status inferred/ambiguous: {len(ambiguous)}")
if section_open:
    print(f"  open items under a RETIRED/DONE section heading: {len(section_open)}  <- resolve by hand")
    for h, first in section_open:
        print(f"      {h}\n        {first}")
print(f"  open with NO trigger: {no_trigger}  <- migration must surface these, not invent them")
