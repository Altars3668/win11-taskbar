#!/usr/bin/python3
"""Shell 菜单或弹层开着时右键别处：菜单关闭，这一下右键仍送到落点。

只在隔离 testbed 中运行。落点是应用窗口（桌面图标也是一个应用窗口）时，
合成器会把松开直接交给窗口，扩展等不到它；这里检查窗口在同一下右键里
收到完整的按下与松开、弹出自己的菜单，之后也没有残留的按键状态。
"""
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

# 在居中的开始菜单和右侧通知中心之外，落在全屏的探针窗口上。
AT = (250, 400)


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def state():
        return json.loads(shell.trigger('state'))

    def point(rect):
        return [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]

    def click(at, button=1):
        shell.pointer([{'move': list(at)}, {'wait': 120}, {'press': button}, {'wait': 70},
                       {'release': button}, {'wait': 500}])

    def escape():
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 50}, {'release': 0xff1b}]))
        time.sleep(0.4)

    def wait(predicate, timeout=5):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.1)
        return False

    def check(label, ok, detail=None):
        nonlocal count
        if not ok:
            raise AssertionError(f'{label}: {detail}')
        count += 1
        print('ok ' + label, flush=True)

    def open_start():
        click(point(dump()['startButton']))
        return wait(lambda: state()['startMenu'])

    def open_app_menu():
        if not open_start():
            return False
        click(point(dump()['startMenu']['pinnedApps'][0]), 3)
        return wait(lambda: dump()['startMenu']['appMenu'] is not None)

    # 新虚拟指针的第一下移动会丢坐标，先空走两下。
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])
    probe = ctx.Probe(shell, 4, None)
    try:
        bar = dump()
        blank = [110, bar['panel']['y'] + 12]
        cases = [
            ('任务栏空白处菜单',
             lambda: (click(blank, 3), wait(lambda: dump()['taskbarMenu']['open']))[1],
             lambda: dump()['taskbarMenu']['open']),
            ('开始按钮的 Win+X 菜单',
             lambda: (click(point(dump()['startButton']), 3), wait(lambda: state()['quickLinks']))[1],
             lambda: state()['quickLinks']),
            ('开始菜单', open_start, lambda: state()['startMenu']),
            ('开始菜单里的图标菜单', open_app_menu,
             lambda: state()['startMenu'] or dump()['startMenu']['appMenu'] is not None),
            ('通知中心',
             lambda: (click(point(dump()['clock'])), wait(lambda: state()['notifications']))[1],
             lambda: state()['notifications']),
        ]
        for name, opener, is_open in cases:
            check(f'{name}已打开', opener())
            mark = probe.mark()
            click(AT, 3)
            lines = probe.since(mark)
            check(f'{name}开着时右键窗口：菜单关闭，窗口在同一下弹出自己的菜单',
                  not is_open() and 'SHOWN' in lines, lines)
            escape()
            mark = probe.mark()
            click(AT, 3)
            check(f'{name}之后普通右键窗口不受影响', 'SHOWN' in probe.since(mark))
            escape()

        check('开始菜单已打开', open_start())
        click(blank, 3)
        check('开始菜单开着时右键任务栏空白处：菜单关闭，任务栏菜单打开',
              not state()['startMenu'] and wait(lambda: dump()['taskbarMenu']['open'], 3))
        escape()
        check('之后左键开始按钮照常打开，Shell 没有残留按键', open_start())
        escape()
    finally:
        probe.close()
    print(f'{count} 项菜单外右键送达检查通过，0 项失败')


if __name__ == '__main__':
    main()
