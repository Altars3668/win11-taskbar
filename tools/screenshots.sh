#!/bin/bash
# screenshots.sh — render every state of the taskbar and save them.
#
# Drives the headless test shell through the debug service's Trigger method,
# grabbing the screen after each step. Useful for reviewing the result
# without logging out, and for the README.
#
#   tools/screenshots.sh [OUTDIR]

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/screenshots}"
RUN="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/win11-taskbar-testbed"
BUS=org.gnome.Shell.Extensions.Win11Taskbar
OBJ=/org/gnome/Shell/Extensions/Win11Taskbar

mkdir -p "$OUT"

env_for_session() {
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_CONFIG_HOME="$RUN/config"
    export XDG_CACHE_HOME="$RUN/config/cache"
    export WAYLAND_DISPLAY=w11test
    export DBUS_SESSION_BUS_ADDRESS="$(cat "$RUN/bus")"
    unset DISPLAY
}

trigger() {
    gdbus call --session --dest "$BUS" --object-path "$OBJ" \
        --method "$BUS.Trigger" "$1" >/dev/null 2>&1
    # Let the fade finish and the compositor paint a frame with it: the
    # screenshot otherwise captures the frame from before the trigger.
    sleep 1
}

shot() {
    gdbus call --session --dest "$BUS" --object-path "$OBJ" \
        --method "$BUS.Screenshot" "$OUT/$1.png" >/dev/null 2>&1
    sleep 2
    echo "  $1.png"
}

"$ROOT/tools/testbed.sh" start >/dev/null || exit 1
"$ROOT/tools/testbed.sh" apps >/dev/null
env_for_session

echo "capturing into $OUT"
shot 01-idle

trigger preview-first;       shot 02-thumbnail-flyout
trigger preview-close

trigger jump-list;         shot 03-jump-list
trigger jump-list-close

trigger start-menu;        shot 04-start-menu
trigger start-menu-all-apps; shot 05-all-apps
trigger start-menu-close

gsettings --schemadir "$ROOT/schemas" \
    set org.gnome.shell.extensions.win11-taskbar tray-hidden-items \
    "['tray-beta']" >/dev/null 2>&1
sleep 1
trigger tray-overflow;     shot 06-tray-overflow
trigger tray-overflow
gsettings --schemadir "$ROOT/schemas" \
    set org.gnome.shell.extensions.win11-taskbar tray-hidden-items \
    "[]" >/dev/null 2>&1

trigger quick-settings;      shot 07-quick-settings
trigger wifi-submenu;        shot 08-flyout-subpage
trigger quick-settings-close
trigger notifications;       shot 09-notification-centre
trigger notifications-close

gsettings set org.gnome.desktop.interface color-scheme prefer-dark
sleep 2
shot 10-dark

trigger start-menu;          shot 11-dark-start-menu
trigger start-menu-close
trigger quick-settings;      shot 12-dark-quick-settings
trigger quick-settings-close

gsettings --schemadir "$ROOT/schemas" \
    set org.gnome.shell.extensions.win11-taskbar alignment left
sleep 2
shot 13-left-aligned
gsettings --schemadir "$ROOT/schemas" \
    set org.gnome.shell.extensions.win11-taskbar alignment center
gsettings set org.gnome.desktop.interface color-scheme default

"$ROOT/tools/testbed.sh" stop >/dev/null
echo "done"
