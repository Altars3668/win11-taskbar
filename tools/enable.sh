#!/bin/bash
# enable.sh — switch this session over to the Windows 11 taskbar.
#
# Turns off the extensions that would fight with it and turns this one on.
# Nothing here is destructive: it records what it disabled in
# ~/.config/win11-taskbar-disabled so tools/disable.sh can put it back.
#
#   tools/enable.sh          # show what would change
#   tools/enable.sh --apply  # do it

set -u
UUID=win11-taskbar@altarscn.com
STATE="${XDG_CONFIG_HOME:-$HOME/.config}/win11-taskbar-disabled"

# Anything that also draws a taskbar/dock, or also hosts the tray. Only one
# process can own org.kde.StatusNotifierWatcher, so AppIndicator Support and
# this extension cannot both show tray icons.
CONFLICTS=(
    dash-to-panel@jderose9.github.com
    ubuntu-dock@ubuntu.com
    dash-to-dock@micxgx.gmail.com
    appindicatorsupport@rgcjonas.gmail.com
    ubuntu-appindicators@ubuntu.com
)

apply=0
[ "${1:-}" = "--apply" ] && apply=1

enabled() {
    gnome-extensions list --enabled 2>/dev/null | grep -qx "$1"
}

EXTDIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
if [ ! -e "$EXTDIR" ]; then
    echo "not installed: run 'make link' or 'make install' first"
    exit 1
fi

# The files can be in place while the running shell has not scanned them
# yet — on Wayland it only picks up a new extension at login.
if ! gnome-extensions list 2>/dev/null | grep -qx "$UUID"; then
    echo "note: the files are at $EXTDIR, but this shell has not loaded"
    echo "      the extension yet. Log out and back in, then re-run this."
    echo
fi

to_disable=()
for ext in "${CONFLICTS[@]}"; do
    enabled "$ext" && to_disable+=("$ext")
done

echo "would disable:"
if [ ${#to_disable[@]} -eq 0 ]; then
    echo "  (nothing — no conflicting extension is enabled)"
else
    printf '  %s\n' "${to_disable[@]}"
fi
echo "would enable:"
echo "  $UUID"

if [ $apply -eq 0 ]; then
    echo
    echo "re-run with --apply to make these changes"
    exit 0
fi

: > "$STATE"
for ext in "${to_disable[@]}"; do
    gnome-extensions disable "$ext" && echo "$ext" >> "$STATE"
done
gnome-extensions enable "$UUID"

echo
echo "done. Disabled extensions recorded in $STATE"
if [ "${XDG_SESSION_TYPE:-}" = "wayland" ]; then
    echo "On Wayland the shell only loads a new extension at login, so log"
    echo "out and back in if the taskbar does not appear."
fi
