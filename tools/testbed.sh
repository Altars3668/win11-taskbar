#!/bin/bash
# testbed.sh — run the extension in a throwaway GNOME Shell and check it.
#
# Starts a headless shell on a 1920x1080 virtual monitor — the same size as
# the Windows machine the measurements came from — with its own D-Bus and its
# own XDG_CONFIG_HOME, so nothing here touches the real session. Only this
# extension is enabled.
#
#   tools/testbed.sh start     bring the shell up
#   tools/testbed.sh verify    run the geometry checks against it
#   tools/testbed.sh shot FILE grab the screen
#   tools/testbed.sh apps      launch a couple of apps so buttons appear
#   tools/testbed.sh log       show the shell log, minus DING noise
#   tools/testbed.sh stop      tear it down
#   tools/testbed.sh all       start, launch apps, verify, stop

set -u
UUID=win11-taskbar@altarscn.com
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/win11-taskbar-testbed"
DISPLAY_NAME=w11test
BUS=org.gnome.Shell.Extensions.Win11Taskbar
OBJ=/org/gnome/Shell/Extensions/Win11Taskbar

mkdir -p "$RUN/config/cache"

session_env() {
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_CONFIG_HOME="$RUN/config"
    export XDG_CACHE_HOME="$RUN/config/cache"
    export WAYLAND_DISPLAY="$DISPLAY_NAME"
    unset DISPLAY
    [ -s "$RUN/bus" ] && export DBUS_SESSION_BUS_ADDRESS="$(cat "$RUN/bus")"
}

# Kill only the shell we started. Matching on the command line would also
# match this script, so go through the pid file. setsid put the whole thing
# in its own process group, so signal the group: killing dbus-run-session
# alone leaves the shell it spawned running, which then keeps the Wayland
# socket locked and blocks the next run.
do_stop() {
    if [ -s "$RUN/pid" ]; then
        local pgid
        pgid="$(cat "$RUN/pid")"
        kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pgid" 2>/dev/null
        for _ in $(seq 1 10); do
            kill -0 -- "-$pgid" 2>/dev/null || break
            sleep 1
        done
        kill -KILL -- "-$pgid" 2>/dev/null
    fi
    rm -f "$RUN/pid" "$RUN/bus"

    # A shell that died badly can leave the socket behind; without clearing
    # it mutter refuses to start with "unable to lock lockfile".
    local sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/$DISPLAY_NAME"
    if [ -e "$sock" ] && ! fuser "$sock" >/dev/null 2>&1; then
        rm -f "$sock" "$sock.lock"
    fi
}

do_start() {
    do_stop
    # The extension must be installed (or symlinked) where the shell looks.
    local target="$HOME/.local/share/gnome-shell/extensions/$UUID"
    if [ ! -e "$target" ]; then
        mkdir -p "$(dirname "$target")"
        ln -sfn "$ROOT" "$target"
        echo "linked $target -> $ROOT"
    fi
    glib-compile-schemas "$ROOT/schemas" || return 1

    cat > "$RUN/inner.sh" <<INNER
#!/bin/bash
printf '%s' "\$DBUS_SESSION_BUS_ADDRESS" > "$RUN/bus"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings --schemadir "$ROOT/schemas" set \
    org.gnome.shell.extensions.win11-taskbar debug-service true
exec gnome-shell --headless --virtual-monitor 1920x1080 \
    --wayland-display $DISPLAY_NAME
INNER
    chmod +x "$RUN/inner.sh"

    session_env
    unset DBUS_SESSION_BUS_ADDRESS
    setsid dbus-run-session -- bash "$RUN/inner.sh" > "$RUN/shell.log" 2>&1 &
    echo $! > "$RUN/pid"

    echo -n "waiting for the shell"
    for _ in $(seq 1 60); do
        if [ -s "$RUN/bus" ]; then
            session_env
            if timeout 5 gdbus introspect --session --dest "$BUS" \
                 --object-path "$OBJ" >/dev/null 2>&1; then
                echo " ok"
                return 0
            fi
        fi
        echo -n .
        sleep 2
    done
    echo " timed out"
    tail -20 "$RUN/shell.log" | grep -v '^DING'
    return 1
}

case "${1:-all}" in
  start)  do_start ;;
  stop)   do_stop; echo stopped ;;
  apps)
    session_env
    for app in gnome-text-editor gnome-calculator; do
        command -v "$app" >/dev/null && setsid "$app" >/dev/null 2>&1 &
    done
    sleep 10
    echo "launched test apps" ;;
  verify)
    session_env
    python3 "$ROOT/tools/verify-geometry.py" ;;
  shot)
    session_env
    timeout 25 gdbus call --session --dest "$BUS" --object-path "$OBJ" \
        --method "$BUS.Screenshot" "${2:-$RUN/shot.png}" >/dev/null && \
        sleep 2 && echo "saved ${2:-$RUN/shot.png}" ;;
  dump)
    session_env
    timeout 25 gdbus call --session --dest "$BUS" --object-path "$OBJ" \
        --method "$BUS.DumpGeometry" ;;
  log)
    grep -v '^DING' "$RUN/shell.log" | tail -"${2:-40}" ;;
  errors)
    grep -A4 'JS ERROR' "$RUN/shell.log" | grep -v '^DING' | head -40
    echo "(no output above means no JS errors)" ;;
  all)
    do_start || exit 1
    "$0" apps
    "$0" errors
    "$0" verify
    rc=$?
    do_stop
    exit $rc ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
