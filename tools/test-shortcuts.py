#!/usr/bin/python3
"""The Windows shortcuts against GNOME's own key bindings, in the test shell.

    tools/test-shortcuts.py

GNOME holds some of the same accelerators (Super+V, Super+A, Super+N,
Super+1..9). Checks that enabling the extension takes them out of GNOME's
bindings and records what they were; that the shortcuts then work when
pressed for real, through a virtual keyboard; that disabling gives GNOME's
bindings back exactly; and that a session ending without disable — which is
how every logout ends — still gives them back later.
"""
import importlib.util
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ctx', os.path.join(HERE, 'test-context-menu.py'))
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

UUID = 'win11-taskbar@altarscn.com'
SCHEMADIR = os.path.join(HERE, '..', 'schemas')
GNOME = [('org.gnome.shell.keybindings', 'toggle-message-tray'),
         ('org.gnome.shell.keybindings', 'toggle-application-view'),
         ('org.gnome.shell.keybindings', 'focus-active-notification')]
GNOME += [('org.gnome.shell.keybindings', f'switch-to-application-{i}') for i in range(1, 10)]
SUPER, ESC = 0xffeb, 0xff1b
COMBOS = {'clipboard': 0x76, 'quickSettings': 0x61, 'notifications': 0x6e, 'quickLinks': 0x78, 'search': 0x73}


def env(bus=None):
    e = dict(os.environ, XDG_CONFIG_HOME=os.path.join(ctx.RUN, 'config'))
    if bus:
        e['DBUS_SESSION_BUS_ADDRESS'] = bus
    return e


def gsettings(bus, *args):
    cmd = ['gsettings', *args]
    if bus is None:   # no shell running: dconf needs a bus of its own
        cmd = ['dbus-run-session', '--', *cmd]
    return subprocess.run(cmd, env=env(bus), capture_output=True, text=True,
                          check=True, timeout=15).stdout.strip()


def gnome_values(bus):
    return {key: gsettings(bus, 'get', schema, key) for schema, key in GNOME}


def record(bus):
    return gsettings(bus, '--schemadir', SCHEMADIR, 'get',
                     'org.gnome.shell.extensions.win11-taskbar', 'yielded-bindings')


def testbed(cmd):
    subprocess.run([os.path.join(HERE, 'testbed.sh'), cmd], check=True, timeout=150)


def check(label, ok, detail=''):
    print(f'{"ok  " if ok else "FAIL"} {label}{"  " + detail if detail else ""}', flush=True)
    return ok


def main():
    testbed('stop')
    for schema, key in GNOME:   # start from GNOME's defaults
        gsettings(None, 'reset', schema, key)
    gsettings(None, '--schemadir', SCHEMADIR, 'reset',
              'org.gnome.shell.extensions.win11-taskbar', 'yielded-bindings')
    defaults = gnome_values(None)

    testbed('start')
    shell = ctx.Shell()
    shell.trigger('windows')
    time.sleep(2)
    results = []
    yielded = gnome_values(shell.address)
    results.append(check('GNOME gave up Super+V/A/N/1',
                         "'<Super>v'" not in yielded['toggle-message-tray'] and
                         "'<Super>m'" in yielded['toggle-message-tray'] and
                         all(yielded[k] == '@as []' for _s, k in GNOME[1:]), str(yielded)))
    results.append(check('what they were is recorded', 'toggle-message-tray' in record(shell.address)))

    for panel, key in COMBOS.items():
        shell.trigger('keys:' + json.dumps([{'press': SUPER}, {'press': key}, {'release': key},
                                            {'release': SUPER}, {'wait': 500}]))
        time.sleep(0.8)
        opened = json.loads(shell.trigger('state'))[panel]
        shell.trigger('keys:' + json.dumps([{'press': ESC}, {'release': ESC}, {'wait': 300}]))
        time.sleep(0.6)
        results.append(check(f'Super+{chr(key).upper()} opens {panel}', opened is True))

    subprocess.run(['gnome-extensions', 'disable', UUID], env=env(shell.address))
    time.sleep(1.5)
    results.append(check('disable gives GNOME its bindings back',
                         gnome_values(shell.address) == defaults, str(gnome_values(shell.address))))
    results.append(check('and clears the record', record(shell.address) == '@a{sas} {}'))

    subprocess.run(['gnome-extensions', 'enable', UUID], env=env(shell.address))
    time.sleep(2)
    testbed('stop')   # a session that ends without disable, as a logout does
    results.append(check('a session ending without disable keeps the record',
                         'toggle-message-tray' in record(None)))
    testbed('start')
    shell = ctx.Shell()
    subprocess.run(['gnome-extensions', 'disable', UUID], env=env(shell.address))
    time.sleep(1.5)
    results.append(check('and the next disable still gives them back',
                         gnome_values(shell.address) == defaults, str(gnome_values(shell.address))))
    subprocess.run(['gnome-extensions', 'enable', UUID], env=env(shell.address))

    failures = results.count(False)
    print(f'{failures} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
