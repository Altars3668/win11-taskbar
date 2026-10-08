#!/usr/bin/python3
"""只在隔离 testbed 验证多个 Peek 来源与窗口动画交错，不留下整窗透明状态。"""
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
FIRST, SECOND = 'Peek first', 'Peek second'


def main():
    shell = ctx.Shell()
    count = 0
    processes = []

    def windows():
        return {w['title']: w for w in json.loads(shell.trigger('windows'))}

    def check(label, predicate, timeout=6):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            state = windows()
            if predicate(state):
                count += 1
                print('ok ' + label, flush=True)
                return
            time.sleep(0.04)
        raise AssertionError(f'{label}: {[(t, w.get("opacity"), w.get("scale"), w.get("animationPhase")) for t,w in windows().items() if t in (FIRST,SECOND)]}')

    env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
               XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')))
    env.pop('DISPLAY', None)
    try:
        shell.trigger('windows')
        shell.pointer([{'move': [960, 500]}, {'wait': 200}])
        for title in (FIRST, SECOND):
            processes.append(subprocess.Popen(['gjs', '-m', str(HERE / 'anim-window.js'), title], env=env,
                                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
            check('测试窗已映射且不透明：' + title, lambda ws: title in ws and ws[title]['mapped']
                  and ws[title]['visible'] and ws[title]['opacity'] == 255 and not ws[title]['opacityTransition']
                  and not ws[title]['animationPhase']['mapping'])
        shell.trigger('peek-window:' + FIRST)
        check('缩略图 Peek 淡出其他窗口', lambda ws: ws[SECOND]['opacity'] == 0)
        shell.trigger('desktop-peek-start')
        time.sleep(0.25)
        shell.trigger('peek-clear')
        time.sleep(0.25)
        shell.trigger('desktop-peek-clear')
        check('交错两个 Peek 后窗口全部恢复原始不透明度，而非记住已经淡出的值',
              lambda ws: all(ws[t]['opacity'] == 255 and ws[t]['scale'] == [1, 1] for t in (FIRST, SECOND)))

        shell.trigger('window-opacity:' + SECOND + ':160')
        shell.trigger('peek-window:' + FIRST)
        check('原来半透明的窗口也可预览', lambda ws: ws[SECOND]['opacity'] == 0)
        shell.trigger('peek-clear')
        check('恢复的是窗口本来的 160，而非强制设置 255', lambda ws: ws[SECOND]['opacity'] == 160)
        shell.trigger('window-opacity:' + SECOND + ':255')

        for _ in range(5):
            shell.trigger('peek-window:' + FIRST)
            time.sleep(0.04)
            shell.trigger('peek-window:' + SECOND)
            time.sleep(0.04)
            shell.trigger('peek-clear')
            time.sleep(0.04)
        check('快速切换并中断退场不留下中间透明度',
              lambda ws: all(ws[t]['opacity'] == 255 for t in (FIRST, SECOND)))
        shell.trigger('window-minimize:' + SECOND)
        check('窗口已最小化', lambda ws: ws[SECOND]['minimized'])
        shell.trigger('window-unminimize:' + SECOND)
        shell.trigger('desktop-peek-start')
        time.sleep(0.08)
        shell.trigger('desktop-peek-clear')
        check('还原动画期间 Peek 不取消原生缩放和透明度收尾',
              lambda ws: not ws[SECOND]['minimized'] and ws[SECOND]['opacity'] == 255 and ws[SECOND]['scale'] == [1, 1])
    finally:
        shell.trigger('peek-clear')
        shell.trigger('desktop-peek-clear')
        for title in (FIRST, SECOND):
            shell.trigger('window-close:' + title)
        time.sleep(0.4)
        for process in processes:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项窗口 Peek 稳健性检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
