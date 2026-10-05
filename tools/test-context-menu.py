#!/usr/bin/python3
"""End-to-end check of the Windows context-menu model in GTK3 and GTK4.

Runs the probes in tools/ctxprobe/ inside the headless test shell
(tools/testbed.sh start) and drives them with a virtual pointer through the
debug service, so GTK sees real press, motion and release events.

    tools/test-context-menu.py                 # the GTKs installed now
    tools/test-context-menu.py --gtk3-lib DIR --gtk4-lib DIR
                                               # libraries from a build tree

Cases, with what the Windows model requires:
  drag     right-press, drag to where the first item will be, release: the
           menu appears only on release, nothing is chosen, it stays open;
           a left click then chooses the item
  quick    right click in place: the menu appears on release; a left click
           on the item then chooses it
  hold     right-press held 800ms in place: no menu until the release, then
           the menu appears and stays open
  dismiss  right click, then a left click well away from the menu: the
           menu closes and chooses nothing (it holds the popup grab)
  reopen   right click, then a right click somewhere else: the menu closes
           and a new one opens there, in that one click
  passthrough  right click, then a left click somewhere else: the menu
           closes and the click still reaches what is under it
  shell    right click, then a left click on the Start button: the menu
           closes and Start opens, in that one click (needs the patched
           compositor: the popup grab used to swallow the press)
  dropdown click a menu button, then click it again: its menu opens once
           and closes (the press that closes it is not passed through)
  menubar  left-press File, drag onto the first item, release: chosen
           (press-drag-release with the primary button is kept)

After the cases, with no menu open, a click on the Start button must still
open Start: a press the compositor holds and puts back must not leave the
shell believing a button is down, which no client would notice.
"""
import argparse
import json
import os
import subprocess
import sys
import threading
import time

import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(os.environ.get('XDG_RUNTIME_DIR', f'/run/user/{os.getuid()}'),
                   'win11-taskbar-testbed')
BUS = 'org.gnome.Shell.Extensions.Win11Taskbar'
OBJ = '/org/gnome/Shell/Extensions/Win11Taskbar'
PRESS_AT = (700, 500)


class Shell:
    def __init__(self):
        with open(os.path.join(RUN, 'bus')) as f:
            self.address = f.read().strip()
        self.conn = Gio.DBusConnection.new_for_address_sync(
            self.address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT |
            Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)

    def trigger(self, action):
        reply = self.conn.call_sync(BUS, OBJ, BUS, 'Trigger',
                                    GLib.Variant('(s)', (action,)),
                                    GLib.VariantType('(s)'),
                                    Gio.DBusCallFlags.NONE, 10000, None)
        return reply.unpack()[0]

    def pointer(self, steps):
        """Play steps and wait until they have all been delivered."""
        self.trigger('pointer:' + json.dumps(steps))
        time.sleep(sum(s.get('wait', 0) for s in steps) / 1000 + 0.3)


