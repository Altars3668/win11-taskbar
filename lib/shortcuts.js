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
 * disagree in a way that is very confusing.
 *
 * GNOME holds more of these accelerators itself: Super+V opens its
 * notification list, Super+A its app grid, Super+N focuses a notification.
 * Two bindings on one accelerator is not an error in mutter — whichever it
 * indexed last wins, and it re-indexes whenever bindings change — so the
 * shortcut would work or not by accident. yieldAccelerators() takes ours
 * out of GNOME's bindings first and restoreAccelerators() gives them back.
 * What was taken is kept in the yielded-bindings setting rather than in
 * memory: the shell does not disable extensions when a session ends, so a
 * record in memory would lose GNOME's bindings at the first logout.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** How many Super+N bindings Windows offers. */
const APP_KEYS = 9;

/** Where GNOME keeps the key bindings a Windows shortcut can collide with. */
const KEYBINDING_SCHEMAS = [
    'org.gnome.shell.keybindings',
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

function keybindingSettings() {
    const source = Gio.SettingsSchemaSource.get_default();
    return KEYBINDING_SCHEMAS
        .map(id => source.lookup(id, true))
        .filter(Boolean)
        .map(schema => [schema, new Gio.Settings({settings_schema: schema})]);
}

/**
 * Take the accelerators of our @names out of GNOME's own key bindings,
 * recording each binding's value from before we touched it.
 *
 * @param {Gio.Settings} settings this extension's settings
 * @param {string[]} names our keybinding keys
 */
export function yieldAccelerators(settings, names) {
    const ours = new Set(names.flatMap(name =>
        settings.get_strv(name).map(a => a.toLowerCase())));
    const record = settings.get_value('yielded-bindings').deep_unpack();

    for (const [schema, gnome] of keybindingSettings()) {
        for (const key of schema.list_keys()) {
            if (schema.get_key(key).get_value_type().dup_string() !== 'as')
                continue;
            const value = gnome.get_strv(key);
            const kept = value.filter(a => !ours.has(a.toLowerCase()));
            if (kept.length === value.length)
                continue;
            const id = `${schema.get_id()} ${key}`;
            record[id] ??= value;
            gnome.set_strv(key, kept);
        }
    }
    settings.set_value('yielded-bindings', new GLib.Variant('a{sas}', record));
}

/**
 * Give GNOME back what yieldAccelerators() took. A binding the user has
 * changed in the meantime keeps the change, with ours added back to it.
 *
 * @param {Gio.Settings} settings this extension's settings
 */
export function restoreAccelerators(settings) {
    const record = settings.get_value('yielded-bindings').deep_unpack();
    const byId = new Map(keybindingSettings().map(([s, g]) => [s.get_id(), [s, g]]));

    for (const [id, original] of Object.entries(record)) {
        const [schemaId, key] = id.split(' ');
        const [schema, gnome] = byId.get(schemaId) ?? [];
        if (!schema?.has_key(key))
            continue;
        const current = gnome.get_strv(key);
        gnome.set_strv(key, current.every(a => original.includes(a))
            ? original
            : [...current, ...original.filter(a => !current.includes(a))]);
    }
    settings.set_value('yielded-bindings', new GLib.Variant('a{sas}', {}));
}

export class Shortcuts {
    constructor(taskbar) {
        this._taskbar = taskbar;
        this._settings = taskbar.settings;
        this._bound = [];

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

    /** The keybinding keys this class binds, for yieldAccelerators(). */
    static keyNames(settings) {
        const names = ['show-desktop-key', 'file-manager-key', 'settings-key',
            'run-key', 'quick-settings-key', 'notifications-key', 'cycle-tasks-key'];
        if (settings.get_boolean('super-number-keys')) {
            for (let i = 1; i <= APP_KEYS; i++)
                names.push(`app-key-${i}`);
        }
        return names;
    }

    /** Super+1..9 reaches the Nth taskbar button, as on Windows. */
    _bindAppKeys() {
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

        this._taskbar = null;
    }
}
