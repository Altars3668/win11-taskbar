#!/usr/bin/python3
"""任务按钮之间的预览转移；只在隔离 testbed 中运行，需要先 `testbed.sh apps`。

第一次悬停要等 Windows 的悬停时间才出预览；预览开着时移到另一个按钮，立即切换，
浮窗从原处平移、缩放到新按钮上方，全程不淡出再弹出，新缩略图淡入。
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


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def preview():
        return dump()['preview']

    def centre(rect):
        return rect['x'] + rect['w'] / 2

    def check(label, ok, detail=None):
        nonlocal count
        if not ok:
            raise AssertionError(f'{label}: {detail}')
        count += 1
        print('ok ' + label, flush=True)

    def wait(predicate, timeout=5):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.05)
        return False

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])
    animations = json.loads(shell.trigger('state'))['animations']
    first, second = [b for b in dump()['buttons'] if b['windows'] > 0][:2]
    y = first['y'] + first['h'] / 2

    shell.trigger('pointer:' + json.dumps([{'move': [centre(first), y]}]))
    time.sleep(0.2)
    check('第一次悬停未到悬停时间时不出预览', not preview()['open'], preview())
    check('悬停时间到后为第一个按钮打开预览', wait(lambda: preview()['open'] and
          preview()['app'] == first['id'] and preview()['opacity'] == 255), preview())
    start = preview()

    # Straight onto the next button, then sample the flyout as it goes.
    t0 = time.monotonic()
    shell.trigger('pointer:' + json.dumps([{'move': [centre(second), y]}]))
    samples = []
    while time.monotonic() - t0 < 0.6:
        p = preview()
        samples.append((round(time.monotonic() - t0, 3), centre(p), p['opacity'], p['open'], p['app']))
        time.sleep(0.015)
    end = preview()
    check('预览开着时移到另一按钮，立即切换而不再等悬停时间',
          any(app == second['id'] for _t, _x, _o, _open, app in samples if _t < 0.2), samples[:6])
    check('切换过程中浮窗一直可见，没有淡出再弹出',
          all(opacity == 255 and is_open for _t, _x, opacity, is_open, _a in samples), samples)
    check('最终停在第二个按钮上方', abs(centre(end) - centre(second)) <= 2 or
          end['x'] <= 12 or end['x'] + end['w'] >= 1908, (end, second))
    if animations:
        between = [x for _t, x, _o, _open, _a in samples
                   if min(centre(start), centre(end)) + 2 < x < max(centre(start), centre(end)) - 2]
        check('浮窗从原处平移过去，途中经过两按钮之间', len(between) >= 2, samples)
    shell.pointer([{'move': [960, 500]}, {'wait': 500}])
    check('离开后预览关闭', wait(lambda: not preview()['open']))

    # Aero Peek between two windows of one app, quickly, with a third window
    # faded all along: it must come back fully, not stop where the first
    # peek's restore had got to.
    editor = next(b for b in dump()['buttons'] if b['id'] == 'org.gnome.TextEditor.desktop')
    if editor['windows'] < 2:
        env = dict(os.environ, XDG_CONFIG_HOME=f'{ctx.RUN}/config', XDG_CACHE_HOME=f'{ctx.RUN}/config/cache',
                   XDG_DATA_HOME=f'{ctx.RUN}/app-data', WAYLAND_DISPLAY='w11test',
                   DBUS_SESSION_BUS_ADDRESS=shell.address)
        env.pop('DISPLAY', None)
        proc = subprocess.Popen(['gnome-text-editor', '--standalone'], env=env, start_new_session=True,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(f'{ctx.RUN}/app-pids', 'a') as pids:
            pids.write(f'{proc.pid}\n')
        wait(lambda: next(b for b in dump()['buttons']
                          if b['id'] == 'org.gnome.TextEditor.desktop')['windows'] >= 2, 10)
        shell.trigger('windows')
        time.sleep(1)
    editor = next(b for b in dump()['buttons'] if b['id'] == 'org.gnome.TextEditor.desktop')
    shell.pointer([{'move': [centre(editor), y]}, {'wait': 900}])
    thumbs = dump()['preview']
    check('同一应用两个窗口时预览有两张缩略图', thumbs['thumbnails'] >= 2, thumbs)
    left = thumbs['x'] + thumbs['w'] * 0.3
    right = thumbs['x'] + thumbs['w'] * 0.7
    middle = thumbs['y'] + thumbs['h'] / 2
    shell.pointer([{'move': [left, middle]}, {'wait': 60}, {'move': [right, middle]}, {'wait': 60},
                   {'move': [left, middle]}, {'wait': 60}, {'move': [960, 400]}, {'wait': 700}])
    others = [w for w in json.loads(shell.trigger('windows')) if w['wmClass'] and 'calculator' in w['wmClass'].lower()]
    check('Aero Peek 来回切换后其他窗口完全复原', others and all(w['opacity'] == 255 for w in others), others)
    print(f'{count} 项预览转移检查通过，0 项失败')


if __name__ == '__main__':
    main()
