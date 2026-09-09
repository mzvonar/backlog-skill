// The migration traps, as permanent fixtures.
//
// Each was LIVE in migrate.py against a real 3,622-line ledger, and each is silent: the migration
// completes and the counts look plausible. A synthetic corpus containing all of them is the only way
// they stay closed — nothing about the shipped output would reveal a regression.
//
// The last two are one root cause: the status zone was the item's first PHYSICAL line, while an
// item's own text runs to its first sub-bullet. Every earlier trap here was closed by normalising
// before matching; these two were left because the fixture set enumerated the shapes the author had
// seen rather than the ways the layout can vary. Both were live against the real ledger — four items
// migrated `open` while their own body said DONE, three of them then reported as untriaged.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const MIGRATE = path.join(import.meta.dirname, "..", "skills", "backlog", "scripts", "migrate.py");

// One section, fourteen items. Eight are closed in eight different real spellings; six are open.
// Five bullets look closed and are not. A migrator that reads this correctly finds EIGHT.
const CORPUS = `# Deferred work

## Deferred from: story 1-1 review

- **DONE (2026-08-04)** the documented spelling.
- **✅ DONE (2026-08-04, story 3-5)** emoji prefix and a second field in the parens.
- **DONE upstream (2026-08-31, some-branch)** a word between the marker and the paren.
- **KILLED (2026-07-27, superseded)** the killed spelling.
- ~~struck through, no marker at all~~ retired in place.
- **DONE (2026-08-31, a long parenthetical that wraps onto the following line and only
  closes here) the line-spanning case.**
- **An open item.** It stays open.
  - **❌ KILLED (2026-09-01)** a NESTED sub-bullet — context for the parent, not a status for it.
- **A second open item.** Its body quotes the convention: mark it \`**DONE (YYYY-MM-DD)**\` when retired.
- **Third open item.** Progress note only: the rem switch is HALF DONE (2026-07-20), not finished.
- **An item retired in place after the fact.** The original text stays as the record and the
  marker is appended at the END of the item's own body, several lines below the bullet line.
  **DONE (2026-09-07)** — closed by the follow-up run.
- **A marker on the bullet line whose OPENING paren wraps.** **DONE in-story
  (2026-08-25, review round 1):** the marker starts on line one and its parenthetical begins on
  the next, so a pattern needing \`(\` on the same physical line finds nothing.
- **Fourth open item.** It carries continuation text of its own before any child, so the status
  zone must span these lines without ever reaching the child below.
  - **KILLED (2026-09-02)** a nested sub-bullet under an item with continuation text.
- **Fifth open item.** An item's block runs to the next top-level bullet, so it also contains
  whatever sits between them at the left margin.

### A following sub-heading that is retired — **DONE (2026-09-03)**

**✅ DONE (2026-09-03) — this paragraph retires the sub-heading above, not the bullet before it.**

- **Sixth open item.** It follows that retired group and is not retired by it.
`;

const migrate = (corpus) => {
  const dir = mkdtempSync(path.join(tmpdir(), "dbk-"));
  const src = path.join(dir, "deferred-work.md");
  writeFileSync(src, corpus);
  const out = path.join(dir, "out");
  const stdout = execFileSync("python3", [MIGRATE, src, out], { encoding: "utf-8" });
  const files = readdirSync(path.join(out, "deferred-work"));
  const status = files.map((f) => {
    const t = readFileSync(path.join(out, "deferred-work", f), "utf-8");
    return /^status: (?<s>.*)$/mu.exec(t)?.groups.s ?? "";
  });
  return { dir, files, status, stdout };
};

