/* 任务栏输入法选择器：本机 Fcitx 真实配置组与 GNOME 键盘源，不处理候选词内容。
 *
 * Windows 11 lists each input method on two lines, the language and then
 * the keyboard or IME, beside the short mark the taskbar shows for it (ENG,
 * 中); the one in use is marked with an accent bar. Fcitx is asked afresh
 * each time the list opens — methods added or a group switched in its
 * settings show up at once, and it announces neither.
 */
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {applyThemeClass} from './theme.js';
import {sideFacingBar} from './barEdge.js';
import {anchorPopup} from './popupAnchor.js';

const BUS = 'org.fcitx.Fcitx5';
const PATH = '/controller';
const IFACE = 'org.fcitx.Fcitx.Controller1';

/* Fcitx takes its bus name before its controller answers, so reads made
 * as soon as it appears — at login, when the shell and it start together —
 * can fail. Those are retried, a second apart, this many times. */
const LOAD_RETRIES = 10;

/** How long the list waits for Fcitx before opening with what it has. */
const OPEN_WAIT = 400;

/* The marks Windows shows for languages that have no character of their
 * own on the taskbar. */
const MARKS = {en: 'ENG', ja: 'JPN', ko: 'KOR', de: 'DEU', fr: 'FRA', es: 'ESP',
    it: 'ITA', ru: 'RUS', pt: 'POR'};

/**
 * A language code as a name: 'zh_CN' is "Chinese (China)".
 *
 * @param {string} code a language code, optionally with a country
 * @returns {string} its name, or the code if it has none
 */
function languageName(code) {
    const [language, country] = code.split(/[_-]/);
    const name = GnomeDesktop.get_language_from_code(language, null);
    if (!name)
        return code;
    const place = country ? GnomeDesktop.get_country_from_code(country.toUpperCase(), null) : null;
    return place ? `${name} (${place})` : name;
}

/**
 * The mark the taskbar shows for an input method.
 *
 * @param {object} method an entry of _methods
 * @returns {string} ENG, 中 and the like
 */
function markFor(method) {
    if (method.short)
        return method.short.toUpperCase();
    const language = (method.language ?? '').split(/[_-]/)[0].toLowerCase();
    if (language === 'zh')
        return '中';
    return MARKS[language] ?? (language.toUpperCase() || 'IME');
}

