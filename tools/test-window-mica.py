#!/usr/bin/python3
"""Windows 11 的云母（Mica）背景；只在隔离 testbed 中运行（只写 testbed 的配置目录）。

打开 GTK 标题栏和云母后，GTK 窗口下方有一块与其 frame 同大的模糊壁纸，亮度换成 Windows
着色色的亮度（浅色 #F3F3F3、深色 #202020），只留壁纸的色相；窗口自己的底色按 Windows 的
强度叠在上面。测试桌面的壁纸是深蓝色：当前窗口在一个白色窗口前面，仍是浅色、带一点蓝，
而不是后面的白色，也不是被深色壁纸拉暗的灰。不是当前窗口时是窗口自己的实色。桌面换成
深色方案后变暗。没有应用 ID 的 GTK 窗口（不属于 GtkApplication 的进程、应用的模态对话框）
同样有；不用 GTK 的窗口没有。关掉云母后不再有这块，GTK 样式也不再让窗口半透明。
"""
import importlib.util
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

FIRST, SECOND, DIALOG, BACKDROP, PLAIN = 'Mica one', 'Mica two', 'Mica dialog', 'Mica backdrop', 'Mica plain'


def main():
    shell = ctx.Shell()
    config = Path(ctx.RUN, 'config')
    env = dict(os.environ, XDG_CONFIG_HOME=str(config), DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    ours = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    count = 0
    processes = []
    others = []
    shots = 0

    def setting(key, value):
        subprocess.run(ours + ['set', schema, key, value], env=env, check=True)

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def record(title):
        return next((r for r in dump()['mica'] or [] if r['title'] == title), None)

    def windows():
        return json.loads(shell.trigger('windows'))

    def window(title):
        return next((w for w in windows() if w['title'] == title), None)

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
            time.sleep(0.1)
        raise AssertionError(f'{label}: {last} {json.dumps(dump()["mica"], ensure_ascii=False)[:1200]}')

    app_env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                   XDG_CONFIG_HOME=str(config), NO_AT_BRIDGE='1')
    app_env.pop('DISPLAY', None)

    def start(command):
        processes.append(subprocess.Popen(command, env=app_env, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL))

    def open_window(title, *flags, app=True):
        start(['gjs', '-m', str(HERE / 'anim-window.js'), title, *flags] +
              (['--app-id=org.example.W11Mica' + str(len(processes))] if app else []))
        check(f'打开“{title}”', lambda: window(title) is not None and window(title)['opacity'] == 255)

    def shot():
        nonlocal shots
        shots += 1
        path = Path(ctx.RUN, f'mica-shot-{shots}.png')
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

    try:
        shell.trigger('windows')
        shell.pointer([{'move': [1800, 200]}, {'wait': 200}])
        others = [w['title'] for w in windows() if w['type'] == 0 and not w['minimized']]
        for title in others:
            shell.trigger('window-minimize:' + title)
        setting('gtk-window-style', 'true')
        # 后面垫一个白色窗口：它不属于 GtkApplication，没有应用 ID。它在云母打开之前
        # 就开着：已开的窗口也要得到云母。
        open_window(BACKDROP, '--size=900x700', '--fill=#ffffff', app=False)
        setting('gtk-mica', 'true')
        check('云母打开', lambda: dump()['mica'] is not None)
        check('已开着、没有应用 ID、但用 GTK 画的窗口也有云母', lambda: record(BACKDROP)['gtk'] and
              record(BACKDROP)['mica'] is not None)
        # 足够大：上面再开的小窗口和对话框，连同它们的阴影，都落在它的中间。
        open_window(FIRST, '--size=700x500')
        check('GTK 应用的窗口下方有一块与 frame 同大的云母', lambda: (lambda r, w: r and r['mica'] and
              [r['mica'][k] for k in ('x', 'y', 'w', 'h')] == w['frame'])(record(FIRST), window(FIRST)))
        f, b = window(FIRST)['frame'], window(BACKDROP)['frame']
        assert b[0] < f[0] and b[1] < f[1] and f[0] + f[2] < b[0] + b[2] and f[1] + f[3] < b[1] + b[3], (f, b)
        # 左上和左下：后面打开的小窗口和对话框居中，挡不到这两处。
        spots = (('标题栏', (f[0] + 30, f[1] + 12)), ('窗口背景', (f[0] + 30, f[1] + f[3] - 30)))

        def look():
            """The two spots of FIRST, and the white window beside it."""
            time.sleep(0.8)
            image = shot()
            # 舞台是逻辑像素；缩放 2 且 scale-monitor-framebuffer 时截图像素多一倍。
            k = image.width / dump()['stage'][0]

            def at(lx, ly):
                return image.getpixel((int((lx + 0.5) * k), int((ly + 0.5) * k)))
            return [at(*spot) for _, spot in spots], at(b[0] + 40, b[1] + b[3] - 40)

        def lum(pixel):
            return 0.3 * pixel[0] + 0.59 * pixel[1] + 0.11 * pixel[2]

        pixels, behind = look()
        for (label, _), pixel in zip(spots, pixels):
            # 深蓝壁纸上仍是浅色，带一点蓝：不是后面的白，也不是被拉暗的灰。
            assert min(pixel) > 225 and pixel[2] - pixel[0] >= 5, (label, pixel)
            count += 1
            print(f'ok 当前窗口的{label}是浅色、带壁纸的色相：{pixel}', flush=True)
        assert min(behind) > 240, behind
        count += 1
        print(f'ok 后面的白色窗口仍是白色：{behind}', flush=True)
        light = lum(pixels[1])

        # 任务栏缩略图里，窗口下面同样垫着云母，而不是透出缩略图浮层。
        shell.trigger('preview-window:' + FIRST)
        check('缩略图里窗口下面也有云母', lambda: dump()['bars'][0]['preview']['open'] and
              any(t['mica'] for t in dump()['bars'][0]['preview']['thumbs']))
        shell.trigger('preview-close')
        check('缩略图收起', lambda: not dump()['bars'][0]['preview']['open'])

        open_window(SECOND, '--size=300x200', f'--dialog={DIALOG}')
        check('应用的模态对话框没有应用 ID，也有云母', lambda: window(DIALOG) is not None and
              record(DIALOG)['gtk'] and record(DIALOG)['mica'] is not None, timeout=8)
        # 不是当前窗口：GTK 画出窗口自己的实色，盖住云母。
        pixels, _ = look()
        for (label, _), pixel in zip(spots, pixels):
            assert abs(pixel[2] - pixel[0]) < 3 and min(pixel) > 225, (label, pixel)
            count += 1
            print(f'ok 不是当前窗口时{label}是实色：{pixel}', flush=True)
        shell.trigger('window-close:' + DIALOG)
        check('对话框关掉', lambda: window(DIALOG) is None)
        shell.trigger('window-minimize:' + SECOND)
        check('它又成为当前窗口', lambda: window(SECOND)['minimized'] and dump()['focus']['title'] == FIRST)

        # 浅色、深色跟着桌面的配色方案走（应用也跟着它），不管任务栏自己设成什么。
        setting('theme', "'dark'")
        time.sleep(0.5)
        assert not record(FIRST)['mica']['dark'], record(FIRST)
        count += 1
        print('ok 任务栏设成深色、桌面仍是浅色：云母仍按浅色', flush=True)
        subprocess.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', 'prefer-dark'],
                       env=env, check=True)
        check('桌面换成深色：云母按深色', lambda: record(FIRST)['mica']['dark'] and record(BACKDROP)['mica']['dark'])
        pixels, _ = look()
        assert lum(pixels[1]) < light - 40, (pixels, light)
        count += 1
        print(f'ok 深色方案下壁纸换成深色的亮度：{pixels[1]}', flush=True)
        subprocess.run(['gsettings', 'reset', 'org.gnome.desktop.interface', 'color-scheme'], env=env, check=True)
        check('换回浅色', lambda: not record(FIRST)['mica']['dark'])

        # 不用 GTK 的 Wayland 窗口：mpv 用共享内存直接画，不加载 GTK。
        if shutil.which('mpv'):
            start(['mpv', '--no-config', '--vo=wlshm', '--idle=yes', '--force-window=yes',
                   f'--title={PLAIN}', '--no-audio'])
            check('打开不用 GTK 的窗口', lambda: record(PLAIN) is not None)
            time.sleep(1)
            assert not record(PLAIN)['gtk'] and record(PLAIN)['mica'] is None, record(PLAIN)
            count += 1
            print('ok 不用 GTK 的窗口没有云母', flush=True)
        else:
            print('跳过：没有 mpv，无法检查不用 GTK 的窗口', flush=True)

        setting('gtk-mica', 'false')
        check('关掉云母：不再有这块', lambda: dump()['mica'] is None)
        css = (config / 'gtk-4.0' / 'gtk.css').read_text()
        assert 'alpha(@theme_bg_color' not in css and 'transparent' not in css, css[-600:]
        count += 1
        print('ok 关掉后 GTK 样式不再让窗口半透明', flush=True)
    finally:
        for key in ('gtk-mica', 'gtk-window-style', 'theme'):
            subprocess.run(ours + ['reset', schema, key], env=env, check=True)
        subprocess.run(['gsettings', 'reset', 'org.gnome.desktop.interface', 'color-scheme'], env=env, check=True)
        for title in (DIALOG, FIRST, SECOND, BACKDROP, PLAIN):
            shell.trigger('window-close:' + title)
        time.sleep(0.5)
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for title in others:
            shell.trigger('window-unminimize:' + title)
        subprocess.run(['gsettings', 'reset', 'org.gnome.desktop.wm.preferences', 'button-layout'],
                       env=env, check=True)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项云母检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
