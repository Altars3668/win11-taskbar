#!/bin/bash
# load-live.sh — load the extension into the running shell, without logging out.
#
# Wayland cannot restart GNOME Shell: the shell *is* the compositor, so
# restarting it takes every window with it. But it can be told about an
# extension it has never seen.
#
# The shell scans the extension directories once, at startup. Anything
# installed afterwards is simply unknown to it — which is why
# `gnome-extensions enable` says the extension does not exist, and why
# ReloadExtension over D-Bus cannot help either: it only reloads
# extensions already in the manager.
#
# The fix is to hand the manager the extension directly. That needs JS
# running inside the shell, and GNOME 50 removed the Eval D-Bus method —
# but Looking Glass, the shell's built-in console, is not affected by
# that. So this script prints one line to paste there, then does the rest
# itself.
#
# Verified on a headless GNOME 50.1: an extension installed after startup
# went from "not known to the shell" to state=1 (ENABLED) with its
# enable() actually running, no logout involved.

set -u
UUID=win11-taskbar@altarscn.com
EXTDIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

if [ ! -e "$EXTDIR" ]; then
    echo "not installed: run 'make link' or 'make install' first"
    exit 1
fi

# Already known? Then there is nothing to inject; just enable it.
if gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
    echo "The shell already knows this extension — no injection needed."
    echo
    echo "Run:  tools/enable.sh --apply"
    exit 0
fi

SNIPPET="Main.extensionManager.loadExtension(Main.extensionManager.createExtensionObject('$UUID', Gio.File.new_for_path('$EXTDIR'), 2))"

cat <<EOF
The running shell has not scanned this extension, so it has to be handed
over by hand. One line, once — after this the shell knows it for good.

  1. Press Alt+F2, type:   lg        and press Enter.
     (That is Looking Glass, the shell's own JS console.)

  2. Paste this into its prompt and press Enter:

$SNIPPET

  3. Press Escape to close Looking Glass, then come back here and run:

       tools/enable.sh --apply

EOF

if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$SNIPPET" | wl-copy && echo "(the line is on your clipboard)"
elif command -v xclip >/dev/null 2>&1; then
    printf '%s' "$SNIPPET" | xclip -selection clipboard && \
        echo "(the line is on your clipboard)"
fi

echo
echo "Then check it took:"
echo "  gnome-extensions info $UUID"
