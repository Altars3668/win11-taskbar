#!/usr/bin/python3
"""系统图标合并、显示桌面分隔线和连接式快捷按钮；只在隔离 testbed 运行。

合并图标使用假音量和电池图标，快捷按钮使用假 Wi-Fi 开关；不操作真实网络或音量。
"""
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
    parser.add_argument('--case', choices=['all', 'indicators', 'desktop', 'split'], default='all')
    args = parser.parse_args()
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')),
               DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    gs = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    saved = {
        (schema, 'position'): subprocess.check_output(gs + ['get', schema, 'position'], env=env, text=True).strip(),
        ('org.gnome.desktop.interface', 'color-scheme'): subprocess.check_output(
            gs + ['get', 'org.gnome.desktop.interface', 'color-scheme'], env=env, text=True).strip(),
    }
    count = 0

    def setting(key, value, target=schema):
        subprocess.run(gs + ['set', target, key, value], env=env, check=True)

    def bar():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def check(label, predicate, timeout=6):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.08)
        raise AssertionError(label)

    def move(rect):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]}, {'wait': 250}])

    def click(rect):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]}, {'wait': 80},
                       {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 350}])

    def alpha(color):
        return int(color[-2:], 16)

    def scheme(name):
        setting('color-scheme', repr(name), 'org.gnome.desktop.interface')
        time.sleep(0.4)

    def wireless():
        return next(t for t in bar()['quickSettings']['tiles'] if t['title'] == 'Test Wi-Fi')

    try:
        setting('position', "'bottom'")
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 400}])
        if args.case in ('all', 'indicators'):
            shell.trigger('test-system-glyphs')
            check('无头桌面有网络和两枚假系统图标', lambda: len(bar()['systemGlyphs']) >= 3)
            for name in ('default', 'prefer-dark'):
                scheme(name)
                for index in range(len(bar()['systemGlyphs'])):
                    move(bar()['systemGlyphs'][index])
                    check(f'{name}：第 {index + 1} 个图标下整组合并高亮，图标本身不画背景',
                          lambda: bar()['systemButton']['hover'] and alpha(bar()['systemButton']['background']) > 0
                          and all(not g['hover'] and alpha(g['background']) == 0
                                  for g in bar()['systemGlyphs']))
                    click(bar()['systemGlyphs'][index])
                    check('点任一图标打开同一快捷设置面板', lambda: bar()['quickSettings'] is not None)
                    shell.trigger('quick-settings-close')
                    time.sleep(0.3)
                shell.pointer([{'move': [960, 500]}, {'wait': 300}])
                check('移开后整组不再高亮', lambda: not bar()['systemButton']['hover']
                      and alpha(bar()['systemButton']['background']) == 0)
            shell.trigger('test-system-glyphs-remove')

        if args.case in ('all', 'desktop'):
            for edge in ('bottom', 'top', 'left', 'right'):
                setting('position', repr(edge))
                check(f'{edge}：任务栏已换边', lambda: bar()['edge'] == edge)
                def line_fits():
                    b = bar()
                    line, button = b['showDesktopLine'], b['showDesktop']
                    if not line or not line['visible'] or line['reactive'] or alpha(line['background']) == 0:
                        return False
                    if edge in ('bottom', 'top'):
                        return line['x'] == button['x'] and line['w'] == 1 and line['h'] == button['h'] - 16 \
                            and line['y'] == button['y'] + 8
                    return line['y'] == button['y'] and line['h'] == 1 and line['w'] == button['w'] - 16 \
                        and line['x'] == button['x'] + 8
                check('分隔线独立绘制、非交互，两端各内缩 8px', line_fits)
            setting('position', "'bottom'")
            check('任务栏回到底边', lambda: bar()['edge'] == 'bottom')
            for name in ('default', 'prefer-dark'):
                scheme(name)
                check(f'{name}：显示桌面分隔线有足够对比度',
                      lambda: alpha(bar()['showDesktopLine']['background']) >= 50)

        if args.case in ('all', 'split'):
            shell.trigger('quick-settings')
            shell.trigger('test-wireless-toggle')
            check('假 Wi-Fi 卡片已加入', lambda: any(t['title'] == 'Test Wi-Fi' for t in bar()['quickSettings']['tiles']))
            for name in ('default', 'prefer-dark'):
                scheme(name)
                t = wireless()
                main, divider, arrow = (t['controls'][key] for key in ('main', 'divider', 'arrow'))
                check('主按钮、内部分隔线、箭头区域相接，没有独立按钮间距',
                      lambda: (lambda c: c['main']['x'] + c['main']['w'] == c['divider']['x']
                               and c['divider']['x'] + c['divider']['w'] == c['arrow']['x'])(wireless()['controls']))
                check('内部分隔线两端留空，不把外框切成两个按钮',
                      lambda: (lambda t: t['controls']['divider']['y'] > t['card']['y'] + 1
                               and t['controls']['divider']['h'] < t['controls']['arrow']['h'])(wireless()))
                for key in ('main', 'arrow'):
                    move(wireless()['controls'][key])
                    check(f'{name}：悬停 {key} 时只有共享卡片绘制底色和外框',
                          lambda: all(alpha(c['background']) == 0 and c['borders'] == [0, 0, 0, 0]
                                      for c in (wireless()['controls']['main'], wireless()['controls']['arrow'])))
                before = wireless()['checked']
                click(wireless()['controls']['main'])
                check('点击左侧仅切换开关，不打开子页', lambda: wireless()['checked'] != before
                      and bar()['quickSettings']['page']['title'] is None)
                checked = wireless()['checked']
                click(wireless()['controls']['arrow'])
                check('点击箭头打开 Wi-Fi 子页，不额外切换开关',
                      lambda: bar()['quickSettings']['page']['title'] == 'Test Wi-Fi'
                      and bar()['quickSettings']['page']['testWireless']['checked'] == checked)
                click(bar()['quickSettings']['page']['back'])
                check('返回后仍是一整块连接式按钮', lambda: bar()['quickSettings']['page']['title'] is None
                      and wireless()['checked'] == checked)
            shell.trigger('test-wireless-remove')
            shell.trigger('quick-settings-close')
    finally:
        shell.trigger('quick-settings-close')
        shell.trigger('test-wireless-remove')
        shell.trigger('test-system-glyphs-remove')
        for (target, key), value in saved.items():
            setting(key, value, target)
        time.sleep(0.6)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项控件连接检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
