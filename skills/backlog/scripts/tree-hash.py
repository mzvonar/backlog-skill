#!/usr/bin/env python3
"""tree-hash.py — deterministic content hash of a vendored skill directory.

    python3 tree-hash.py <dir>        → prints a sha256 hex digest

Consumers use this to answer "does the copy on disk still match the commit its pin names?" — the
commit sha in `.backlog-version` cannot, since it records where the copy CAME FROM and editing a
vendored copy in place is a supported workflow.

Self-contained on purpose. This is the ONE function a vendored copy's integrity proof cannot afford
to load from elsewhere: an import that is not there degrades to `tree_sha256=unavailable` in the pin
and takes the whole check with it, silently and in every consumer at once.
"""
import hashlib, os, sys


def tree_hash(root):
    """POSIX-sorted relative paths + exec bit + sha256 per file.

    `__pycache__` and `*.pyc` are excluded — they appear from merely running the skill and would
    make the digest unstable for a copy nobody edited.
    """
    rels = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != "__pycache__"]
        for fn in filenames:
            if fn.endswith(".pyc"):
                continue
            rels.append(os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/"))
    h = hashlib.sha256()
    for rel in sorted(rels):
        p = os.path.join(root, rel)
        h.update(rel.encode() + b"\0")
        h.update((b"x" if os.access(p, os.X_OK) else b"-") + b"\0")
        with open(p, "rb") as f:
            h.update(hashlib.sha256(f.read()).hexdigest().encode() + b"\0")
    return h.hexdigest()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: tree-hash.py <dir>", file=sys.stderr); sys.exit(2)
    if not os.path.isdir(sys.argv[1]):
        print(f"not a directory: {sys.argv[1]}", file=sys.stderr); sys.exit(2)
    print(tree_hash(sys.argv[1]))