export const InputMethodButton = GObject.registerClass({GTypeName: 'W11InputMethodButton'},
class InputMethodButton extends St.Button {
    _init(taskbar) {
        super._init({style_class: 'w11-shell-button w11-input-method', can_focus: true,
            track_hover: true, label: 'ENG', accessible_name: 'Input language'});
        this._taskbar = taskbar;
        this._settings = taskbar.settings;
        this._cancellable = new Gio.Cancellable();
        this._methods = [];
        this._fcitx = false;
        this._fcitxOwned = false;
        this._retries = 0;
        this._retryId = 0;
        this._openWaitId = 0;
        this._pollInFlight = false;
        this._currentId = '';
        this._switching = null;
        this._menu = new PopupMenu.PopupMenu(this, 0.5, sideFacingBar(taskbar.edge));
        this._menu.actor.add_style_class_name('w11-tray-menu');
        this._menu.actor.add_style_class_name('w11-input-panel');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(this);
        this._manager.addMenu(this._menu);
        taskbar.applyAcrylicToPopup(this._menu);
        anchorPopup(this._menu, this, {edge: taskbar.edge});
        this.connect('clicked', () => this.open());
        this._sourceManager = Keyboard.getInputSourceManager();
        this._sourceId = this._sourceManager.connect('current-source-changed', () => {
            if (!this._fcitx)
                this._syncGnome();
        });
        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.NONE,
            () => {
                this._fcitxOwned = true;
                this._retries = 0;
                this._loadFcitx();
            }, () => {
                this._fcitxOwned = false;
                this._fcitx = false;
                this._syncGnome();
            });
        this._pollId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            if (this.mapped && this._fcitx)
                this._poll();
            return GLib.SOURCE_CONTINUE;
        });
        this.connect('destroy', () => this._onDestroy());
        this.updateMetrics();
        this._syncGnome();
    }

    updateMetrics() {
        this.set_size(...this._taskbar.cellSize(40));
    }

    /* Only a Fcitx already running is asked: a call must not start one —
     * the session starts the input method it wants, and a Fcitx started
     * behind its back would turn IBus out. */
    _call(method, args, callback) {
        Gio.DBus.session.call(BUS, PATH, IFACE, method, args, null,
            Gio.DBusCallFlags.NO_AUTO_START, 3000, this._cancellable, (connection, result) => {
                if (this._cancellable.is_cancelled())
                    return;
                try {callback(null, connection.call_finish(result).deepUnpack());}
                catch (error) {callback(error, null);}
            });
    }

    /**
     * Read the current group's methods from Fcitx.
     *
     * @param {Function} [done] called once it has succeeded or failed
     */
    _loadFcitx(done = null) {
        const fail = () => {
            this._retryLoad();
            done?.();
        };
        this._call('CurrentInputMethodGroup', null, (error, result) => {
            if (error) {
                fail();
                return;
            }
            this._call('InputMethodGroupInfo', new GLib.Variant('(s)', [result[0]]), (groupError, group) => {
                if (groupError) {
                    fail();
                    return;
                }
                this._call('AvailableInputMethods', null, (methodsError, available) => {
                    if (methodsError) {
                        fail();
                        return;
                    }
                    // (unique name, name, native name, icon, label, language, configurable)
                    const info = new Map(available[0].map(entry => [entry[0], entry]));
                    this._methods = group[1].map(([id]) => {
                        const [, name = id, , , , language = ''] = info.get(id) ?? [];
                        return {id, name: name.replace(/^Keyboard - /, ''), language};
                    });
                    this._fcitx = true;
                    this._retries = 0;
                    this._poll();
                    done?.();
                });
            });
        });
    }

    _retryLoad() {
        // Once read, a later failure is not the startup race: keep the list.
        if (this._fcitx || this._retryId || !this._fcitxOwned || this._retries >= LOAD_RETRIES)
            return;
        this._retries++;
        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._retryId = 0;
            if (this._fcitxOwned)
                this._loadFcitx();
            return GLib.SOURCE_REMOVE;
        });
    }

    _poll() {
        if (this._pollInFlight)
            return;
        this._pollInFlight = true;
        this._call('CurrentInputMethod', null, (error, result) => {
            this._pollInFlight = false;
            if (error)
                return;
            this._currentId = result[0];
            const method = this._methods.find(item => item.id === this._currentId);
            this.label = method ? markFor(method) : 'ENG';
            this.accessible_name = method?.name ?? 'Input language';
        });
    }

    _syncGnome() {
        this._methods = Object.values(this._sourceManager.inputSources).map(source => ({
            id: `${source.type}:${source.id}`, name: source.displayName, short: source.shortName, source}));
        const current = this._sourceManager.currentSource;
        this._currentId = current ? `${current.type}:${current.id}` : '';
        this.label = current?.shortName?.toUpperCase() || 'ENG';
    }

    open() {
        if (this._menu.isOpen) {
            this._menu.close();
            return;
        }
        if (!this._fcitxOwned) {
            this._showMenu();
            return;
        }
        // Ask Fcitx afresh, but do not keep the click waiting on it.
        let shown = false;
        const show = () => {
            if (shown)
                return;
            shown = true;
            if (this._openWaitId)
                GLib.source_remove(this._openWaitId);
            this._openWaitId = 0;
            this._showMenu();
        };
        this._openWaitId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, OPEN_WAIT, () => {
            this._openWaitId = 0;
            show();
            return GLib.SOURCE_REMOVE;
        });
        this._loadFcitx(show);
    }

    /**
     * Win+Space, as on Windows 11: the list opens with the next input method
     * marked; while Win is held each Space marks the one after it (with
     * Shift, the one before), and letting go of Win switches to the marked
     * one. A quick press and release just switches. Esc lets it be.
     *
     * @param {number} step 1 for the next, -1 for the one before
     * @param {number} mask the modifiers that keep the list open
     */
    cycle(step, mask) {
        if (this._methods.length < 2)
            return;
        const index = Math.max(0, this._methods.findIndex(method => method.id === this._currentId));
        // Where there is nowhere to show the list — the button hidden, or
        // another menu holding the screen — switch without it.
        if (!this.mapped || (Main.actionMode === Shell.ActionMode.POPUP && !this._menu.isOpen)) {
            const count = this._methods.length;
            this.select(this._methods[(((index + step) % count) + count) % count]);
            return;
        }
        if (!this._switching) {
            this._switching = {mask, index};
            if (!this._menu.isOpen)
                this._showMenu();
            this._switching.eventId = this._menu.actor.connect('captured-event',
                (_actor, event) => this._onSwitchEvent(event));
            this._switching.closeId = this._menu.connect('open-state-changed', (_menu, open) => {
                if (!open)
                    this._endSwitch(false);
            });
        }
        this._mark(this._switching.index + step);
        // Let go of already: a quick press.
        const [,, mods] = global.get_pointer();
        if (!(mods & this._switching.mask))
            this._endSwitch(true);
    }

    _mark(index) {
        const count = this._methods.length;
        this._switching.index = ((index % count) + count) % count;
        this._highlight(this._switching.index);
        const row = this._rows?.[this._switching.index];
        if (row)
            row.active = true;
    }

    /* The accent bar and the shade go on one row: the input method in use
     * when the list is opened from the taskbar, and while Win+Space cycles,
     * the one marked — moving with each Space, as on Windows. */
    _highlight(index) {
        (this._rows ?? []).forEach((row, i) => {
            const on = i === index;
            row._w11Pill.opacity = on ? 255 : 0;
            if (on)
                row.add_style_class_name('w11-input-current');
            else
                row.remove_style_class_name('w11-input-current');
        });
    }

    _onSwitchEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS) {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_space) {
                const back = (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
                this._mark(this._switching.index + (back ? -1 : 1));
                return Clutter.EVENT_STOP;
            }
            if ([Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_ISO_Enter].includes(symbol)) {
                this._endSwitch(true);
                return Clutter.EVENT_STOP;
            }
        } else if (type === Clutter.EventType.KEY_RELEASE) {
            const [,, mods] = global.get_pointer();
            if (!(mods & this._switching.mask)) {
                this._endSwitch(true);
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _endSwitch(commit) {
        const switching = this._switching;
        if (!switching)
            return;
        this._switching = null;
        this._menu.actor.disconnect(switching.eventId);
        this._menu.disconnect(switching.closeId);
        if (commit)
            this.select(this._methods[switching.index]);
    }

    get switching() {
        return this._switching !== null && this._switching !== undefined;
    }

    _showMenu() {
        this._menu.removeAll();
        this._rows = [];
        const header = new PopupMenu.PopupMenuItem('Keyboard layout and input method', {reactive: false});
        header.add_style_class_name('w11-input-header');
        this._menu.addMenuItem(header);
        for (const method of this._methods) {
            const row = this._row(method);
            this._rows.push(row);
            this._menu.addMenuItem(row);
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const configure = new PopupMenu.PopupMenuItem('Input method settings');
        configure.connect('activate', () => {
            if (this._fcitx)
                this._call('Configure', null, () => {});
            else
                Gio.Subprocess.new(['gnome-control-center', 'keyboard'], Gio.SubprocessFlags.NONE);
        });
        this._menu.addMenuItem(configure);
        applyThemeClass(this._menu.actor);
        this._menu.open(true);
    }

    /* The language on top and the keyboard or IME under it, beside the
     * mark; GNOME's own sources have only the one name. */
    _row(method) {
        const current = method.id === this._currentId;
        const row = new PopupMenu.PopupBaseMenuItem({style_class: 'w11-input-row'});
        row.setOrnament(PopupMenu.Ornament.HIDDEN);
        // Taking its room on every row keeps the marks in a column.
        row._w11Pill = new St.Widget({style_class: 'w11-input-pill', opacity: current ? 255 : 0,
            y_align: Clutter.ActorAlign.CENTER});
        row.add_child(row._w11Pill);
        row.add_child(new St.Label({text: markFor(method), style_class: 'w11-input-mark',
            y_align: Clutter.ActorAlign.CENTER}));
        const text = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        row.label = new St.Label({text: method.language ? languageName(method.language) : method.name,
            style_class: 'w11-input-title'});
        text.add_child(row.label);
        if (method.language) {
            row.subtitle = new St.Label({text: method.name, style_class: 'w11-input-subtitle'});
            text.add_child(row.subtitle);
        }
        row.add_child(text);
        row.label_actor = row.label;
        if (current) {
            row.add_style_class_name('w11-input-current');
            row.add_accessible_state(Atk.StateType.CHECKED);
        }
        row.connect('activate', () => this.select(method));
        return row;
    }

    select(method) {
        this._menu.close(false);
        if (this._selectionId)
            GLib.source_remove(this._selectionId);
        // 关闭 popup、恢复原应用焦点后再切换，避免只改了 Shell 弹层的输入上下文。
        this._selectionId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._selectionId = 0;
            if (this._fcitx)
                this._call('SetCurrentIM', new GLib.Variant('(s)', [method.id]), error => {
                    if (!error)
                        this._poll();
                });
            else
                method.source?.activate(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    refreshTheme() {
        applyThemeClass(this._menu.actor);
    }

    _onDestroy() {
        this._endSwitch(false);
        this._cancellable.cancel();
        this._sourceManager.disconnect(this._sourceId);
        Gio.bus_unwatch_name(this._watchId);
        GLib.source_remove(this._pollId);
        for (const id of [this._selectionId, this._retryId, this._openWaitId]) {
            if (id)
                GLib.source_remove(id);
        }
        this._menu.destroy();
    }
});
