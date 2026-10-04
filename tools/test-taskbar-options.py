#!/usr/bin/python3
"""设置、右键空白区、悬停菜单与折叠；仅使用隔离 testbed 的配置和总线。"""
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
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    keys = ['start-layout', 'start-folders', 'tray-hover', 'tray-hidden-items']
    saved = {k: subprocess.check_output(command + ['get', schema, k], env=env, text=True).strip() for k in keys}
    count = 0

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)
        time.sleep(0.2)

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                 ctx.GLib.VariantType('(s)'), ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def check(label, predicate):
        nonlocal count
        end = time.monotonic() + 8
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.05)
        raise AssertionError(label)

    def point(rect):
        return [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]

    def click(rect, button=1):
        shell.pointer([{'move': point(rect)}, {'wait': 80}, {'press': button},
                       {'wait': 80}, {'release': button}, {'wait': 300}])

    def icon():
        return next(i for i in dump()['tray']['icons'] if i['id'] == 'tray-alpha')

    def escape():
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 50}, {'release': 0xff1b}]))
        time.sleep(0.3)

    try:
        setting('tray-hover', "'none'")
        setting('tray-hidden-items', '[]')
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 500}])
        time.sleep(1)
        bar = dump()
        tray, system, clock, desktop = (bar[k] for k in ['tray', 'systemIndicators', 'clock', 'showDesktop'])
        assert system['x'] - tray['x'] - tray['w'] == 4
        assert clock['x'] - system['x'] - system['w'] == 8
        assert desktop['x'] - clock['x'] - clock['w'] == 4
        count += 1
        print('ok 右侧组间留白为实测的 4/8/4px', flush=True)

        setting('start-layout', "'compact'")
        setting('start-folders', "['files', 'settings']")
        click(bar['startButton'])
        check('默认紧凑菜单为 640×720、六列', lambda: dump()['startMenu']['w'] == 640 and
              dump()['startMenu']['h'] == 720 and dump()['startMenu']['layout']['columns'] == 6)
        check('Resources 不再是强制的开始菜单入口', lambda: [b['name'] for b in
              dump()['startMenu']['folderButtons']] == ['File Explorer', 'Settings'])
        setting('start-folders', "['downloads', 'resources']")
        check('底部入口选择即时更新', lambda: [b['name'] for b in
              dump()['startMenu']['folderButtons']] == ['Downloads', 'Task Manager'])
        setting('start-layout', "'wide'")
        check('可切换八列 Insider 布局', lambda: dump()['startMenu']['w'] == 832 and
              dump()['startMenu']['layout']['columns'] == 8)
        escape()

        empty = {'x': 110, 'y': bar['panel']['y'] + 12, 'w': 1, 'h': 1}
        shell.pointer([{'move': point(empty)}, {'wait': 60}, {'press': 3}, {'wait': 600}])
        assert not dump()['taskbarMenu']['open']
        shell.pointer([{'release': 3}, {'wait': 300}])
        check('空白处右键在松开后才出现两项菜单', lambda: dump()['taskbarMenu']['open'] and
              [i['label'] for i in dump()['taskbarMenu']['items']] == ['Task Manager', 'Taskbar settings'])
        first_x = dump()['taskbarMenu']['x']
        other = dict(empty, x=400)
        click(other, 3)
        check('再右键可在新位置直接打开菜单', lambda: dump()['taskbarMenu']['open'] and
              dump()['taskbarMenu']['x'] > first_x + 100)
        escape()
        start = dump()['startButton']
        click(start, 3)
        check('开始按钮仍保留自己的 Win+X 菜单', lambda: dump()['quickLinks']['open'] and
              not dump()['taskbarMenu']['open'])
        escape()

        setting('tray-hover', "'tooltip'")
        shell.pointer([{'move': point(icon())}, {'wait': 650}])
        check('托盘提示实际可见，而非只有 accessible_name', lambda: icon()['tooltip'] is not None and
              icon()['tooltip']['visible'] and not icon()['menuOpen'])
        shell.pointer([{'move': [1300, 500]}, {'wait': 250}])
        check('离开即清掉提示', lambda: icon()['tooltip'] is None)
        setting('tray-hover', "'menu'")
        shell.pointer([{'move': point(icon())}, {'wait': 650}])
        check('悬停打开程序提供的 DBusMenu', lambda: icon()['menuOpen'] and
              'First entry' in [i['label'] for i in icon()['menuItems']])
        check('异步刷新不会丢掉折叠操作', lambda: sum(i['label'] == 'Hide icon' for i in icon()['menuItems']) == 1)
        shell.pointer([{'move': [1300, 500]}, {'wait': 350}])
        check('离开图标及菜单后按宽限期关闭', lambda: not icon()['menuOpen'])
        setting('tray-hover', "'none'")
        shell.pointer([{'move': point(icon())}, {'wait': 650}])
        check('悬停关闭模式不弹任何东西', lambda: not icon()['menuOpen'] and icon()['tooltip'] is None)
        click(icon(), 3)
        check('关闭悬停不影响右键程序菜单', lambda: icon()['menuOpen'])
        hide = next(i for i in icon()['menuItems'] if i['label'] == 'Hide icon')
        click(hide)
        check('菜单中的折叠操作生效且显示箭头', lambda: dump()['tray']['chevronVisible'])
        click(dump()['tray']['chevron'])
        check('折叠图标可从溢出层使用', lambda: dump()['tray']['overflowVisible'] and icon()['visible'] and
              icon()['y'] < bar['panel']['y'])
        setting('tray-hidden-items', '[]')
        check('溢出层打开时展开图标也可正确重新归属', lambda: not dump()['tray']['chevronVisible'] and
              icon()['y'] == bar['panel']['y'])
        assert 'JS ERROR' not in Path(ctx.RUN, 'shell.log').read_text()
        print(f'{count} 项设置与任务栏交互检查通过，0 项失败', flush=True)
    finally:
        for key, value in saved.items():
            setting(key, value)
        shell.trigger('start-menu-close')
        shell.pointer([{'move': [960, 500]}, {'wait': 300}])


if __name__ == '__main__':
    main()
