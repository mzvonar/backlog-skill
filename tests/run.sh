#!/usr/bin/env bash
# Every test in this repo. node stdlib + python3 only — no install, no network.
set -euo pipefail
cd "$(dirname "$0")/.."
node --test "tests/*.test.mjs"
