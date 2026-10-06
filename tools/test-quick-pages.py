#!/usr/bin/python3
"""只在隔离 Shell 验证分页、右键、紧凑操作和日历/菜单锚点；不触发电源动作。编辑见 test-quick-edit.py。"""
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

    def settled(get, timeout=3):
        # What a sliding page reports mid-way is not where it ends up.
        end = time.monotonic() + timeout
        last = None
        while time.monotonic() < end:
            current = get()
            if current == last:
                return current
            last = current
            time.sleep(0.1)
        return last

    def click(rect, button=1):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]},
                       {'wait': 60}, {'press': button}, {'wait': 80}, {'release': button}, {'wait': 350}])

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 400}])
    shell.trigger('quick-settings')
    check('快捷主页面可见且打开动画已接受输入', lambda: quick() is not None and not quick()['inputMuted'])
    main_height = quick()['content']['h']
    # 页脚借走编辑按钮后，网格增删卡片引起的重排不能再去排它（曾触发 Clutter-CRITICAL）。
    log = Path(ctx.RUN) / 'shell.log'
    seen = log.read_text(errors='replace').count('set_child_at_index')
    shell.trigger('test-wireless-toggle')
    time.sleep(0.6)
    shell.trigger('test-wireless-remove')
    time.sleep(0.6)
    check('页脚借走的编辑按钮不再参与网格重排',
          lambda: log.read_text(errors='replace').count('set_child_at_index') == seen)
    shell.trigger('wifi-submenu')
    check('Wi-Fi 是完整子页而非原地展开', lambda: quick()['page']['title'] is not None and
          not quick()['page']['gridVisible'])
    check('子页没有把弹层撑高', lambda: quick()['content']['h'] <= max(main_height, 410))
    click(settled(lambda: quick()['page']['back']))
    check('返回按钮恢复主页面', lambda: quick()['page']['title'] is None and quick()['page']['gridVisible'])
    tile = settled(lambda: next(t for t in quick()['tiles'] if t['visible']))
    click(tile, 3)
    check('快捷卡片右键菜单可用', lambda: quick()['page']['contextOpen'])
    check('右键菜单提供设置或选项', lambda: any(i['label'] in ['Go to Settings', 'Open options']
          for i in quick()['page']['contextItems']))
    shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 60}, {'release': 0xff1b}]))
    time.sleep(.3)
    shell.trigger('test-quick-action')
    check('快捷面板不放电源按钮，Reboot Into 磁贴也隐藏', lambda: not quick()['page']['power']['visible'] and
          'Reboot Into' in quick()['page']['hiddenTiles'] and
          all(t['title'] != 'Reboot Into' or not t['visible'] for t in quick()['tiles']))
    shell.trigger('quick-settings-close')
    time.sleep(0.4)
    shell.trigger('start-menu')
    time.sleep(0.5)
    click(settled(lambda: dump()['startMenu']['powerButton']))
    def start_power():
        return dump()['startMenu']['powerMenu']
    def after_restart(labels, entry):
        # Just after Restart; last where the session cannot restart, as
        # the isolated shell cannot.
        place = labels.index(entry)
        return place == labels.index('Restart') + 1 if 'Restart' in labels else place == len(labels) - 1
    check('开始菜单的电源菜单在 Restart 后（没有 Restart 时在最后）列出 Reboot into…',
          lambda: start_power() and after_restart([i['label'] for i in start_power()['items']], 'Reboot into…'))
    reboot = next(i for i in start_power()['items'] if i['label'] == 'Reboot into…')
    click(reboot)
    entry = settled(lambda: next(sub for i in start_power()['items'] if i['label'] == 'Reboot into…'
                                 for sub in i['submenu'] if sub['label'] == 'Test entry — no power action'))
    before = dump()['testClicks']
    click(entry)
    check('开始菜单里选启动项会执行原扩展的动作并收起开始菜单', lambda: dump()['testClicks'] == before + 1 and
          not dump()['startMenu']['open'])
    shell.trigger('quick-links')
    time.sleep(0.4)
    def shutdown_submenu():
        item = next(i for i in dump()['quickLinks']['items'] if i['label'] == 'Shut down or sign out')
        return [sub['label'] for sub in item['submenu']]
    check('Win+X 的关机或注销在 Restart 后（没有 Restart 时在最后）列出启动项',
          lambda: after_restart(shutdown_submenu(), 'Reboot into Test entry — no power action'))
    shell.trigger('quick-links-close')
    time.sleep(0.3)
    shell.trigger('test-quick-action-remove')
    shell.trigger('quick-settings')
    time.sleep(0.6)
    shell.trigger('test-wireless-toggle')
    time.sleep(0.4)
    shell.trigger('test-wireless-open')
    check('WLAN 类子页标题右侧显示开关，原生大标题隐藏',
          lambda: quick()['page']['title'] == 'Test Wi-Fi' and quick()['page']['switch']['visible'] and
          quick()['page']['nativeHeaderVisible'] is False)
    before = quick()['page']['testWireless']['checked']
    off_knob = quick()['page']['switch']['knob']['x']
    click(settled(lambda: quick()['page']['switch']))
    check('页头开关真正切换原生卡片状态', lambda: quick()['page']['testWireless']['checked'] != before and
          quick()['page']['switch']['checked'] != before)
    check('开关圆点随状态移动', lambda: quick()['page']['switch']['knob']['x'] != off_knob)
    click(settled(lambda: quick()['page']['back']))
    check('返回后恢复原生标题，供 GNOME 自身使用', lambda: quick()['page']['title'] is None and
          quick()['page']['testWireless']['headerVisible'])
    shell.trigger('test-wireless-remove')
    shell.trigger('quick-settings-close')
    shell.trigger('quick-links')
    time.sleep(.4)
    menu = dump()['quickLinks']
    first = menu['items'][0]
    start = dump()['startButton']
    assert abs(first['x'] + first['w'] / 2 - start['x'] - start['w'] / 2) < 20, (first, start)
    count += 1
    print('ok Win+X 相对开始图标居中', flush=True)
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
    # 收起开始菜单的电源条目在自己的点击里关掉菜单：菜单不能在点击松开前就被销毁。
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项子页与菜单检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
