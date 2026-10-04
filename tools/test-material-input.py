#!/usr/bin/python3
"""无损录帧检查快速悬停后的静态残影、窗口背景采样和材质生命周期。

只在隔离桌面画合成棋盘；不使用真实文档或真实桌面截图。--baseline 仅报告旧实现。
"""
import argparse
import importlib.util
import json
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path
from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    shell = ctx.Shell()
    root = Path(os.environ.get('WIN11_TASKBAR_TEST_ROOT', HERE.parent))
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               XDG_DATA_HOME=str(Path(ctx.RUN, 'data')), XDG_CACHE_HOME=str(Path(ctx.RUN, 'config/cache')),
               WAYLAND_DISPLAY='w11test', DBUS_SESSION_BUS_ADDRESS=shell.address)
    env.pop('DISPLAY', None)
    work = Path(tempfile.mkdtemp(prefix='material-baseline-' if args.baseline else 'material-scene-',
                                 dir=os.environ.get('XDG_RUNTIME_DIR', '/run/user/1000')))
    command = ['gsettings', '--schemadir', str(root / 'schemas')]
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    saved = {key: subprocess.check_output(command + ['get', schema, key], env=env, text=True).strip()
             for key in ['reserve-space', 'acrylic']}
    fixture = None
    recording = False
    results = {}

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)
        time.sleep(0.2)

    def dump():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                     ctx.GLib.VariantType('(s)'), ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(reply.unpack()[0])['bars'][0]

    def capture(name):
        path = work / f'{name}.png'
        shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'Screenshot', ctx.GLib.Variant('(s)', (str(path),)),
                             None, ctx.Gio.DBusCallFlags.NONE, 10000, None)
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            try:
                image = Image.open(path)
                image.load()
                return image.convert('RGB')
            except (OSError, FileNotFoundError):
                time.sleep(0.05)
        raise RuntimeError('合成背景截图未完成')

    def frame(video, timestamp, name):
        path = work / f'{name}.png'
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', video, '-ss', str(timestamp),
                        '-frames:v', '1', str(path)], check=True, timeout=45)
        return Image.open(path).convert('RGB')

    def difference(a, b, region):
        diff = ImageChops.difference(a.crop(region), b.crop(region))
        pixels = list(getattr(diff, 'get_flattened_data', diff.getdata)())
        return {'changed_fraction': sum(max(pixel) > 3 for pixel in pixels) / len(pixels),
                'mean_change': sum(sum(pixel) / 3 for pixel in pixels) / len(pixels)}

    def cast(method, arguments=None):
        return shell.conn.call_sync('org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast',
                                    'org.gnome.Shell.Screencast', method, arguments, None,
                                    ctx.Gio.DBusCallFlags.NONE, 30000, None).unpack()

    try:
        setting('reserve-space', 'false')
        setting('acrylic', 'true')
        fixture = subprocess.Popen(['/usr/bin/python3', str(HERE / 'ctxprobe/acrylic-fixture.py')], env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            windows = json.loads(shell.trigger('windows'))
            if any(w['title'] == 'W11 Acrylic Fixture' and w['frame'][2] > 1000 for w in windows):
                break
            if fixture.poll() is not None:
                raise RuntimeError(fixture.stderr.read())
            time.sleep(0.1)
        else:
            raise RuntimeError('合成背景没有出现在隔离桌面中')
        shell.pointer([{'move': [60, 500]}, {'wait': 300}])
        time.sleep(1)
        options = {'framerate': ctx.GLib.Variant('i', 20),
                   'draw-cursor': ctx.GLib.Variant('b', False),
                   'pipeline': ctx.GLib.Variant('s', 'capsfilter caps=video/x-raw,max-framerate=20/1 ! '
                                               'videoconvert ! avenc_ffv1 ! matroskamux')}
        ok, video = cast('Screencast', ctx.GLib.Variant('(sa{sv})', (str(work / 'trail'), options)))
        assert ok, '隔离桌面无损录屏没有启动'
        recording = True
        start = time.monotonic()
        time.sleep(2)
        bar_ref = time.monotonic() - start - 1
        panel = dump()['panel']
        moves = [step for x in range(560, 1280, 16)
                 for step in [{'move': [x, panel['y'] + 24]}, {'wait': 22}]]
        moves += [{'move': [60, 500]}, {'wait': 300}]
        shell.pointer(moves)
        time.sleep(1)
        bar_after = time.monotonic() - start
        time.sleep(1)
        shell.trigger('start-menu')
        time.sleep(0.8)
        # 模态 grab 建立时的首个 pick 可暂留在第一块 tile，先送真实 motion 归位。
        shell.pointer([{'move': [60, 501]}, {'wait': 60}, {'move': [60, 500]}, {'wait': 250}])
        time.sleep(2)
        menu = dump()['startMenu']
        menu_ref = time.monotonic() - start - 1
        results['before_tile_hover'] = [tile['hovered'] for tile in menu.get('tileStates', [])]
        moves = []
        for row in range(3):
            xs = list(range(menu['x'] + 40, menu['x'] + menu['w'] - 40, 18))
            if row % 2:
                xs.reverse()
            moves.extend(step for x in xs
                         for step in [{'move': [x, menu['y'] + 140 + row * 84]}, {'wait': 20}])
        moves += [{'move': [60, 500]}, {'wait': 400}]
        shell.pointer(moves)
        time.sleep(1)
        menu_after = time.monotonic() - start
        results['after_tile_hover'] = [tile['hovered'] for tile in dump()['startMenu'].get('tileStates', [])]
        time.sleep(1)
        results['timestamps'] = dict(bar_ref=bar_ref, bar_after=bar_after, menu_ref=menu_ref,
                                     menu_after=menu_after, wall_duration=time.monotonic() - start)
        assert cast('StopScreencast')[0], '录屏没有正常停止'
        recording = False
        results['taskbar_rest'] = difference(frame(video, bar_ref, 'bar-before'), frame(video, bar_after, 'bar-after'),
                                              (540, panel['y'] + 2, 1320, panel['y'] + 46))
        region = (menu['x'] + 15, menu['y'] + 100, menu['x'] + menu['w'] - 15,
                  menu['y'] + menu['h'] - 80)
        results['start_rest'] = difference(frame(video, menu_ref, 'start-before'), frame(video, menu_after, 'start-after'), region)
        (work / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        if not args.baseline:
            for key in ['taskbar_rest', 'start_rest']:
                assert results[key]['changed_fraction'] < 0.005, (key, results[key])
            material = next(m for m in dump()['materials'] if m['name'] == 'start')
            assert material['sampling'] and material['windows'] > 0, material
            first = capture('window-red-blue')
            fixture.send_signal(signal.SIGUSR1)
            time.sleep(0.5)
            second = capture('window-green')
            results['window_live_sample'] = difference(first, second, region)
            assert results['window_live_sample']['mean_change'] > 4, results['window_live_sample']
            shell.trigger('start-menu-close')
            time.sleep(0.3)
            material = next(m for m in dump()['materials'] if m['name'] == 'start')
            assert not material['sampling'] and material['clones'] == 0, material
            for _ in range(4):
                setting('acrylic', 'false')
                assert all(not m['sampling'] and m['clones'] == 0 for m in dump()['materials'])
                setting('acrylic', 'true')
            # 使用自己启动的 Shell 进程，统计静止桌面，而不是把录屏编码开销算到材质上。
            pgid = Path(ctx.RUN, 'pid').read_text().strip()
            pid = int(subprocess.check_output(['pgrep', '-g', pgid, '-x', 'gnome-shell'], text=True).strip())
            def ticks():
                values = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
                return int(values[11]) + int(values[12])
            before, clock = ticks(), time.monotonic()
            time.sleep(4)
            results['idle_cpu_percent_of_one_core'] = round((ticks() - before) / os.sysconf('SC_CLK_TCK') /
                                                           (time.monotonic() - clock) * 100, 2)
            assert results['idle_cpu_percent_of_one_core'] < 15, results
            assert 'JS ERROR' not in Path(ctx.RUN, 'shell.log').read_text()
        print(json.dumps(results, ensure_ascii=False, indent=2), flush=True)
        print(('旧实现观测完成' if args.baseline else '录帧、窗口采样、启停清理与静止开销检查通过，0 项失败') + f'；合成测试记录：{work}', flush=True)
    finally:
        if recording:
            cast('StopScreencast')
        shell.trigger('start-menu-close')
        for key, value in saved.items():
            setting(key, value)
        if fixture:
            fixture.terminate()
            try:
                fixture.wait(4)
            except subprocess.TimeoutExpired:
                fixture.kill()
                fixture.wait()


if __name__ == '__main__':
    main()
