#!/usr/bin/python3
"""防止 AboutToShow→LayoutUpdated→AboutToShow 风暴；仅操作隔离 Shell。"""
import importlib.util
import json
import os
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
               XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
    process = subprocess.Popen(['gjs', '-m', str(HERE / 'fake-tray-item.js'), 'tray-storm',
                                'dialog-information-symbolic', '--notify-about'], env=env,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def call(name, path, iface, method, args):
        return shell.conn.call_sync(name, path, iface, method, args, None,
                                    ctx.Gio.DBusCallFlags.NONE, 3000, None).unpack()

    def dump():
        return json.loads(call(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None)[0])['bars'][0]

    try:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            items = dump()['tray']['icons']
            icon = next((i for i in items if i['id'] == 'tray-storm'), None)
            if icon:
                break
            time.sleep(.1)
        else:
            raise AssertionError('测试托盘项没有注册')
        shell.trigger('windows')
        shell.pointer([{'move': [960, 540]}, {'wait': 250}])
        time.sleep(1)
        icon = next(i for i in dump()['tray']['icons'] if i['id'] == 'tray-storm')
        shell.pointer([{'move': [icon['x'] + icon['w'] / 2, icon['y'] + 24]},
                       {'wait': 60}, {'press': 3}, {'wait': 100}, {'release': 3}, {'wait': 400}])
        time.sleep(2)
        watcher = 'org.kde.StatusNotifierWatcher'
        services = call(watcher, '/StatusNotifierWatcher', 'org.freedesktop.DBus.Properties', 'Get',
                        ctx.GLib.Variant('(ss)', (watcher, 'RegisteredStatusNotifierItems')))[0]
        for service in services:
            name, path = service.split('/', 1)
            props = call(name, '/' + path, 'org.freedesktop.DBus.Properties', 'GetAll',
                         ctx.GLib.Variant('(s)', ('org.kde.StatusNotifierItem',)))[0]
            if props['Id'] == 'tray-storm':
                about, layouts = props['TestAboutCount'], props['TestLayoutCount']
                assert 1 <= about <= 3, (about, layouts)
                assert layouts <= 6, (about, layouts)
                print(f'菜单自身发出 LayoutUpdated 不会触发刷新风暴：AboutToShow={about}，GetLayout={layouts}；0 项失败')
                break
        else:
            raise AssertionError('未找到测试统计')
    finally:
        process.terminate()
        try:
            process.wait(timeout=4)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


if __name__ == '__main__':
    main()
