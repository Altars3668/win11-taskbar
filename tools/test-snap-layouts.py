#!/usr/bin/python3
"""Windows 11 的贴靠布局；只在隔离 testbed 中运行。

Win+Z 在焦点窗口右上角、标题栏下方打开 344×166 左右的浮层（3 列 98×64 的布局格），带数字；
按数字选布局、再按数字选区块，窗口贴进去，贴靠辅助在下一个空区块里列出其余窗口，点一个
贴进去，直到填满或按 Esc。鼠标点区块同样贴靠，点浮层外面就收起。拖窗口顶到屏幕上沿时
顶部出现一排布局，拖到区块上有落点预览，松开就贴进去。窗口由测试自己开 GTK 4 小窗口。
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

SUPER, ESCAPE, Z = 0xffeb, 0xff1b, 0x7a
ONE, TWO = 0x31, 0x32
FIRST, SECOND = 'Snap one', 'Snap two'


def main():
    shell = ctx.Shell()
    count = 0
    processes = []

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def snap():
        return dump()['snap']

    def windows():
        return json.loads(shell.trigger('windows'))

    def frame(title):
        return next(w['frame'] for w in windows() if w['title'] == title)

    def work():
        area = dump()['bars'][0]['workArea']
        return area['x'], area['y'], area['w'], area['h']

    def check(label, predicate, timeout=6):
        nonlocal count
        end = time.monotonic() + timeout
        last = None
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (TypeError, KeyError, StopIteration, IndexError) as error:
                last = error
            time.sleep(0.08)
        raise AssertionError(f'{label}: {last} {json.dumps(snap(), ensure_ascii=False)[:2000]}')

    def keys(*steps):
        shell.trigger('keys:' + json.dumps(list(steps)))
        time.sleep(sum(s.get('wait', 0) for s in steps) / 1000 + 0.3)

    def tap(key):
        keys({'press': key}, {'wait': 40}, {'release': key}, {'wait': 200})

    def win_z():
        keys({'press': SUPER}, {'wait': 40}, {'press': Z}, {'wait': 40}, {'release': Z},
             {'wait': 40}, {'release': SUPER}, {'wait': 300})

    def centre(r):
        return [r['x'] + r['w'] / 2, r['y'] + r['h'] / 2]

    def click(r, button=1):
        shell.pointer([{'move': centre(r)}, {'wait': 80}, {'press': button}, {'wait': 80},
                       {'release': button}, {'wait': 300}])

    def focus(title):
        shell.trigger('window-unminimize:' + title)
        check(f'“{title}”在前台', lambda: dump()['focus']['title'] == title)

    def open_window(title):
        env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                   XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
        env.pop('DISPLAY', None)
        processes.append(subprocess.Popen(['gjs', '-m', str(HERE / 'anim-window.js'), title], env=env,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        check(f'打开窗口“{title}”', lambda: any(w['title'] == title for w in windows()))

    try:
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 200}])
        open_window(FIRST)
        open_window(SECOND)
        x0, y0, w0, h0 = work()
        left = [x0, y0, w0 // 2, h0]
        right = [x0 + w0 // 2, y0, w0 - w0 // 2, h0]

        focus(FIRST)
        win_z()
        check('Win+Z 打开贴靠布局，两行三列的布局格 98×64', lambda: snap()['flyout'] and
              len(snap()['flyout']['tiles']) == 6 and
              {(t['w'], t['h']) for t in snap()['flyout']['tiles']} == {(98, 64)})
        fl = snap()['flyout']
        f = frame(FIRST)
        assert fl['window'] == FIRST, fl
        assert abs(fl['x'] + fl['w'] - (f[0] + f[2])) <= 1 and abs(fl['y'] - (f[1] + 31)) <= 1, (fl, f)
        count += 1
        print('ok 浮层右缘对齐窗口右缘、在窗口顶部下方 31px', flush=True)
        check('键盘打开时每个布局格都有编号', lambda: [t['number'] for t in snap()['flyout']['tiles']] ==
              ['1', '2', '3', '4', '5', '6'])
        tap(ONE)
        check('按 1 选中两等分：格子有外框，区块显示 1、2', lambda: snap()['flyout']['chosen'] == 0 and
              snap()['flyout']['tiles'][0]['chosen'] and
              [z['number'] for z in snap()['flyout']['tiles'][0]['zones']] == ['1', '2'])
        tap(ONE)
        check('再按 1：窗口贴进左半边，浮层收起', lambda: snap()['flyout'] is None and frame(FIRST) == left)
        check('贴靠辅助出现在右半边，列出其余窗口', lambda: snap()['assist'] and snap()['assist']['zone'] == 1 and
              abs(snap()['assist']['x'] - (right[0] + 6)) <= 1 and
              any(i['title'] == SECOND for i in snap()['assist']['items']))
        item = next(i for i in snap()['assist']['items'] if i['title'] == SECOND)
        assert item['h'] == 195 and item['w'] <= 288, item
        click(item)
        check('点“{0}”：它贴进右半边，区块填满后辅助结束'.format(SECOND),
              lambda: frame(SECOND) == right and snap()['assist'] is None)

        # 鼠标：在第二个窗口上打开，点三等分的中间一块。
        focus(SECOND)
        win_z()
        check('再次打开浮层', lambda: snap()['flyout'] and snap()['flyout']['window'] == SECOND)
        middle = snap()['flyout']['tiles'][2]['zones'][1]
        shell.pointer([{'move': centre(middle)}, {'wait': 250}])
        check('指针所在的区块亮起', lambda: snap()['flyout']['tiles'][2]['zones'][1]['active'])
        shell.pointer([{'press': 1}, {'wait': 80}, {'release': 1}, {'wait': 300}])
        third = [x0 + round(w0 / 3), y0, round(2 * w0 / 3) - round(w0 / 3), h0]
        check('点中间一块：窗口贴进三等分的中间', lambda: frame(SECOND) == third)
        check('贴靠辅助接着填第一块', lambda: snap()['assist'] and snap()['assist']['zone'] == 0)
        tap(ESCAPE)
        check('Esc 收起贴靠辅助', lambda: snap()['assist'] is None)

        win_z()
        check('浮层又打开', lambda: snap()['flyout'] is not None)
        desktop = {'x': x0 + 20, 'y': y0 + h0 - 60, 'w': 1, 'h': 1}
        click(desktop)
        check('点浮层外面就收起', lambda: snap()['flyout'] is None)

        # 拖窗口：在它的标题栏按住，拖到屏幕上沿，再拖进布局条的一块。
        focus(FIRST)
        f = frame(FIRST)
        grip = [f[0] + f[2] / 2, f[1] + 20]
        shell.pointer([{'move': grip}, {'wait': 120}, {'press': 1}, {'wait': 120}] +
                      [{'move': [grip[0] + 5 * i, grip[1] + 40 + 4 * i]} for i in range(1, 6)] +
                      [{'wait': 200}])
        check('拖动中', lambda: snap()['dragging'])
        steps = 10
        top = [960, y0 + 2]
        shell.pointer([{'move': [grip[0] + (top[0] - grip[0]) * i / steps,
                                 grip[1] + (top[1] - grip[1]) * i / steps]} for i in range(1, steps + 1)] +
                      [{'wait': 300}])
        check('顶到屏幕上沿：顶部出现一排六个布局格', lambda: snap()['bar'] and
              len(snap()['bar']['tiles']) == 6 and len({t['y'] for t in snap()['bar']['tiles']}) == 1)
        bar = snap()['bar']
        assert abs(bar['x'] + bar['w'] / 2 - (x0 + w0 / 2)) <= 1 and abs(bar['y'] - (y0 + 24)) <= 1, bar
        count += 1
        print('ok 布局条水平居中、离顶 24px', flush=True)
        target = snap()['bar']['tiles'][0]['zones'][1]
        shell.pointer([{'move': centre(target)}, {'wait': 300}])
        check('拖到两等分的右半块：它亮起，屏幕上有落点预览', lambda: snap()['bar']['tiles'][0]['zones'][1]['active']
              and snap()['preview'] and [snap()['preview'][k] for k in ('x', 'y', 'w', 'h')] == right)
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('松开：窗口贴进右半边，布局条收起', lambda: frame(FIRST) == right and snap()['bar'] is None and
              not snap()['dragging'])
        tap(ESCAPE)
        check('收起随之出现的贴靠辅助', lambda: snap()['assist'] is None)
    finally:
        for title in (FIRST, SECOND):
            shell.trigger('window-close:' + title)
        time.sleep(0.5)
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项贴靠布局检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
