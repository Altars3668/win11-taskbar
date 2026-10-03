#!/usr/bin/env python3
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
  menubar  left-press File, drag onto the first item, release: chosen
           (press-drag-release with the primary button is kept)
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
        gx, gy, gw, gh = map(int, next(
            l for l in self.lines if l.startswith('GEOM file')).split()[2:])
        windows = json.loads(shell.trigger('windows'))   # also hides the Overview
        window = next(w for w in windows if w['title'] == self.title)
        bx, by = window['buffer'][:2]
        self.file = (bx + gx + gw // 2, by + gy + gh // 2, gh)
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
    'menubar': {'reached item': True, 'release chose': True},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--gtk3-lib')
    ap.add_argument('--gtk4-lib')
    ap.add_argument('--toolkits', default='3,4')
    ap.add_argument('--cases', default='drag,quick,hold,dismiss,menubar')
    ap.add_argument('--expect-original', action='store_true',
                    help='report only; do not fail on the X11 model')
    args = ap.parse_args()

    shell = Shell()
    failures = 0
    for toolkit in map(int, args.toolkits.split(',')):
        libdir = args.gtk3_lib if toolkit == 3 else args.gtk4_lib
        for case in args.cases.split(','):
            got = run_case(shell, toolkit, libdir, case)
            bad = {k: v for k, v in got.items() if WANT[case].get(k) != v}
            verdict = 'ok' if not bad else ('differs' if args.expect_original else 'FAIL')
            if bad and not args.expect_original:
                failures += 1
            print(f'GTK{toolkit} {case:8} {verdict:7} {got}', flush=True)
    for library in sorted(LIBRARIES):
        print('loaded', library)
    print(f'{failures} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
