#!/bin/bash
# Syntax-check the extension's ES modules. gjs cannot be used here: the gi://
# typelibs for Meta/Shell/St only exist inside the gnome-shell process, so an
# import would fail for reasons unrelated to syntax. node parses the module
# without resolving imports when we only ask it to check.
cd "$(dirname "$0")/.."
fail=0
for f in extension.js prefs.js lib/*.js; do
  [ -f "$f" ] || continue
  cp "$f" "/tmp/_chk_$$.mjs"
  if node --check "/tmp/_chk_$$.mjs" 2>/tmp/_err_$$; then
    echo "  ok   $f"
  else
    echo "  FAIL $f"; sed 's/^/        /' /tmp/_err_$$ | head -6; fail=1
  fi
  rm -f "/tmp/_chk_$$.mjs" /tmp/_err_$$
done
exit $fail
