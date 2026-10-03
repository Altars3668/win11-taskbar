#!/usr/bin/env python3
"""Check when Edge opens its context menu, inside the headless test shell.

    tools/test-edge-context-menu.py [--flag=--blink-settings=showContextMenuOnMouseUp=true]

Runs a throwaway Edge profile on tools/testbed.sh's display (never the
real one), loads a page that writes every mousedown / mouseup /
contextmenu into its title, and drives it with the debug service's virtual
pointer. It reports, for a right click held for a moment:

  * the page events after the press and after the release, and
  * whether Edge's menu window existed after the press and after the release,

then tries a right-drag to the left — Edge's Back gesture — and reports
whether the page went back and whether a menu appeared anyway.
"""
import argparse
import importlib.util
import json
import os
import signal
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ctx', os.path.join(HERE, 'test-context-menu.py'))
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

EDGE = '/opt/microsoft/msedge-dev/msedge'
POPUP_TYPES = {6, 9, 10}     # MetaWindowType MENU, DROPDOWN_MENU, POPUP_MENU

PAGE_A = '''<!doctype html><meta charset="utf-8"><title>A:</title>
<style>html,body{height:100%;margin:0;background:#eef;font:40px sans-serif}</style>
<body>page A<a href="b.html" style="position:fixed;inset:0"></a><script>
const seen = [];
for (const type of ['mousedown', 'mouseup', 'contextmenu'])
  addEventListener(type, e => { seen.push(type + e.button); document.title = 'A:' + seen.join(','); }, true);
</script>'''
# B has no link. A is left by a real click: a navigation without user
# activation would leave A skippable, and Back would have nowhere to go.
PAGE_B = PAGE_A.replace('A:', 'B:').replace('page A', 'page B').replace(
    '<a href="b.html" style="position:fixed;inset:0"></a>', '')


def edge_window(shell):
    for w in json.loads(shell.trigger('windows')):
        if w['title'] and w['title'][:2] in ('A:', 'B:'):
            return w
    return None


def popups(shell):
    return [w for w in json.loads(shell.trigger('windows')) if w['type'] in POPUP_TYPES]


def page_events(shell):
    w = edge_window(shell)
    return w['title'].split(' ')[0] if w else None


def shoot(shell, prefix, name):
    if prefix:
        shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'Screenshot',
                             ctx.GLib.Variant('(s)', (f'{prefix}-{name}.png',)), None,
                             ctx.Gio.DBusCallFlags.NONE, 10000, None)
        time.sleep(0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--flag', action='append', default=[])
    ap.add_argument('--case', choices=('click', 'gesture'), default='click')
    ap.add_argument('--edge', default=EDGE,
                    help='what to run; /usr/bin/microsoft-edge-dev tests the installed launcher')
    ap.add_argument('--shot', help='screenshot path prefix')
    args = ap.parse_args()

    shell = ctx.Shell()
    work = tempfile.mkdtemp(prefix='edge-ctx-', dir=os.environ.get('TMPDIR'))
    for name, body in (('a.html', PAGE_A), ('b.html', PAGE_B)):
        with open(os.path.join(work, name), 'w') as f:
            f.write(body)
    os.makedirs(os.path.join(work, 'profile', 'Default'))
    with open(os.path.join(work, 'profile', 'Default', 'Preferences'), 'w') as f:
        json.dump({'edge_mouse_gesture': {'enabled': True}}, f)

    env = dict(os.environ)
    env.pop('DISPLAY', None)
    # Edge puts its singleton socket under $TMPDIR, and a long path
    # there exceeds the limit on socket path length.
    env.pop('TMPDIR', None)
    env.update(XDG_CONFIG_HOME=os.path.join(ctx.RUN, 'config'),
               WAYLAND_DISPLAY='w11test', DBUS_SESSION_BUS_ADDRESS=shell.address)
    cmd = [args.edge, f'--user-data-dir={work}/profile', '--ozone-platform=wayland',
           '--no-first-run', '--no-default-browser-check', '--password-store=basic',
           '--disable-sync', '--disable-gpu', *args.flag, f'file://{work}/a.html']
    log = open(os.path.join(os.environ.get('TMPDIR', '/tmp'), 'edge-ctx.log'), 'w')
    edge = subprocess.Popen(cmd, env=env, stdout=log, stderr=log,
                            start_new_session=True)
    try:
        deadline = time.time() + 40
        while not (page_events(shell) or '').startswith('A:'):
            if time.time() > deadline:
                raise SystemExit('Edge never showed page A; windows: '
                                 + shell.trigger('windows'))
            time.sleep(0.5)
        time.sleep(1.0)
        fx, fy, fw, fh = edge_window(shell)['frame']
        shell.pointer([{'move': [fx + fw // 2, fy + fh // 2]}, {'wait': 200}, {'press': 1},
                       {'wait': 60}, {'release': 1}, {'wait': 300}])
        deadline = time.time() + 20
        while not (page_events(shell) or '').startswith('B:'):
            if time.time() > deadline:
                raise SystemExit('Edge never reached page B; windows: '
                                 + shell.trigger('windows'))
            time.sleep(0.5)
        time.sleep(1.5)
        fx, fy, fw, fh = edge_window(shell)['frame']
        at = (fx + fw // 2, fy + fh // 2 + 60)

        print(f'flags: {" ".join(args.flag) or "(none)"}')
        if args.case == 'click':
            # A right click, held long enough to see what the press does.
            shell.pointer([{'move': list(at)}, {'wait': 200}, {'press': 3}, {'wait': 400}])
            after_press = (page_events(shell), bool(popups(shell)))
            shoot(shell, args.shot, 'press')
            shell.pointer([{'release': 3}, {'wait': 600}])
            after_release = (page_events(shell), bool(popups(shell)))
            shoot(shell, args.shot, 'release')
            print(f'after press:   events={after_press[0]!r:40} menu={after_press[1]}')
            print(f'after release: events={after_release[0]!r:40} menu={after_release[1]}')
        else:
            # Edge's Back gesture: hold the right button and draw leftwards.
            steps = [{'move': list(at)}, {'wait': 200}, {'press': 3}, {'wait': 80}]
            for i in range(1, 21):
                steps += [{'move': [at[0] - 15 * i, at[1]]}, {'wait': 20}]
            shell.pointer(steps)
            mid = (page_events(shell), bool(popups(shell)))
            shoot(shell, args.shot, 'drawing')
            shell.pointer([{'wait': 100}, {'release': 3}, {'wait': 1500}])
            shoot(shell, args.shot, 'after')
            print(f'while drawing: page={mid[0]!r:36} menu={mid[1]}')
            print(f'after release: page={page_events(shell)!r:36} menu={bool(popups(shell))}')
    finally:
        os.killpg(edge.pid, signal.SIGTERM)
        try:
            edge.wait(5)
        except subprocess.TimeoutExpired:
            os.killpg(edge.pid, signal.SIGKILL)
        subprocess.run(['rm', '-rf', work])


if __name__ == '__main__':
    main()
