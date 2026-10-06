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
#
# TESTBED_MODE=ubuntu runs the shell in Ubuntu's session mode, with its Yaru
# theme as on the real desktop, and keeps that mode's own extensions off.
#
# TESTBED_MONITOR=3840x2160 TESTBED_SCALE=2 gives the virtual monitor another
# size and a whole-number scale, as on a HiDPI desktop; the defaults are
# 1920x1080 and the scale mutter picks for it. TESTBED_LOGICAL=1 lays the
# monitors out in logical pixels, as GNOME does with its
# scale-monitor-framebuffer feature on (Ubuntu's default): the stage is then
# half the monitor's pixels at scale 2, and what is drawn offscreen is drawn
# at the monitor's own pixels.
#
# TESTBED_ANIMATIONS=1 forces animations on. GNOME switches them off when
# mutter cannot render on the GPU, which a headless shell may not.
#
# TESTBED_LD_LIBRARY_PATH=DIR loads a locally built libmutter into the test
# shell only, so a compositor patch can be tried before it is installed. If
# DIR also has libmutter-clutter-18.so.0, tools/testbed-dlopen.c is built
# and preloaded so GObject introspection does not load the installed one
# beside it.

set -u
UUID=win11-taskbar@altarscn.com
ROOT="${WIN11_TASKBAR_TEST_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
USER_RUNTIME="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
RUN="$USER_RUNTIME/win11-taskbar-testbed"
# The test session's own runtime directory. GNOME Shell keeps a file there,
# gnome-shell-disable-extensions, for the first minute after it starts; if
# the session's shell fails while the file is there, systemd switches every
# user extension off. A test shell started in the user's runtime directory
# put the file in the way of the real session's logout — and the next login
# came up with all extensions disabled. The whole test session lives in it,
# its bus and the dconf service that bus starts included: dconf tells its
# readers that a value changed through a file in the runtime directory, so
# a shell and a dconf service apart would not see each other's writes.
# PipeWire is still the user's, as before — the screencast tests record
# through it — while the sound server's socket stays out of reach.
XDG_PRIVATE="$RUN/xdg"
DISPLAY_NAME=w11test
BUS=org.gnome.Shell.Extensions.Win11Taskbar
OBJ=/org/gnome/Shell/Extensions/Win11Taskbar

mkdir -p "$RUN/config/cache"
mkdir -p -m 700 "$XDG_PRIVATE"

session_env() {
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    export XDG_CONFIG_HOME="$RUN/config"
    export XDG_CACHE_HOME="$RUN/config/cache"
    export XDG_DATA_HOME="$RUN/data"
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
    if [ -s "$RUN/app-pids" ]; then
        while read -r pid; do
            case "$(readlink "/proc/$pid/exe" 2>/dev/null)" in
                */gjs|*/gnome-text-editor|*/gnome-calculator)
                    if grep -azFxq "XDG_CONFIG_HOME=$RUN/config" "/proc/$pid/environ" 2>/dev/null; then
                        kill -TERM "$pid" 2>/dev/null || true
                    fi ;;
            esac
        done < "$RUN/app-pids"
        rm -f "$RUN/app-pids"
    fi
    if [ -s "$RUN/pid" ]; then
        local pgid shell
        pgid="$(cat "$RUN/pid")"
        # The shell goes first, as at logout, while its session bus is still
        # there; a bus that goes with it cuts its shutdown short.
        shell="$(pgrep -g "$pgid" -x gnome-shell | head -1)"
        if [ -n "$shell" ]; then
            kill -TERM "$shell" 2>/dev/null
            for _ in $(seq 1 20); do
                kill -0 "$shell" 2>/dev/null || break
                sleep 0.5
            done
        fi
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
    local sock="$XDG_PRIVATE/$DISPLAY_NAME"
    if [ -e "$sock" ] && ! fuser "$sock" >/dev/null 2>&1; then
        rm -f "$sock" "$sock.lock"
    fi
    # The link clients find the socket by, in the user's runtime directory —
    # and a socket left there by a test shell from before it had its own.
    local link="$USER_RUNTIME/$DISPLAY_NAME"
    if [ -L "$link" ]; then
        rm -f "$link"
    elif [ -S "$link" ] && ! fuser "$link" >/dev/null 2>&1; then
        rm -f "$link" "$link.lock"
    fi
}

