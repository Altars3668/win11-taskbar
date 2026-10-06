#!/usr/bin/python3
"""时钟面板里的通知：关闭、打开、清除全部、应用退出后保留、滚动条位置。

只在隔离 testbed 中运行。面板底边贴着任务栏，高度跟随内容：关掉一张卡片，
顶边下移，底边不动，列表和日历之间不留空白。点开通知会关闭面板；应用退出
后它的通知仍在，点开时改为打开该应用。滚动条在卡片右侧的槽里，不压住卡片。
"""
import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

# 以已知应用的身份发一条带默认动作的通知，保持连接片刻后退出，像应用退出那样。
POST_AND_EXIT = r'''
import sys, time
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
bus.call_sync('org.freedesktop.Notifications', '/org/freedesktop/Notifications',
              'org.freedesktop.Notifications', 'Notify',
              GLib.Variant('(susssasa{sv}i)', ('Resources', 0, '', sys.argv[1], 'from an app that has quit',
                                              ['default', 'Open'],
                                              {'desktop-entry': GLib.Variant('s', 'net.nokyan.Resources')}, -1)),
              GLib.VariantType('(u)'), Gio.DBusCallFlags.NONE, 5000, None)
time.sleep(0.5)
'''


def main():
    shell = ctx.Shell()
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS=shell.address)
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None, None,
                                 ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])

    def centre():
        return dump()['bars'][0]['notificationCentre']

    def state():
        return json.loads(shell.trigger('state'))

    def click(x, y):
        shell.pointer([{'move': [x, y]}, {'wait': 120}, {'press': 1}, {'wait': 60},
                       {'release': 1}, {'wait': 500}])

    def middle(rect):
        return rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2

    def wait(predicate, timeout=8):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.1)
        return False

    def check(label, ok, detail=None):
        nonlocal count
        if not ok:
            raise AssertionError(f'{label}: {detail}')
        count += 1
        print('ok ' + label, flush=True)

    def post(*titles):
        for title in titles:
            subprocess.run(['notify-send', '-a', 'Test', title, 'body'], env=env, check=True)
        time.sleep(0.4)

    def open_centre():
        if not state()['notifications']:
            click(*middle(dump()['bars'][0]['clock']))
        return wait(lambda: state()['notifications'])

    def cards():
        return sorted(centre()['cards'], key=lambda c: c['y'])

    # Earlier tests may have left notifications of their own in the panel.
    mine = ('fourth', 'third', 'second', 'first')

    def my_cards():
        return [c for c in cards() if c['title'] in mine]

    def bottom(n):
        return n['y'] + n['h']

    def escape():
        shell.trigger('keys:' + json.dumps([{'press': 0xff1b}, {'wait': 50}, {'release': 0xff1b}]))
        wait(lambda: not state()['notifications'])

    # 新虚拟指针的第一下移动会丢坐标，先空走两下。
    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])

    # What earlier tests left would fill the panel to the top of the screen,
    # where its height no longer follows what is in it.
    if centre()['cards'] and open_centre():
        click(*middle(centre()['clearButton']))
        wait(lambda: not centre()['cards'])
        escape()

    post('first', 'second', 'third', 'fourth')
    check('点时钟打开面板', open_centre())
    before = centre()
    check('页头有“清除全部”', before['clearButton']['visible'] and not before['empty']['visible'])
    gap = before['calendar']['y'] - (before['messageList']['y'] + before['messageList']['h'])
    check('列表与日历之间没有多余空白', 0 <= gap <= 50, gap)

    second = my_cards()[1]
    remaining = [t for t in mine if t != second['title']]
    click(*middle(second['close']))
    check('关掉一张卡片后它不在列表里',
          wait(lambda: [c['title'] for c in my_cards()] == remaining), cards())
    after = centre()
    check('面板顶边下移、底边不动，收缩一张卡片的高度',
          bottom(after) == bottom(before) and after['h'] < before['h'] - second['h'] / 2,
          (before['y'], before['h'], after['y'], after['h']))
    check('关掉通知后面板保持打开', state()['notifications'])

    click(*middle(cards()[0]))
    check('点开一条通知会关闭面板', wait(lambda: not state()['notifications']))

    check('重新打开面板', open_centre())
    shrunk = centre()
    click(*middle(shrunk['clearButton']))
    check('清除全部后只剩“没有新通知”',
          wait(lambda: not centre()['cards'] and centre()['empty']['visible']
               and not centre()['clearButton']['visible']))
    check('清除全部后面板收缩、底边不动',
          bottom(centre()) == bottom(shrunk) and centre()['h'] < shrunk['h'])
    escape()

    subprocess.run([sys.executable, '-c', POST_AND_EXIT, 'left behind'], env=env, check=True)
    time.sleep(1.0)
    check('应用退出后它的通知仍在面板里',
          open_centre() and [c['title'] for c in cards()] == ['left behind'], cards())
    click(*middle(cards()[0]))
    check('点开已退出应用的通知会打开该应用并关闭面板',
          wait(lambda: any('resources' in (w['wmClass'] or '').lower()
                           for w in json.loads(shell.trigger('windows'))), 20)
          and not state()['notifications'])

    post(*[f'filler {i}' for i in range(12)])
    check('通知多到需要滚动时打开面板', open_centre())
    n = centre()
    right = max(c['x'] + c['w'] for c in n['cards'])
    check('滚动条出现在卡片右侧的槽里，不压住卡片',
          n['scrollBar'] and n['scrollBar']['visible'] and n['scrollBar']['x'] >= right
          and n['scrollBar']['x'] + n['scrollBar']['w'] <= n['x'] + n['w'], (right, n['scrollBar']))
    check('面板没有超出屏幕顶边', n['y'] >= 0, n['y'])
    click(*middle(n['clearButton']))
    wait(lambda: not centre()['cards'])
    escape()
    print(f'{count} 项通知面板检查通过，0 项失败')


if __name__ == '__main__':
    main()
