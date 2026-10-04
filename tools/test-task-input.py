#!/usr/bin/python3
"""在隔离 Shell 中验证真实左键点击和预览关闭；先运行 testbed.sh start。"""
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

APP = 'org.gnome.Calculator.desktop'


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN) / 'config'),
               DBUS_SESSION_BUS_ADDRESS=shell.address,
               WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
               XDG_DATA_HOME=str(Path(ctx.RUN) / 'app-data'))
    env.pop('DISPLAY', None)
    app = None

    def dump():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry',
                                     None, ctx.GLib.VariantType('(s)'),
                                     ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(reply.unpack()[0])

    def wait_for(predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.1)
        raise AssertionError('等待输入结果超时')

    def click_button():
        button = next(b for b in dump()['bars'][0]['buttons'] if b['id'] == APP)
        centre = [button['x'] + button['w'] // 2, button['y'] + button['h'] // 2]
        shell.pointer([{'move': centre}, {'wait': 50}, {'press': 1}, {'wait': 40},
                       {'release': 1}, {'wait': 50}, {'move': [1600, 500]}, {'wait': 400}])

    def restore_focus():
        if dump()['focusApp'] != APP:
            click_button()
        wait_for(lambda: dump()['focusApp'] == APP)

    try:
        # 再运行一次 Calculator 会创建第二个窗口；此用例必须保持单窗口，不能测成缩略图行为。
        if not any(b['id'] == APP and b['windows'] > 0 for b in dump()['bars'][0]['buttons']):
            app = subprocess.Popen(['gnome-calculator'], env=env,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shell.trigger('windows')
        shell.pointer([{'move': [960, 540]}, {'wait': 250}])
        wait_for(lambda: any(b['id'] == APP and b['windows'] > 0
                            for b in dump()['bars'][0]['buttons']))
        time.sleep(1)
        button = next(b for b in dump()['bars'][0]['buttons'] if b['id'] == APP)
        assert button['windows'] == 1, f"此用例需要一个 Calculator 窗口，实际为 {button['windows']}"
        restore_focus()
        click_button()
        wait_for(lambda: dump()['focusApp'] != APP)
        print('ok 左键点击活动任务可最小化', flush=True)

        shell.trigger('windows')
        time.sleep(0.6)
        click_button()
        wait_for(lambda: dump()['focusApp'] == APP)
        print('ok 再次左键点击可还原窗口', flush=True)

        shell.trigger('preview-first')
        wait_for(lambda: dump()['bars'][0]['preview']['visible'])
        window = next(w for w in json.loads(shell.trigger('windows'))
                      if w['wmClass'] and 'calculator' in w['wmClass'].lower())
        x, y, w, h = window['frame']
        shell.pointer([{'move': [x + w // 2, y + h // 2]}, {'wait': 50},
                       {'press': 1}, {'wait': 40}, {'release': 1}, {'wait': 500}])
        wait_for(lambda: not dump()['bars'][0]['preview']['visible'])
        print('ok 点击应用窗口可关闭预览，无空事件目标异常', flush=True)

        log = Path(ctx.RUN, 'shell.log').read_text()
        assert 'JS ERROR' not in log, '测试 Shell 出现 JS ERROR'
        print('3 项输入检查通过，0 项失败', flush=True)
    finally:
        if app:
            app.terminate()
            try:
                app.wait(timeout=5)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()


if __name__ == '__main__':
    main()
