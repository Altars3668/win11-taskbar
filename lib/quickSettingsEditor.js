/* quickSettingsEditor.js — editing quick settings in place, as Windows 11
 * does.
 *
 * The pencil at the foot of the panel turns the tiles themselves into the
 * editor; there is no separate page. Measured off Windows 11's own panel:
 * every tile shrinks to nine tenths and is drawn as a disabled control,
 * and a 20px round Unpin button sits in the corner the tile had before it
 * shrank. A tile can be dragged to another place: it follows the pointer,
 * the other tiles fade to about half and slide out of its way. The foot of
 * the panel offers Done and Add, centred, in place of its usual row; Add
 * lists what has been unpinned. Each change holds from the moment it is
 * made, so Done, Esc and closing the panel all just leave edit mode.
 *
 * What is pinned, and in what order, are two settings keyed by tileKey():
 * quick-settings-hidden and quick-settings-order. The panel puts its tiles
 * in that order whenever it reorders itself (systemFlyouts.js).
 */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PopupSurface} from './acrylicSurface.js';
import {DURATION, EASE, duration} from './motion.js';
import {applyThemeClass} from './theme.js';

/* Measured: tiles at nine tenths while editing, and the other tiles at
 * about half their opacity while one is dragged. */
const EDIT_SCALE = 0.9;
const DRAG_DIM = 120;

/* Windows' Unpin glyph; no icon theme has one. */
const UNPIN_ICON = new Gio.FileIcon({
    file: Gio.File.new_for_uri(import.meta.url).get_parent().get_parent()
        .get_child('assets').get_child('w11-unpin-symbolic.svg'),
});

export function tileKey(tile) {
    const type = tile.constructor?.$gtype?.name ?? tile.constructor?.name ?? 'Item';
    const title = tile.title ?? tile.accessible_name ?? '';
    return title ? `${type}:${title}` : type;
}

/**
 * The tiles in the order the user gave them. Tiles the order does not know
 * yet go after the rest, in the order they came.
 *
 * @param {Clutter.Actor[]} tiles the tiles, in GNOME's order
 * @param {string[]} order tile keys, as quick-settings-order keeps them
 * @returns {Clutter.Actor[]} the tiles in order
 */
export function orderTiles(tiles, order) {
    if (!order.length)
        return tiles;
    const rank = new Map(order.map((key, index) => [key, index]));
    return tiles
        .map((tile, index) => [tile, rank.get(tileKey(tile)) ?? order.length + index])
        .sort((a, b) => a[1] - b[1])
        .map(([tile]) => tile);
}

function isUnpinButton(actor) {
    return actor?.has_style_class_name?.('w11-qs-unpin') ?? false;
}

