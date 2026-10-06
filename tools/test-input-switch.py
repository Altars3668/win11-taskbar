#!/usr/bin/python3
"""Win+空格切换输入法，按 Windows 11 的方式；只在隔离 testbed 中运行，用假的 Fcitx。

按住 Win 点空格：任务栏的输入法列表打开并标记下一个；继续点空格往下移，加 Shift 往回；
松开 Win 切到标记的那个。Esc 取消；快速点按直接切到下一个。
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

SUPER, SHIFT, SPACE, ESCAPE = 0xffeb, 0xffe1, 0x20, 0xff1b
METHODS = ['keyboard-us', 'rime', 'pinyin']


def main():
    shell = ctx.Shell()
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=shell.address)
    fake = subprocess.Popen(['gjs', '-m', str(HERE / 'fake-fcitx.js')], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None, 0, 5000, None)
        return json.loads(r.unpack()[0])['bars'][0]['inputMethod']

    def fcitx(method, args=None):
        r = shell.conn.call_sync('org.fcitx.Fcitx5', '/controller', 'org.fcitx.Fcitx.Controller1', method,
                                 args, None, 0, 3000, None)
        return r.unpack()

    def current():
        return fcitx('CurrentInputMethod')[0]

    def start_open():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None, 0, 5000, None)
        return json.loads(r.unpack()[0])['bars'][0]['startMenu']['open']

    def check(label, predicate, timeout=6):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (TypeError, KeyError, StopIteration, ctx.GLib.Error):
                pass
            time.sleep(0.05)
        raise AssertionError(f'{label}: {json.dumps(dump(), ensure_ascii=False)[:800]}')

    def keys(steps):
        shell.trigger('keys:' + json.dumps(steps))
        time.sleep(sum(step.get('wait', 0) for step in steps) / 1000 + 0.15)

    def marked():
        rows = [item for item in dump()['items'] if item.get('subtitle') or item['label']]
        names = [item['subtitle'] or item['label'] for item in rows if item['marked']]
        return names[0] if names else None

    def name(method_id):
        return next(m['name'] for m in dump()['methods'] if m['id'] == method_id)

    try:
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 300}])
        check('假 Fcitx 已接入', lambda: (fcitx('TestSetGroupMethods', ctx.GLib.Variant('(as)', [METHODS])) or True)
              and dump()['backend'] == 'fcitx')
        fcitx('SetCurrentIM', ctx.GLib.Variant('(s)', ['keyboard-us']))
        # The indicator reads the group afresh each time its list opens.
        shell.trigger('input-method-reload')
        check('三个输入法都已读到', lambda: [m['id'] for m in dump()['methods']] == METHODS)

        keys([{'press': SUPER}, {'wait': 40}, {'press': SPACE}, {'wait': 40}, {'release': SPACE}, {'wait': 300}])
        check('按住 Win 点空格：列表打开并标记下一个', lambda: dump()['menuOpen'] and dump()['switching'] and
              marked() == name('rime'))
        keys([{'press': SPACE}, {'wait': 40}, {'release': SPACE}, {'wait': 200}])
        check('再点空格标记再下一个', lambda: marked() == name('pinyin'))
        keys([{'press': SHIFT}, {'wait': 30}, {'press': SPACE}, {'wait': 40}, {'release': SPACE},
              {'wait': 30}, {'release': SHIFT}, {'wait': 200}])
        check('Shift+空格往回标记', lambda: marked() == name('rime'))
        keys([{'release': SUPER}, {'wait': 300}])
        check('松开 Win 切到标记的输入法并收起列表', lambda: current() == 'rime' and not dump()['menuOpen'] and
              not dump()['switching'])
        time.sleep(0.3)
        assert not start_open(), '松开 Win 时误开了开始菜单'
        count += 1
        print('ok 松开 Win 不会顺带打开开始菜单', flush=True)

        keys([{'press': SUPER}, {'wait': 40}, {'press': SPACE}, {'wait': 40}, {'release': SPACE}, {'wait': 300}])
        check('再次打开并标记下一个', lambda: dump()['menuOpen'] and marked() == name('pinyin'))
        keys([{'press': ESCAPE}, {'wait': 40}, {'release': ESCAPE}, {'wait': 40}, {'release': SUPER}, {'wait': 300}])
        check('Esc 取消：收起列表，输入法不变', lambda: not dump()['menuOpen'] and current() == 'rime')

        keys([{'press': SUPER}, {'press': SPACE}, {'release': SPACE}, {'release': SUPER}, {'wait': 400}])
        check('快速点按 Win+空格直接切到下一个', lambda: current() == 'pinyin' and not dump()['menuOpen'] and
              not start_open())
        keys([{'press': SUPER}, {'press': SPACE}, {'release': SPACE}, {'release': SUPER}, {'wait': 400}])
        check('从最后一个循环回第一个', lambda: current() == 'keyboard-us')
    finally:
        keys([{'release': SHIFT}, {'release': SUPER}])
        fake.terminate()
        try:
            fake.wait(3)
        except subprocess.TimeoutExpired:
            fake.kill()
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项 Win+空格切换输入法检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