do_start() {
    do_stop
    # 测试自己的扩展目录也隔离，既不切换真实安装，也不读取真实最近文档。
    local target="$RUN/data/gnome-shell/extensions/$UUID"
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        printf 'test extension path is not a symlink: %s\n' "$target"
        return 1
    fi
    mkdir -p "$(dirname "$target")"
    ln -sfn "$ROOT" "$target"
    glib-compile-schemas "$ROOT/schemas" || return 1

    local preload="" mode_arg="" disabled="[]"
    if [ -n "${TESTBED_MODE:-}" ]; then
        mode_arg="--mode=$TESTBED_MODE"
        # 该模式默认启用的扩展（Dock、AppIndicator 等）在测试里一律关掉。
        disabled="$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])).get("enabledExtensions", [])).replace(chr(34), chr(39)))' \
            "/usr/share/gnome-shell/modes/$TESTBED_MODE.json")" || return 1
    fi
    if [ -n "${TESTBED_LD_LIBRARY_PATH:-}" ] &&
       [ -e "$TESTBED_LD_LIBRARY_PATH/libmutter-clutter-18.so.0" ]; then
        # 用系统 gcc：PATH 里的 cc 可能是别的工具。
        /usr/bin/gcc -shared -fPIC -O2 -o "$RUN/testbed-dlopen.so" \
            "$ROOT/tools/testbed-dlopen.c" -ldl || return 1
        preload="export TESTBED_CLUTTER=\"$TESTBED_LD_LIBRARY_PATH/libmutter-clutter-18.so.0\" LD_PRELOAD=\"$RUN/testbed-dlopen.so\""
    fi

    local features='[]'
    [ -n "${TESTBED_LOGICAL:-}" ] && features="['scale-monitor-framebuffer']"
    cat > "$RUN/inner.sh" <<INNER
#!/bin/bash
printf '%s' "\$DBUS_SESSION_BUS_ADDRESS" > "$RUN/bus"
gsettings set org.gnome.shell disable-user-extensions false
# 清除上一轮禁用测试留下的记录；只修改隔离测试配置。
gsettings set org.gnome.shell disabled-extensions "$disabled"
gsettings set org.gnome.shell enabled-extensions "['$UUID']"
gsettings set org.gnome.desktop.interface scaling-factor ${TESTBED_SCALE:-0}
gsettings set org.gnome.mutter experimental-features "$features"
gsettings --schemadir "$ROOT/schemas" set \
    org.gnome.shell.extensions.win11-taskbar debug-service true
${TESTBED_LD_LIBRARY_PATH:+export LD_LIBRARY_PATH="$TESTBED_LD_LIBRARY_PATH"}
$preload
exec gnome-shell --headless --virtual-monitor ${TESTBED_MONITOR:-1920x1080} \
    --wayland-display $DISPLAY_NAME $mode_arg${TESTBED_ANIMATIONS:+ --force-animations}
INNER
    chmod +x "$RUN/inner.sh"

    session_env
    unset DBUS_SESSION_BUS_ADDRESS
    XDG_RUNTIME_DIR="$XDG_PRIVATE" PIPEWIRE_RUNTIME_DIR="$USER_RUNTIME" \
        setsid dbus-run-session -- bash "$RUN/inner.sh" > "$RUN/shell.log" 2>&1 &
    echo $! > "$RUN/pid"

    echo -n "waiting for the shell"
    for _ in $(seq 1 60); do
        if [ -s "$RUN/bus" ]; then
            session_env
            if timeout 5 gdbus introspect --session --dest "$BUS" \
                 --object-path "$OBJ" >/dev/null 2>&1; then
                # Clients look for the display in the user's runtime
                # directory, as before.
                ln -sfn "$XDG_PRIVATE/$DISPLAY_NAME" "$USER_RUNTIME/$DISPLAY_NAME"
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
    # 不恢复真实用户的编辑器标签或草稿，且记录自己启动的独立进程供 stop 回收。
    mkdir -p "$RUN/app-data"
    start_app() {
        setsid "$@" >/dev/null 2>&1 &
        printf '%s\n' "$!" >> "$RUN/app-pids"
    }
    command -v gnome-text-editor >/dev/null && \
        start_app env XDG_DATA_HOME="$RUN/app-data" gnome-text-editor --standalone
    command -v gnome-calculator >/dev/null && \
        start_app env XDG_DATA_HOME="$RUN/app-data" gnome-calculator
    start_app gjs -m "$ROOT/tools/fake-tray-item.js" tray-alpha dialog-information-symbolic
    start_app gjs -m "$ROOT/tools/fake-tray-item.js" tray-beta mail-unread-symbolic
    sleep 10
    echo "launched test apps and tray items" ;;
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
