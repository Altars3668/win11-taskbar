#!/usr/bin/python3
"""菜单真实输入回归；只操作 testbed.sh 的隔离桌面，不执行注销等系统动作。"""
import importlib.util
import json
import os
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)


@contextmanager
def selected_resources(shell):
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    cmd = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    saved = subprocess.check_output(cmd + ['get', schema, 'start-folders'], env=env, text=True).strip()
    try:
        subprocess.run(cmd + ['set', schema, 'start-folders', "['files', 'settings', 'resources']"], env=env, check=True)
        time.sleep(0.25)
        yield
    finally:
        subprocess.run(cmd + ['set', schema, 'start-folders', saved], env=env, check=True)


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry',
                                     None, ctx.GLib.VariantType('(s)'),
                                     ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(reply.unpack()[0])

    def check(label, predicate):
        nonlocal count
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.05)
        raise AssertionError(label)

    def click(rect):
        shell.pointer([{'move': [rect['x'] + rect['w'] // 2, rect['y'] + rect['h'] // 2]},
                       {'wait': 60}, {'press': 1}, {'wait': 80}, {'release': 1}, {'wait': 350}])

    def escape():
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 40},
                                            {'release': 0xff1b}, {'wait': 250}]))
        time.sleep(0.4)

    shell.trigger('windows')
    shell.pointer([{'move': [960, 540]}, {'wait': 250}])
    time.sleep(1)
    click(dump()['bars'][0]['startButton'])
    check('真实左键可打开开始菜单', lambda: dump()['bars'][0]['startMenu']['open'])
    shell.pointer([{'move': [60, 400]}, {'wait': 60}, {'press': 1}, {'wait': 80},
                   {'release': 1}, {'wait': 250}])
    check('点菜单外的空白处可关闭开始菜单', lambda: not dump()['bars'][0]['startMenu']['open'])

    click(dump()['bars'][0]['startButton'])
    check('再次点击可打开开始菜单', lambda: dump()['bars'][0]['startMenu']['open'])
    escape()
    check('焦点在搜索框时 Esc 也能关闭', lambda: not dump()['bars'][0]['startMenu']['open'])

    shell.trigger('start-menu')
    shell.trigger('start-menu-close')
    shell.trigger('start-menu')
    time.sleep(0.45)
    check('关闭动画中重新打开不会被旧回调隐藏',
          lambda: dump()['bars'][0]['startMenu']['open'] and dump()['bars'][0]['startMenu']['visible'])
    account = dump()['bars'][0]['startMenu']['accountButton']
    click(account)
    check('用户头像弹出账户菜单', lambda: dump()['bars'][0]['startMenu']['accountMenuOpen'])
    check('账户菜单包含用户信息入口',
          lambda: 'Account information' in dump()['bars'][0]['startMenu']['accountMenuItems'])
    def account_anchored():
        start = dump()['bars'][0]['startMenu']
        menu, button = start['accountMenu'], start['accountButton']
        return (abs(menu['x'] + menu['w'] / 2 - button['x'] - button['w'] / 2) <= 1 and
                menu['y'] + menu['h'] <= button['y'])
    check('账户菜单居中在账户按钮正上方', account_anchored)
    shell.trigger('start-menu-close')
    time.sleep(0.3)

    click(dump()['bars'][0]['clock'])
    check('真实点击日期打开任务栏日历', lambda: dump()['bars'][0]['notificationCentre']['open'])
    date = dump()['bars'][0]['notificationCentre']
    clock = dump()['bars'][0]['clock']
    assert date['x'] > 1000 and date['y'] > 0
    assert abs(date['y'] + date['h'] - (clock['y'] - 7)) <= 2, (date, clock)
    count += 1
    print('ok 日历锚定日期按钮上方而不是左上角', flush=True)
    escape()
    check('Esc 可关闭日期面板', lambda: not dump()['bars'][0]['notificationCentre']['open'])

    shell.trigger('quick-settings')
    check('快捷面板有非透明材质底色',
          lambda: dump()['bars'][0]['quickSettings'] is not None and
          100 < dump()['bars'][0]['quickSettings']['backgroundAlpha'] < 255)
    def quick_anchored():
        bar = dump()['bars'][0]
        content = bar['quickSettings']['content']
        return (348 <= content['w'] <= 362 and
                abs(content['x'] + content['w'] - (1920 - 12)) <= 2 and
                abs(content['y'] + content['h'] - (bar['panel']['y'] - 6)) <= 2)
    check('快捷面板离屏幕右侧 12px、离任务栏 6px', quick_anchored)
    q = dump()['bars'][0]['quickSettings']
    assert q['columns'] == 3
    cards = [tile for tile in q['tiles'] if tile['visible']]
    assert cards
    for tile in cards:
        assert 90 <= tile['card']['w'] <= 103, tile
        assert 46 <= tile['card']['h'] <= 51, tile
        assert tile['labels']['y'] >= tile['card']['y'] + tile['card']['h'] - 1, tile
    count += 1
    print('ok 三列矩形卡片，文字在卡片下方：' + str([(t['title'], t['card']['w'], t['card']['h']) for t in cards]), flush=True)
    shell.trigger('quick-settings-close')

    with selected_resources(shell):
        shell.trigger('start-menu')
        time.sleep(0.35)
        folders = dump()['bars'][0]['startMenu']['folderButtons']
        resource = next(button for button in folders if button['name'] == 'Task Manager')
        click(resource)
        check('选择开始菜单任务管理器后可实际启动 Resources',
              lambda: any(w['wmClass'] and 'resources' in w['wmClass'].lower() and w['frame'][2] > 0
                          for w in json.loads(shell.trigger('windows'))))
    # The window is listed, with its size, as soon as it is created; the
    # compositor maps it — and the animation is set up — a moment later.
    def launched_from_icon():
        window = next(w for w in json.loads(shell.trigger('windows'))
                      if w['wmClass'] and 'resources' in w['wmClass'].lower())
        return window['launchOrigin'] and window['launchAnimationApplied']
    check('新窗口从被点击的图标位置展开', launched_from_icon)

    shell.trigger('quick-links')
    time.sleep(0.3)
    entry = next(item for item in dump()['bars'][0]['quickLinks']['items']
                 if item['label'] == 'Task Manager')
    click(entry)
    check('Win+X 的任务管理器同样连接 Resources',
          lambda: dump()['focusApp'] == 'net.nokyan.Resources.desktop')

    buttons = dump()['bars'][0]['buttons'][:2]
    for button in buttons:
        shell.pointer([{'move': [button['x'] + button['w'] // 2, button['y'] + button['h'] // 2]},
                       {'wait': 150}])
    shell.pointer([{'move': [1300, 500]}, {'wait': 100}])
    check('指针离开图标后高亮取消且缩放迅速归位',
          lambda: all(not b['hovered'] and abs(b['iconScale'] - 1) < 0.005
                      for b in dump()['bars'][0]['buttons']))

    log = Path(ctx.RUN, 'shell.log').read_text()
    assert 'JS ERROR' not in log, '测试出现 JS ERROR'
    print(f'{count} 项菜单输入检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
