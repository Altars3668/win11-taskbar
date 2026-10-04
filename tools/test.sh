#!/bin/bash
# test.sh — everything that can be checked, in order of how long it takes.
set -u
cd "$(dirname "$0")/.."
rc=0

echo "== syntax =="
tools/check.sh || rc=1

echo
echo "== click semantics (no compositor needed) =="
node tools/test-semantics.mjs || rc=1
node tools/test-layout-options.mjs || rc=1
node tools/test-ui-lifecycle.mjs || rc=1

echo
echo "== schemas =="
if glib-compile-schemas --strict --dry-run schemas/; then
    echo "  ok   schemas/"
else
    rc=1
fi

echo
echo "== rendered geometry vs the Windows measurements =="
tools/testbed.sh all || rc=1

exit $rc
