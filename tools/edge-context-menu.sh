#!/bin/bash
# Make Microsoft Edge open a page's context menu on mouse-up, as on Windows.
#
#   tools/edge-context-menu.sh install      # every installed Edge channel
#   tools/edge-context-menu.sh uninstall
#   tools/edge-context-menu.sh status
#
# Blink opens a page's context menu on mouse-down everywhere but Windows.
# The difference is one Blink setting, showContextMenuOnMouseUp, which
# --blink-settings turns on; Edge has no policy or preference for it. The
# same setting is what lets Edge's mouse gestures start on Linux: a menu
# that opens on mouse-down takes the pointer before a gesture can begin.
# tools/test-edge-context-menu.py shows both, in the test shell.
#
# Every way Edge starts — its desktop files, PWA shortcuts, xdg-open, the
# terminal, the microsoft-edge alternative — goes through the channel's
# launcher script, so the switch goes there. dpkg-divert moves Edge's
# launcher to <name>.real and a three-line wrapper takes its place; Edge's
# upgrades then update <name>.real and leave the wrapper alone. The wrapper
# sources the real launcher instead of running it, so the launcher still
# sees its usual path in $0 and hands that to Edge as CHROME_WRAPPER, which
# Edge uses to relaunch itself and in the shortcuts it writes.
#
# Not covered: the browser's own chrome. Menus on tabs, the toolbar and
# bookmarks are views menus, compiled to open on press except on Windows,
# with no switch.
set -euo pipefail

FLAG='--blink-settings=showContextMenuOnMouseUp=true'
MARK='win11-taskbar: context menus on mouse-up'

launchers() {
    local f
    for f in /opt/microsoft/msedge*/microsoft-edge*; do
        [[ $f == *.real || -L $f ]] && continue
        [[ -f $f ]] && [[ $(head -c 2 "$f") == '#!' ]] && echo "$f"
    done
}

install_one() {
    local f=$1
    if grep -q "$MARK" "$f"; then
        echo "already wrapped: $f"
        return
    fi
    sudo dpkg-divert --local --rename --divert "$f.real" --add "$f"
    sudo tee "$f" >/dev/null <<WRAPPER
#!/bin/bash
# $MARK. dpkg-divert moved Edge's launcher to
# $f.real; see tools/edge-context-menu.sh in win11-taskbar.
set -- $FLAG "\$@"
. $f.real
WRAPPER
    sudo chmod 755 "$f"
    echo "wrapped: $f"
}

uninstall_one() {
    local f=$1
    if ! grep -q "$MARK" "$f"; then
        echo "not wrapped: $f"
        return
    fi
    sudo rm "$f"
    sudo dpkg-divert --local --rename --remove "$f"
    echo "restored: $f"
}

case "${1:-status}" in
install)
    for f in $(launchers); do install_one "$f"; done ;;
uninstall)
    for f in $(launchers); do uninstall_one "$f"; done ;;
status)
    for f in $(launchers); do
        if grep -q "$MARK" "$f"; then echo "wrapped:     $f"; else echo "not wrapped: $f"; fi
    done
    dpkg-divert --list | grep -i 'msedge' || true
    # The running browser only has the switch if it was started after install.
    for pid in $(pgrep -f '/opt/microsoft/msedge[^ ]*/msedge( |$)' | head -20); do
        if tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- '--type='; then continue; fi
        if tr '\0' '\n' < "/proc/$pid/cmdline" | grep -qx -- "$FLAG"; then
            echo "running browser $pid: has the switch"
        else
            echo "running browser $pid: started before install — quit Edge fully and start it again"
        fi
    done ;;
*)
    echo "usage: $0 install|uninstall|status" >&2; exit 2 ;;
esac
