/* 把 GNOME 的原生 QuickToggleMenu 当作整页呈现，保留原业务控件和信号。 */
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {PopupSurface} from './acrylicSurface.js';
import {DURATION, EASE, duration} from './motion.js';
import {tileKey} from './quickSettingsEditor.js';
import {applyThemeClass} from './theme.js';
import {WifiFlow} from './wifiFlow.js';

/* Windows slides a page of the flyout in from the side it lies on: a
 * sub-page from the right, the main page back from the left. The frame
 * stays put — both pages are the same size — so only the content moves. */
const PAGE_SLIDE = 40;

function slideIn(actors, from) {
    const time = duration(DURATION.emphasized);
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    for (const actor of actors) {
        actor.remove_all_transitions();
        if (time === 0) {
            actor.translation_x = 0;
            actor.opacity = 255;
            continue;
        }
        actor.translation_x = from * scale;
        actor.opacity = 0;
        actor.ease({translation_x: 0, opacity: 255, duration: time, mode: EASE});
    }
}

/* Where an interrupted slide should have ended. */
function settle(actors) {
    for (const actor of actors) {
        actor.remove_all_transitions();
        actor.translation_x = 0;
        actor.opacity = 255;
    }
}

export class QuickPages {
    constructor(menu, gettext = s => s, settings = null) {
        this.menu = menu;
        this._settings = settings;
        this._contextMenu = null;
        this._rightPress = null;
        this._gettext = gettext;
        this._records = new Map();
        this._borrowed = new Map();
        this._actions = new Map();
        this._current = null;
        this._page = new St.BoxLayout({style_class: 'w11-quick-page',
            orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true, visible: false});
        const header = new St.BoxLayout({style_class: 'w11-quick-page-header'});
        this._back = new St.Button({style_class: 'w11-quick-back', can_focus: true,
            accessible_name: gettext('Back'), child: new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 16})});
        this._back.connect('clicked', () => this.back({animate: true}));
        header.add_child(this._back);
        this._title = new St.Label({style_class: 'w11-quick-page-title', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER});
        this._title.clutter_text.ellipsize = 3;
        header.add_child(this._title);
        // Windows 的 WLAN/蓝牙页在标题右侧放开关；状态始终取自原生卡片。
        this._knob = new St.Widget({style_class: 'w11-switch-knob', x_expand: true,
            y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.START});
        this._pageToggle = new St.Button({style_class: 'w11-switch', can_focus: true,
            visible: false, y_align: Clutter.ActorAlign.CENTER, child: this._knob});
        this._pageToggle.connect('clicked', () => {
            const source = this._current?.record?.submenu.sourceActor;
            if (source)
                source.emit('clicked', Clutter.BUTTON_PRIMARY);
        });
        header.add_child(this._pageToggle);
        this._page.add_child(header);
        this._scroll = new St.ScrollView({x_expand: true, y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._page.add_child(this._scroll);
        this._footer = new St.BoxLayout({style_class: 'w11-quick-footer', x_expand: true});
        menu.box.add_child(this._footer);
        menu.box.add_child(this._page);
        this._originalDim = menu._setDimmed;
        this._dimWrapper = () => {
            menu._boxPointer.remove_transition('@effects.dim.brightness');
            menu._dimEffect.enabled = false;
        };
        menu._setDimmed = this._dimWrapper;
        this._closeId = menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this.back();
        });
        this._keyId = menu.actor.connect('captured-event', (_actor, event) => {
            if (this._settings?.get_boolean('debug-service') &&
                [Clutter.EventType.BUTTON_PRESS, Clutter.EventType.BUTTON_RELEASE].includes(event.type())) {
                const target = global.stage.get_event_actor(event);
                this._debugEvents ??= [];
                this._debugEvents.push({type: event.type(), button: event.get_button(), target: target?.constructor?.name,
                    cls: target?.style_class ?? null, inside: target ? menu.actor.contains(target) : false});
                this._debugEvents = this._debugEvents.slice(-12);
            }
            if (this._onRightClick(event))
                return Clutter.EVENT_STOP;
            if (this._current && event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                this.back({animate: true});
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.refresh();
    }

    _onRightClick(event) {
        if (this._current || !this._settings ||
            ![Clutter.EventType.BUTTON_PRESS, Clutter.EventType.BUTTON_RELEASE].includes(event.type()) ||
            event.get_button() !== Clutter.BUTTON_SECONDARY)
            return false;
        let target = global.stage.get_event_actor(event);
        while (target && target.get_parent() !== this.menu._grid)
            target = target.get_parent();
        if (!target || typeof target.title !== 'string')
            return false;
        if (event.type() === Clutter.EventType.BUTTON_PRESS) {
            this._rightPress = {tile: target, at: event.get_coords()};
            if (!this._settings.get_boolean('context-menu-on-release')) {
                this._openContext(target);
                this._rightPress = null;
            }
        } else if (this._rightPress) {
            const [x, y] = event.get_coords();
            const {tile, at} = this._rightPress;
            this._rightPress = null;
            if (tile === target && Math.hypot(x - at[0], y - at[1]) <= 8)
                this._openContext(tile);
        }
        return true;
    }

    _openContext(tile) {
        this._contextMenu?.destroy();
        const popup = new PopupMenu.PopupMenu(tile, 0.5, St.Side.BOTTOM);
        popup.actor.add_style_class_name('w11-tray-menu');
        applyThemeClass(popup.actor);
        Main.uiGroup.add_child(popup.actor);
        popup.actor.hide();
        const manager = new PopupMenu.PopupMenuManager(this.menu.actor);
        manager.addMenu(popup);
        new PopupSurface(popup, this._settings, 24);
        const add = (title, action) => {
            const item = new PopupMenu.PopupMenuItem(this._gettext(title));
            item.connect('activate', action);
            popup.addMenuItem(item);
        };
        if (tile.menu)
            add('Open options', () => tile.menu.open());
        const name = `${tile.constructor?.name ?? ''} ${tile.title}`;
        const panel = /bluetooth/i.test(name) ? 'bluetooth' : /wi.?fi|wireless/i.test(name) ? 'wifi' :
            /network|wired|airplane/i.test(name) ? 'network' : /night|display/i.test(name) ? 'display' :
            /power/i.test(name) ? 'power' : /dark|style/i.test(name) ? 'appearance' :
            /notification|disturb/i.test(name) ? 'notifications' : null;
        if (panel)
            add('Go to Settings', () => Gio.Subprocess.new(['gnome-control-center', panel], Gio.SubprocessFlags.NONE));
        if (!tile._w11FooterAction)
            add('Remove from quick settings', () => {
                const hidden = this._settings.get_strv('quick-settings-hidden');
                const key = tileKey(tile);
                if (!hidden.includes(key))
                    this._settings.set_strv('quick-settings-hidden', [...hidden, key]);
            });
        this._contextMenu = popup;
        popup.open(true);
    }

    get activeTitle() {
        return this._current ? this._title.text : null;
    }

    _borrow(actor) {
        if (this._borrowed.has(actor))
            return;
        const parent = actor.get_parent();
        this._borrowed.set(actor, {parent, index: parent.get_children().indexOf(actor),
            destroyId: actor.connect('destroy', () => this._borrowed.delete(actor))});
        parent.remove_child(actor);
        this._footer.add_child(actor);
    }

    refresh() {
        const grid = this.menu._grid;
        for (const actor of grid.get_children()) {
            const type = actor.constructor?.$gtype?.name ?? actor.constructor?.name ?? '';
            if (/SystemItem/.test(type) || actor.has_style_class_name?.('w11-qs-editor'))
                this._borrow(actor);
            if (/RebootQuickMenu/.test(type) || /reboot\s*into/i.test(actor.title ?? ''))
                this._compactAction(actor);
        }
        const walk = actor => {
            if (actor.menu?.actor && actor.menu !== this.menu)
                this._wrap(actor.menu, actor.title ?? actor.accessible_name ?? '');
            for (const child of actor.get_children())
                walk(child);
        };
        walk(grid);
        walk(this._footer);
    }

    _compactAction(tile) {
        if (this._actions.has(tile))
            return;
        const button = new St.Button({style_class: 'w11-quick-footer-action', can_focus: true,
            accessible_name: tile.title, child: new St.Icon({icon_name: tile.icon_name || 'system-reboot-symbolic', icon_size: 16})});
        const record = {button, visible: tile.visible};
        tile._w11FooterAction = true;
        tile._w11FooterWasVisible = tile.visible;
        tile.hide();
        button.connect('clicked', () => tile.menu?.open());
        record.destroyId = tile.connect('destroy', () => {
            button.destroy();
            this._actions.delete(tile);
        });
        this._actions.set(tile, record);
        this._footer.add_child(button);
    }

    _wrap(submenu, title) {
        if (this._records.has(submenu))
            return;
        if (submenu.isOpen)
            submenu.close(false);
        const manager = submenu.sourceActor?._menuManager;
        // 原管理器会给旧的、已隐藏的 submenu.actor 建立 grab；内容移到子页后，
        // 点击会被判成“点外”并立即 back。整页由顶层菜单管理输入，只移除这项管理。
        const managed = manager?._menus.includes(submenu) ?? false;
        if (managed)
            manager.removeMenu(submenu);
        const record = {submenu, title, manager, managed, open: submenu.open, close: submenu.close,
            activated: submenu.itemActivated, activatedOwn: Object.hasOwn(submenu, 'itemActivated'),
            openOwn: Object.hasOwn(submenu, 'open'), closeOwn: Object.hasOwn(submenu, 'close')};
        record.openWrapper = () => this.showMenu(record);
        record.closeWrapper = () => {
            if (this._current?.record === record)
                this.back({animate: true});
        };
        record.activatedWrapper = () => {
            // 页面内点击保留当前页；原生网络/电源动作若明确 close()，仍按其业务执行。
        };
        submenu.open = record.openWrapper;
        submenu.close = record.closeWrapper;
        submenu.itemActivated = record.activatedWrapper;
        record.destroyId = submenu.actor.connect('destroy', () => {
            if (this._current?.record === record)
                this.back();
            this._records.delete(submenu);
        });
        this._records.set(submenu, record);
    }

    showMenu(record) {
        if (this._current?.record === record)
            return;
        this.back();
        const {submenu} = record;
        const parent = submenu.box.get_parent();
        const index = parent.get_children().indexOf(submenu.box);
        parent.remove_child(submenu.box);
        submenu.box.remove_all_transitions();
        submenu.box.opacity = 255;
        this._scroll.set_child(submenu.box);
        this._current = {record, parent, index, content: submenu.box};
        this._show(record.title || submenu._headerTitle?.text || this._gettext('Options'));
        const source = submenu.sourceActor;
        const type = source?.constructor?.$gtype?.name ?? source?.constructor?.name ?? '';
        if (source && typeof source.checked === 'boolean' && /Wireless|Bluetooth|Wired|Vpn|Modem/i.test(type)) {
            const sync = () => {
                this._pageToggle.checked = source.checked;
                this._knob.x_align = source.checked ? Clutter.ActorAlign.END : Clutter.ActorAlign.START;
                this._pageToggle.reactive = source.reactive;
                this._pageToggle.accessible_name = record.title;
            };
            this._current.toggleSignals = [source.connect('notify::checked', sync),
                source.connect('notify::reactive', sync)];
            this._pageToggle.show();
            sync();
        } else {
            this._pageToggle.hide();
        }
        // Windows 式加入网络：点网络先展开，加密网络在列表里输入密钥。
        if (/Wireless/.test(type) && source._items)
            this._current.wifi = new WifiFlow(source, this._gettext);
        // 页头已经有返回键和标题；隐藏原生大图标标题，原生 setHeader() 再次显示时也压住。
        const header = submenu._header;
        if (header) {
            this._current.headerWanted = header.visible;
            header.hide();
            this._current.headerSignal = header.connect('notify::visible', () => {
                if (!header.visible)
                    return;
                this._current.headerWanted = true;
                header.hide();
            });
        }
        submenu.isOpen = true;
        submenu.emit('open-state-changed', true);
        global.stage.set_key_focus(this._back);
    }

    showContent(title, content, onBack = null) {
        this.back();
        this._scroll.set_child(content);
        this._current = {content, onBack};
        this._show(title);
        global.stage.set_key_focus(this._back);
    }

    _show(title) {
        this._title.text = title;
        this.menu._grid.hide();
        this.menu._overlay.hide();
        this._footer.hide();
        settle([this.menu._grid, this._footer]);
        this._page.show();
        if (this.menu.isOpen)
            slideIn([this._page], PAGE_SLIDE);
        else
            settle([this._page]);
        this.menu.actor.queue_relayout();
    }

    /**
     * Leave the page for the main one.
     *
     * @param {object} [options] how
     * @param {boolean} [options.animate] slide the main page back in, as
     *   the back button and Esc do; not when the flyout is closing, or
     *   another page is about to replace this one
     */
    back({animate = false} = {}) {
        const current = this._current;
        if (!current)
            return;
        this._current = null;
        current.wifi?.destroy();
        this._scroll.set_child(null);
        for (const id of current.toggleSignals ?? [])
            current.record.submenu.sourceActor.disconnect(id);
        if (current.record) {
            const {submenu} = current.record;
            if (submenu._header) {
                if (current.headerSignal)
                    submenu._header.disconnect(current.headerSignal);
                submenu._header.visible = current.headerWanted ?? false;
            }
            current.parent.insert_child_at_index(submenu.box, current.index);
            submenu.isOpen = false;
            submenu.emit('open-state-changed', false);
            submenu.emit('menu-closed');
        } else {
            current.content.destroy();
            current.onBack?.();
        }
        this._page.hide();
        settle([this._page]);
        this.menu._grid.show();
        this.menu._overlay.show();
        this._footer.show();
        if (animate && this.menu.isOpen)
            slideIn([this.menu._grid, this._footer], -PAGE_SLIDE);
        else
            settle([this.menu._grid, this._footer]);
        this.menu.actor.queue_relayout();
    }

    destroy() {
        this._contextMenu?.destroy();
        this._contextMenu = null;
        this.back();
        this.menu.disconnect(this._closeId);
        this.menu.actor.disconnect(this._keyId);
        if (this.menu._setDimmed === this._dimWrapper)
            this.menu._setDimmed = this._originalDim;
        for (const record of this._records.values()) {
            const {submenu} = record;
            submenu.actor.disconnect(record.destroyId);
            for (const [method, wrapper, original, owned] of [
                ['open', record.openWrapper, record.open, record.openOwn],
                ['close', record.closeWrapper, record.close, record.closeOwn],
                ['itemActivated', record.activatedWrapper, record.activated, record.activatedOwn],
            ]) {
                if (submenu[method] !== wrapper)
                    continue;
                if (owned)
                    submenu[method] = original;
                else
                    delete submenu[method];
            }
            if (record.managed)
                record.manager.addMenu(submenu);
        }
        this._records.clear();
        for (const [tile, record] of this._actions) {
            tile.disconnect(record.destroyId);
            tile.visible = record.visible;
            delete tile._w11FooterAction;
            delete tile._w11FooterWasVisible;
            record.button.destroy();
        }
        this._actions.clear();
        for (const [actor, record] of this._borrowed) {
            actor.disconnect(record.destroyId);
            actor.get_parent()?.remove_child(actor);
            record.parent.insert_child_at_index(actor, Math.min(record.index, record.parent.get_n_children()));
        }
        this._borrowed.clear();
        this._page.destroy();
        this._footer.destroy();
    }
}
