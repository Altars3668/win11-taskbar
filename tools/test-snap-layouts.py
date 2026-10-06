#!/usr/bin/python3
"""Windows 11 的贴靠布局；只在隔离 testbed 中运行。

Win+Z 在焦点窗口右上角、标题栏下方打开 344×166 左右的浮层（3 列 98×64 的布局格），带数字；
按数字选布局、再按数字选区块，窗口贴进去，贴靠辅助在下一个空区块里列出其余窗口，点一个
贴进去，直到填满或按 Esc。鼠标点区块同样贴靠，点浮层外面就收起。拖窗口顶到屏幕上沿时
顶部出现一排布局，拖到区块上有落点预览，松开就贴进去。拖到左右边缘是半边、到角上是四分之一、
到顶上布局条以外的地方是整块（最大化），预览离工作区边 8px；离开边缘预览收回，Esc 取消拖动也不贴。
贴靠布局开着时 GNOME 自带的边缘平铺关掉，关掉贴靠布局再打开。Ubuntu 的 Tiling Assistant 在时边缘
留给它；测试在隔离的配置里暂时停用它，验证交接。窗口由测试自己开 GTK 4 小窗口。
"""
import ast
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
ASSISTANT = 'tiling-assistant@ubuntu.com'
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

    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)

    def gsettings(*args):
        return subprocess.run(['gsettings', '--schemadir', str(HERE.parent / 'schemas'), *args], env=env,
                              check=True, capture_output=True, text=True).stdout.strip()

    def edge_tiling():
        return gsettings('get', 'org.gnome.mutter', 'edge-tiling') == 'true'

    def grab(title):
        """在窗口标题栏按住，往下带一点，拖动开始。返回指针位置。先把它提到前面：
        别的窗口的不可见缩放边可能盖在它的标题栏上。"""
        focus(title)
        f = frame(title)
        grip = [f[0] + f[2] / 2, f[1] + 20]
        shell.pointer([{'move': grip}, {'wait': 120}, {'press': 1}, {'wait': 120}] +
                      [{'move': [grip[0] + 5 * i, grip[1] + 40 + 4 * i]} for i in range(1, 6)] +
                      [{'wait': 200}])
        check(f'拖动“{title}”', lambda: snap()['dragging'])
        return [grip[0] + 25, grip[1] + 60]

    def glide(start, end, steps=10, wait=300):
        shell.pointer([{'move': [start[0] + (end[0] - start[0]) * i / steps,
                                 start[1] + (end[1] - start[1]) * i / steps]} for i in range(1, steps + 1)] +
                      [{'wait': wait}])
        return end

    def aimed():
        t = snap()['previewTarget']
        return [t['x'], t['y'], t['w'], t['h']] if t else None

    def open_window(title):
        env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                   XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
        env.pop('DISPLAY', None)
        processes.append(subprocess.Popen(['gjs', '-m', str(HERE / 'anim-window.js'), title], env=env,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        check(f'打开窗口“{title}”', lambda: any(w['title'] == title for w in windows()))

    # testbed 在 Ubuntu 模式下把该模式自带的扩展都放进禁用列表；结束时原样写回。
    lists = {key: gsettings('get', 'org.gnome.shell', key) for key in ('enabled-extensions', 'disabled-extensions')}

    def assistant_on(on):
        enabled, disabled = (ast.literal_eval(lists[k].removeprefix('@as ')) for k in
                             ('enabled-extensions', 'disabled-extensions'))
        if on:
            enabled = enabled + [ASSISTANT] if ASSISTANT not in enabled else enabled
            disabled = [u for u in disabled if u != ASSISTANT]
        gsettings('set', 'org.gnome.shell', 'disabled-extensions', repr(disabled))
        gsettings('set', 'org.gnome.shell', 'enabled-extensions', repr(enabled))

    try:
        gsettings('reset', 'org.gnome.shell.extensions.win11-taskbar', 'snap-layouts')
        check('贴靠布局开着', lambda: snap() is not None, timeout=10)
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
        right_preview = [right[0], right[1] + 8, right[2] - 8, right[3] - 16]
        check('拖到两等分的右半块：它亮起，屏幕上有落点预览（离工作区边 8px）',
              lambda: snap()['bar']['tiles'][0]['zones'][1]['active'] and aimed() == right_preview)
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('松开：窗口贴进右半边，布局条收起', lambda: frame(FIRST) == right and snap()['bar'] is None and
              not snap()['dragging'])
        tap(ESCAPE)
        check('收起随之出现的贴靠辅助', lambda: snap()['assist'] is None)

        # 屏幕边缘。testbed 里没有开着的 Tiling Assistant，边缘归贴靠布局。
        check('边缘归贴靠布局，GNOME 自带的边缘平铺是关的', lambda: snap()['edges'] and not edge_tiling() and
              not snap()['edgeTiling'])

        half = w0 // 2
        left_half = [x0, y0, half, h0]
        at = glide(grab(FIRST), [x0 + 20, y0 + h0 // 2])
        check('拖到左边缘：左半边的预览，离工作区边 8px、中线不缩',
              lambda: snap()['place'] == 'edge:0:left' and aimed() == [x0 + 8, y0 + 8, half - 8, h0 - 16])
        at = glide(at, [x0 + 20, y0 + 60], steps=6)
        check('沿边缘到上角：变成左上四分之一', lambda: snap()['place'] == 'edge:0:top-left' and
              aimed() == [x0 + 8, y0 + 8, half - 8, h0 // 2 - 8])
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('松开：窗口进左上四分之一', lambda: frame(FIRST) == [x0, y0, half, h0 // 2] and
              snap()['preview'] is None and not snap()['dragging'])
        check('贴靠辅助接着填右上四分之一', lambda: snap()['assist'] and snap()['assist']['zone'] == 1 and
              snap()['assist']['layout'] == 'quarters')
        tap(ESCAPE)
        check('Esc 收起贴靠辅助', lambda: snap()['assist'] is None)

        at = glide(grab(SECOND), [x0 + w0 - 10, y0 + h0 // 2])
        check('拖到右边缘：右半边的预览', lambda: snap()['place'] == 'edge:0:right' and
              aimed() == [x0 + half, y0 + 8, w0 - half - 8, h0 - 16])
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('松开：窗口进右半边，贴靠辅助接着填左半边', lambda: frame(SECOND) == [x0 + half, y0, w0 - half, h0]
              and snap()['assist'] and snap()['assist']['zone'] == 0 and snap()['assist']['layout'] == 'halves')
        tap(ESCAPE)
        check('Esc 收起贴靠辅助', lambda: snap()['assist'] is None)

        # 离开边缘：预览收回窗口，松开不贴。
        before = frame(FIRST)
        at = glide(grab(FIRST), [x0 + 20, y0 + h0 // 2])
        check('又到左边缘，出现预览', lambda: snap()['place'] == 'edge:0:left' and snap()['preview'])
        at = glide(at, [x0 + 100, y0 + h0 // 2], steps=4)
        check('离边 100px 仍在左半边（进入后要 138px 才离开）', lambda: snap()['place'] == 'edge:0:left')
        at = glide(at, [x0 + w0 // 3, y0 + h0 // 2], steps=6)
        check('走远了：预览收回窗口里', lambda: snap()['place'] is None and snap()['preview'] is None)
        shell.pointer([{'release': 1}, {'wait': 500}])
        moved = frame(FIRST)
        check('松开：窗口留在松开的地方，不贴', lambda: frame(FIRST) == moved and moved[2:] == before[2:]
              and snap()['assist'] is None)

        # Esc：mutter 把窗口放回去，也不贴。
        before = frame(FIRST)
        at = glide(grab(FIRST), [x0 + 20, y0 + h0 // 2])
        check('拖到左边缘', lambda: snap()['place'] == 'edge:0:left')
        keys({'press': ESCAPE}, {'wait': 40}, {'release': ESCAPE}, {'wait': 300})
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('Esc 取消拖动：窗口回到原处，不贴、没有预览', lambda: frame(FIRST) == before and
              snap()['preview'] is None and snap()['assist'] is None and not snap()['dragging'])

        # 顶上，布局条以外：整块。布局条只在它的宽度以内落下来。
        at = glide(grab(FIRST), [x0 + 100, y0 + 2])
        check('顶到上沿、布局条以外：没有布局条，整块工作区的预览', lambda: snap()['bar'] is None and
              snap()['place'] == 'edge:0:top' and aimed() == [x0 + 8, y0 + 8, w0 - 16, h0 - 16])
        shell.pointer([{'release': 1}, {'wait': 500}])
        check('松开：窗口最大化', lambda: frame(FIRST) == [x0, y0, w0, h0] and
              snap()['lastSnap']['layout'] == 'maximized')
        shell.trigger('window-unmaximize:' + FIRST)
        check('还原', lambda: frame(FIRST) != [x0, y0, w0, h0])

        # GNOME 的边缘平铺被打开（比如别的程序恢复了它）时马上关掉；关掉贴靠布局时还原，再打开又关上。
        gsettings('set', 'org.gnome.mutter', 'edge-tiling', 'true')
        check('有人打开 GNOME 的边缘平铺：贴靠布局马上把它关掉', lambda: not edge_tiling(), timeout=10)
        gsettings('set', 'org.gnome.shell.extensions.win11-taskbar', 'snap-layouts', 'false')
        check('关掉贴靠布局：GNOME 自带的边缘平铺回来', lambda: edge_tiling(), timeout=10)
        gsettings('set', 'org.gnome.shell.extensions.win11-taskbar', 'snap-layouts', 'true')
        check('再打开：它又关上', lambda: not edge_tiling() and snap() and snap()['edges'], timeout=10)

        # Ubuntu 的 Tiling Assistant 打开时边缘交给它，关掉后收回来。
        if Path('/usr/share/gnome-shell/extensions', ASSISTANT).exists():
            assistant_on(True)
            check('Tiling Assistant 打开：边缘交给它，GNOME 的边缘平铺仍关着',
                  lambda: not snap()['edges'] and not edge_tiling(), timeout=10)
            at = glide(grab(FIRST), [x0 + 20, y0 + h0 // 2])
            check('拖到左边缘：贴靠布局不出预览', lambda: snap()['place'] is None and snap()['preview'] is None)
            shell.pointer([{'move': [x0 + w0 // 2, y0 + h0 // 2]}, {'wait': 300}, {'release': 1}, {'wait': 500}])
            assistant_on(False)
            check('Tiling Assistant 关掉：边缘收回，GNOME 的边缘平铺还是关的',
                  lambda: snap()['edges'] and not edge_tiling(), timeout=10)
    finally:
        # 中途失败时左键可能还按着，留给后面的测试就成了一次拖动。
        if snap() and snap()['dragging']:
            shell.pointer([{'release': 1}, {'wait': 300}])
        for key, value in lists.items():
            gsettings('set', 'org.gnome.shell', key, value)
        gsettings('reset', 'org.gnome.shell.extensions.win11-taskbar', 'snap-layouts')
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
