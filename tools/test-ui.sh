#!/bin/bash
# 完整 UI 回归：只操作 testbed 的独立桌面、总线和配置。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/win11-taskbar-testbed"
trap '"$ROOT/tools/testbed.sh" stop' EXIT

"$ROOT/tools/check.sh"
glib-compile-schemas --strict "$ROOT/schemas"
node "$ROOT/tools/test-semantics.mjs"
node "$ROOT/tools/test-layout-options.mjs"
node "$ROOT/tools/test-ui-lifecycle.mjs"
node "$ROOT/tools/test-peek-state.mjs"
node "$ROOT/tools/test-recommendations.mjs"
node "$ROOT/tools/test-adaptive-layout.mjs"
node "$ROOT/tools/test-mica-target.mjs"
gjs -m "$ROOT/tools/test-recent-documents.js"
gjs -m "$ROOT/tools/test-application-order.js"
"$ROOT/tools/testbed.sh" start
"$ROOT/tools/testbed.sh" apps
"$ROOT/tools/testbed.sh" verify
/usr/bin/python3 "$ROOT/tools/test-taskbar-options.py"
/usr/bin/python3 "$ROOT/tools/test-controls.py"
/usr/bin/python3 "$ROOT/tools/test-dbusmenu-storm.py"
/usr/bin/python3 "$ROOT/tools/test-quick-pages.py"
/usr/bin/python3 "$ROOT/tools/test-quick-edit.py"
/usr/bin/python3 "$ROOT/tools/test-slider-thumb.py"
/usr/bin/python3 "$ROOT/tools/test-tray-overflow.py"
/usr/bin/python3 "$ROOT/tools/test-attention.py"
/usr/bin/python3 "$ROOT/tools/test-input-switch.py"
/usr/bin/python3 "$ROOT/tools/test-start-pins.py"
/usr/bin/python3 "$ROOT/tools/test-layout-functional.py"
/usr/bin/python3 "$ROOT/tools/test-menu-input.py"
/usr/bin/python3 "$ROOT/tools/test-task-input.py"
/usr/bin/python3 "$ROOT/tools/test-preview-travel.py"
/usr/bin/python3 "$ROOT/tools/test-material-input.py"
/usr/bin/python3 "$ROOT/tools/test-tray-late-item.py"
/usr/bin/python3 "$ROOT/tools/test-shell-menu-passthrough.py"
/usr/bin/python3 "$ROOT/tools/test-notification-centre.py"
/usr/bin/python3 "$ROOT/tools/test-wifi-flow.py"
/usr/bin/python3 "$ROOT/tools/test-window-animations.py"
/usr/bin/python3 "$ROOT/tools/test-window-peek.py"
/usr/bin/python3 "$ROOT/tools/test-snap-layouts.py"
/usr/bin/python3 "$ROOT/tools/test-window-frames.py"
/usr/bin/python3 "$ROOT/tools/test-gtk-window-style.py"
/usr/bin/python3 "$ROOT/tools/test-window-mica.py"
/usr/bin/python3 "$ROOT/tools/test-search-recommendations.py"
/usr/bin/python3 "$ROOT/tools/test-adaptive-ui.py"
# 搜索的最后一步把任务栏换到左边，同样会重建任务栏，所以紧挨着换边测试。
/usr/bin/python3 "$ROOT/tools/test-search.py"
# 换边会重建任务栏；放在最后，结束时复位到底边。
/usr/bin/python3 "$ROOT/tools/test-edges.py"

# 与真实偏好服务相同的类型库和异步主循环；memory 后端不改变测试桌面的选择。
LC_ALL=C.UTF-8 GSETTINGS_BACKEND=memory \
GI_TYPELIB_PATH="/usr/lib/gnome-shell/girepository-1.0:/usr/lib/gnome-shell${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}" \
LD_LIBRARY_PATH="/usr/lib/gnome-shell${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
XDG_CONFIG_HOME="$RUN/config" XDG_DATA_HOME="$RUN/data" WAYLAND_DISPLAY=w11test \
DBUS_SESSION_BUS_ADDRESS="$(< "$RUN/bus")" \
timeout 25 gjs -m "$ROOT/tools/test-prefs-ui.js" "$RUN/data/gnome-shell/extensions/win11-taskbar@altarscn.com"

check_log() {
/usr/bin/python3 - "$RUN/shell.log" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
errors = re.findall(r'^.*(?:JS ERROR|Exception in callback|GNOME Shell-CRITICAL|Clutter-CRITICAL|St-CRITICAL|Gjs-CRITICAL).*$', text, re.M)
if errors:
    raise SystemExit('\n'.join(errors))
print('日志检查：没有 JavaScript 异常')
PY
}
check_log
# 包括停用还原和模拟会话结束后的再还原，此脚本会重新启动隔离 Shell。
/usr/bin/python3 "$ROOT/tools/test-shortcuts.py"
check_log
# Shell 退出时整个舞台一起销毁：扩展不能再碰已释放的 GNOME 对象，也不能再写设置。
"$ROOT/tools/testbed.sh" stop >/dev/null
/usr/bin/python3 - "$RUN/shell.log" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
start = text.find('Shutting down GNOME Shell')
if start < 0:
    raise SystemExit('退出检查：日志里没有 Shell 的关闭记录')
errors = re.findall(r'^.*(?:CRITICAL|failed to commit changes to dconf|already owns).*$', text[start:], re.M)
if errors:
    raise SystemExit('\n'.join(errors))
print('退出检查：关闭过程没有报错')
PY
printf '完整 UI 回归结束，0 项失败\n'
