/* 任务栏输入法选择器：本机 Fcitx 真实配置组与 GNOME 键盘源，不处理候选词内容。 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import {applyThemeClass} from './theme.js';
import {anchorPopup} from './popupAnchor.js';

const BUS = 'org.fcitx.Fcitx5';
const PATH = '/controller';
const IFACE = 'org.fcitx.Fcitx.Controller1';

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
        this._pollInFlight = false;
        this._currentId = '';
        this._menu = new PopupMenu.PopupMenu(this, 0.5, taskbar.isBottom ? St.Side.BOTTOM : St.Side.TOP);
        this._menu.actor.add_style_class_name('w11-tray-menu');
        this._menu.actor.add_style_class_name('w11-input-panel');
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(this);
        this._manager.addMenu(this._menu);
        taskbar.applyAcrylicToPopup(this._menu);
        anchorPopup(this._menu, this, {bottom: taskbar.isBottom});
        this.connect('clicked', () => this.open());
        this._sourceManager = Keyboard.getInputSourceManager();
        this._sourceId = this._sourceManager.connect('current-source-changed', () => {
            if (!this._fcitx)
                this._syncGnome();
        });
        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, BUS, Gio.BusNameWatcherFlags.NONE,
            () => this._loadFcitx(), () => {this._fcitx = false; this._syncGnome();});
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
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.set_size(40 * scale, 48 * scale);
    }

    _call(method, args, callback) {
        Gio.DBus.session.call(BUS, PATH, IFACE, method, args, null,
            Gio.DBusCallFlags.NONE, 3000, this._cancellable, (connection, result) => {
                if (this._cancellable.is_cancelled())
                    return;
                try {callback(null, connection.call_finish(result).deepUnpack());}
                catch (error) {callback(error, null);}
            });
    }

    _loadFcitx() {
        this._call('CurrentInputMethodGroup', null, (error, result) => {
            if (error)
                return;
            this._call('InputMethodGroupInfo', new GLib.Variant('(s)', [result[0]]), (groupError, group) => {
                if (groupError)
                    return;
                this._call('AvailableInputMethods', null, (methodsError, available) => {
                    if (methodsError)
                        return;
                    const info = new Map(available[0].map(method => [method[0], method]));
                    this._methods = group[1].map(([id, layout]) => ({id, layout,
                        name: info.get(id)?.[1] || id,
                        language: info.get(id)?.[4] || (id.startsWith('keyboard-') ? 'en' : '')}));
                    this._fcitx = true;
                    this._poll();
                });
            });
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
            this.label = this._currentId.startsWith('keyboard-') ? 'ENG' : /zh|rime|pinyin/i.test(
                `${method?.language ?? ''} ${this._currentId}`) ? '中' : (method?.language || 'IME').slice(0, 3).toUpperCase();
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
        this._menu.removeAll();
        const header = new PopupMenu.PopupMenuItem('Keyboard layout and input method', {reactive: false});
        header.add_style_class_name('w11-input-header');
        this._menu.addMenuItem(header);
        for (const method of this._methods) {
            const row = new PopupMenu.PopupImageMenuItem(method.name,
                method.id.startsWith('keyboard') || method.source?.type === 'xkb' ? 'input-keyboard-symbolic' : 'accessories-character-map-symbolic');
            row.setOrnament(method.id === this._currentId ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            row.connect('activate', () => this.select(method));
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
        this._cancellable.cancel();
        this._sourceManager.disconnect(this._sourceId);
        Gio.bus_unwatch_name(this._watchId);
        GLib.source_remove(this._pollId);
        if (this._selectionId)
            GLib.source_remove(this._selectionId);
        this._menu.destroy();
    }
});
