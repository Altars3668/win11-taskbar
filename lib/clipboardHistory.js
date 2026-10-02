/* clipboardHistory.js — the panel Windows opens with Win+V.
 *
 * Windows keeps the last couple of dozen things you copied and offers
 * them back at the pointer, with the ones you pinned kept across
 * restarts. This is that, for GNOME.
 *
 * Choosing an entry pastes it, as Windows does. An ordinary client
 * cannot synthesise input on Wayland, but the shell is the compositor:
 * Clutter will hand out a virtual input device, which is the same
 * mechanism the on-screen keyboard uses. The paste goes out after the
 * modal grab is released, so it lands in the window that had focus
 * rather than in this panel.
 *
 * One limit remains: GNOME has no clipboard-changed signal, so the
 * clipboard is polled — at low priority, like every clipboard manager.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, SLIDE, slideIn, slideOut} from './motion.js';
import {applyThemeClass} from './theme.js';

/** How often to look at the clipboard, and how much to remember. */
const POLL_INTERVAL_MS = 1200;
const MAX_ENTRIES = 25;

/** How long to wait after closing before typing the paste, so the grab
 *  has unwound and focus is back where it was. */
const PASTE_DELAY_MS = 140;

/** Applications where Ctrl+V is not paste. */
const TERMINAL_CLASSES = [
    'gnome-terminal', 'org.gnome.terminal', 'org.gnome.console', 'kgx',
    'ptyxis', 'org.gnome.ptyxis', 'konsole', 'xterm', 'alacritty',
    'kitty', 'wezterm', 'foot', 'terminator', 'tilix',
];

/**
 * Whether a window wants Ctrl+Shift+V rather than Ctrl+V.
 *
 * @param {Meta.Window|null} win the window to check
 * @returns {boolean} true for terminals
 */
function isTerminal(win) {
    const cls = (win?.get_wm_class() ?? '').toLowerCase();
    return TERMINAL_CLASSES.some(t => cls.includes(t));
}

/** Panel geometry, following Windows' proportions. */
const PANEL_WIDTH = 320;
const PANEL_MAX_HEIGHT = 420;
const POINTER_GAP = 12;

