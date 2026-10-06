#!/usr/bin/python3
"""任务栏的搜索，按 Windows 任务栏设置的四种样式；只在隔离 testbed 中运行。

实测（SEARCH in lib/spec.js）：仅图标是 44×48 的格子、24px 放大镜；图标加文字是 106×48 的
格子，中间一个 98×32 的胶囊；搜索框是 220×32、离开始和任务视图各 2px，胶囊 216×32 ——
这里取 224 的格子，胶囊离两边各 4px。隐藏时开始与任务视图相邻。点它打开开始菜单；
任务栏立在侧边时只放得下图标。
"""
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
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    keys = ['search-style', 'position']
    count = 0

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)

    def bar():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

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
            except (TypeError, KeyError) as error:
                last = error
            time.sleep(0.08)
        b = bar()
        raise AssertionError(f'{label}: {last} search={b.get("search")} start={b.get("startButton")} '
                             f'taskView={b.get("taskViewButton")}')

    def styled(style):
        return lambda: bar()['search']['style'] == style

    try:
        setting('position', "'bottom'")
        setting('search-style', "'box'")
        check('搜索框样式', styled('box'))
        b = bar()
        start, search, task, pill = b['startButton'], b['search'], b['taskViewButton'], b['search']['pill']
        check('搜索框：224 宽的格子，胶囊 216×32 竖向居中', lambda: (lambda s, p: s['w'] == 224 and s['h'] == 48 and
              p['w'] == 216 and p['h'] == 32 and p['y'] - s['y'] == 8)(bar()['search'], bar()['search']['pill']))
        check('搜索框：胶囊离开始和任务视图各 4px（Windows 的框是各 2px，框内又 2px）',
              lambda: (lambda b: b['search']['pill']['x'] - (b['startButton']['x'] + b['startButton']['w']) == 4 and
                       b['taskViewButton']['x'] - (b['search']['pill']['x'] + b['search']['pill']['w']) == 4)(bar()))
        check('搜索框：放大镜和占位文字“Search”', lambda: bar()['search']['label'] == 'Search' and
              bar()['search']['glyph'] == 16)

        setting('search-style', "'icon-label'")
        check('图标加文字：106 宽的格子，98×32 的胶囊居中', lambda: (lambda s, p: s['w'] == 106 and s['h'] == 48 and
              p['w'] == 98 and p['h'] == 32 and p['x'] - s['x'] == 4 and p['y'] - s['y'] == 8)(
              bar()['search'], bar()['search']['pill']))
        check('图标加文字：开始、搜索、任务视图相邻', lambda: (lambda b: b['search']['x'] ==
              b['startButton']['x'] + b['startButton']['w'] and b['taskViewButton']['x'] ==
              b['search']['x'] + b['search']['w'])(bar()))

        setting('search-style', "'icon'")
        check('仅图标：44×48 的格子，24px 放大镜，没有文字', lambda: (lambda s: s['w'] == 44 and s['h'] == 48 and
              s['glyph'] == 24 and s['label'] is None)(bar()['search']))

        setting('search-style', "'hidden'")
        check('隐藏：开始与任务视图相邻', lambda: not bar()['search']['visible'] and (lambda b: b['taskViewButton']['x'] ==
              b['startButton']['x'] + b['startButton']['w'])(bar()))

        # 悬停：图标加文字和搜索框只有胶囊变亮，格子本身不画底色；仅图标是整格变暗或变亮。
        def alpha(color):
            return int(color[-2:], 16) if color else None

        def hover_case(style, scheme, cell, pill):
            setting('search-style', f"'{style}'")
            check(f'{scheme}：{style} 样式', styled(style))
            time.sleep(0.4)
            s = bar()['search']
            shell.pointer([{'move': [960, 500]}, {'wait': 150},
                           {'move': [s['x'] + s['w'] // 2, s['y'] + s['h'] // 2]}, {'wait': 300}])
            # St 把 CSS 的透明度换成 0–255 时可能差 1。
            check(f'{scheme}：悬停 {style}，格子底色 α≈{cell}' + (f'、胶囊 α≈{pill}' if pill is not None else ''),
                  lambda: (lambda s: s['hover'] and abs(alpha(s['cellColor']) - cell) <= 1 and
                           (pill is None or abs(alpha(s['pillColor']) - pill) <= 1))(bar()['search']))
            shell.pointer([{'move': [960, 500]}, {'wait': 200}])

        # 浅色：胶囊白 0.7，悬停 0.86；仅图标的格子 6% 黑。暗色：胶囊悬停 8.37% 白；格子 8% 白。
        hover_case('box', '浅色', 0, round(0.86 * 255))
        hover_case('icon-label', '浅色', 0, round(0.86 * 255))
        hover_case('icon', '浅色', round(0.06 * 255), None)
        subprocess.run(['gsettings', 'set', 'org.gnome.desktop.interface', 'color-scheme', 'prefer-dark'],
                       env=env, check=True)
        time.sleep(1)
        hover_case('box', '暗色', 0, round(0.0837 * 255))
        hover_case('icon-label', '暗色', 0, round(0.0837 * 255))
        hover_case('icon', '暗色', round(0.08 * 255), None)
        subprocess.run(['gsettings', 'reset', 'org.gnome.desktop.interface', 'color-scheme'], env=env, check=True)
        time.sleep(1)

        setting('search-style', "'box'")
        check('换回搜索框', styled('box'))
        time.sleep(0.5)
        s = bar()['search']['pill']
        shell.pointer([{'move': [s['x'] + s['w'] // 2, s['y'] + s['h'] // 2]}, {'wait': 120},
                       {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 500}])
        check('点搜索打开开始菜单', lambda: bar()['startMenu']['open'])
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 50}, {'release': 0xff1b}]))
        check('Esc 收起开始菜单', lambda: not bar()['startMenu']['open'])

        setting('position', "'left'")
        check('任务栏立在左边：只放得下图标', styled('icon'), timeout=10)
    finally:
        for key in keys:
            subprocess.run(command + ['reset', schema, key], env=env, check=True)
        subprocess.run(['gsettings', 'reset', 'org.gnome.desktop.interface', 'color-scheme'], env=env, check=True)
        time.sleep(1.5)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项任务栏搜索检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
