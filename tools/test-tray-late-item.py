#!/usr/bin/python3
"""托盘项先注册、后导出，且图标放在 IconThemePath 私有目录（Chromium/Edge 的做法）。

只在隔离 Shell 中运行：图标必须是那张 PNG，名字取提示文字，不能是总线名。
"""
import importlib.util
import json
import os
import signal
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)


def main():
    shell = ctx.Shell()
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=shell.address,
               XDG_CONFIG_HOME=os.path.join(ctx.RUN, 'config'))
    proc = subprocess.Popen(['gjs', '-m', str(HERE / 'fake-tray-item.js'), 'chrome_status_icon_1',
                             'status_icon_0', '--late', '--theme-path'],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            start_new_session=True)
    count = 0

    def tray_item():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 5000, None)
        icons = json.loads(r.unpack()[0])['bars'][0]['tray']['icons']
        return next((icon for icon in icons if icon['id'] == 'chrome_status_icon_1'), None)

    def check(label, predicate, timeout=10):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.2)
        raise AssertionError(f'{label}: {tray_item()}')

    try:
        check('晚导出的托盘项最终读到图标', lambda: (tray_item() or {}).get('gicon') and
              'status_icon_0.png' in tray_item()['gicon'])
        check('名称取提示文字，不是总线名', lambda: (tray_item() or {}).get('name') == 'Fake Chromium')
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(5)
    print(f'{count} 项托盘晚注册检查通过，0 项失败')


if __name__ == '__main__':
    main()