describe("migrate.py", () => {
  it("counts every closed spelling, and no false positive", () => {
    const { dir, status } = migrate(CORPUS);
    try {
      const closed = status.filter((s) => /^(DONE|KILLED)/u.test(s));
      const open = status.filter((s) => s === "open");
      // EIGHT closed: documented, emoji, word-before-paren, KILLED, struck-through, line-spanning,
      // marker appended at the end of the body, marker whose opening paren wraps to the next line.
      // SIX open: the nested-KILLED parent, the convention-quoting body, the HALF DONE note, the
      // parent with continuation text above a KILLED child, and the two around the retired
      // sub-heading — whose marker sits at the left margin INSIDE the fifth item's block.
      assert.equal(closed.length, 8, `closed spellings: got ${JSON.stringify(status)}`);
      assert.equal(open.length, 6, `open items: got ${JSON.stringify(status)}`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("does not let a nested sub-bullet's status leak onto its parent", () => {
    // Trap 2. A character window over the item block reaches the child; scope is the bullet line.
    const { dir, files, status } = migrate(CORPUS);
    try {
      const i = files.findIndex((f) => f.includes("an-open-item"));
      assert.notEqual(i, -1, `expected an item file for the nested-child parent, got ${files}`);
      assert.equal(status[i], "open", "the parent of a KILLED sub-bullet must stay open");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reads a status parenthetical that wraps onto the next line", () => {
    // Trap 3. Requiring the closing paren on line 1 silently drops this item.
    const { dir, status } = migrate(CORPUS);
    try {
      assert.ok(status.includes("DONE (2026-08-31)"), `line-spanning date lost: ${JSON.stringify(status)}`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("is lossless — every source item body survives verbatim", () => {
    const { dir, files } = migrate(CORPUS);
    try {
      const out = path.join(dir, "out", "deferred-work");
      const bodies = files.map((f) => readFileSync(path.join(out, f), "utf-8").split("---\n")[2]);
      for (const probe of ["the line-spanning case", "HALF DONE (2026-07-20)", "context for the parent"]) {
        assert.ok(bodies.some((b) => b.includes(probe)), `dropped from every detail body: ${probe}`);
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports items it could not derive a trigger for, rather than inventing one", () => {
    const { dir, stdout } = migrate(CORPUS);
    try {
      assert.match(stdout, /open with NO trigger: [1-9]/u, `expected untriaged items to be reported: ${stdout}`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

// A ledger is more than its bullets. These three shapes carry content that reaches no detail file,
// so a migration driven by items alone drops them with no failure signature: the counts are right,
// the items are all present, and a section's worth of provenance is simply gone.
const SECTIONS = `# Deferred work

## A section whose heading is retired — **RETIRED (2026-09-03, some groom)**

> **RETIRED — the work is closed.** Kept for provenance; do not action.

- **An item under that heading.** It carries no marker of its own.

## A section with intro prose

Context nothing else repeats: why these were parked and who owns them.

- **An ordinary open item.** With a body.

## A section with no bullets at all (2026-09-08)

### Delete the shim when both consumer tiers land

**Trigger:** both downstream tiers are merged.

**What:** delete the shim and drop its paragraph from the README.
`;

describe("migrate.py — what is not an item", () => {
  it("keeps a section's intro prose, which reaches no detail file", () => {
    const { dir, stdout } = migrate(SECTIONS);
    try {
      const index = readFileSync(path.join(dir, "out", "deferred-work.md"), "utf-8");
      assert.ok(
        index.includes("Context nothing else repeats: why these were parked and who owns them."),
        `intro prose dropped from the index:\n${index}`,
      );
      assert.ok(index.includes("> **RETIRED — the work is closed.**"), "the retired banner is gone");
      assert.ok(stdout.length > 0);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("keeps a section that has no bullet items at all, and says so", () => {
    // The newest entry on the real corpus has this shape — a heading with Trigger/What paragraphs
    // and no bullet anywhere. An item-driven walk drops the whole section and reports 0 items lost.
    const { dir, stdout } = migrate(SECTIONS);
    try {
      const index = readFileSync(path.join(dir, "out", "deferred-work.md"), "utf-8");
      assert.ok(index.includes("Delete the shim when both consumer tiers land"), "bulletless section dropped");
      assert.ok(index.includes("**Trigger:** both downstream tiers are merged."), "its trigger is gone");
      assert.match(stdout, /sections with NO bullet items: 1/u);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports an open item under a retired heading — and does NOT retire it", () => {
    // Report, never apply. A retired section usually means its items are done, but a DONE section
    // can hold one live item and only a person can tell which. Silently inheriting would decide it.
    const { dir, status, stdout } = migrate(SECTIONS);
    try {
      assert.match(stdout, /open items under a RETIRED\/DONE section heading: 1/u);
      assert.equal(status.filter((s) => s === "open").length, 2, `got ${JSON.stringify(status)}`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

// The closed vocabulary. A ledger's header documented two words; the ledger used six, and the four
// it never documented retired 7 items that migrated `open` into the untriaged set — presented to
// every grooming pass as live work, two of them saying "do not action" verbatim. Neither the
// migrator nor its differential gate could see it: both knew only DONE|KILLED.
const VOCAB = `# Deferred work

## Closed six ways, hedged three ways

- **DONE (2026-08-04)** the documented one.
- **KILLED (2026-08-04)** the other documented one.
- **CLOSED (2026-09-08, deletePerson aggregate row lock)** nine of these in the real ledger.
- **RETIRED (2026-08-07, story 3-7 groom)** four of these; two said "do not action".
- **SUPERSEDED the same day — FIXED upstream at \`2c8bf973\`.** No date parenthetical at all.
- **RESOLVED — the A2 five-seam block (:692-713).** A paren that is not a date.
- **◐ MOSTLY CLOSED (2026-09-08)** a hedge in front of a closure is not a closure.
- **🟡 PARTIALLY LANDED (2026-08-10)** nor is this.
- **NOT done at 4.3** nor is this.
- **STILL OPEN, explicitly not fired at story 4-1.** Ordinary emphasis, not a marker.
`;

describe("migrate.py — the closed vocabulary", () => {
  it("closes on every word the corpus uses, not just the two its header documented", () => {
    const { dir, status } = migrate(VOCAB);
    try {
      const closed = status.filter((s) => /^(DONE|KILLED|CLOSED|SUPERSEDED|RETIRED|RESOLVED)/u.test(s));
      assert.equal(closed.length, 6, `expected six closed spellings, got ${JSON.stringify(status)}`);
      for (const w of ["DONE", "KILLED", "CLOSED", "SUPERSEDED", "RETIRED", "RESOLVED"]) {
        assert.ok(status.some((s) => s.startsWith(w)), `${w} did not close an item: ${JSON.stringify(status)}`);
      }
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("leaves a HEDGED closure open — the tool asks instead of guessing", () => {
    // "mostly closed" is a person's call. Guessing either way is worse than reporting.
    const { dir, status } = migrate(VOCAB);
    try {
      assert.equal(status.filter((s) => s === "open").length, 4, `got ${JSON.stringify(status)}`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("records a closure with no date as `(date unknown)` and reports it", () => {
    // The alternative was leaving it open, which is how two of the seven were lost. A wrong-looking
    // date is visible; an item silently back in the untriaged set is not.
    const { dir, status, stdout } = migrate(VOCAB);
    try {
      assert.ok(status.includes("SUPERSEDED (date unknown)"), `got ${JSON.stringify(status)}`);
      assert.ok(status.includes("RESOLVED (date unknown)"), `got ${JSON.stringify(status)}`);
      assert.match(stdout, /status inferred\/ambiguous: 2/u);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

// `repr()` was used to quote YAML scalars. Python's escaping is not YAML's, and both divergences
// shipped into the first real corpus.
const QUOTING = String.raw`# Deferred work

## Quoting

- **A regex the item quotes: ` + "`" + String.raw`^conformance/.*\.md$` + "`" + String.raw`.** A backslash must stay one backslash.
- **` + "`" + String.raw`RequestBodyMissingException` + "`" + String.raw`'s KDoc says "a createPerson request".** An apostrophe, inside quotes.
`;

describe("migrate.py — frontmatter is YAML, not Python", () => {
  it("keeps a backslash literal and doubles an apostrophe", () => {
    const { dir, detailDir } = (() => {
      const r = migrate(QUOTING);
      return { ...r, detailDir: path.join(r.dir, "out", "deferred-work") };
    })();
    try {
      const all = readdirSync(detailDir).map((n) => readFileSync(path.join(detailDir, n), "utf-8")).join("\n");
      assert.ok(all.includes(String.raw`\.md$`), "the backslash was doubled — the record no longer matches its source");
      assert.ok(!all.includes(String.raw`\\.md$`), "a doubled backslash is still present");
      assert.ok(all.includes(`''s KDoc`), "the apostrophe is not YAML-escaped as ''");
      assert.ok(!all.includes(String.raw`\'s KDoc`), String.raw`\' is not valid inside a YAML single-quoted scalar`);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
