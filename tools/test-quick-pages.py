#!/usr/bin/python3
"""只在隔离 Shell 验证分页、编辑、右键、紧凑操作和日历/菜单锚点；不触发电源动作。"""
import importlib.util
import json
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
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                 ctx.GLib.VariantType('(s)'), ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def quick():
        return dump()['quickSettings']

    def check(label, predicate):
        nonlocal count
        end = time.monotonic() + 8
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.08)
        raise AssertionError(label)

    def click(rect, button=1):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]},
                       {'wait': 60}, {'press': button}, {'wait': 80}, {'release': button}, {'wait': 350}])

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 400}])
    shell.trigger('quick-settings')
    check('快捷主页面可见', lambda: quick() is not None)
    main_height = quick()['content']['h']
    shell.trigger('wifi-submenu')
    check('Wi-Fi 是完整子页而非原地展开', lambda: quick()['page']['title'] is not None and
          not quick()['page']['gridVisible'])
    check('子页没有把弹层撑高', lambda: quick()['content']['h'] <= max(main_height, 410))
    click(quick()['page']['back'])
    check('返回按钮恢复主页面', lambda: quick()['page']['title'] is None and quick()['page']['gridVisible'])
    click(quick()['editor']['button'])
    check('编辑是有明确选择项的独立页面', lambda: quick()['editor']['editing'] and len(quick()['editor']['rows']) > 0)
    row = quick()['editor']['rows'][0]
    click(row)
    check('编辑移除会变成添加，且不切换设备状态', lambda: any(r['title'] == row['title'] and r['action'] == 'Add'
          for r in quick()['editor']['rows']))
    click(next(r for r in quick()['editor']['rows'] if r['title'] == row['title']))
    shell.trigger('quick-page-back')
    check('退出编辑没有拦截残留', lambda: not quick()['editor']['editing'])
    tile = next(t for t in quick()['tiles'] if t['visible'])
    click(tile, 3)
    check('快捷卡片右键菜单可用', lambda: quick()['page']['contextOpen'])
    check('右键菜单提供设置或选项', lambda: any(i['label'] in ['Go to Settings', 'Open options']
          for i in quick()['page']['contextItems']))
    shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 60}, {'release': 0xff1b}]))
    time.sleep(.3)
    shell.trigger('test-quick-action')
    check('Reboot Into 被收进底部而非独占一排', lambda: len(quick()['page']['footerActions']) == 1 and
          all(t['title'] != 'Reboot Into' or not t['visible'] for t in quick()['tiles']))
    click(quick()['page']['footerActions'][0])
    check('底部操作也使用子页', lambda: quick()['page']['title'] == 'Reboot Into' and not quick()['page']['gridVisible'])
    shell.trigger('quick-page-back')
    shell.trigger('test-quick-action-remove')
    shell.trigger('quick-settings-close')
    shell.trigger('quick-links')
    time.sleep(.4)
    menu = dump()['quickLinks']
    first = menu['items'][0]
    start = dump()['startButton']
    assert abs(first['x'] - start['x']) < 20, (first, start)
    count += 1
    print('ok Win+X 的左边缘锚定开始按钮', flush=True)
    shell.trigger('quick-links-close')
    shell.trigger('notifications')
    time.sleep(.4)
    centre = dump()['notificationCentre']
    columns = sorted(centre['weekdays'], key=lambda d: d['x'])
    assert len(columns) == 7
    left = columns[0]['x'] - centre['panel']['x']
    right = centre['panel']['x'] + centre['panel']['w'] - columns[-1]['x'] - columns[-1]['w']
    assert abs(left - right) <= 4, (left, right, columns)
    count += 1
    print('ok 日历七列左右留白平衡', flush=True)
    shell.trigger('notifications-close')
    log = Path(ctx.RUN, 'shell.log').read_text()
    assert 'JS ERROR' not in log and 'Exception in callback' not in log
    print(f'{count} 项子页与菜单检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
