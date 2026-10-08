#!/usr/bin/python3
"""自动尺寸、50 个隔离应用按钮和真实滚轮/快捷键；仅修改 testbed。"""
import argparse
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
    parser = argparse.ArgumentParser()
    parser.add_argument('--expected-size', type=int, default=48)
    parser.add_argument('--expected-columns', type=int, default=6)
    args = parser.parse_args()
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')), DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    saved = {key: subprocess.check_output(command + ['get', schema, key], env=env, text=True).strip()
             for key in ['position', 'taskbar-size-mode', 'taskbar-size', 'search-style', 'start-layout', 'start-menu']}
    favorites = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', 'favorite-apps'], env=env, text=True).strip()
    count = 0
    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)
    def geometry():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                     ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(reply.unpack()[0])
    def bar():
        return geometry()['bars'][0]
    def check(label, predicate, timeout=10):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (TypeError, KeyError):
                pass
            time.sleep(0.08)
        raise AssertionError(label + ': ' + json.dumps(bar(), ensure_ascii=False))
    applications = Path(ctx.RUN, 'data', 'applications')
    applications.mkdir(parents=True, exist_ok=True)
    files = []
    try:
        setting('position', "'bottom'")
        setting('taskbar-size-mode', "'auto'")
        setting('search-style', "'auto'")
        setting('start-layout', "'auto'")
        setting('start-menu', 'true')
        check('自动粗细按逻辑尺寸选择', lambda: bar()['size'] == args.expected_size)
        check('舞台缩放只应用一次', lambda: abs(bar()['thickness'] / geometry()['scaleFactor'] - args.expected_size) < 0.01)
        shell.trigger('start-menu')
        check('自动 Start 列数符合显示器大小', lambda: bar()['startMenu']['layout']['columns'] == args.expected_columns)
        shell.trigger('start-menu-close')
        setting('taskbar-size-mode', "'manual'")
        setting('taskbar-size', '64')
        check('手动粗细仍覆盖自动值', lambda: bar()['size'] == 64)
        setting('taskbar-size-mode', "'auto'")
        check('切回自动不把派生值写回手动设置', lambda: bar()['size'] == args.expected_size and
              subprocess.check_output(command + ['get', schema, 'taskbar-size'], env=env, text=True).strip() == '64')
        ids = []
        for index in range(50):
            app_id = f'w11-adaptive-fixture-{index:02d}.desktop'
            path = applications / app_id
            with path.open('x') as stream:
                stream.write('[Desktop Entry]\nType=Application\n'
                             f'Name=W11 Adaptive Fixture {index:02d}\nExec=/usr/bin/true\n'
                             'Icon=application-x-executable\n')
            files.append(path)
            ids.append(app_id)
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps', repr(ids)], env=env, check=True)
        check('50 个隔离应用按钮被加载', lambda: sum(b['id'].startswith('w11-adaptive-fixture-') for b in bar()['buttons']) == 50)
        check('搜索优先缩为图标且应用条进入滚动模式', lambda: bar()['search']['style'] == 'icon' and bar()['taskScroll']['overflow'])
        check('滚动容器不盖住系统控件', lambda: bar()['taskScroll']['x'] + bar()['taskScroll']['w'] <= bar()['rightZone']['x'] + 1)
        scale = geometry()['scaleFactor']
        check('不无限缩小应用按钮', lambda: all(b['w'] / scale >= 36 for b in bar()['buttons']))
        scroll = bar()['taskScroll']
        shell.pointer([{'move': [scroll['x'] + scroll['w'] / 2, scroll['y'] + scroll['h'] / 2]}, {'wait': 150},
                       *[step for _ in range(6) for step in [{'scroll': 'DOWN'}, {'wait': 60}]]])
        check('真实滚轮让受约束的应用条移动', lambda: bar()['taskScroll']['offset'] > 0)
        shell.trigger('keys:' + json.dumps([{'press': 0xffeb}, {'press': ord('1')}, {'release': ord('1')},
                                            {'release': 0xffeb}, {'wait': 250}]))
        check('Super+1 把首个应用按钮重新滚入视野', lambda: bar()['taskScroll']['offset'] == 0)
    finally:
        shell.trigger('start-menu-close')
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps', favorites], env=env, check=True)
        for name, value in saved.items():
            setting(name, value)
        for path in files:
            path.unlink(missing_ok=True)
    print(f'自动尺寸与溢出 UI：{count} 项通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
