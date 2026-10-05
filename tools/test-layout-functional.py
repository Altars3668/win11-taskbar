#!/usr/bin/python3
"""工作区占位、输入法真实调用模型和开始菜单模式；仅操作隔离桌面。"""
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
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')), DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    cmd = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    saved = subprocess.check_output(cmd + ['get', schema, 'start-layout'], env=env, text=True).strip()
    fake = subprocess.Popen(['gjs', '-m', str(HERE / 'fake-fcitx.js')], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None, 0, 3000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def check(label, predicate):
        nonlocal count
        end = time.monotonic() + 10
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(.1)
        raise AssertionError(label)

    def click(rect):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]},
                       {'wait': 80}, {'press': 1}, {'wait': 80}, {'release': 1}, {'wait': 400}])

    def setting(value):
        subprocess.run(cmd + ['set', schema, 'start-layout', value], env=env, check=True)
        time.sleep(.25)

    try:
        shell.trigger('windows')
        shell.pointer([{'move': [960, 540]}, {'wait': 300}])
        time.sleep(1)
        check('隐藏顶栏真正释放顶边工作区', lambda: dump()['workArea']['y'] == 0 and dump()['workArea']['h'] == 1032)
        check('读取配置组中的 Fcitx 输入法而非静态项', lambda: dump()['inputMethod']['backend'] == 'fcitx' and
              {m['id'] for m in dump()['inputMethod']['methods']} == {'keyboard-us', 'rime'})
        click(dump()['inputMethod']['button'])
        check('语言面板可以打开', lambda: dump()['inputMethod']['menuOpen'])
        row = next(r for r in dump()['inputMethod']['items'] if r['label'] == 'Rime')
        click(row)
        check('选择后实际调用 Fcitx 切换并更新标签', lambda: dump()['inputMethod']['label'] == '中')
        current = shell.conn.call_sync('org.fcitx.Fcitx5', '/controller', 'org.fcitx.Fcitx.Controller1',
                                      'CurrentInputMethod', None, None, 0, 3000, None).unpack()[0]
        assert current == 'rime', current
        # 同一应用两条、另一应用一条；GNOME 默认会把同源通知叠成一组并缩进。
        for app_name, summary in [('Alpha App', 'First alpha'), ('Alpha App', 'Second alpha'),
                                  ('Beta App', 'Only beta')]:
            shell.conn.call_sync('org.freedesktop.Notifications', '/org/freedesktop/Notifications',
                                 'org.freedesktop.Notifications', 'Notify',
                                 ctx.GLib.Variant('(susssasa{sv}i)', (app_name, 0, 'dialog-information-symbolic',
                                                  summary, 'Body text', [], {}, -1)),
                                 None, 0, 3000, None)
        time.sleep(0.6)
        shell.trigger('notifications')
        check('三条通知各自成卡，不叠放', lambda: len(dump()['notificationCentre']['cards']) == 3)
        time.sleep(0.5)
        centre = dump()['notificationCentre']
        cards = sorted(centre['cards'], key=lambda c: c['y'])
        panel = centre['panel']
        for upper, lower in zip(cards, cards[1:]):
            assert upper['y'] + upper['h'] <= lower['y'], ('通知卡片重叠', upper, lower)
        for card in cards:
            left = card['x'] - panel['x']
            right = panel['x'] + panel['w'] - card['x'] - card['w']
            assert abs(left - right) <= 2 and card['w'] >= panel['w'] - 30, ('通知左右间距不对称', card, panel)
        count += 1
        print('ok 通知卡片互不重叠，左右间距对称、占满列宽', flush=True)
        shell.trigger('notifications-close')
        setting("'fullscreen'")
        shell.trigger('start-menu')
        check('全屏开始菜单按可用工作区展开', lambda: dump()['startMenu']['w'] >= 1800 and dump()['startMenu']['h'] >= 980)
        shell.trigger('start-menu-close')
        setting("'app-grid'")
        click(dump()['startButton'])
        check('应用程序屏幕模式真正打开 GNOME 应用视图', lambda: dump()['shell']['overviewVisible'] and not dump()['startMenu']['open'])
        shell.trigger('windows')
        print(f'{count} 项功能布局检查通过，0 项失败')
    finally:
        subprocess.run(cmd + ['set', schema, 'start-layout', saved], env=env, check=True)
        fake.terminate()
        try:
            fake.wait(timeout=4)
        except subprocess.TimeoutExpired:
            fake.kill(); fake.wait()


if __name__ == '__main__':
    main()
