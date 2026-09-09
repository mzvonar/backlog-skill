import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { scanBacklog } from "../skills/backlog/scripts/validate.mjs";

// A deferred-work index declares its policy; a plain backlog omits it. That one line is the whole
// difference between the two modes.
const INDEX =
  "---\npolicy: deferred-work\n---\n\n# index\n\n" +
  "- id: dw-001\n  summary: A\n  detail: `deferred-work/dw-001-a.md`\n" +
  "- id: dw-002\n  summary: B\n  detail: `deferred-work/dw-002-b.md`\n";

const detail = (fm) => `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n\n- The record.\n`;

/** A clean two-item backlog. Every offender below is one mutation away from this. */
const cleanTree = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dbk-v-"));
  mkdirSync(path.join(dir, "deferred-work"));
  writeFileSync(path.join(dir, "deferred-work", "dw-001-a.md"), detail({ id: "dw-001", status: "open", summary: "'A'", trigger: "'when X'" }));
  writeFileSync(path.join(dir, "deferred-work", "dw-002-b.md"), detail({ id: "dw-002", status: "DONE (2026-01-01)", summary: "'B'" }));
  writeFileSync(path.join(dir, "deferred-work.md"), INDEX);
  return dir;
};

const codes = (f) => f.map((x) => x.code).toSorted();

describe("scanBacklog", () => {
  it("finds nothing in a clean backlog — the positive control", () => {
    // Without this, every offender row below also passes against a scanner that flags everything.
    const dir = cleanTree();
    try {
      assert.deepEqual(scanBacklog(dir), []);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("reports a missing index rather than reporting a clean empty backlog", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "dbk-empty-"));
    try {
      assert.deepEqual(codes(scanBacklog(dir)), ["NO_INDEX"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  // Exact finding sets, never `contains`: a surface the scanner is blind to yields zero findings,
  // which no content match distinguishes from a clean tree.
  const offenders = [
    ["an index pointer to a file that is not there", (d) =>
      writeFileSync(path.join(d, "deferred-work.md"), "---\npolicy: deferred-work\n---\n\n- id: dw-009\n  summary: X\n  detail: `deferred-work/gone.md`\n"),
      ["DANGLING_DETAIL", "UNINDEXED", "UNINDEXED"]],
    ["a detail file nothing points at", (d) =>
      writeFileSync(path.join(d, "deferred-work", "dw-003-c.md"), detail({ id: "dw-003", status: "open", summary: "'C'", trigger: "'t'" })),
      ["UNINDEXED"]],
    ["an open item with no trigger — untriaged, not keep-deferred", (d) =>
      writeFileSync(path.join(d, "deferred-work", "dw-001-a.md"), detail({ id: "dw-001", status: "open", summary: "'A'" })),
      ["NO_TRIGGER"]],
    ["a detail file with no frontmatter at all", (d) =>
      writeFileSync(path.join(d, "deferred-work", "dw-001-a.md"), "- just a bullet, no fence\n"),
      ["NO_FRONTMATTER"]],
    ["two detail files claiming the same id", (d) =>
      writeFileSync(path.join(d, "deferred-work", "dw-001-a.md"), detail({ id: "dw-002", status: "open", summary: "'A'", trigger: "'t'" })),
      ["DUPLICATE_ID"]],
    // Expectation corrected against the run, and recorded rather than quietly fixed: this was
    // written as MISSING_FIELD + NO_TRIGGER. It is MISSING_FIELD alone — the item HAS a trigger,
    // and an absent `status` reads as open, which is the safe default. The next reader will make
    // the same guess.
    ["a required field missing", (d) =>
      writeFileSync(path.join(d, "deferred-work", "dw-001-a.md"), detail({ id: "dw-001", trigger: "'t'", summary: "'A'" })),
      ["MISSING_FIELD"]],
    ["a stray non-markdown file in the detail directory", (d) =>
      writeFileSync(path.join(d, "deferred-work", "notes.txt"), "scratch\n"),
      ["STRAY_FILE"]],
    ["a generator append with no detail file — untriaged, reported not failed-silently", (d) =>
      writeFileSync(path.join(d, "deferred-work.md"),
        INDEX + "- source_spec: `spec-9.md`\n  summary: appended by a tool\n  evidence: why\n"),
      ["UNPROMOTED_APPENDS"]],
  ];

  for (const [name, mutate, expected] of offenders) {
    it(`flags ${name}`, () => {
      const dir = cleanTree();
      try {
        mutate(dir);
        assert.deepEqual(codes(scanBacklog(dir)), [...expected].toSorted());
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });
  }

  it("a plain backlog does not require a trigger — that rule is the deferred-work policy", () => {
    // The mode's whole surface. Without the policy line an item with no trigger is ordinary: a
    // backlog item is actionable when picked, not when a condition fires.
    const dir = cleanTree();
    try {
      writeFileSync(path.join(dir, "deferred-work.md"), INDEX.replace("---\npolicy: deferred-work\n---\n\n", ""));
      writeFileSync(path.join(dir, "deferred-work", "dw-001-a.md"), detail({ id: "dw-001", status: "open", summary: "'A'" }));
      assert.deepEqual(scanBacklog(dir), []);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("refuses a policy it does not implement rather than silently ignoring it", () => {
    // A typo or a policy from a newer version must not read as "no policy" — that would silently
    // drop whichever rules the author was relying on.
    const dir = cleanTree();
    try {
      writeFileSync(path.join(dir, "deferred-work.md"), INDEX.replace("policy: deferred-work", "policy: kanban"));
      assert.deepEqual(codes(scanBacklog(dir)), ["UNKNOWN_POLICY"]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("does not read detail bodies — only frontmatter decides", () => {
    // The body may quote the convention (`status: open` in prose) without changing the verdict;
    // that quoting is exactly what fooled the migrator's first status detector.
    const dir = cleanTree();
    try {
      writeFileSync(path.join(dir, "deferred-work", "dw-002-b.md"),
        detail({ id: "dw-002", status: "DONE (2026-01-01)", summary: "'B'" }) +
        "\nRetire an item by writing `status: open` -> `status: KILLED (date)`.\n");
      assert.deepEqual(scanBacklog(dir), []);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
