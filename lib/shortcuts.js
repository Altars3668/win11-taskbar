/* shortcuts.js — the Windows key combinations people arrive expecting.
 *
 * Win+X and Win+V are elsewhere, because they own their own panels. This
 * is the rest of the set that a taskbar is responsible for: the ones that
 * open a shell surface, and the ones that reach a taskbar button.
 *
 * Super+1..9 is deliberately taken over. GNOME binds it to
 * switch-to-application-N, which walks the *favourites* list; Windows
 * walks the taskbar, which is favourites plus whatever else is running.
 * Those agree right up until something unpinned is open, and then they
 * disagree in a way that is very confusing. The shell's own binding is
 * disabled while ours is in place, and restored on disable.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** How many Super+N bindings Windows offers. */
const APP_KEYS = 9;

export class Shortcuts {
    constructor(taskbar) {
        this._taskbar = taskbar;
        this._settings = taskbar.settings;
        this._bound = [];
        this._suppressed = [];

        const mode = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        this._mode = mode;

        this._bind('show-desktop-key', () => this._showDesktop());
        this._bind('file-manager-key', () =>
            this._launch('org.gnome.Nautilus.desktop', ['nautilus']));
        this._bind('settings-key', () =>
            this._launch('org.gnome.Settings.desktop', ['gnome-control-center']));
        this._bind('run-key', () => Main.openRunDialog());
        this._bind('quick-settings-key', () =>
            Main.panel.statusArea.quickSettings?.menu?.toggle());
        this._bind('notifications-key', () =>
            taskbar.notificationCentre?.toggle());
        this._bind('cycle-tasks-key', () => this._cycleTasks());

        if (this._settings.get_boolean('super-number-keys'))
            this._bindAppKeys();
    }

    _bind(name, handler) {
        try {
            Main.wm.addKeybinding(name, this._settings,
                Meta.KeyBindingFlags.NONE, this._mode, handler);
            this._bound.push(name);
        } catch (e) {
            logError(e, `win11-taskbar: cannot bind ${name}`);
        }
    }

    /** Super+1..9 reaches the Nth taskbar button, as on Windows. */
    _bindAppKeys() {
        // Take GNOME's binding out of the way first, remembering it so
        // disable() can hand it back exactly as it was.
        const wmKeys = new Gio.Settings({
            schema_id: 'org.gnome.shell.keybindings',
        });
        for (let i = 1; i <= APP_KEYS; i++) {
            const key = `switch-to-application-${i}`;
            try {
                const current = wmKeys.get_strv(key);
                if (current.length > 0) {
                    this._suppressed.push([key, current]);
                    wmKeys.set_strv(key, []);
                }
            } catch {
                // Not every version has all nine.
            }
        }
        this._wmKeys = wmKeys;

        for (let i = 1; i <= APP_KEYS; i++)
            this._bind(`app-key-${i}`, () => this._activateNth(i - 1));
    }

    /**
     * Activate the Nth button, launching the app if it is not running.
     *
     * @param {number} index zero-based position in the task strip
     */
    _activateNth(index) {
        const buttons = this._taskbar.taskButtons;
        const button = buttons[index];
        if (!button)
            return;
        button.activateFromKeyboard();
    }

    /** Super+T walks the taskbar, as Windows does. */
    _cycleTasks() {
        const buttons = this._taskbar.taskButtons;
        if (buttons.length === 0)
            return;
        this._cycleIndex = ((this._cycleIndex ?? -1) + 1) % buttons.length;
        buttons[this._cycleIndex].activateFromKeyboard();
    }

    _showDesktop() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows()
            .filter(w => !w.skip_taskbar && !w.minimized);
        if (windows.length > 0) {
            this._minimized = windows;
            for (const win of windows)
                win.minimize();
        } else {
            for (const win of this._minimized ?? []) {
                if (win.get_compositor_private())
                    win.unminimize();
            }
            this._minimized = [];
        }
    }

    _launch(id, fallbackArgv) {
        const app = Shell.AppSystem.get_default().lookup_app(id);
        if (app) {
            app.activate_full(-1, global.get_current_time());
            return;
        }
        try {
            Gio.Subprocess.new(fallbackArgv, Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, `win11-taskbar: cannot launch ${id}`);
        }
    }

    destroy() {
        for (const name of this._bound)
            Main.wm.removeKeybinding(name);
        this._bound = [];

        for (const [key, value] of this._suppressed)
            this._wmKeys?.set_strv(key, value);
        this._suppressed = [];
        this._wmKeys = null;
        this._taskbar = null;
    }
}
