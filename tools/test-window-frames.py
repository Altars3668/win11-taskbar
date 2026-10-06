#!/usr/bin/python3
"""Windows 11 的窗口圆角、1px 边和阴影；只在隔离 testbed 中运行。

自己不画阴影的窗口（缓冲区不比 frame 大，例如无装饰窗口）得到 8px 圆角、最外 1px 的
半透明灰边和按实测曲线的阴影；GTK 这类自己画了阴影的窗口，阴影换成同一圈，只包住窗口框。最大化时直角、无阴影，
还原后恢复；最小化时阴影跟着隐去；窗口层叠变化后阴影仍在它正下方。截图核对像素：角上
露出桌面，边上是半透明灰，下方阴影浓度接近实测（贴边 0.30，8px 处 0.26，16px 处 0.21）。
无装饰的 X11 窗口（如微信）mutter 会自己加一圈阴影：圆角和边仍要对准窗口，阴影只剩一圈。
"""
import importlib.util
import json
import os
import re
import subprocess
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

FRAMED, PLAIN, X11 = 'Framed probe', 'Plain probe', 'X11 probe'


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    count = 0
    processes = []

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def record(title):
        return next((r for r in dump()['frames'] or [] if r['title'] == title), None)

    def window(title):
        return next((w for w in json.loads(shell.trigger('windows')) if w['title'] == title), None)

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
        raise AssertionError(f'{label}: {last} {json.dumps(dump()["frames"], ensure_ascii=False)[:1500]}')

    def open_window(title, *flags):
        app_env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                       XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
        app_env.pop('DISPLAY', None)
        processes.append(subprocess.Popen(['gjs', '-m', str(HERE / 'anim-window.js'), title, *flags],
                                          env=app_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        check(f'打开“{title}”', lambda: window(title) is not None and window(title)['opacity'] == 255)

    shots = 0

    def shot():
        # The screenshot is written after the call returns: a file of its own,
        # read once it is there and whole.
        nonlocal shots
        shots += 1
        path = Path(ctx.RUN, f'frames-shot-{shots}.png')
        path.unlink(missing_ok=True)
        shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'Screenshot', ctx.GLib.Variant('(s)', (str(path),)),
                             None, ctx.Gio.DBusCallFlags.NONE, 20000, None)
        end = time.monotonic() + 10
        size = -1
        while time.monotonic() < end:
            if path.exists() and path.stat().st_size == size and size > 0:
                break
            size = path.stat().st_size if path.exists() else -1
            time.sleep(0.25)
        image = Image.open(path).convert('RGB')
        path.unlink(missing_ok=True)
        return image

    others = []
    try:
        shell.trigger('windows')
        shell.pointer([{'move': [1800, 200]}, {'wait': 200}])
        # 像素要和空桌面比：别的测试开着的窗口先收起来，结束时还原。
        others = [w['title'] for w in json.loads(shell.trigger('windows'))
                  if w['type'] == 0 and not w['minimized']]
        for title in others:
            shell.trigger('window-minimize:' + title)
        check('其他窗口都已收起', lambda: all(w['minimized'] for w in json.loads(shell.trigger('windows'))
                                       if w['title'] in others))
        time.sleep(0.5)
        # 先拍一张空桌面，作为背景。
        desktop = shot()
        open_window(FRAMED, '--undecorated')
        check('无装饰窗口得到圆角、边和阴影', lambda: record(FRAMED)['framed'] and record(FRAMED)['effect'] and
              record(FRAMED)['shadow'] is not None)
        f = window(FRAMED)['frame']
        check('阴影按图的外边距包住窗口（左右 48、上 32、下 80）', lambda: (lambda s: (s['x'], s['y'], s['w'], s['h']) ==
              (f[0] - 48, f[1] - 32, f[2] + 96, f[3] + 112))(record(FRAMED)['shadow']))
        check('阴影就在窗口正下方', lambda: record(FRAMED)['shadow']['below'])

        def look(f, who=''):
            """Corners, edge and shadow of the window at frame f, in pixels."""
            nonlocal count
            # Move the pointer off; let animations settle; then look.
            time.sleep(0.6)
            image = shot()
            x, y, w, h = f
            # The stage is in logical pixels; a screenshot at a scale of 2
            # with scale-monitor-framebuffer has twice as many. A logical
            # pixel is read at the middle of its block.
            k = image.width / dump()['stage'][0]

            def at(picture, lx, ly):
                return picture.getpixel((int((lx + 0.5) * k), int((ly + 0.5) * k)))

            def alpha(px, py):
                """How dark against the bare desktop: 1 - shot / desktop."""
                a = at(image, px, py)
                b = at(desktop, px, py)
                return 1 - sum(a) / max(1, sum(b))
            inside = at(image, x + w // 2, y + h // 2)
            for cx, cy in ((x, y), (x + w - 1, y), (x, y + h - 1), (x + w - 1, y + h - 1)):
                corner = at(image, cx, cy)
                bare = at(desktop, cx, cy)
                assert sum(abs(c - d) for c, d in zip(corner, bare)) < \
                    sum(abs(c - d) for c, d in zip(inside, bare)) / 3, (who, (cx, cy), corner, bare, inside)
            count += 1
            print(f'ok {who}四个圆角处露出后面的桌面，而不是窗口的颜色', flush=True)
            for ex, ey in ((x, y + h // 2), (x + w - 1, y + h // 2), (x + w // 2, y), (x + w // 2, y + h - 1)):
                edge = at(image, ex, ey)
                assert all(abs(e - i) > 40 for e, i in zip(edge, inside)) and edge != at(desktop, ex, ey), \
                    (who, (ex, ey), edge, inside)
            count += 1
            print(f'ok {who}四条边最外 1px 是半透明的灰边，与窗口对齐', flush=True)
            below = [round(alpha(x + w // 2, y + h + d), 3) for d in (0, 8, 16)]
            side = [round(alpha(x - 1 - d, y + h // 2), 3) for d in (0, 8, 16)]
            assert abs(below[0] - 0.298) < 0.05 and abs(below[1] - 0.26) < 0.05 and \
                abs(below[2] - 0.212) < 0.05, (who, below)
            assert abs(side[0] - 0.161) < 0.05 and abs(side[1] - 0.098) < 0.04 and \
                abs(side[2] - 0.05) < 0.03, (who, side)
            count += 1
            print(f'ok {who}阴影浓度接近实测，只有一圈：下方 {below}，侧面 {side}', flush=True)

        look(f)

        # GTK 自己画了圆角和阴影：阴影换成 Windows 的，只包住窗口框。
        open_window(PLAIN)
        check('自己画阴影的 GTK 窗口也得到圆角、边和阴影', lambda: record(PLAIN)['framed'] and record(PLAIN)['effect'])
        g = window(PLAIN)['frame']
        assert window(PLAIN)['buffer'] != g, window(PLAIN)
        check('阴影包住它的窗口框，而不是连同它自己画的阴影', lambda: (lambda sh: (sh['x'], sh['y'], sh['w'], sh['h']) ==
              (g[0] - 48, g[1] - 32, g[2] + 96, g[3] + 112))(record(PLAIN)['shadow']))
        shell.trigger('window-minimize:' + FRAMED)
        check('另一个窗口收起', lambda: window(FRAMED)['minimized'])
        look(g, 'GTK 窗口：')
        shell.trigger('window-unminimize:' + FRAMED)
        check('另一个窗口还原', lambda: not window(FRAMED)['minimized'])

        shell.trigger('window-maximize:' + FRAMED)
        check('最大化：直角、无阴影', lambda: not record(FRAMED)['framed'] and not record(FRAMED)['effect'] and
              record(FRAMED)['shadow'] is None)
        shell.trigger('window-unmaximize:' + FRAMED)
        check('还原后又有圆角和阴影', lambda: record(FRAMED)['framed'] and record(FRAMED)['shadow'] is not None)

        shell.trigger('window-minimize:' + FRAMED)
        check('最小化时阴影跟着隐去', lambda: not record(FRAMED)['shadow']['visible'])
        shell.trigger('window-unminimize:' + FRAMED)
        check('还原后阴影又出现', lambda: record(FRAMED)['shadow']['visible'])

        shell.trigger('window-unminimize:' + PLAIN)
        time.sleep(0.4)
        shell.trigger('window-unminimize:' + FRAMED)
        check('层叠变化后阴影仍在窗口正下方', lambda: record(FRAMED)['shadow']['below'])

        # 无装饰的 X11 窗口，如微信：mutter 自己给它加阴影，画在窗口演员之外。
        for title in (FRAMED, PLAIN):
            shell.trigger('window-minimize:' + title)
        check('别的窗口收起', lambda: window(FRAMED)['minimized'] and window(PLAIN)['minimized'])
        log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
        display = re.search(r'Using public X11 display (:\d+)', log).group(1)
        auth = max(Path(ctx.RUN, 'xdg').glob('.mutter-Xwaylandauth.*'), key=lambda path: path.stat().st_mtime)
        x_env = dict(os.environ, GDK_BACKEND='x11', DISPLAY=display, XAUTHORITY=str(auth),
                     NO_AT_BRIDGE='1', XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
        x_env.pop('WAYLAND_DISPLAY', None)
        processes.append(subprocess.Popen(['/usr/bin/python3', str(HERE / 'x11-window.py'), X11], env=x_env,
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        check('打开无装饰的 X11 窗口', lambda: window(X11) is not None and window(X11)['opacity'] == 255, timeout=10)
        check('它也得到圆角、边和阴影', lambda: record(X11)['framed'] and record(X11)['shadow'] is not None)
        look(window(X11)['frame'], 'X11 窗口：')
        shell.trigger('window-close:' + X11)
        for title in (FRAMED, PLAIN):
            shell.trigger('window-unminimize:' + title)

        subprocess.run(command + ['set', schema, 'window-frames', 'false'], env=env, check=True)
        check('关掉设置：不再改窗口', lambda: dump()['frames'] is None and
              window(FRAMED)['opacity'] == 255)
        subprocess.run(command + ['set', schema, 'window-frames', 'true'], env=env, check=True)
        check('再打开：已有窗口重新得到圆角和阴影', lambda: record(FRAMED) and record(FRAMED)['framed'])
    finally:
        subprocess.run(command + ['reset', schema, 'window-frames'], env=env, check=True)
        for title in (FRAMED, PLAIN, X11):
            shell.trigger('window-close:' + title)
        for title in others:
            shell.trigger('window-unminimize:' + title)
        time.sleep(0.5)
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项窗口圆角与阴影检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
