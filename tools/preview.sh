#!/bin/bash
# preview.sh — run the taskbar in a nested GNOME Shell window you can click.
#
# Wayland only scans for new extensions at login, so there is no way to load
# this into a running session without logging out. A nested shell sidesteps
# that: it opens as an ordinary window on your desktop, runs its own copy of
# GNOME Shell with only this extension enabled, and leaves your real session
# completely alone.
#
# Your dconf is copied into the sandbox, so the pinned apps, theme and clock
# format are yours — but changes made inside the preview stay inside it.
#
#   tools/preview.sh [WIDTHxHEIGHT]   start it (default 1920x1080)
#   tools/preview.sh stop             close it
#   tools/preview.sh log              what it printed
#
# Inside the window: the taskbar is at the bottom. Click Start, hover a
# running app for a thumbnail, right-click for a jump list. Close the window
# (or run `stop`) when you are done.

set -u
UUID=win11-taskbar@altarscn.com
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/win11-taskbar-preview"
DISPLAY_NAME=w11preview

mkdir -p "$RUN/config"

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
    local sock="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/$DISPLAY_NAME"
    if [ -e "$sock" ] && ! fuser "$sock" >/dev/null 2>&1; then
        rm -f "$sock" "$sock.lock"
    fi
}

case "${1:-start}" in
  stop) do_stop; echo "preview closed"; exit 0 ;;
  log)  grep -v '^DING' "$RUN/shell.log" 2>/dev/null | tail -"${2:-40}"; exit 0 ;;
  apps)
    [ -s "$RUN/bus" ] || { echo "no preview running"; exit 1; }
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_CONFIG_HOME="$RUN/config"
    export DBUS_SESSION_BUS_ADDRESS="$(cat "$RUN/bus")"
    export WAYLAND_DISPLAY="$DISPLAY_NAME"
    unset DISPLAY
    for app in "${@:2}"; do
        setsid "$app" >/dev/null 2>&1 &
    done
    if [ $# -le 1 ]; then
        for app in gnome-text-editor gnome-calculator nautilus; do
            command -v "$app" >/dev/null && setsid "$app" >/dev/null 2>&1 &
        done
        setsid gjs -m "$ROOT/tools/fake-tray-item.js" \
            preview-tray dialog-information-symbolic >/dev/null 2>&1 &
    fi
    sleep 3
    echo "launched inside the preview"
    exit 0 ;;
esac

SIZE="${1:-1920x1080}"
case "$SIZE" in
  *x*) ;;
  *) echo "usage: $0 [WIDTHxHEIGHT | stop | log]"; exit 2 ;;
esac

# A nested shell needs a host compositor to open its window on.
HOST_WAYLAND="${WAYLAND_DISPLAY:-wayland-0}"
if [ ! -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/$HOST_WAYLAND" ]; then
    echo "no host Wayland display at $HOST_WAYLAND — run this from inside"
    echo "your graphical session, or set WAYLAND_DISPLAY."
    exit 1
fi

do_stop

target="$HOME/.local/share/gnome-shell/extensions/$UUID"
[ -e "$target" ] || ln -sfn "$ROOT" "$target"
glib-compile-schemas "$ROOT/schemas" || exit 1

# Start from a copy of the real dconf so the preview looks like your desktop,
# then override only what the preview needs. Copying rather than sharing is
# the point: nothing done in here reaches the real session.
mkdir -p "$RUN/config/dconf"
if [ -f "$HOME/.config/dconf/user" ]; then
    cp -f "$HOME/.config/dconf/user" "$RUN/config/dconf/user"
fi

cat > "$RUN/inner.sh" <<INNER
#!/bin/bash
printf '%s' "\$DBUS_SESSION_BUS_ADDRESS" > "$RUN/bus"
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
exec gnome-shell --wayland --wayland-display $DISPLAY_NAME
INNER
chmod +x "$RUN/inner.sh"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export XDG_CONFIG_HOME="$RUN/config"
export XDG_CACHE_HOME="$RUN/config/cache"
export WAYLAND_DISPLAY="$HOST_WAYLAND"
export MUTTER_DEBUG_DUMMY_MODE_SPECS="$SIZE"
unset DISPLAY

setsid dbus-run-session -- bash "$RUN/inner.sh" > "$RUN/shell.log" 2>&1 &
echo $! > "$RUN/pid"

echo -n "opening a $SIZE preview window"
for _ in $(seq 1 40); do
    if [ -S "$XDG_RUNTIME_DIR/$DISPLAY_NAME" ]; then
        echo " ok"
        echo
        echo "A nested GNOME Shell window should now be on your desktop."
        echo "Only $UUID is enabled in it; your real session is untouched."
        echo
        echo "To launch something inside it so task buttons appear:"
        echo "  tools/preview.sh apps"
        echo "To close it:  tools/preview.sh stop"
        exit 0
    fi
    echo -n .
    sleep 1
done
echo " timed out"
grep -v '^DING' "$RUN/shell.log" | tail -20
exit 1
