#!/usr/bin/python3
"""两个隔离虚拟显示器：各自自动尺寸、独立搜索和跨屏启动面板互斥。"""
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
shell = ctx.Shell()
env = dict(os.environ, XDG_CONFIG_HOME=str(Path(ctx.RUN, 'config')), DBUS_SESSION_BUS_ADDRESS=shell.address)
command = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
schema = 'org.gnome.shell.extensions.win11-taskbar'
for key, value in [('multi-monitor', 'true'), ('start-menu', 'true'), ('taskbar-size-mode', "'auto'"),
                   ('position', "'bottom'"), ('search-style', "'auto'")]:
    subprocess.run(command + ['set', schema, key, value], env=env, check=True)
count = 0

def bars():
    reply = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
    return json.loads(reply.unpack()[0])['bars']

def check(label, predicate):
    global count
    end = time.monotonic() + 10
    while time.monotonic() < end:
        try:
            if predicate():
                count += 1
                print('ok ' + label, flush=True)
                return
        except (IndexError, TypeError):
            pass
        time.sleep(0.08)
    raise AssertionError(label)

def click(actor):
    shell.pointer([{'move': [actor['x'] + actor['w'] / 2, actor['y'] + actor['h'] / 2]}, {'wait': 120},
                   {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 300}])

check('两块屏幕各有已分配的任务栏', lambda: len(bars()) == 2 and all(b['search']['x'] is not None for b in bars()))
check('1080p 与 720p 各自选择 48 / 40，而非共用全局尺寸', lambda: sorted(b['size'] for b in bars()) == [40, 48])
click(bars()[1]['search'])
check('第二块屏幕的按钮打开自己的独立搜索', lambda: bars()[1]['searchPanel']['open'] and not bars()[0]['searchPanel']['open'])
check('第二块屏幕搜索落在自己的任务栏旁', lambda: bars()[1]['searchPanel']['x'] >= bars()[1]['panel']['x'] and
      bars()[1]['searchPanel']['x'] + bars()[1]['searchPanel']['w'] <= bars()[1]['panel']['x'] + bars()[1]['panel']['w'])
click(bars()[0]['startButton'])
check('跨屏外点击透传给 Start，并释放第二块屏幕的搜索 modal', lambda: bars()[0]['startMenu']['open'] and
      not bars()[1]['searchPanel']['open'] and not bars()[1]['searchPanel']['modal'])
shell.trigger('start-menu-close')
click(bars()[0]['search'])
check('第一块屏幕也能打开独立搜索', lambda: bars()[0]['searchPanel']['open'])
click(bars()[1]['search'])
check('第二个搜索互斥关闭第一个，两个屏幕不会同时持有 grab', lambda: bars()[1]['searchPanel']['open'] and
      not bars()[0]['searchPanel']['open'] and not bars()[0]['searchPanel']['modal'])
shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'release': 0xff1b}, {'wait': 200}]))
check('Esc 清理最后一个搜索面板', lambda: all(not b['searchPanel']['open'] and not b['searchPanel']['modal'] for b in bars()))
print(f'双显示器搜索：{count} 项通过，0 项失败', flush=True)