export const QuickSettingsEditor = GObject.registerClass({GTypeName: 'W11QuickSettingsEditorV3'},
class QuickSettingsEditor extends St.BoxLayout {
    _init(settings, pages = null) {
        super._init({style_class: 'w11-qs-editor', x_align: Clutter.ActorAlign.END});
        this._settings = settings;
        this._pages = pages;
        this._editing = false;
        this._menu = null;
        this._records = new Map();
        // While editing: each tile's Unpin button, what was taken out of the
        // panel's foot, and what keys could reach before.
        this._badges = new Map();
        this._footer = new Map();
        this._unfocusable = new Map();
        // Tiles that the next frame's layout may move, to be eased there.
        this._flips = new Map();
        this._flipsDoneId = 0;
        this._press = null;
        this._drag = null;
        this._addMenu = null;
        this._addManager = null;

        this._editButton = new St.Button({style_class: 'w11-qs-edit-button icon-button', can_focus: true,
            accessible_name: _('Edit quick settings'),
            child: new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 16})});
        this._editButton.connect('clicked', () => this.toggleEditing());
        this._doneButton = this._action('object-select-symbolic', _('Done'), () => this.leave());
        this._addButton = this._action('list-add-symbolic', _('Add'), () => this._openAdd());
        for (const button of [this._editButton, this._doneButton, this._addButton])
            this.add_child(button);
        this._doneButton.hide();
        this._addButton.hide();

        this._changedId = settings.connect('changed::quick-settings-hidden', () => this.apply());
        this.connect('destroy', () => this._onDestroy());
    }

    get grid() {
        return Main.panel.statusArea.quickSettings?.menu?._grid ?? null;
    }

    get editing() {
        return this._editing;
    }

    get dragging() {
        return this._drag !== null;
    }

    setPages(pages) {
        this._pages = pages;
    }

    /* Done and Add: a glyph and a word, flat, as Windows draws them. */
    _action(iconName, text, callback) {
        const box = new St.BoxLayout({style_class: 'w11-qs-edit-action-box'});
        box.add_child(new St.Icon({icon_name: iconName, style_class: 'w11-qs-edit-action-icon',
            y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        const button = new St.Button({style_class: 'w11-qs-edit-action', can_focus: true,
            track_hover: true, accessible_name: text, child: box});
        button.connect('clicked', callback);
        return button;
    }

    _tiles() {
        return this.grid?.get_children().filter(tile => !tile._w11FooterAction &&
            typeof tile.title === 'string' && /Toggle/.test(tile.constructor?.$gtype?.name ?? tile.constructor?.name ?? '')) ?? [];
    }

    apply() {
        const hidden = new Set(this._settings.get_strv('quick-settings-hidden'));
        for (const tile of this._tiles()) {
            let record = this._records.get(tile);
            if (!record) {
                record = {nativeVisible: tile.visible, updating: false};
                record.visibilityId = tile.connect('notify::visible', () => {
                    if (record.updating)
                        return;
                    record.nativeVisible = tile.visible;
                    this.apply();
                });
                record.destroyId = tile.connect('destroy', () => this._records.delete(tile));
                this._records.set(tile, record);
            }
            record.updating = true;
            tile.visible = record.nativeVisible && !hidden.has(tileKey(tile));
            record.updating = false;
        }
        if (this._editing) {
            this._syncBadges(false);
            this._lockFocus();
            this._syncAdd();
        }
    }

    toggleEditing() {
        if (this._editing)
            this.leave();
        else
            this.enter();
    }

    enter() {
        const menu = Main.panel.statusArea.quickSettings?.menu;
        if (this._editing || !menu)
            return;
        this._pages?.back();
        this.apply();
        // Keys follow only where keys were: the pencil is about to go.
        const byKeyboard = this._editButton.has_key_focus();
        this._editing = true;
        this._menu = menu;
        menu.actor.add_style_class_name('w11-qs-editing');
        this._syncBadges(true);
        this._lockFocus();
        this._showFooter(true);
        this._syncAdd();
        this._eventId = menu.actor.connect('captured-event', (_actor, event) => this._onEvent(event));
        this._closeId = menu.connect('open-state-changed', (_menu, open) => {
            if (!open)
                this.leave();
        });
        if (byKeyboard)
            global.stage.set_key_focus(this._doneButton);
    }

    leave() {
        if (!this._editing)
            return;
        this._endDrag(false);
        this._addMenu?.destroy();
        this._addMenu = null;
        this._editing = false;
        const menu = this._menu;
        this._menu = null;
        if (this._eventId)
            menu.actor.disconnect(this._eventId);
        if (this._closeId)
            menu.disconnect(this._closeId);
        this._eventId = this._closeId = 0;
        const byKeyboard = [this._doneButton, this._addButton].some(button => button.has_key_focus());
        menu.actor.remove_style_class_name('w11-qs-editing');
        this._syncBadges(menu.isOpen);
        this._unlockFocus();
        this._showFooter(false);
        if (menu.isOpen && byKeyboard)
            global.stage.set_key_focus(this._editButton);
    }

    /* The foot of the panel holds only Done and Add while editing, centred;
     * its own row comes back afterwards. */
    _showFooter(editing) {
        const footer = this._pages?.footer;
        if (editing && footer && this.get_parent() === footer) {
            for (const sibling of footer.get_children()) {
                if (sibling === this || !sibling.visible)
                    continue;
                sibling.hide();
                this._footer.set(sibling, sibling.connect('destroy', () => this._footer.delete(sibling)));
            }
        } else if (!editing) {
            for (const [sibling, id] of this._footer) {
                sibling.disconnect(id);
                sibling.show();
            }
            this._footer.clear();
        }
        this._editButton.visible = !editing;
        this._doneButton.visible = editing;
        this._addButton.visible = editing;
        this.x_expand = editing;
        this.x_align = editing ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
    }

    /* An Unpin button on every tile on the panel while editing, and the
     * tile at nine tenths; neither once editing ends. */
    _syncBadges(animate) {
        const tiles = this._tiles();
        for (const tile of [...this._badges.keys()]) {
            // Gone from the grid, its button with it.
            if (!tiles.includes(tile))
                this._badges.delete(tile);
        }
        for (const tile of tiles) {
            const content = tile._w11Content;
            if (!content)
                continue;
            const wanted = this._editing && tile.visible;
            const badge = this._badges.get(tile);
            if (wanted && !badge) {
                const button = new St.Button({style_class: 'w11-qs-unpin', can_focus: true, track_hover: true,
                    accessible_name: `${_('Unpin')}: ${tile.title}`,
                    child: new St.Icon({gicon: UNPIN_ICON, style_class: 'w11-qs-unpin-icon'})});
                button.connect('clicked', () => this._unpin(tile));
                this._badges.set(tile, button);
                content.badge = button;
                content.shrink(EDIT_SCALE, animate);
            } else if (!wanted && badge) {
                this._badges.delete(tile);
                content.badge = null;
                badge.destroy();
                content.shrink(1, animate);
            }
        }
    }

    /* Keys reach the Unpin buttons and the foot of the panel only: a tile
     * or a slider that kept its focus would still answer Space or the
     * arrow keys. */
    _lockFocus() {
        const walk = actor => {
            if (actor === this || isUnpinButton(actor))
                return;
            if (actor instanceof St.Widget && actor.can_focus && !this._unfocusable.has(actor)) {
                actor.can_focus = false;
                this._unfocusable.set(actor, actor.connect('destroy', () => this._unfocusable.delete(actor)));
            }
            for (const child of actor.get_children())
                walk(child);
        };
        for (const child of this.grid?.get_children() ?? [])
            walk(child);
    }

    _unlockFocus() {
        for (const [actor, id] of this._unfocusable) {
            actor.disconnect(id);
            actor.can_focus = true;
        }
        this._unfocusable.clear();
    }

    /* What Add offers: tiles that could be on the panel and were unpinned. */
    _addable() {
        const hidden = new Set(this._settings.get_strv('quick-settings-hidden'));
        return this._tiles().filter(tile =>
            this._records.get(tile)?.nativeVisible && hidden.has(tileKey(tile)));
    }

    _syncAdd() {
        const any = this._addable().length > 0;
        this._addButton.reactive = any;
        this._addButton.can_focus = any;
        if (any)
            this._addButton.remove_style_pseudo_class('insensitive');
        else
            this._addButton.add_style_pseudo_class('insensitive');
    }

    _openAdd() {
        const tiles = this._addable();
        if (!tiles.length)
            return;
        this._addMenu?.destroy();
        const popup = new PopupMenu.PopupMenu(this._addButton, 0.5, St.Side.BOTTOM);
        popup.actor.add_style_class_name('w11-tray-menu');
        applyThemeClass(popup.actor);
        Main.uiGroup.add_child(popup.actor);
        popup.actor.hide();
        this._addManager ??= new PopupMenu.PopupMenuManager(this);
        this._addManager.addMenu(popup);
        new PopupSurface(popup, this._settings, 24);
        for (const tile of tiles) {
            const item = new PopupMenu.PopupImageMenuItem(tile.title, tile.gicon ?? tile.icon_name ?? null);
            item.connect('activate', () => this._pin(tile));
            popup.addMenuItem(item);
        }
        popup.connect('destroy', () => {
            if (this._addMenu === popup)
                this._addMenu = null;
        });
        this._addMenu = popup;
        popup.open(true);
    }

    _unpin(tile) {
        const key = tileKey(tile);
        const hidden = this._settings.get_strv('quick-settings-hidden');
        if (hidden.includes(key))
            return;
        const focused = this._badges.get(tile)?.has_key_focus() ?? false;
        this._flip(() => {
            this._settings.set_strv('quick-settings-hidden', [...hidden, key]);
            this.apply();
        });
        if (focused)
            global.stage.set_key_focus(this._doneButton);
    }

    _pin(tile) {
        const key = tileKey(tile);
        const grid = this.grid;
        this._flip(() => {
            // Windows puts what is added at the end.
            const last = this._tiles().filter(other => other !== tile && other.visible).at(-1);
            if (grid && last)
                grid.set_child_above_sibling(tile, last);
            this._saveOrder();
            this._settings.set_strv('quick-settings-hidden',
                this._settings.get_strv('quick-settings-hidden').filter(value => value !== key));
            this.apply();
        });
    }

    /* Keep the order the tiles are in now, with the places of those not
     * in the grid at the moment — each after the tile it followed. */
    _saveOrder() {
        const order = this._tiles().map(tileKey);
        const saved = this._settings.get_strv('quick-settings-order');
        saved.forEach((key, index) => {
            if (order.includes(key))
                return;
            const before = saved.slice(0, index).reverse().find(other => order.includes(other));
            order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, key);
        });
        this._settings.set_strv('quick-settings-order', order);
    }

    /* Move whatever the change moves from where it is drawn now to where
     * the layout then puts it, eased; whatever it brings onto the panel
     * fades in where it lands. */
    _flip(change) {
        const grid = this.grid;
        if (!grid) {
            change();
            return;
        }
        this._settleFlips();
        const dragged = this._drag?.tile;
        const before = new Map();
        for (const child of grid.get_children()) {
            if (!child.visible || child === dragged)
                continue;
            const box = child.get_allocation_box();
            before.set(child, [box.x1 + child.translation_x, box.y1 + child.translation_y]);
        }
        change();
        const time = duration(DURATION.emphasized);
        for (const child of grid.get_children()) {
            if (!child.visible || child === dragged)
                continue;
            const from = before.get(child);
            if (!from) {
                child.opacity = 0;
                child.ease({opacity: 255, duration: time, mode: EASE});
                continue;
            }
            const allocationId = child.connect('notify::allocation', () => {
                this._dropFlip(child);
                const box = child.get_allocation_box();
                const dx = from[0] - box.x1;
                const dy = from[1] - box.y1;
                if (Math.abs(dx) < 1 && Math.abs(dy) < 1)
                    return;
                child.remove_transition('translation-x');
                child.remove_transition('translation-y');
                child.translation_x = dx;
                child.translation_y = dy;
                child.ease({translation_x: 0, translation_y: 0, duration: time, mode: EASE});
            });
            // A tile gone meanwhile has nothing left to disconnect.
            const destroyId = child.connect('destroy', () => this._flips.delete(child));
            this._flips.set(child, [allocationId, destroyId]);
        }
        // What the next frame's layout did not move stays where it is.
        this._flipsDoneId = global.stage.connect('after-paint', () => this._settleFlips());
    }

    _dropFlip(child) {
        for (const id of this._flips.get(child) ?? [])
            child.disconnect(id);
        this._flips.delete(child);
    }

    _settleFlips() {
        for (const child of [...this._flips.keys()])
            this._dropFlip(child);
        if (this._flipsDoneId)
            global.stage.disconnect(this._flipsDoneId);
        this._flipsDoneId = 0;
    }

    _gridChild(actor) {
        const grid = this.grid;
        if (!grid)
            return null;
        while (actor && actor.get_parent() !== grid)
            actor = actor.get_parent();
        return actor ?? null;
    }

    _inUnpinButton(actor) {
        for (; actor; actor = actor.get_parent()) {
            if (isUnpinButton(actor))
                return true;
        }
        return false;
    }

    /* While editing, tiles and sliders are not controls. A press on a tile
     * may become a drag; nothing else reaches them. The Unpin buttons and
     * everything outside the grid work as ever. */
    _onEvent(event) {
        const type = event.type();
        if (this._press) {
            switch (type) {
            case Clutter.EventType.MOTION:
                this._onMotion(event);
                return Clutter.EVENT_STOP;
            case Clutter.EventType.BUTTON_RELEASE:
                if (event.get_button() === Clutter.BUTTON_PRIMARY)
                    this._onRelease();
                return Clutter.EVENT_STOP;
            case Clutter.EventType.BUTTON_PRESS:
                return Clutter.EVENT_STOP;
            }
        }
        const target = global.stage.get_event_actor(event);
        switch (type) {
        case Clutter.EventType.BUTTON_PRESS: {
            const child = this._gridChild(target);
            if (!child || this._inUnpinButton(target))
                return Clutter.EVENT_PROPAGATE;
            if (event.get_button() === Clutter.BUTTON_PRIMARY && this._badges.has(child)) {
                const [x, y] = event.get_coords();
                this._press = {tile: child, x, y};
            }
            return Clutter.EVENT_STOP;
        }
        case Clutter.EventType.SCROLL:
        case Clutter.EventType.TOUCH_BEGIN:
            return this._gridChild(target) && !this._inUnpinButton(target)
                ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onMotion(event) {
        const [x, y] = event.get_coords();
        if (!this._drag) {
            const threshold = St.Settings.get().drag_threshold;
            if (Math.abs(x - this._press.x) <= threshold && Math.abs(y - this._press.y) <= threshold)
                return;
            this._beginDrag();
        }
        this._moveDrag(x, y);
    }

    _onRelease() {
        if (this._drag)
            this._endDrag(true);
        this._press = null;
    }

    _beginDrag() {
        const {tile} = this._press;
        const visible = this._tiles().filter(other => other.visible);
        // The places in the grid stay where they are while the tiles move
        // between them.
        const slots = visible.map(other => {
            const [x, y] = other.get_transformed_position();
            return [x - other.translation_x, y - other.translation_y];
        });
        const [x, y] = tile.get_transformed_position();
        // What follows the pointer is a picture of the tile; the tile
        // itself stays in the grid, unseen, holding the place it would
        // drop into.
        const clone = new Clutter.Clone({source: tile, reactive: false,
            x, y, width: tile.width, height: tile.height});
        Main.uiGroup.add_child(clone);
        tile.add_style_class_name('w11-qs-dragging');
        tile.opacity = 0;
        for (const other of visible) {
            if (other !== tile)
                other.ease({opacity: DRAG_DIM, duration: duration(DURATION.normal), mode: EASE});
        }
        this._drag = {tile, clone, slots, index: visible.indexOf(tile),
            offset: [this._press.x - x, this._press.y - y],
            destroyId: tile.connect('destroy', () => this._endDrag(false, true))};
    }

    _moveDrag(x, y) {
        const drag = this._drag;
        const left = x - drag.offset[0];
        const top = y - drag.offset[1];
        drag.clone.set_position(Math.round(left), Math.round(top));
        // It drops into the place nearest to where it is.
        let nearest = drag.index;
        let distance = Infinity;
        drag.slots.forEach(([slotX, slotY], index) => {
            const d = Math.hypot(slotX - left, slotY - top);
            if (d < distance) {
                nearest = index;
                distance = d;
            }
        });
        if (nearest !== drag.index)
            this._moveTo(nearest);
    }

    _moveTo(index) {
        const drag = this._drag;
        const grid = this.grid;
        const others = this._tiles().filter(other => other.visible && other !== drag.tile);
        if (!grid || !others.length)
            return;
        this._flip(() => {
            if (index === 0)
                grid.set_child_below_sibling(drag.tile, others[0]);
            else
                grid.set_child_above_sibling(drag.tile, others[Math.min(index, others.length) - 1]);
        });
        drag.index = index;
    }

    _endDrag(animate, destroyed = false) {
        const drag = this._drag;
        this._press = null;
        if (!drag)
            return;
        this._drag = null;
        if (!destroyed)
            drag.tile.disconnect(drag.destroyId);
        for (const other of this._tiles()) {
            if (other !== drag.tile)
                other.ease({opacity: 255, duration: duration(DURATION.normal), mode: EASE});
        }
        const settle = () => {
            drag.clone.destroy();
            if (destroyed || this._drag?.tile === drag.tile)
                return;
            drag.tile.opacity = 255;
            drag.tile.remove_style_class_name('w11-qs-dragging');
        };
        if (destroyed) {
            settle();
            return;
        }
        this._saveOrder();
        const [x, y] = drag.slots[drag.index];
        if (animate)
            drag.clone.ease({x, y, duration: duration(DURATION.normal), mode: EASE, onStopped: settle});
        else
            settle();
    }

    reset() {
        this.leave();
        for (const [tile, record] of this._records) {
            tile.disconnect(record.visibilityId);
            tile.disconnect(record.destroyId);
            tile.visible = record.nativeVisible;
        }
        this._records.clear();
    }

    refreshTheme() {
        if (this._addMenu)
            applyThemeClass(this._addMenu.actor);
    }

    _onDestroy() {
        this.reset();
        this._settleFlips();
        this._addMenu?.destroy();
        this._addMenu = null;
        if (this._changedId)
            this._settings.disconnect(this._changedId);
        this._changedId = 0;
    }
});

let _gettext = value => value;
export function setGettext(fn) {
    _gettext = fn;
}
function _(value) {
    return _gettext(value);
}
