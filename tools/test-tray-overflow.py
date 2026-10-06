#!/usr/bin/python3
"""托盘的闪烁图标与“隐藏的图标”浮层；只在隔离 testbed 中运行，只用测试自己发布的假托盘项。

假托盘项每 300 ms 换一次图标（与微信有未读消息时一样）：悬停打开的程序菜单不能跟着
一开一合。“隐藏的图标”浮层是轻触即关的：点别处收起，而这一下照样落到点中的东西上——
点任务按钮会切到那个应用；按 Esc 收起；再点箭头只收起不重开。浮层开着时箭头顺时针转过
半圈、指回任务栏，浮层收完才转回来。
"""
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

ID = 'tray-blink'


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    keys = ['tray-hover', 'tray-hidden-items']
    saved = {k: subprocess.check_output(command + ['get', schema, k], env=env, text=True).strip() for k in keys}
    count = 0

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)
        time.sleep(0.2)

    def full():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                 ctx.GLib.VariantType('(s)'), ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def dump():
        return full()['bars'][0]

    def icon():
        return next(i for i in dump()['tray']['icons'] if i['id'] == ID)

    def check(label, predicate, timeout=8):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (StopIteration, KeyError, TypeError):
                pass
            time.sleep(0.05)
        raise AssertionError(label)

    def point(rect):
        return [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]

    def click(rect, button=1):
        shell.pointer([{'move': point(rect)}, {'wait': 80}, {'press': button},
                       {'wait': 80}, {'release': button}, {'wait': 350}])

    def escape():
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 50}, {'release': 0xff1b}]))
        time.sleep(0.4)

    item_env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=shell.address)
    item_env.pop('DISPLAY', None)
    item = subprocess.Popen(['gjs', '-m', str(HERE / 'fake-tray-item.js'), ID,
                             'dialog-information-symbolic', '--blink'], env=item_env,
                            start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with open(Path(ctx.RUN, 'app-pids'), 'a') as pids:
        pids.write(f'{item.pid}\n')
    try:
        setting('tray-hover', "'menu'")
        setting('tray-hidden-items', '[]')
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 300}])
        shell.pointer([{'move': [960, 520]}, {'wait': 300}])
        check('闪烁的假托盘项已出现在任务栏', lambda: icon()['visible'])

        shell.pointer([{'move': point(icon())}, {'wait': 700}])
        check('悬停打开程序菜单', lambda: icon()['menuOpen'])
        glyphs, closed = set(), 0
        end = time.monotonic() + 2
        while time.monotonic() < end:
            state = icon()
            glyphs.add(state['gicon'])
            closed += not state['menuOpen']
            time.sleep(0.04)
        assert len(glyphs) >= 2, glyphs
        assert closed == 0, f'菜单在图标闪烁时关了 {closed} 次'
        count += 1
        print('ok 图标闪烁两秒，悬停菜单始终开着，不再一开一合', flush=True)
        shell.pointer([{'move': [960, 500]}, {'wait': 700}])
        check('移开后菜单按宽限期关闭', lambda: not icon()['menuOpen'])

        setting('tray-hover', "'none'")
        setting('tray-hidden-items', f"['{ID}']")
        check('折叠后出现箭头', lambda: dump()['tray']['chevronVisible'])
        # Clicking the focused app minimises it, as on Windows: start from
        # whichever single-window app has the focus, or give it to one.
        buttons = [b for b in dump()['buttons'] if b['windows'] == 1]
        first = next((b for b in buttons if b['id'] == full()['focusApp']), None)
        if first is None:
            first = buttons[0]
            click(first)
        check('先有一个应用在前台', lambda: full()['focusApp'] == first['id'])
        second = next(b for b in buttons if b['id'] != first['id'])

        def turned_back(label):
            # 浮层还看得见时箭头仍指回任务栏；收完之后才转回原样。
            end = time.monotonic() + 3
            while time.monotonic() < end:
                tray = dump()['tray']
                assert not (tray['overflowVisible'] and tray['chevronTurn'] < 180), tray['chevronTurn']
                if not tray['overflowVisible'] and tray['chevronTurn'] == 0:
                    break
                time.sleep(0.02)
            check(label, lambda: not dump()['tray']['overflowVisible'] and dump()['tray']['chevronTurn'] == 0)

        assert dump()['tray']['chevronTurn'] == 0, dump()['tray']['chevronTurn']
        click(dump()['tray']['chevron'])
        check('点箭头打开隐藏的图标', lambda: dump()['tray']['overflowOpen'] and icon()['visible'])
        check('箭头顺时针转过半圈，指回任务栏', lambda: dump()['tray']['chevronTurn'] == 180)
        before = icon()['y']
        time.sleep(1.2)
        check('图标在浮层里闪烁，浮层保持打开、图标不挪位', lambda: dump()['tray']['overflowOpen'] and
              icon()['y'] == before)
        click(second)
        check('点别处的任务按钮：浮层收起', lambda: not dump()['tray']['overflowOpen'])
        turned_back('浮层收完，箭头才转回原样')
        check('这一下照样落到任务按钮上，切到了那个应用', lambda: full()['focusApp'] == second['id'])

        click(dump()['tray']['chevron'])
        check('再次打开', lambda: dump()['tray']['overflowOpen'])
        check('再次打开时箭头又转过去', lambda: dump()['tray']['chevronTurn'] == 180)
        escape()
        check('Esc 收起', lambda: not dump()['tray']['overflowOpen'])
        turned_back('Esc 收起后箭头转回')

        click(dump()['tray']['chevron'])
        check('又一次打开', lambda: dump()['tray']['overflowOpen'])
        click(dump()['tray']['chevron'])
        time.sleep(0.5)
        check('再点箭头只收起，不会立刻重开', lambda: not dump()['tray']['overflowOpen'])
        check('收起后浮层不可见，不留下挡点击的透明区', lambda: not dump()['tray']['overflowVisible'])
        turned_back('再点箭头收起后箭头转回')
    finally:
        for key, value in saved.items():
            setting(key, value)
        item.terminate()
        try:
            item.wait(3)
        except subprocess.TimeoutExpired:
            item.kill()
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项托盘闪烁与隐藏图标浮层检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