class Probe:
    def __init__(self, shell, toolkit, libdir):
        env = dict(os.environ)
        env.pop('DISPLAY', None)
        env.update(XDG_CONFIG_HOME=os.path.join(RUN, 'config'),
                   XDG_CACHE_HOME=os.path.join(RUN, 'config', 'cache'),
                   WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                   DBUS_SESSION_BUS_ADDRESS=shell.address,
                   NO_AT_BRIDGE='1')
        if libdir:
            env['LD_LIBRARY_PATH'] = libdir
        self.lines = []
        self.proc = subprocess.Popen(
            [sys.executable, os.path.join(HERE, 'ctxprobe', f'probe{toolkit}.py')],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        threading.Thread(target=self._read, daemon=True).start()
        self.title = f'ctxprobe{toolkit}'
        deadline = time.time() + 15
        while not any(l.startswith('READY') for l in self.lines):
            if time.time() > deadline:
                raise RuntimeError(f'{self.title} never became ready')
            time.sleep(0.05)
        self.library = next(l for l in self.lines if l.startswith('READY')).split()[1]
        geom = {l.split()[1]: tuple(map(int, l.split()[2:]))
                for l in self.lines if l.startswith('GEOM ')}
        gx, gy, gw, gh = geom['file']
        windows = json.loads(shell.trigger('windows'))   # also hides the Overview
        window = next(w for w in windows if w['title'] == self.title)
        bx, by = window['buffer'][:2]
        self.file = (bx + gx + gw // 2, by + gy + gh // 2, gh)
        dx, dy, dw, dh = geom['drop']
        self.drop = (bx + dx + dw // 2, by + dy + dh // 2)
        # Let the Overview finish hiding; until then it takes the pointer.
        time.sleep(1.0)

    def _read(self):
        for line in self.proc.stdout:
            self.lines.append(line.strip())

    def mark(self):
        return len(self.lines)

    def since(self, mark):
        return self.lines[mark:]

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(3)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def glide(start, end, steps=6, ms=25):
    """Move in steps, then wiggle inside the target. GTK3 only trusts a
    release after a few motion events well inside the item."""
    out = []
    for i in range(1, steps + 1):
        out += [{'move': [start[0] + (end[0] - start[0]) * i / steps,
                          start[1] + (end[1] - start[1]) * i / steps]},
                {'wait': ms}]
    for dx in (3, -3, 3, -3):
        out += [{'move': [end[0] + dx, end[1] + 2]}, {'wait': ms}]
    return out


def item_target(toolkit):
    # GTK4 centres the popover under the press, GTK3 puts the menu's
    # corner at it; either way this is well inside a 300x120 first item.
    x, y = PRESS_AT
    return (x, y + 60) if toolkit == 4 else (x + 100, y + 60)


def run_case(shell, toolkit, libdir, case):
    probe = Probe(shell, toolkit, libdir)
    try:
        target = item_target(toolkit)
        m = probe.mark()
        if case == 'drag':
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 300}, *glide(PRESS_AT, target), {'wait': 150}])
            held = probe.since(m)
            m = probe.mark()
            shell.pointer([{'release': 3}, {'wait': 500}])
            released = probe.since(m)
            chose = any('ACTIVATED first' in part for part in (held, released))
            m = probe.mark()
            if not chose:
                # Wiggle first: GTK3 waits for motion before it highlights
                # the item under a menu that opened beneath the pointer.
                shell.pointer([*glide(target, target, steps=1), {'wait': 100},
                               {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 500}])
            after = probe.since(m)
            return {'shown while held': 'SHOWN' in held,
                    'shown after release': 'SHOWN' in held + released,
                    'release chose': chose,
                    'menu stayed open': 'CLOSED' not in held + released and not chose,
                    'then left click chose': 'ACTIVATED first' in after}
        if case == 'quick':
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 60}, {'release': 3}, {'wait': 300}])
            clicked = probe.since(m)
            m = probe.mark()
            shell.pointer([*glide(PRESS_AT, target, steps=3, ms=20), {'wait': 100},
                           {'press': 1}, {'wait': 50}, {'release': 1}, {'wait': 500}])
            after = probe.since(m)
            return {'shown after release': 'SHOWN' in clicked,
                    'left click chose': 'ACTIVATED first' in after}
        if case == 'hold':
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 800}])
            held = probe.since(m)
            m = probe.mark()
            shell.pointer([{'release': 3}, {'wait': 500}])
            released = probe.since(m)
            lines = held + released
            return {'shown while held': 'SHOWN' in held,
                    'shown after release': 'SHOWN' in lines,
                    'menu stayed open': 'CLOSED' not in lines,
                    'release chose': any(l.startswith('ACTIVATED') for l in lines)}
        if case == 'dismiss':
            far = (PRESS_AT[0] + 700, PRESS_AT[1] + 300)
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 60}, {'release': 3}, {'wait': 300},
                           {'move': list(far)}, {'wait': 100}, {'press': 1},
                           {'wait': 50}, {'release': 1}, {'wait': 500}])
            lines = probe.since(m)
            return {'shown': 'SHOWN' in lines, 'closed': 'CLOSED' in lines,
                    'chose': any(l.startswith('ACTIVATED') for l in lines)}
        if case in ('reopen', 'passthrough'):
            other = (PRESS_AT[0] + 500, PRESS_AT[1] + 250)
            button = 3 if case == 'reopen' else 1
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 60}, {'release': 3}, {'wait': 400}])
            first = probe.since(m)
            m = probe.mark()
            shell.pointer([{'move': list(other)}, {'wait': 150}, {'press': button},
                           {'wait': 60}, {'release': button}, {'wait': 600}])
            second = probe.since(m)
            menus = [w['buffer'] for w in json.loads(shell.trigger('windows'))
                     if w['type'] in (6, 9, 10)]
            # A menu opened at the second spot covers it, give or take shadow.
            there = any(x - 40 <= other[0] <= x + w + 40 and y - 40 <= other[1] <= y + h + 40
                        for x, y, w, h in menus)
            got = {'first shown': 'SHOWN' in first,
                   'click reached the canvas': f'PRESS {button}' in second,
                   'chose': any(l.startswith('ACTIVATED') for l in second)}
            if case == 'reopen':
                got['new menu at the second spot'] = 'SHOWN' in second and there
            else:
                got['menu closed'] = 'CLOSED' in second and not menus
            return got
        if case == 'shell':
            reply = shell.conn.call_sync(BUS, OBJ, BUS, 'DumpGeometry', None, None,
                                         Gio.DBusCallFlags.NONE, 3000, None)
            start = json.loads(reply.unpack()[0])['bars'][0]['startButton']
            at = [start['x'] + start['w'] // 2, start['y'] + start['h'] // 2]
            shell.pointer([{'move': list(PRESS_AT)}, {'wait': 150}, {'press': 3},
                           {'wait': 60}, {'release': 3}, {'wait': 400}])
            first = probe.since(m)
            m = probe.mark()
            shell.trigger('button-events')
            shell.pointer([{'move': at}, {'wait': 150}, {'press': 1},
                           {'wait': 60}, {'release': 1}, {'wait': 700}])
            second = probe.since(m)
            opened = json.loads(shell.trigger('state'))['startMenu']
            if os.environ.get('W11_DEBUG_EVENTS'):
                print('stage button events:', shell.trigger('button-events'), file=sys.stderr)
            if opened:
                shell.trigger('start-menu-close')
            return {'first shown': 'SHOWN' in first, 'menu closed': 'CLOSED' in second,
                    'chose': any(l.startswith('ACTIVATED') for l in second),
                    'start opened': bool(opened)}
        if case == 'dropdown':
            at = list(probe.drop)
            click = [{'move': at}, {'wait': 150}, {'press': 1}, {'wait': 60},
                     {'release': 1}, {'wait': 500}]
            shell.pointer(click)
            first = probe.since(m)
            m = probe.mark()
            shell.pointer(click)
            second = probe.since(m)
            return {'opened': 'DROP SHOWN' in first,
                    'second click closed it': 'DROP CLOSED' in second,
                    'reopened': 'DROP SHOWN' in second}
        if case == 'menubar':
            fx, fy, fh = probe.file
            shell.pointer([{'move': [fx, fy]}, {'wait': 150}, {'press': 1}, {'wait': 400},
                           *glide((fx, fy), (fx + 40, fy + fh // 2 + 70)), {'wait': 150},
                           {'release': 1}, {'wait': 500}])
            lines = probe.since(m)
            return {'reached item': 'HOVER First' in lines,
                    'release chose': 'ACTIVATED first' in lines}
    finally:
        LIBRARIES.add(f'GTK{toolkit}: {probe.library}')
        probe.close()
        time.sleep(0.4)
    return {}


LIBRARIES = set()

# What the Windows model requires of each case.
WANT = {
    'drag': {'shown while held': False, 'shown after release': True,
             'release chose': False, 'menu stayed open': True,
             'then left click chose': True},
    'quick': {'shown after release': True, 'left click chose': True},
    'hold': {'shown while held': False, 'shown after release': True,
             'menu stayed open': True, 'release chose': False},
    'dismiss': {'shown': True, 'closed': True, 'chose': False},
    'reopen': {'first shown': True, 'click reached the canvas': True, 'chose': False,
               'new menu at the second spot': True},
    'passthrough': {'first shown': True, 'click reached the canvas': True, 'chose': False,
                    'menu closed': True},
    'shell': {'first shown': True, 'menu closed': True, 'chose': False, 'start opened': True},
    'dropdown': {'opened': True, 'second click closed it': True, 'reopened': False},
    'menubar': {'reached item': True, 'release chose': True},
}


def run_taskbar(shell):
    """The shell side: right-click one task button, then another. Windows
    closes the first jump list and opens the second in that one click.
    Needs two task buttons (tools/testbed.sh apps)."""
    buttons = json.loads(shell.trigger('task-buttons'))
    if len(buttons) < 2:
        raise SystemExit('need two task buttons: run tools/testbed.sh apps first')
    centres = [[x + w // 2, y + h // 2] for _id, x, y, w, h in buttons[:2]]
    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    click = lambda at: [{'move': at}, {'wait': 200}, {'press': 3}, {'wait': 70},
                        {'release': 3}, {'wait': 700}]
    shell.pointer(click(centres[0]))
    first = json.loads(shell.trigger('jump-list-state'))
    shell.pointer(click(centres[1]))
    second = json.loads(shell.trigger('jump-list-state'))
    shell.trigger('jump-list-close')
    return {'first opened': first == buttons[0][0], 'second opened in one click': second == buttons[1][0]}


def start_button_works(shell):
    """Click Start with nothing open; True if Start opened."""
    reply = shell.conn.call_sync(BUS, OBJ, BUS, 'DumpGeometry', None, None,
                                 Gio.DBusCallFlags.NONE, 3000, None)
    start = json.loads(reply.unpack()[0])['bars'][0]['startButton']
    at = [start['x'] + start['w'] // 2, start['y'] + start['h'] // 2]
    shell.pointer([{'move': [at[0] + 200, at[1] - 300]}, {'wait': 150}, {'move': at},
                   {'wait': 150}, {'press': 1}, {'wait': 60}, {'release': 1}, {'wait': 700}])
    opened = json.loads(shell.trigger('state'))['startMenu']
    if opened:
        shell.trigger('start-menu-close')
        time.sleep(0.5)
    return bool(opened)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gtk3-lib')
    ap.add_argument('--gtk4-lib')
    ap.add_argument('--toolkits', default='3,4')
    ap.add_argument('--cases', default='drag,quick,hold,dismiss,reopen,passthrough,shell,dropdown,menubar')
    ap.add_argument('--taskbar', action='store_true',
                    help='check the shell side on the taskbar instead')
    ap.add_argument('--expect-original', action='store_true',
                    help='report only; do not fail on the X11 model')
    args = ap.parse_args()

    shell = Shell()
    # A shell that has just started is still hiding its Overview, and the
    # virtual pointer has not moved yet.
    shell.trigger('windows')
    shell.pointer([{'move': [960, 540]}, {'wait': 300}])
    time.sleep(2)
    failures = 0
    if args.taskbar:
        got = run_taskbar(shell)
        ok = all(got.values())
        print(f'taskbar  {"ok" if ok else "FAIL":7} {got}')
        return 0 if ok else 1
    for toolkit in map(int, args.toolkits.split(',')):
        libdir = args.gtk3_lib if toolkit == 3 else args.gtk4_lib
        for case in args.cases.split(','):
            got = run_case(shell, toolkit, libdir, case)
            bad = {k: v for k, v in got.items() if WANT[case].get(k) != v}
            verdict = 'ok' if not bad else ('differs' if args.expect_original else 'FAIL')
            if bad and not args.expect_original:
                failures += 1
            print(f'GTK{toolkit} {case:8} {verdict:7} {got}', flush=True)
    alive = start_button_works(shell)
    if not alive:
        failures += 1
    print(f'shell still takes clicks: {"ok" if alive else "FAIL"}', flush=True)
    for library in sorted(LIBRARIES):
        print('loaded', library)
    print(f'{failures} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
