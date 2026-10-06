#!/usr/bin/python3
"""窗口按 Windows 11 的方式打开、最小化、还原、关闭；只在隔离 testbed 中运行。

Windows 的窗口从中心按约 0.9 倍放大淡入（约 200ms，先快后慢），关闭时缩回约 0.9 并淡出
（约 150ms，先慢后快），最小化缩进任务栏按钮（约 220ms，先慢后快），还原沿原路放大淡入
（约 220ms，先快后慢）。GNOME 自己的动画照常收尾，这里只核对它被改成了什么。关掉设置后
回到 GNOME 原来的动画。窗口由测试自己开一个 GTK 4 小窗口，结束时关掉。
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

TITLE = 'Animation probe'


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    count = 0
    windows = []

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def log():
        return dump()['windowAnimations']

    def window():
        return next((w for w in json.loads(shell.trigger('windows')) if w['title'] == TITLE), None)

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
        raise AssertionError(f'{label}: {last} {json.dumps(log(), ensure_ascii=False)[-1500:]} {window()}')

    def latest(phase):
        return next((e for e in reversed(log() or []) if e['phase'] == phase and e['title'] == TITLE), None)

    def open_window():
        app_env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                       XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
        app_env.pop('DISPLAY', None)
        windows.append(subprocess.Popen(['gjs', '-m', str(HERE / 'anim-window.js'), TITLE], env=app_env,
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))

    try:
        shell.trigger('windows')
        before = len(log() or [])
        open_window()
        check('打开：从中心按 0.9 倍放大、淡入，200ms 先快后慢', lambda: (lambda e: e and
              e['pivot'] == [0.5, 0.5] and e['scale'] == [0.9, 0.9] and e['opacity'] == 0 and
              e['to']['opacity'] == 255 and e['duration'] == 200 and e['mode'] == 'EASE_OUT_CUBIC')(
                  latest('map')))
        check('打开结束后窗口原大、不透明', lambda: window()['scale'] == [1, 1] and window()['opacity'] == 255)

        shell.trigger('window-minimize:' + TITLE)
        check('最小化：缩向任务栏按钮，220ms 先慢后快', lambda: (lambda e: e and
              e['duration'] == 220 and e['mode'] == 'EASE_IN_CUBIC' and e['to']['opacity'] == 0)(
                  latest('minimize')))
        check('最小化完成', lambda: window()['minimized'])

        shell.trigger('window-unminimize:' + TITLE)
        check('还原：从按钮淡入放大，220ms 先快后慢', lambda: (lambda e: e and
              e['opacity'] == 0 and e['to']['opacity'] == 255 and e['duration'] == 220 and
              e['mode'] == 'EASE_OUT_CUBIC')(latest('unminimize')))
        check('还原结束后窗口原大、不透明', lambda: not window()['minimized'] and
              window()['scale'] == [1, 1] and window()['opacity'] == 255)

        shell.trigger('window-close:' + TITLE)
        check('关闭：以中心缩到 0.9 并淡出，150ms 先慢后快', lambda: (lambda e: e and
              e['pivot'] == [0.5, 0.5] and e['to'] == {'opacity': 0, 'scale_x': 0.9, 'scale_y': 0.9} and
              e['duration'] == 150 and e['mode'] == 'EASE_IN_QUAD')(latest('destroy')))
        check('关闭后窗口不在了', lambda: window() is None)
        assert len(log()) > before

        subprocess.run(command + ['set', schema, 'window-animations', 'false'], env=env, check=True)
        check('关掉设置后不再改写动画', lambda: log() is None)
        open_window()
        check('关掉后窗口照常打开', lambda: window() is not None and window()['opacity'] == 255 and
              window()['scale'] == [1, 1])
        shell.trigger('window-close:' + TITLE)
        check('关掉后窗口照常关闭', lambda: window() is None)
    finally:
        subprocess.run(command + ['reset', schema, 'window-animations'], env=env, check=True)
        for process in windows:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    time.sleep(0.5)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项窗口动画检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