/** One row: a snippet, a pin and a delete. */
const Entry = GObject.registerClass({
    Signals: {
        'chosen': {},
        'pin-toggled': {},
        'removed': {},
    },
}, class Entry extends St.Button {
    _init(text, pinned) {
        super._init({
            style_class: 'w11-clip-entry',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });

        this.text = text;

        const box = new St.BoxLayout({
            style_class: 'w11-clip-entry-box',
            x_expand: true,
        });
        this.set_child(box);

        // Collapse whitespace so a multi-line snippet stays one row.
        const label = new St.Label({
            text: text.replace(/\s+/g, ' ').trim().slice(0, 160),
            style_class: 'w11-clip-text',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        box.add_child(label);

        this._pin = new St.Button({
            style_class: 'w11-clip-action',
            child: new St.Icon({
                icon_name: pinned
                    ? 'view-pin-symbolic' : 'view-pin-symbolic',
                style_class: 'w11-shell-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pin.accessible_name = pinned ? _('Unpin') : _('Pin');
        if (pinned)
            this._pin.add_style_class_name('w11-clip-pinned');
        this._pin.connect('clicked', () => this.emit('pin-toggled'));
        box.add_child(this._pin);

        const remove = new St.Button({
            style_class: 'w11-clip-action',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                style_class: 'w11-shell-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        remove.accessible_name = _('Remove');
        remove.connect('clicked', () => this.emit('removed'));
        box.add_child(remove);

        this.connect('clicked', () => this.emit('chosen'));
    }
});

export const ClipboardHistory = GObject.registerClass(
class ClipboardHistory extends St.Widget {
    _init(taskbar) {
        super._init({
            style_class: 'w11-clipboard',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            visible: false,
            opacity: 0,
        });

        this._taskbar = taskbar;
        this._settings = taskbar.settings;
        this._entries = [];          // newest first, strings
        this._last = null;
        this._modal = null;

        this._pinned = this._settings.get_strv('clipboard-pinned');

        this._panel = new St.BoxLayout({
            style_class: 'w11-clip-panel',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._panel);

        const header = new St.BoxLayout({style_class: 'w11-clip-header'});
        header.add_child(new St.Label({
            text: _('Clipboard'),
            style_class: 'w11-clip-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const clear = new St.Button({
            style_class: 'w11-clip-action',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        clear.accessible_name = _('Clear all');
        clear.connect('clicked', () => this._clearAll());
        header.add_child(clear);
        this._panel.add_child(header);

        this._scroll = new St.ScrollView({
            style_class: 'w11-clip-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        this._list = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this._panel.add_child(this._scroll);

        Main.layoutManager.addChrome(this);
        applyThemeClass(this);
        this._startPolling();
        this.connect('destroy', () => this._onDestroy());
    }

    /* ------------------------------------------------------- collecting */

    _startPolling() {
        // Low priority: this runs forever, and nothing depends on it
        // being prompt.
        this._pollId = GLib.timeout_add(GLib.PRIORITY_LOW, POLL_INTERVAL_MS,
            () => {
                this._poll();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _poll() {
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD,
            (_clipboard, text) => {
                if (!text || text === this._last)
                    return;
                this._last = text;
                this._remember(text);
            });
    }

    _remember(text) {
        if (text.trim() === '')
            return;
        this._entries = [text, ...this._entries.filter(e => e !== text)]
            .slice(0, MAX_ENTRIES);
        if (this.visible)
            this._rebuild();
    }

    /* ------------------------------------------------------------- list */

    /** Pinned entries first, then the rest in order of use. */
    _ordered() {
        const pinned = this._pinned.filter(p => p.trim() !== '');
        const rest = this._entries.filter(e => !pinned.includes(e));
        return [...pinned.map(t => [t, true]), ...rest.map(t => [t, false])];
    }

    _rebuild() {
        this._list.destroy_all_children();
        const items = this._ordered();

        if (items.length === 0) {
            this._list.add_child(new St.Label({
                text: _('Nothing copied yet'),
                style_class: 'w11-clip-empty',
            }));
            return;
        }

        for (const [text, pinned] of items) {
            const entry = new Entry(text, pinned);
            entry.connect('chosen', () => this._choose(text));
            entry.connect('pin-toggled', () => this._togglePin(text));
            entry.connect('removed', () => this._remove(text));
            this._list.add_child(entry);
        }
    }

    _choose(text) {
        // Remember what had focus before the grab took it away; that is
        // where the paste has to land.
        const target = this._focusBeforeOpen;

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
        this._last = text;
        this.close();

        if (!this._settings.get_boolean('clipboard-paste'))
            return;

        // Let the grab unwind and focus return before typing, otherwise
        // the keystroke arrives while this panel still owns the keyboard.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
            this._sendPaste(target);
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Type the paste shortcut into whatever has focus.
     *
     * @param {Meta.Window|null} target the window that had focus, used
     *   only to pick between Ctrl+V and Ctrl+Shift+V
     */
    _sendPaste(target) {
        let device = this._virtualKeyboard;
        if (!device) {
            const seat = Clutter.get_default_backend().get_default_seat();
            device = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE);
            this._virtualKeyboard = device;
        }
        if (!device)
            return;

        // Terminals take Ctrl+Shift+V; Ctrl+V means something else there.
        const shifted = isTerminal(target ?? global.display.focus_window);
        const time = Clutter.get_current_event_time();
        const P = Clutter.KeyState.PRESSED;
        const R = Clutter.KeyState.RELEASED;

        device.notify_keyval(time, Clutter.KEY_Control_L, P);
        if (shifted)
            device.notify_keyval(time, Clutter.KEY_Shift_L, P);
        device.notify_keyval(time, Clutter.KEY_v, P);
        device.notify_keyval(time, Clutter.KEY_v, R);
        if (shifted)
            device.notify_keyval(time, Clutter.KEY_Shift_L, R);
        device.notify_keyval(time, Clutter.KEY_Control_L, R);
    }

    _togglePin(text) {
        this._pinned = this._pinned.includes(text)
            ? this._pinned.filter(t => t !== text)
            : [text, ...this._pinned];
        this._settings.set_strv('clipboard-pinned', this._pinned);
        this._rebuild();
    }

    _remove(text) {
        this._entries = this._entries.filter(e => e !== text);
        if (this._pinned.includes(text)) {
            this._pinned = this._pinned.filter(t => t !== text);
            this._settings.set_strv('clipboard-pinned', this._pinned);
        }
        this._rebuild();
    }

    _clearAll() {
        this._entries = [];
        this._pinned = [];
        this._settings.set_strv('clipboard-pinned', []);
        this._rebuild();
    }

    /* --------------------------------------------------------- open/close */

    get isOpen() {
        return this.visible;
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.visible)
            return;
        if (Main.overview.visible)
            Main.overview.hide();

        this._focusBeforeOpen = global.display.focus_window;

        this._rebuild();
        applyThemeClass(this);
        this.visible = true;
        this._reposition();

        slideIn(this, {from: SLIDE / 2, ms: DURATION.normal});

        this._modal = Main.pushModal(this, {
            actionMode: Shell.ActionMode.POPUP,
        });
        global.stage.set_key_focus(this);

        this._acceptsDismiss = false;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._acceptsDismiss = true;
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        if (!this.visible)
            return;
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        slideOut(this, {
            onComplete: () => {
                this.visible = false;
            },
        });
    }

    /** Windows puts this where you are working, so it follows the
     *  pointer, clamped to the monitor it is on. */
    _reposition() {
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [px, py] = global.get_pointer();
        // currentMonitor is the one the pointer is on, which is exactly
        // the monitor this panel should clamp itself to.
        const monitor = Main.layoutManager.currentMonitor ??
            Main.layoutManager.primaryMonitor;

        const width = PANEL_WIDTH * s;
        const height = Math.min(PANEL_MAX_HEIGHT * s,
            Math.max(this.get_preferred_height(width)[1], 120 * s));
        this.set_size(Math.round(width), Math.round(height));

        const gap = POINTER_GAP * s;
        let x = px - width / 2;
        x = Math.max(monitor.x + gap,
            Math.min(x, monitor.x + monitor.width - width - gap));

        // Below the pointer if it fits, above it otherwise.
        let y = py + gap;
        if (y + height > monitor.y + monitor.height - this._taskbar.height)
            y = py - height - gap;
        y = Math.max(monitor.y + gap, y);

        this.set_position(Math.round(x), Math.round(y));
    }

    vfunc_key_press_event(event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_press_event(event) {
        if (!this._acceptsDismiss)
            return Clutter.EVENT_STOP;
        const target = event.get_source();
        if (!this._panel.contains(target) && target !== this._panel)
            this.close();
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        this._virtualKeyboard = null;
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        Main.layoutManager.removeChrome(this);
    }
});

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
