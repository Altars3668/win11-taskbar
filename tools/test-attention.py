#!/usr/bin/python3
"""应用请求注意时的任务栏按钮；只在隔离 testbed 中运行。

Windows 不为“窗口请求注意”弹通知：应用的任务栏按钮以淡红色底板闪烁 7 次，然后保持高亮，
直到窗口被使用。GNOME 原本弹““窗口”已就绪”的通知，微信每来一条消息都会这样，且通知里
没有内容。这里让测试应用的一个窗口请求注意，检查按钮闪烁并常亮、没有就绪通知、聚焦后熄灭。
"""
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
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def button(app):
        return next(b for b in dump()['buttons'] if b['id'] == app)

    def check(label, predicate, timeout=8):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (StopIteration, KeyError, TypeError):
                pass
            time.sleep(0.05)
        raise AssertionError(f'{label}: {json.dumps(dump()["buttons"], ensure_ascii=False)[:1200]}')

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    animations = json.loads(shell.trigger('state'))['animations']
    toasts = dump()['attentionToasts']
    app = shell.trigger('demand-attention')
    assert app not in ('no window', 'no app'), app
    check('请求注意的应用按钮亮起', lambda: button(app)['attention'] and button(app)['flash']['visible'])
    if animations:
        seen = set()
        end = time.monotonic() + 2
        while time.monotonic() < end:
            seen.add(button(app)['flash']['opacity'] // 64)
            time.sleep(0.03)
        assert len(seen) >= 3, seen
        count += 1
        print('ok 底板在闪烁，而不是一下子亮着', flush=True)
        check('闪 7 次后停在常亮', lambda: not button(app)['flash']['flashing'] and
              button(app)['flash']['opacity'] == 255, timeout=12)
    else:
        check('无动画时直接常亮', lambda: button(app)['flash']['opacity'] == 255)
    check('没有 GNOME 的“已就绪”通知', lambda: dump()['attentionToasts'] == toasts)
    b = button(app)
    shell.pointer([{'move': [b['x'] + b['w'] / 2, b['y'] + b['h'] / 2]}, {'wait': 60}, {'press': 1},
                   {'wait': 60}, {'release': 1}, {'wait': 600}])
    check('点按钮切到该应用后熄灭', lambda: not button(app)['attention'] and not button(app)['flash']['visible'])
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    log = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in log, marker
    print(f'{count} 项请求注意检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
