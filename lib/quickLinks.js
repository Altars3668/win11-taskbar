/* quickLinks.js — the menu Windows opens with Win+X.
 *
 * Microsoft calls it the Quick Link menu; most people know it as
 * right-clicking the Start button. It is a flat list of administrative
 * destinations, and it is the one part of the Start button people reach
 * for by muscle memory, so a Start button without it feels broken.
 *
 * The entries are Windows' own, mapped to what the destination is on this
 * system. A few have no counterpart — Device Manager and Computer
 * Management are Windows-shaped ideas — and are left out rather than
 * pointed at something that merely sounds similar. Anything whose target
 * is not installed is dropped at build time, so the menu never offers
 * something that will not open.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {applyThemeClass} from './theme.js';
import {anchorPopup} from './popupAnchor.js';

/** A Settings panel, if GNOME Settings is installed. */
function settingsPanel(panel) {
    return () => spawn(['gnome-control-center', panel]);
}

function spawn(argv) {
    try {
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (e) {
        logError(e, `win11-taskbar: cannot run ${argv[0]}`);
    }
}

function haveCommand(name) {
    return GLib.find_program_in_path(name) !== null;
}

/** Launch a .desktop if it exists, else fall back to a command. */
function launchApp(id, fallbackArgv) {
    const app = Shell.AppSystem.get_default().lookup_app(id);
    if (app) {
        app.activate_full(-1, global.get_current_time());
        return;
    }
    if (fallbackArgv)
        spawn(fallbackArgv);
}

export class QuickLinksMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor, taskbar) {
        super(sourceActor, 0.0, taskbar.isBottom ? St.Side.BOTTOM : St.Side.TOP);

        this._taskbar = taskbar;
        this.actor.add_style_class_name('w11-quick-links');
        this.actor.add_style_class_name('w11-jumplist');
        applyThemeClass(this.actor);

        this._build();

        Main.uiGroup.add_child(this.actor);
        this.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(sourceActor);
        this._manager.addMenu(this);
        taskbar.applyAcrylicToPopup(this);
        anchorPopup(this, sourceActor, {bottom: taskbar.isBottom});
    }

    _build() {
        const terminal = this._terminalCommand();
        const resources = Shell.AppSystem.get_default().lookup_app('net.nokyan.Resources.desktop');

        // Windows' order, minus the entries with no counterpart here.
        const groups = [
            [
                [_('Apps and Features'), () =>
                    spawn(['gnome-control-center', 'applications']),
                    haveCommand('gnome-control-center')],
                [_('Power Options'), settingsPanel('power'),
                    haveCommand('gnome-control-center')],
                [_('System'), settingsPanel('system'),
                    haveCommand('gnome-control-center')],
            ],
            [
                [_('Event Viewer'), () => launchApp('org.gnome.Logs.desktop',
                    ['gnome-logs']), haveCommand('gnome-logs')],
                [_('Network Connections'), settingsPanel('network'),
                    haveCommand('gnome-control-center')],
                [_('Disk Management'), () =>
                    launchApp('org.gnome.DiskUtility.desktop', ['gnome-disks']),
                    haveCommand('gnome-disks')],
                [_('Task Manager'), () => resources
                    ? resources.activate_full(-1, global.get_current_time())
                    : launchApp('gnome-system-monitor.desktop', ['gnome-system-monitor']),
                    Boolean(resources) || haveCommand('gnome-system-monitor')],
            ],
            [
                [_('Terminal'), () => spawn(terminal), terminal !== null],
                [_('Terminal (Admin)'), () => this._adminTerminal(terminal),
                    terminal !== null && haveCommand('pkexec')],
            ],
            [
                [_('Settings'), () => launchApp('org.gnome.Settings.desktop',
                    ['gnome-control-center']),
                    haveCommand('gnome-control-center')],
                [_('File Explorer'), () =>
                    launchApp('org.gnome.Nautilus.desktop', ['nautilus']),
                    haveCommand('nautilus')],
                [_('Search'), () => Main.overview.show(), true],
                [_('Run'), () => this._openRunDialog(), true],
            ],
        ];

        for (const group of groups) {
            const usable = group.filter(([, , available]) => available);
            if (usable.length === 0)
                continue;
            if (!this.isEmpty())
                this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            for (const [label, action] of usable) {
                const item = new PopupMenu.PopupMenuItem(label);
                item.connect('activate', () => {
                    this.close();
                    action();
                });
                this.addMenuItem(item);
            }
        }

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._addShutdownSubmenu();

        const desktop = new PopupMenu.PopupMenuItem(_('Desktop'));
        desktop.connect('activate', () => {
            this.close();
            this._showDesktop();
        });
        this.addMenuItem(desktop);
    }

    /** Windows nests sign out, sleep, shut down and restart here. */
    _addShutdownSubmenu() {
        const actions = SystemActions.getDefault();
        const entries = [
            ['logout', _('Sign out'), actions.canLogout],
            ['suspend', _('Sleep'), actions.canSuspend],
            ['power-off', _('Shut down'), actions.canPowerOff],
            ['restart', _('Restart'), actions.canRestart],
        ].filter(([, , available]) => available);

        if (entries.length === 0)
            return;

        const submenu = new PopupMenu.PopupSubMenuMenuItem(
            _('Shut down or sign out'));
        for (const [id, label] of entries) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                this.close();
                actions.activateAction(id);
            });
            submenu.menu.addMenuItem(item);
        }
        this.addMenuItem(submenu);
    }

    /** The user's terminal, as argv, or null if none is installed. */
    _terminalCommand() {
        try {
            const settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.default-applications.terminal',
            });
            const exec = settings.get_string('exec');
            if (exec && haveCommand(exec))
                return [exec];
        } catch {
            // The schema is not guaranteed to exist.
        }
        for (const candidate of ['kgx', 'gnome-terminal', 'ptyxis',
            'konsole', 'xterm']) {
            if (haveCommand(candidate))
                return [candidate];
        }
        return null;
    }

    _adminTerminal(terminal) {
        if (!terminal)
            return;
        // pkexec prompts properly; su/sudo in a fresh terminal would not
        // have anywhere to ask for the password.
        spawn(['pkexec', ...terminal]);
    }

    _openRunDialog() {
        // The shell's own run dialog is what Alt+F2 opens.
        Main.openRunDialog();
    }

    _showDesktop() {
        const workspace = global.workspace_manager.get_active_workspace();
        for (const win of workspace.list_windows()) {
            if (!win.skip_taskbar && !win.minimized)
                win.minimize();
        }
    }
}

let _gettext = s => s;

/**
 * Install the gettext function this module should use.
 *
 * @param {Function} fn the extension's gettext
 */
export function setGettext(fn) {
    _gettext = fn;
}

function _(s) {
    return _gettext(s);
}
