/* 独立本地搜索：不借用 Start、不扫描磁盘、不联网、不持久化查询。 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {AppRow} from './startMenu.js';
import {ApplicationOrder} from './applicationOrder.js';
import {activateApplication, installedApplications, matchingApplications} from './applicationSearch.js';
import {matchesQuery} from './searchMatch.js';
import {closeOtherLaunchers, registerLauncher} from './launcherPanels.js';
import {besideBar} from './barEdge.js';
import {DURATION, SLIDE, slideIn, slideOut} from './motion.js';
import {START_MENU} from './spec.js';
import {applyThemeClass} from './theme.js';
import {passOnPress} from './shellMenus.js';

export const SearchPanel = GObject.registerClass(
class SearchPanel extends St.Widget {
    _init(taskbar, gettext) {
        super._init({style_class: 'w11-start-menu w11-search-panel',
            layout_manager: new Clutter.BinLayout(), reactive: true, visible: false, opacity: 0});
        this._taskbar = taskbar;
        this._ = gettext;
        this._isOpen = false;
        this._timer = 0;
        this._dismissIdleId = 0;
        this._scope = 'all';
        this._results = [];
        this._order = new ApplicationOrder(() => { if (this._isOpen) this._render(); });
        this._unregister = registerLauncher(this);
        this._panel = new St.BoxLayout({style_class: 'w11-start-panel w11-search-panel-content',
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
        this.add_child(this._panel);
        this._entry = new St.Entry({style_class: 'w11-start-search', can_focus: true, x_expand: true,
            hint_text: gettext('Search apps, recent files and folders')});
        this._entry.set_primary_icon(new St.Icon({icon_name: 'system-search-symbolic',
            style_class: 'w11-start-search-icon', icon_size: 16}));
        this._entry.clutter_text.connect('text-changed', () => this._queueRender());
        this._entry.clutter_text.connect('activate', () => this._results[0]?.emit('clicked', 1));
        this._panel.add_child(this._entry);
        const tabs = new St.BoxLayout({style_class: 'w11-search-scopes'});
        this._scopeButtons = new Map();
        for (const [id, label] of [['all', 'All'], ['apps', 'Apps'], ['files', 'Files'], ['folders', 'Folders']]) {
            const button = new St.Button({style_class: 'w11-start-allapps', label: gettext(label), can_focus: true});
            button.connect('clicked', () => {
                this._scope = id;
                this._render();
                global.stage.set_key_focus(this._entry.clutter_text);
            });
            tabs.add_child(button);
            this._scopeButtons.set(id, button);
        }
        this._panel.add_child(tabs);
        this._scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, x_expand: true, y_expand: true});
        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._scroll.set_child(this._list);
        this._panel.add_child(this._scroll);
        const scope = new St.Label({text: gettext('Local apps and recent items only; no web or disk scan.'),
            style_class: 'w11-start-row-subtitle'});
        scope.clutter_text.line_wrap = true;
        this._panel.add_child(scope);
        this._unsubscribe = taskbar.recentDocuments.subscribe(() => { if (this._isOpen) this._render(); });
        this._appSystem = Shell.AppSystem.get_default();
        this._installedId = this._appSystem.connect('installed-changed', () => { if (this._isOpen) this._render(); });
        Main.layoutManager.addChrome(this);
        this.connect('captured-event', (_actor, event) => this._capturedEvent(event));
        this.connect('destroy', () => this._onDestroy());
    }

    get isOpen() { return this._isOpen; }
    toggle() { if (this._isOpen) this.close(); else this.open(); }

    _queueRender() {
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._timer = 0;
            if (this._isOpen) this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _render() {
        const query = this._entry.get_text().trim();
        const focus = global.stage.get_key_focus();
        const oldIndex = this._results.indexOf(focus);
        this._results = [];
        this._list.destroy_all_children();
        for (const [id, button] of this._scopeButtons) {
            if (id === this._scope) button.add_style_pseudo_class('checked');
            else button.remove_style_pseudo_class('checked');
        }
        const section = title => this._list.add_child(new St.Label({text: this._(title),
            style_class: 'w11-start-section'}));
        if (this._scope === 'all' || this._scope === 'apps') {
            const apps = matchingApplications(query, installedApplications(this._order)).slice(0, query ? 40 : 12);
            if (apps.length) section('Apps');
            for (const app of apps) {
                const row = new AppRow(app.get_icon(), app.get_name(), app.get_description(), button => {
                    if (button === Clutter.BUTTON_PRIMARY)
                        activateApplication(app, row.get_child().get_first_child(), () => this.close());
                });
                row._searchKind = 'app';
                row._searchId = app.get_id();
                this._results.push(row);
                this._list.add_child(row);
            }
        }
        // 空查询只显示应用入口；显式选择文件/文件夹时才显示最近项目。
        if (query || this._scope === 'files' || this._scope === 'folders') {
            for (const [kind, scope, title] of [['file', 'files', 'Recent files'], ['folder', 'folders', 'Recent folders']]) {
                if (this._scope !== 'all' && this._scope !== scope) continue;
                const entries = this._taskbar.recentDocuments.entries.filter(entry => entry.kind === kind &&
                    matchesQuery(query, [entry.name, entry.dir])).slice(0, 25);
                if (entries.length) section(title);
                for (const entry of entries) {
                    const row = new AppRow(Gio.content_type_get_icon(entry.mime || 'application/octet-stream'),
                        entry.name, entry.dir, button => {
                            if (button !== Clutter.BUTTON_PRIMARY) return;
                            this.close();
                            try {
                                Gio.AppInfo.launch_default_for_uri(entry.uri, global.create_app_launch_context(0, -1));
                            } catch (error) { Main.notifyError(this._('Could not open this item'), error.message); }
                        });
                    row._searchKind = kind;
                    row._searchUri = entry.uri;
                    this._results.push(row);
                    this._list.add_child(row);
                }
            }
        }
        if (!this._results.length) {
            this._list.add_child(new St.Label({text: query ? this._('No local results. Try a shorter name or another category.') :
                this._('No recent items in this category.'), style_class: 'w11-start-empty'}));
        }
        if (oldIndex >= 0 && this._results.length)
            global.stage.set_key_focus(this._results[Math.min(oldIndex, this._results.length - 1)]);
    }

    open() {
        if (this._isOpen) return;
        closeOtherLaunchers(this);
        const reversing = this.visible;
        this._isOpen = true;
        this.reactive = true;
        if (Main.overview.visible) Main.overview.hide();
        this._scope = 'all';
        this._entry.set_text('');
        this._render();
        this._taskbar.recentDocuments.refresh();
        applyThemeClass(this);
        this.visible = true;
        this.reposition();
        this._taskbar.holdVisible(true);
        slideIn(this, {from: this._taskbar.towardsBar(SLIDE), ms: DURATION.emphasized, fromCurrent: reversing});
        this._modal = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP}) ?? null;
        global.stage.set_key_focus(this._entry.clutter_text);
        this._acceptsDismiss = false;
        this._dismissIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._dismissIdleId = 0;
            this._acceptsDismiss = this._isOpen;
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        if (!this._isOpen) return;
        this._isOpen = false;
        this._acceptsDismiss = false;
        this._clearTimers();
        if (this._modal) { Main.popModal(this._modal); this._modal = null; }
        this._taskbar.holdVisible(false);
        slideOut(this, {to: this._taskbar.towardsBar(SLIDE / 2), onComplete: () => {
            if (!this._isOpen) this.visible = false;
        }});
    }

    reposition() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.monitors[this._taskbar.monitorIndex] ?? Main.layoutManager.primaryMonitor;
        const area = besideBar(this._taskbar.edge, monitor, this._taskbar.thickness);
        const gap = START_MENU.gapFromPanel * scale;
        const width = Math.max(1, Math.min(640 * scale, area.width - gap * 2));
        const height = Math.max(1, Math.min(680 * scale, area.height - gap * 2));
        this.set_size(width, height);
        const left = this._taskbar.settings.get_string('alignment') === 'left';
        const x = this._taskbar.vertical ? (this._taskbar.edge === 'left' ? area.x + gap : area.x + area.width - width - gap) :
            left ? area.x + gap : area.x + (area.width - width) / 2;
        const y = this._taskbar.vertical ? (left ? area.y + gap : area.y + (area.height - height) / 2) :
            this._taskbar.edge === 'top' ? area.y + gap : area.y + area.height - height - gap;
        this.set_position(Math.round(x), Math.round(y));
    }

    _capturedEvent(event) {
        if (!this._isOpen) return Clutter.EVENT_PROPAGATE;
        if (event.type() === Clutter.EventType.KEY_PRESS) {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) { this.close(); return Clutter.EVENT_STOP; }
            if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                const index = this._results.indexOf(global.stage.get_key_focus());
                const next = key === Clutter.KEY_Down ? index + 1 : index - 1;
                global.stage.set_key_focus(next < 0 || !this._results.length ? this._entry.clutter_text :
                    this._results[Math.min(next, this._results.length - 1)]);
                return Clutter.EVENT_STOP;
            }
        }
        if (event.type() !== Clutter.EventType.BUTTON_PRESS || !this._acceptsDismiss) return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (target && (target === this._panel || this._panel.contains(target))) return Clutter.EVENT_PROPAGATE;
        this.close();
        passOnPress(event);
        return Clutter.EVENT_STOP;
    }

    _clearTimers() {
        for (const key of ['_timer', '_dismissIdleId']) {
            if (this[key]) GLib.source_remove(this[key]);
            this[key] = 0;
        }
    }

    _onDestroy() {
        this._clearTimers();
        this._unsubscribe?.();
        this._unregister?.();
        this._order.destroy();
        this._appSystem.disconnect(this._installedId);
        if (this._modal) { Main.popModal(this._modal); this._modal = null; }
        if (this._isOpen) this._taskbar.holdVisible(false);
        this._isOpen = false;
        Main.layoutManager.removeChrome(this);
    }
});
