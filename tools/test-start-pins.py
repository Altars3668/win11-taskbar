#!/usr/bin/python3
"""开始菜单固定项与任务栏固定项互相独立；只修改隔离桌面的设置并在结束时恢复。"""
import ast
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

CALC = 'org.gnome.Calculator.desktop'
EDITOR = 'org.gnome.TextEditor.desktop'
FILES = 'org.gnome.Nautilus.desktop'


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    shell_schema = 'org.gnome.shell'
    count = 0

    def gs(*args):
        return ['gsettings', '--schemadir', str(HERE.parent / 'schemas'), *args]

    def get(schema_id, key):
        return subprocess.check_output(gs('get', schema_id, key), env=env, text=True).strip()

    def strv(schema_id, key):
        value = get(schema_id, key)
        return [] if value.startswith('@as') else ast.literal_eval(value)

    def put(schema_id, key, value):
        subprocess.run(gs('set', schema_id, key, value), env=env, check=True)
        time.sleep(0.25)

    def pins():
        return strv(schema, 'start-pinned')

    def favorites():
        return strv(shell_schema, 'favorite-apps')

    saved_pins = get(schema, 'start-pinned')
    saved_favorites = get(shell_schema, 'favorite-apps')

    def dump():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                     None, 0, 5000, None)
        return json.loads(reply.unpack()[0])['bars'][0]

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

    def centre(rect):
        return [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]

    def click(rect, button=1):
        shell.pointer([{'move': centre(rect)}, {'wait': 80}, {'press': button}, {'wait': 80},
                       {'release': button}, {'wait': 350}])

    def tile(app_id):
        return next(t for t in dump()['startMenu']['pinnedApps'] if t['id'] == app_id)

    def menu_item(label):
        return next(i for i in dump()['startMenu']['appMenu']['items'] if i['label'] == label)

    def notifications():
        return len(dump()['notificationCentre']['cards'])

    try:
        check('首次启用时按默认类别初始化，且不等同于任务栏收藏夹',
              lambda: get(schema, 'start-pins-initialized') == 'true' and
              pins() and pins() != favorites())

        put(schema, 'start-pinned', str([CALC, EDITOR]))
        put(shell_schema, 'favorite-apps', str([FILES]))
        before_notes = notifications()
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 300}])
        time.sleep(1)
        click(dump()['startButton'])
        check('开始菜单只显示自己的固定列表',
              lambda: [t['id'] for t in dump()['startMenu']['pinnedApps']] == [CALC, EDITOR])

        target = tile(EDITOR)
        click(target, 3)
        check('右键固定图标在指针处打开应用菜单', lambda: dump()['startMenu']['appMenu'] is not None)
        menu = dump()['startMenu']['appMenu']
        pointer = centre(target)
        assert abs(menu['x'] - pointer[0]) <= 12 and 0 <= menu['y'] - pointer[1] <= 16 or \
            abs(menu['y'] + menu['h'] - pointer[1]) <= 16, (menu, pointer)
        labels = [i['label'] for i in menu['items']]
        assert labels == ['Unpin from Start', 'Move to front', 'Pin to taskbar'], labels
        count += 1
        print('ok 菜单分开列出“开始菜单”和“任务栏”两种固定：' + str(labels), flush=True)

        click(menu_item('Move to front'))
        check('移到最前只改开始菜单顺序', lambda: pins() == [EDITOR, CALC] and favorites() == [FILES])
        check('开始菜单立即按新顺序重排',
              lambda: [t['id'] for t in dump()['startMenu']['pinnedApps']] == [EDITOR, CALC])

        click(tile(CALC), 3)
        check('再次打开应用菜单', lambda: dump()['startMenu']['appMenu'] is not None)
        click(menu_item('Pin to taskbar'))
        check('固定到任务栏只改任务栏收藏夹', lambda: favorites() == [FILES, CALC] and pins() == [EDITOR, CALC])

        click(tile(CALC), 3)
        check('已固定到任务栏的应用显示“从任务栏取消固定”',
              lambda: 'Unpin from taskbar' in [i['label'] for i in dump()['startMenu']['appMenu']['items']])
        click(menu_item('Unpin from Start'))
        check('从开始菜单取消固定不影响任务栏', lambda: pins() == [EDITOR] and CALC in favorites())

        put(shell_schema, 'favorite-apps', str([FILES]))
        check('任务栏收藏夹变化不改开始菜单',
              lambda: pins() == [EDITOR] and [t['id'] for t in dump()['startMenu']['pinnedApps']] == [EDITOR])

        shell.trigger('start-menu-all-apps')
        time.sleep(0.4)
        row = next(r for r in dump()['startMenu']['listRows'] if r['text'] == 'Calculator')
        click(row, 3)
        check('所有应用列表的右键菜单可固定到开始菜单',
              lambda: 'Pin to Start' in [i['label'] for i in dump()['startMenu']['appMenu']['items']])
        click(menu_item('Pin to Start'))
        check('从所有应用固定后追加到开始菜单末尾', lambda: pins() == [EDITOR, CALC] and favorites() == [FILES])
        check('固定/取消固定没有弹出 GNOME “已固定到 Dash”通知', lambda: notifications() == before_notes)

        log = Path(ctx.RUN, 'shell.log').read_text()
        assert 'JS ERROR' not in log and 'Exception in callback' not in log
        print(f'{count} 项开始菜单独立固定检查通过，0 项失败', flush=True)
    finally:
        shell.trigger('start-menu-close')
        put(schema, 'start-pinned', saved_pins)
        put(shell_schema, 'favorite-apps', saved_favorites)


if __name__ == '__main__':
    main()
