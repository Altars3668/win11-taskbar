#!/usr/bin/python3
"""独立搜索、推荐过滤和自动尺寸的真实隔离 Shell 回归；不操作真实桌面。"""
import importlib.util
import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)


def main():
    shell = ctx.Shell()
    env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')), DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    keys = ['start-menu', 'search-style', 'position', 'start-layout', 'taskbar-size', 'taskbar-size-mode',
            'recommended-enabled', 'recommended-files', 'recommended-folders', 'recommended-types',
            'recommended-extensions', 'recommended-days', 'recommended-limit',
            'recommended-include-directories', 'recommended-exclude-directories']
    saved = {key: subprocess.check_output(command + ['get', schema, key], env=env, text=True).strip() for key in keys}
    count = 0

    def setting(key, value):
        subprocess.run(command + ['set', schema, key, value], env=env, check=True)

    def bar():
        reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                     ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(reply.unpack()[0])['bars'][0]

    def check(label, predicate, timeout=8):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.08)
        raise AssertionError(label + ': ' + json.dumps(bar(), ensure_ascii=False))

    def keys(steps):
        shell.trigger('keys:' + json.dumps(steps))
        time.sleep(sum(s.get('wait', 0) for s in steps) / 1000 + 0.3)

    def key(value):
        keys([{'press': value}, {'wait': 30}, {'release': value}, {'wait': 200}])

    def click(actor):
        shell.pointer([{'move': [actor['x'] + actor['w'] / 2, actor['y'] + actor['h'] / 2]},
                       {'wait': 120}, {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 300}])

    data = Path(ctx.RUN, 'data')
    assert data.name == 'data' and data.parent.name == 'win11-taskbar-testbed'
    fixtures = data / 'feature-fixtures'
    allowed = fixtures / 'allowed'
    excluded = allowed / 'excluded'
    folder = allowed / 'w11-fixture-folder'
    for directory in [allowed, excluded, folder]:
        directory.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    records = [
        (excluded / 'w11-excluded-only.pdf', 'application/pdf', 0),
        (allowed / 'w11-new-document.pdf', 'application/pdf', 1),
        (allowed / 'w11-old-document.pdf', 'application/pdf', 2),
        (allowed / 'w11-old-outside-window.pdf', 'application/pdf', 50),
        (allowed / 'w11-picture.png', 'image/png', 0),
        (folder, 'inode/directory', 0),
    ]
    for path, mime, _age in records:
        if mime != 'inode/directory':
            path.write_text('isolated fixture')
    bookmarks = []
    for path, mime, age in records:
        stamp = (now - timedelta(days=age)).isoformat()
        bookmarks.append(f'<bookmark href="{escape(path.as_uri())}" visited="{stamp}" modified="{stamp}">'
                         '<info><metadata owner="http://freedesktop.org">'
                         f'<mime:mime-type type="{mime}"/><bookmark:applications>'
                         f'<bookmark:application name="org.gnome.TextEditor" exec="gnome-text-editor %u" count="1" modified="{stamp}"/>'
                         '</bookmark:applications></metadata></info></bookmark>')
    store = data / 'recently-used.xbel'
    old_store = store.read_bytes() if store.exists() else None
    store.write_text('<?xml version="1.0"?><xbel version="1.0" '
                     'xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info" '
                     'xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks">'
                     + ''.join(bookmarks) + '</xbel>')
    try:
        setting('position', "'bottom'")
        setting('start-menu', 'true')
        setting('taskbar-size-mode', "'auto'")
        setting('search-style', "'auto'")
        setting('start-layout', "'auto'")
        check('标准屏幕自动任务栏为 48 逻辑像素', lambda: bar()['size'] == 48)
        shell.trigger('recent-refresh')
        check('共享读取器加载全部本地 fixture', lambda: len(bar()['recentItems']) == len(records))
        setting('recommended-enabled', 'true')
        setting('recommended-files', 'true')
        setting('recommended-folders', 'false')
        setting('recommended-types', "['documents']")
        setting('recommended-extensions', "['pdf']")
        setting('recommended-days', '7')
        setting('recommended-limit', '2')
        setting('recommended-include-directories', repr([str(allowed)]))
        setting('recommended-exclude-directories', repr([str(excluded)]))
        shell.trigger('start-menu')
        expected = ['w11-new-document.pdf', 'w11-old-document.pdf']
        check('推荐先排除目录/类型/日期再按数量排序', lambda: bar()['startMenu']['recommendedRows'] == expected and
              bar()['startMenu']['pinnedScroll']['h'] is not None)
        initial_height = bar()['startMenu']['pinnedScroll']['h']
        setting('recommended-enabled', 'false')
        check('关闭推荐隐藏列表并把空间交给固定项', lambda: not bar()['startMenu']['recommendedVisible'] and
              bar()['startMenu']['pinnedScroll']['h'] > initial_height)
        b = bar()['startMenu']
        check('关闭推荐仍保留电源页脚', lambda: b['powerButton']['y'] + b['powerButton']['h'] <= b['y'] + b['h'])
        setting('recommended-enabled', 'true')
        setting('recommended-files', 'false')
        setting('recommended-folders', 'true')
        check('文件和文件夹独立开关即时生效', lambda: bar()['startMenu']['recommendedRows'] == [folder.name])
        shell.trigger('search-panel')
        check('搜索与 Start 互斥，空查询显示应用入口', lambda: bar()['searchPanel']['open'] and
              not bar()['startMenu']['open'] and bar()['searchPanel']['results'] and
              all(row['kind'] == 'app' for row in bar()['searchPanel']['results']))
        keys([step for char in 'calcul' for step in [{'press': ord(char)}, {'release': ord(char)}, {'wait': 25}]])
        check('真实键盘输入匹配应用', lambda: bar()['searchPanel']['query'] == 'calcul' and
              any(row['id'] == 'org.gnome.Calculator.desktop' for row in bar()['searchPanel']['results']))
        key(0xff54)
        check('下箭头进入结果，向上可回到输入框', lambda: bar()['searchPanel']['results'][0]['focused'])
        key(0xff52)
        check('上箭头回到输入框', lambda: not any(row['focused'] for row in bar()['searchPanel']['results']))
        key(0xff0d)
        check('回车激活应用并释放 modal', lambda: not bar()['searchPanel']['open'] and not bar()['searchPanel']['modal'])
        shell.trigger('search-panel')
        shell.trigger('search-query:w11-excluded-only')
        check('Start 黑名单不影响显式最近文件搜索', lambda: any(row['uri'] == records[0][0].as_uri()
              for row in bar()['searchPanel']['results']))
        shell.trigger('search-query:there-is-no-such-w11fixture')
        check('无结果状态不会留下旧结果', lambda: bar()['searchPanel']['query'].startswith('there-is-no') and
              not bar()['searchPanel']['results'])
        key(0xff1b)
        check('Esc 清理 modal 和渲染计时器', lambda: not bar()['searchPanel']['open'] and
              not bar()['searchPanel']['modal'] and bar()['searchPanel']['timer'] == 0)
        setting('start-menu', 'false')
        check('Start 可以单独关闭', lambda: bar()['startMenu'] is None and bar()['search']['x'] is not None)
        click(bar()['search'])
        check('关闭 Start 后搜索按钮仍打开独立面板', lambda: bar()['searchPanel']['open'])
        key(0xff1b)
        keys([{'press': 0xffeb}, {'press': ord('s')}, {'release': ord('s')}, {'release': 0xffeb}, {'wait': 400}])
        check('Super+S 不依赖 Start', lambda: bar()['searchPanel']['open'])
        key(0xff1b)
        setting('start-menu', 'true')
        check('重新打开 Start 功能', lambda: bar()['startMenu'] is not None)
        shell.trigger('search-panel')
        click(bar()['startButton'])
        check('搜索外点击透传给 Start，同一次点击切换', lambda: not bar()['searchPanel']['open'] and bar()['startMenu']['open'])
        shell.trigger('start-menu-close')
        for edge in ['top', 'left', 'right', 'bottom']:
            setting('position', repr(edge))
            check(f'任务栏换到 {edge}', lambda: bar()['edge'] == edge)
            shell.trigger('search-panel')
            def fits():
                b = bar()
                p, a = b['searchPanel'], b['panel']
                if any(actor[name] is None for actor in [p, a] for name in ['x', 'y', 'w', 'h']):
                    return False
                inside = p['x'] >= 0 and p['y'] >= 0 and p['x'] + p['w'] <= 1920 and p['y'] + p['h'] <= 1080
                beside = p['y'] >= a['y'] + a['h'] if edge == 'top' else p['y'] + p['h'] <= a['y'] if edge == 'bottom' else \
                    p['x'] >= a['x'] + a['w'] if edge == 'left' else p['x'] + p['w'] <= a['x']
                return p['open'] and inside and beside
            check(f'{edge} 搜索位于屏幕内、任务栏旁', fits)
            key(0xff1b)
    finally:
        shell.trigger('search-panel-close')
        shell.trigger('start-menu-close')
        for name, value in saved.items():
            setting(name, value)
        if old_store is None:
            store.unlink(missing_ok=True)
        else:
            store.write_bytes(old_store)
        for path, mime, _age in records:
            if mime != 'inode/directory':
                path.unlink(missing_ok=True)
        for directory in [folder, excluded, allowed, fixtures]:
            directory.rmdir()
        shell.trigger('recent-refresh')
    print(f'独立搜索、推荐和自动尺寸：{count} 项通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
