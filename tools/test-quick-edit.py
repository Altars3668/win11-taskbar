#!/usr/bin/python3
"""快捷面板的 Windows 式原地编辑；只在隔离 testbed 中运行。

testbed 的 Shell 连着本机真实的 NetworkManager、蓝牙与电源服务，所以这里只按调试服务
加的假磁贴：点它、拖它、按它的取消固定钮、从“添加”里加回它。编辑时磁贴缩到九成并灰化，
右上角是 20px 的取消固定钮；拖动时其余磁贴淡到一半并让位；页脚居中只有“完成”和“添加”。
结束时复位排序与隐藏设置。
"""
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

TEST = 'Test Tile'


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def quick():
        return dump()['quickSettings']

    def editor():
        return quick()['editor']

    def tiles(visible_only=True):
        return [t for t in quick()['tiles'] if t['visible'] or not visible_only]

    def tile(title):
        return next(t for t in quick()['tiles'] if t['title'] == title)

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
            time.sleep(0.06)
        raise AssertionError(f'{label}: {last} {json.dumps(editor(), ensure_ascii=False)[:1500]}')

    def centre(rect):
        return rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2

    def click(rect, button=1):
        x, y = centre(rect)
        shell.pointer([{'move': [x, y]}, {'wait': 60}, {'press': button}, {'wait': 80},
                       {'release': button}, {'wait': 300}])

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])
    shell.trigger('quick-edit-reset')
    shell.trigger('quick-settings')
    time.sleep(0.6)
    shell.trigger('test-tile')
    check('假磁贴已加入面板', lambda: tile(TEST)['visible'])
    try:
        before_checked = tile(TEST)['checked']
        # A split tile's own frame never takes focus; its two halves do.
        focusable = {t['title']: t['canFocus'] for t in tiles()}
        click(editor()['button'])
        check('编辑按钮进入原地编辑，不再另开页面', lambda: editor()['editing'] and editor()['editingClass'] and
              quick()['page']['title'] is None and quick()['page']['gridVisible'])
        check('每块可见磁贴都有取消固定钮', lambda: sorted(b['title'] for b in editor()['badges']) ==
              sorted(t['title'] for t in tiles()))

        def badge_in_corner():
            for b in editor()['badges']:
                t = tile(b['title'])
                if (b['w'], b['h']) != (20, 20):
                    return False
                if abs(b['x'] + b['w'] - (t['x'] + t['w'])) > 1 or abs(b['y'] - t['y']) > 1:
                    return False
            return True
        check('取消固定钮 20px，贴在磁贴原来的右上角', badge_in_corner)
        check('磁贴缩到九成，圆钮压住缩小后卡片的角', lambda: all(
            abs(t['scale'] - 0.9) < 0.01 and abs(t['cardDrawn']['w'] - 0.9 * t['card']['w']) <= 1
            for t in tiles() if t['scale'] is not None))
        check('页脚只剩居中的“完成”和“添加”', lambda: not editor()['button']['visible'] and
              editor()['done']['visible'] and editor()['add']['visible'] and
              not any(editor()['footerOthers']))
        footer = quick()['page']['footer']
        done, add = editor()['done'], editor()['add']
        middle = (done['x'] + add['x'] + add['w']) / 2
        assert done['x'] + done['w'] <= add['x'], (done, add)
        assert abs(middle - (footer['x'] + footer['w'] / 2)) <= 2, (done, add, footer)
        count += 1
        print('ok “完成”在左、“添加”在右，整体居中', flush=True)
        check('没有取消固定的磁贴时“添加”不可用', lambda: not editor()['add']['reactive'])
        check('键盘焦点只落在取消固定钮和页脚上', lambda: not any(t['canFocus'] for t in tiles()))

        click(tile(TEST)['card'])
        check('编辑中点击磁贴不切换它', lambda: tile(TEST)['checked'] == before_checked and editor()['editing'])
        click(tile(TEST)['card'], 3)
        time.sleep(0.3)
        check('编辑中右键磁贴不弹菜单', lambda: not quick()['page']['contextOpen'])

        # Drag the test tile onto the first place.
        first = tiles()[0]
        if first['title'] == TEST:
            first = tiles()[1]
        start = centre(tile(TEST)['card'])
        target = centre(first['card'])
        shell.pointer([{'move': list(start)}, {'wait': 60}, {'press': 1}, {'wait': 60}])
        steps = 8
        for i in range(1, steps + 1):
            x = start[0] + (target[0] - start[0]) * i / steps
            y = start[1] + (target[1] - start[1]) * i / steps
            shell.trigger('pointer:' + json.dumps([{'move': [x, y]}]))
            time.sleep(0.03)
        check('拖动中磁贴跟着指针，原位隐去', lambda: editor()['dragging'] and editor()['clone'] and
              tile(TEST)['opacity'] == 0 and
              abs(editor()['clone']['x'] + editor()['clone']['w'] / 2 - target[0]) < 40)
        check('拖动中其余磁贴淡到一半', lambda: all(t['opacity'] < 200 for t in tiles() if t['title'] != TEST))
        check('拖到第一位时其余磁贴让位', lambda: tiles()[0]['title'] == TEST)
        shell.pointer([{'wait': 250}, {'release': 1}, {'wait': 400}])
        check('松开后落在第一位并复原', lambda: not editor()['dragging'] and editor()['clone'] is None and
              tiles()[0]['title'] == TEST and all(t['opacity'] == 255 for t in tiles()) and
              all(t['translation'] == [0, 0] for t in tiles()))
        check('新顺序写入设置', lambda: editor()['order'] and editor()['order'][0].endswith(':' + TEST))
        check('拖动没有切换磁贴', lambda: tile(TEST)['checked'] == before_checked)
        # Anything that makes the panel reorder itself keeps that order.
        shell.trigger('test-wireless-toggle')
        time.sleep(0.6)
        check('面板重排时保持用户顺序', lambda: tiles()[0]['title'] == TEST)
        shell.trigger('test-wireless-remove')
        time.sleep(0.4)

        badge = next(b for b in editor()['badges'] if b['title'] == TEST)
        shell.pointer([{'move': list(centre(badge))}, {'wait': 200}])
        check('指针移到取消固定钮上有悬停态', lambda: next(b for b in editor()['badges']
                                               if b['title'] == TEST)['hover'])
        click(badge)
        check('取消固定后磁贴离开面板', lambda: not tile(TEST)['visible'] and
              any(key.endswith(':' + TEST) for key in editor()['hidden']))
        check('取消固定后“添加”可用', lambda: editor()['add']['reactive'])
        check('其余磁贴补位后没有残留位移', lambda: all(t['translation'] == [0, 0] for t in tiles()))

        click(editor()['add'])
        check('“添加”列出已取消固定的磁贴', lambda: editor()['addOpen'] and
              [i['label'] for i in editor()['addItems']] == [TEST])
        click(next(i for i in editor()['addItems'] if i['label'] == TEST))
        check('加回的磁贴回到面板末尾', lambda: tile(TEST)['visible'] and tiles()[-1]['title'] == TEST and
              not any(key.endswith(':' + TEST) for key in editor()['hidden']))
        check('加回后仍在编辑中，带取消固定钮', lambda: editor()['editing'] and
              any(b['title'] == TEST for b in editor()['badges']) and abs(tile(TEST)['scale'] - 0.9) < 0.01)
        check('全部加回后“添加”又不可用', lambda: not editor()['add']['reactive'])

        click(editor()['done'])
        check('“完成”退出编辑：圆钮消失，磁贴复原', lambda: not editor()['editing'] and not editor()['badges'] and
              all(t['scale'] in (None, 1) or abs(t['scale'] - 1) < 0.01 for t in tiles()))
        check('页脚恢复原来的一排', lambda: editor()['button']['visible'] and not editor()['done']['visible'] and
              all(editor()['footerOthers']))
        check('磁贴的可聚焦状态复原', lambda: all(t['canFocus'] == focusable[t['title']] for t in tiles()))

        click(editor()['button'])
        check('再次进入编辑', lambda: editor()['editing'])
        shell.trigger('quick-settings-close')
        time.sleep(0.5)
        shell.trigger('quick-settings')
        check('关闭面板即退出编辑', lambda: not editor()['editing'] and not editor()['badges'])
    finally:
        shell.trigger('test-tile-remove')
        shell.trigger('test-wireless-remove')
        shell.trigger('quick-edit-reset')
        shell.trigger('quick-settings-close')
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项原地编辑检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
