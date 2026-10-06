#!/usr/bin/python3
"""快捷面板滑块的 Windows 式手柄；只在隔离 testbed 中运行，只操作调试服务加的假滑块。

真实的音量滑块连着本机的 PipeWire，这里绝不碰它。手柄落在 GNOME 原手柄的位置；
指针移上去内点变大，按住时变小，都带过渡；拖动时上方显示数值，松开后消失。
"""
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

REST, HOVER, HELD = 12 / 14, 1.0, 10 / 14


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def test_slider():
        quick = dump()['quickSettings']
        return next((s for s in (quick or {}).get('sliders', []) if s['test']), None)

    def check(label, predicate, timeout=5):
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
            time.sleep(0.05)
        raise AssertionError(f'{label}: {test_slider()}')

    def centre(rect):
        return rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])
    try:
        shell.trigger('quick-settings')
        time.sleep(0.6)
        shell.trigger('test-slider')
        check('假滑块带上了 Windows 式手柄', lambda: test_slider() is not None)

        def on_handle():
            s = test_slider()
            slider, thumb = s['slider'], s['thumb']
            radius = 10
            expected = slider['x'] + radius + (slider['w'] - 2 * radius) * s['value']
            return abs(centre(thumb)[0] - expected) <= 1.5 and abs(centre(thumb)[1] - centre(slider)[1]) <= 1.5
        check('手柄在 GNOME 原手柄的位置', on_handle)
        check('静止时内点为 12px', lambda: abs(test_slider()['dot'] - REST) < 0.01)

        x, y = centre(test_slider()['slider'])
        shell.pointer([{'move': [x, y - 2]}, {'wait': 250}])
        check('指针移上去内点变大', lambda: abs(test_slider()['dot'] - HOVER) < 0.01)

        slider = test_slider()['slider']
        target = slider['x'] + slider['w'] * 0.75
        shell.pointer([{'move': [target, y]}, {'wait': 60}, {'press': 1}, {'wait': 250}])
        check('按住时内点变小', lambda: abs(test_slider()['dot'] - HELD) < 0.01)
        check('拖动时上方显示数值', lambda: test_slider()['tip'] is not None and
              test_slider()['tip']['y'] + test_slider()['tip']['h'] <= test_slider()['thumb']['y'] and
              int(test_slider()['tip']['text']) == round(test_slider()['value'] * 100))
        shell.pointer([{'move': [target + 20, y]}, {'wait': 120}])
        check('拖动中手柄跟着数值走', on_handle)
        shell.pointer([{'release': 1}, {'wait': 250}])
        check('松开后数值提示消失，内点回到悬停大小', lambda: test_slider()['tip'] is None and
              abs(test_slider()['dot'] - HOVER) < 0.01)
        shell.pointer([{'move': [x, y - 120]}, {'wait': 250}])
        check('移开后内点回到静止大小', lambda: abs(test_slider()['dot'] - REST) < 0.01)
    finally:
        shell.trigger('test-slider-remove')
        shell.trigger('quick-settings-close')
    print(f'{count} 项滑块手柄检查通过，0 项失败')


if __name__ == '__main__':
    main()
