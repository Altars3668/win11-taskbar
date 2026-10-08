#!/usr/bin/python3
"""任务栏放在四条边、改粗细；只在隔离 testbed 中运行。

Windows 11 只把任务栏放在底边；这里四条边都可放。放在左右时任务栏竖立，按钮自上而下、
居中，运行指示条贴着屏幕边竖立；开始菜单、快捷设置、通知中心、预览、Win+X 都开在任务栏
内侧，沿任务栏方向对准各自的按钮，角落浮层贴在任务栏末端。自动隐藏朝所在的边收起，顶住
那条边才出来。粗细改变时按钮单元与图标随之缩放，工作区随之让出。结束时复位位置、粗细与
自动隐藏。
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

W, H = 1920, 1080
# lib/spec.js：开始菜单离任务栏 13，快捷设置 6，通知中心 7、离顶 8，角落离屏幕边 12，预览 8。
START_GAP, QUICK_GAP, NOTE_GAP, NOTE_TOP, MARGIN, PREVIEW_GAP = 13, 6, 7, 8, 12, 8


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    keys = ['position', 'taskbar-size', 'taskbar-size-mode', 'auto-hide', 'alignment', 'tray-hidden-items', 'tray-hover']
    count = 0

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

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
        bar = dump()
        raise AssertionError(f'{label}: {last} ' + json.dumps(
            {k: bar.get(k) for k in ('edge', 'size', 'panel', 'workArea', 'autoHide')}, ensure_ascii=False))

    def settled(read):
        """Two equal reads in a row: nothing is sliding any more."""
        end = time.monotonic() + 4
        previous = None
        while time.monotonic() < end:
            value = read()
            if value is not None and value == previous:
                return value
            previous = value
            time.sleep(0.12)
        return previous

    def rect(r):
        return r['x'], r['y'], r['w'], r['h']

    def opened(trigger, read, close):
        shell.trigger(trigger)
        value = settled(read)
        shell.trigger(close)
        time.sleep(0.3)
        return value

    def running():
        return [b for b in dump()['buttons'] if b['windows'] > 0]

    try:
        # 一个托盘图标收进“隐藏的图标”，好检查浮层的位置；悬停不弹菜单，免得挡住。
        setting('tray-hover', "'none'")
        setting('tray-hidden-items', "['tray-alpha']")
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 300}])
        time.sleep(0.5)
        for edge in ('left', 'right', 'top'):
            setting('position', f"'{edge}'")
            vertical = edge in ('left', 'right')
            bar_rect = {'left': (0, 0, 48, H), 'right': (W - 48, 0, 48, H),
                        'top': (0, 0, W, 48)}[edge]
            work = {'left': (48, 0, W - 48, H), 'right': (0, 0, W - 48, H),
                    'top': (0, 48, W, H - 48)}[edge]
            check(f'{edge}：任务栏贴着这条边，48px 粗，工作区让出这一条',
                  lambda: dump()['edge'] == edge and rect(dump()['panel']) == bar_rect and
                  rect(dump()['workArea']) == work)
            line = {'left': (47, 0, 1, H), 'right': (W - 48, 0, 1, H), 'top': (0, 47, W, 1)}[edge]
            check(f'{edge}：分隔线在任务栏内侧', lambda: rect(dump()['separator']) == line)

            def stacked():
                buttons = dump()['buttons']
                sizes = {(b['w'], b['h']) for b in buttons}
                if vertical:
                    ys = [b['y'] for b in buttons]
                    return sizes == {(48, 44)} and all(b - a == 44 for a, b in zip(ys, ys[1:]))
                xs = [b['x'] for b in buttons]
                return sizes == {(44, 48)} and all(b - a == 44 for a, b in zip(xs, xs[1:]))
            check(f'{edge}：任务按钮沿任务栏排开，单元 {"48×44" if vertical else "44×48"}', stacked)
            check(f'{edge}：按钮组沿任务栏居中', lambda: abs(
                (dump()['centerZone']['y'] + dump()['centerZone']['h'] / 2 if vertical else
                 dump()['centerZone']['x'] + dump()['centerZone']['w'] / 2) - (H if vertical else W) / 2) <= 1)

            def indicator_at_edge():
                b = next(b for b in running() if b['indicator']['visible'])
                i = b['indicator']
                if edge == 'left':
                    return i['w'] == 3 and i['x'] == b['x'] + 5 and i['h'] in (6, 18)
                if edge == 'right':
                    return i['w'] == 3 and i['x'] + i['w'] == b['x'] + b['w'] - 5 and i['h'] in (6, 18)
                return i['h'] == 3 and i['y'] == b['y'] + 5 and i['w'] in (6, 18)
            check(f'{edge}：运行指示条贴着屏幕边', indicator_at_edge)

            start = opened('start-menu', lambda: (lambda s: rect(s) if s['open'] else None)(dump()['startMenu']),
                           'start-menu-close')
            expect = {'left': (48 + START_GAP, (H - 720) // 2, 640, 720),
                      'right': (W - 48 - START_GAP - 640, (H - 720) // 2, 640, 720),
                      'top': ((W - 640) // 2, 48 + START_GAP, 640, 720)}[edge]
            assert start == expect, (edge, start, expect)
            count += 1
            print(f'ok {edge}：开始菜单开在任务栏旁 13px，沿任务栏居中', flush=True)

            quick = opened('quick-settings', lambda: (lambda q: rect(q['frame']) if q else None)(
                dump()['quickSettings']), 'quick-settings-close')
            x, y, w, h = quick
            corner = {'left': (x == 48 + QUICK_GAP and y + h == H - MARGIN),
                      'right': (x + w == W - 48 - QUICK_GAP and y + h == H - MARGIN),
                      'top': (x + w == W - MARGIN and y == 48 + QUICK_GAP)}[edge]
            assert corner, (edge, quick)
            count += 1
            print(f'ok {edge}：快捷设置在任务栏末端的角上，离任务栏 6、离屏幕边 12', flush=True)

            note = opened('notifications', lambda: (lambda n: rect(n) if n['open'] else None)(
                dump()['notificationCentre']), 'notifications-close')
            x, y, w, h = note
            corner = {'left': (x == 48 + NOTE_GAP and y + h == H - MARGIN),
                      'right': (x + w == W - 48 - NOTE_GAP and y + h == H - MARGIN),
                      'top': (x + w == W - MARGIN and y == 48 + NOTE_TOP)}[edge]
            assert corner, (edge, note)
            count += 1
            print(f'ok {edge}：通知中心贴着任务栏末端', flush=True)

            shell.trigger('preview-first')
            preview = settled(lambda: (lambda p: (rect(p), p['app']) if p['open'] else None)(dump()['preview']))
            (x, y, w, h), app = preview
            button = next(b for b in dump()['buttons'] if b['id'] == app)
            shell.trigger('preview-close')
            time.sleep(0.3)
            if vertical:
                beside = x == 48 + PREVIEW_GAP if edge == 'left' else x + w == W - 48 - PREVIEW_GAP
                centred = abs(y + h / 2 - (button['y'] + button['h'] / 2)) <= 1
            else:
                beside = y == 48 + PREVIEW_GAP
                centred = abs(x + w / 2 - (button['x'] + button['w'] / 2)) <= 1
            assert beside and centred, (edge, preview, button)
            count += 1
            print(f'ok {edge}：缩略图开在按钮旁 8px，对准按钮', flush=True)

            jump = opened('jump-list', lambda: (lambda j: rect(j) if j else None)(dump()['jumpList']),
                          'jump-list-close')
            x, y, w, h = jump
            inside = {'left': x >= 48, 'right': x + w <= W - 48, 'top': y >= 48}[edge]
            assert inside, (edge, jump)
            count += 1
            print(f'ok {edge}：跳转列表开在任务栏内侧', flush=True)

            links = opened('quick-links', lambda: (lambda q: rect(q) if q['open'] else None)(
                dump()['quickLinks']), 'quick-links-close')
            start_button = dump()['startButton']
            x, y, w, h = links
            if vertical:
                ok = (x == 48 + 8 if edge == 'left' else x + w == W - 48 - 8) and \
                    abs(y + h / 2 - (start_button['y'] + start_button['h'] / 2)) <= 1
            else:
                ok = y == 48 + 8 and abs(x + w / 2 - (start_button['x'] + start_button['w'] / 2)) <= 1
            assert ok, (edge, links, start_button)
            count += 1
            print(f'ok {edge}：Win+X 菜单开在开始按钮旁并对准它', flush=True)

            chevron = dump()['tray']['chevron']
            shell.trigger('tray-overflow')
            overflow = settled(lambda: (lambda t: rect(t['overflow']) if t['overflowOpen'] else None)(
                dump()['tray']))
            shell.trigger('tray-overflow')
            time.sleep(0.4)
            x, y, w, h = overflow
            if vertical:
                ok = (x == 48 if edge == 'left' else x + w == W - 48) and \
                    y <= chevron['y'] + chevron['h'] / 2 <= y + h
            else:
                ok = y == 48 and x <= chevron['x'] + chevron['w'] / 2 <= x + w
            assert ok, (edge, overflow, chevron)
            count += 1
            print(f'ok {edge}：隐藏的图标浮层贴着任务栏内侧、对着箭头', flush=True)

            if vertical:
                def clock_fits():
                    bar = dump()
                    clock = bar['clock']
                    labels = bar['clockLabels']
                    return clock['w'] == 48 and all(
                        l['x'] >= clock['x'] and l['x'] + l['w'] <= clock['x'] + clock['w'] for l in labels)
                check(f'{edge}：时钟在 48px 宽里放得下（日期省去年份）', clock_fits)

            # 刚换边就开自动隐藏：朝这条边收起、只留 1px，顶住边才出来。
            setting('auto-hide', 'true')
            hidden = {'left': (-47, 0), 'right': (W - 1, 0), 'top': (0, -47)}[edge]
            check(f'{edge}：自动隐藏朝这条边收起，只留 1px',
                  lambda: (dump()['panel']['x'], dump()['panel']['y']) == hidden)
            at = {'left': [0, 500], 'right': [W - 1, 500], 'top': [960, 0]}[edge]
            push = {'left': [-15, 0], 'right': [15, 0], 'top': [0, -15]}[edge]
            shell.pointer([{'move': at}, {'wait': 100}] +
                          [step for _ in range(12) for step in ({'by': push}, {'wait': 40})])
            check(f'{edge}：顶住这条边，任务栏出来',
                  lambda: (dump()['panel']['x'], dump()['panel']['y']) == bar_rect[:2])
            shell.pointer([{'move': [960, 540]}, {'wait': 100}])
            check(f'{edge}：指针离开后再收起',
                  lambda: (dump()['panel']['x'], dump()['panel']['y']) == hidden)
            setting('auto-hide', 'false')
            check(f'{edge}：关掉自动隐藏，回到原位',
                  lambda: (dump()['panel']['x'], dump()['panel']['y']) == bar_rect[:2])

        setting('position', "'bottom'")
        check('回到底边', lambda: dump()['edge'] == 'bottom' and rect(dump()['panel']) == (0, H - 48, W, 48))
        setting('taskbar-size-mode', "'manual'")
        for size, cell, icon in ((64, 60, 32), (32, 28, 16)):
            setting('taskbar-size', str(size))
            check(f'{size}px：任务栏、工作区随之改变', lambda: rect(dump()['panel']) == (0, H - size, W, size) and
                  rect(dump()['workArea']) == (0, 0, W, H - size))
            check(f'{size}px：任务按钮 {cell}×{size}，图标 {icon}px',
                  lambda: {(b['w'], b['h'], b['icon']['w']) for b in dump()['buttons']} == {(cell, size, icon)})
            check(f'{size}px：开始按钮、时钟、显示桌面与任务栏一样高',
                  lambda: all(dump()[k]['h'] == size for k in ('startButton', 'clock', 'showDesktop')))
            check(f'{size}px：指示条仍在底边上方 5px', lambda: all(
                b['indicator']['y'] + b['indicator']['h'] == b['y'] + b['h'] - 5
                for b in running() if b['indicator']['visible']))
        start = opened('start-menu', lambda: (lambda s: rect(s) if s['open'] else None)(dump()['startMenu']),
                       'start-menu-close')
        assert start[1] + start[3] == H - 32 - START_GAP, start
        count += 1
        print('ok 开始菜单仍离任务栏 13px', flush=True)
    finally:
        for key in keys:
            subprocess.run(command + ['reset', schema, key], env=env, check=True)
        time.sleep(1.0)
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项任务栏位置与粗细检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
