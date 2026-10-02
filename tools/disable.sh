#!/bin/bash
# disable.sh — undo tools/enable.sh.
set -u
UUID=win11-taskbar@altarscn.com
STATE="${XDG_CONFIG_HOME:-$HOME/.config}/win11-taskbar-disabled"

gnome-extensions disable "$UUID" && echo "disabled $UUID"

if [ -s "$STATE" ]; then
    while read -r ext; do
        [ -n "$ext" ] && gnome-extensions enable "$ext" && echo "re-enabled $ext"
    done < "$STATE"
    rm -f "$STATE"
else
    echo "nothing recorded to restore"
fi
