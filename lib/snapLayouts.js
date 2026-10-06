/* snapLayouts.js — Windows 11's snap layouts.
 *
 * Three ways in, as on Windows. Win+Z opens the layouts over the focused
 * window, at its top right; a number picks a layout, the next a zone. While
 * a window is dragged against the top of the screen they open there as a
 * bar, and letting go over a zone puts the window in it. Once a window is
 * in a zone, snap assist offers the other windows for the zone still
 * empty, one zone after the other, until they are filled or it is waved
 * away. The geometry, measured on Windows, is in snapGeometry.js.
 *
 * The flyout and snap assist hold the keyboard while they are open, and a
 * click anywhere else closes them and still lands where it was aimed, like
 * the other flyouts here. The bar never takes input: mutter holds the
 * pointer for the drag, so the bar follows it by polling.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, duration, EASE} from './motion.js';
import {passOnPress} from './shellMenus.js';
import {assistGrid, layoutsFor, rectAt, SNAP, tileZones, zoneRect} from './snapGeometry.js';
import {applyThemeClass} from './theme.js';

let current = null;

/**
 * The snap layouts, while they are on.
 *
 * @returns {SnapLayouts|null} them
 */
export function snapLayouts() {
    return current;
}

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/* What a snap layout can place: an ordinary window that can be moved and
 * resized. */
function snappable(win) {
    return Boolean(win) && win.get_window_type() === Meta.WindowType.NORMAL &&
        !win.skip_taskbar && win.allows_move() && win.allows_resize();
}

function workArea(monitor) {
    const rect = Main.layoutManager.getWorkAreaForMonitor(monitor);
    return {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
}

/**
 * Put a window into a rectangle, out of whatever maximised or tiled state
 * it was in.
 *
 * @param {Meta.Window} win the window
 * @param {object} rect where it goes, in stage pixels
 */
export function snapWindow(win, rect) {
    if (win.is_fullscreen())
        win.unmake_fullscreen();
    if (win.get_maximize_flags())
        win.unmaximize();
    if (win.minimized)
        win.unminimize();
    win.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
}

const KEY_DIGITS = new Map([
    [Clutter.KEY_1, 1], [Clutter.KEY_2, 2], [Clutter.KEY_3, 3], [Clutter.KEY_4, 4],
    [Clutter.KEY_5, 5], [Clutter.KEY_6, 6], [Clutter.KEY_7, 7], [Clutter.KEY_8, 8],
    [Clutter.KEY_9, 9], [Clutter.KEY_KP_1, 1], [Clutter.KEY_KP_2, 2], [Clutter.KEY_KP_3, 3],
    [Clutter.KEY_KP_4, 4], [Clutter.KEY_KP_5, 5], [Clutter.KEY_KP_6, 6],
    [Clutter.KEY_KP_7, 7], [Clutter.KEY_KP_8, 8], [Clutter.KEY_KP_9, 9],
]);

/** The layouts' tiles: in rows of three in the flyout, one row in the bar. */
const SnapPanel = GObject.registerClass({
    GTypeName: 'W11SnapPanel',
    Signals: {'zone-chosen': {param_types: [GObject.TYPE_INT, GObject.TYPE_INT]}},
}, class SnapPanel extends St.Widget {
    _init(layouts, columns, {reactive = true, styleClass = 'w11-snap-panel'} = {}) {
        super._init({style_class: styleClass, reactive, layout_manager: new Clutter.FixedLayout()});
        this.layouts = layouts;
        this._tiles = [];
        this._active = [-1, -1];
        this._chosen = -1;
        const s = scaleFactor();
        const [tw, th] = [SNAP.tileWidth * s, SNAP.tileHeight * s];
        const [gap, pad] = [SNAP.tileGap * s, SNAP.padding * s];
        layouts.forEach((layout, i) => {
            const tile = new St.Widget({style_class: 'w11-snap-tile',
                layout_manager: new Clutter.FixedLayout()});
            tile.set_position(pad + (i % columns) * (tw + gap), pad + Math.floor(i / columns) * (th + gap));
            tile.set_size(tw, th);
            const rects = tileZones(layout.zones, tw, th, SNAP.zoneGap * s);
            const zones = rects.map((r, z) => {
                const zone = new St.Widget({style_class: 'w11-snap-zone', reactive,
                    track_hover: reactive, layout_manager: new Clutter.BinLayout()});
                zone.set_position(r.x, r.y);
                zone.set_size(r.width, r.height);
                zone._badge = new St.Label({style_class: 'w11-snap-badge', text: String(z + 1),
                    visible: false, x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER});
                zone.add_child(zone._badge);
                if (reactive) {
                    zone.connect('notify::hover', () => {
                        if (zone.hover)
                            this.highlight(i, z);
                        else if (this._active[0] === i && this._active[1] === z)
                            this.highlight(-1, -1);
                    });
                    zone.connect('button-release-event', (_actor, event) => {
                        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                            return Clutter.EVENT_PROPAGATE;
                        this.emit('zone-chosen', i, z);
                        return Clutter.EVENT_STOP;
                    });
                }
                tile.add_child(zone);
                return zone;
            });
            tile._badge = new St.Label({style_class: 'w11-snap-badge', text: String(i + 1),
                visible: false});
            tile.add_child(tile._badge);
            this.add_child(tile);
            this._tiles.push({tile, zones, rects});
        });
        const rows = Math.ceil(layouts.length / columns);
        this.set_size(2 * pad + columns * tw + (columns - 1) * gap, 2 * pad + rows * th + (rows - 1) * gap);
    }

    /** Light one zone, the one the pointer or the keyboard is on. */
    highlight(tileIndex, zoneIndex) {
        this._active = [tileIndex, zoneIndex];
        this._tiles.forEach(({zones}, i) => zones.forEach((zone, z) => {
            if (i === tileIndex && z === zoneIndex)
                zone.add_style_class_name('w11-snap-zone-active');
            else
                zone.remove_style_class_name('w11-snap-zone-active');
        }));
    }

    get active() {
        return this._active;
    }

    get chosen() {
        return this._chosen;
    }

    /* The keyboard's numbers: one on each layout, then, once one is
     * chosen, one on each of its zones. */
    showNumbers(chosen = -1) {
        this._chosen = chosen;
        this._tiles.forEach(({tile, zones}, i) => {
            const badge = tile._badge;
            badge.visible = chosen < 0;
            if (badge.visible) {
                const [, w] = badge.get_preferred_width(-1);
                const [, h] = badge.get_preferred_height(w);
                badge.set_position(Math.round((tile.width - w) / 2), Math.round((tile.height - h) / 2));
            }
            for (const zone of zones)
                zone._badge.visible = i === chosen;
            if (i === chosen)
                tile.add_style_class_name('w11-snap-tile-chosen');
            else
                tile.remove_style_class_name('w11-snap-tile-chosen');
        });
    }

    /**
     * The tile and zone under a point of the stage.
     *
     * @param {number} x stage x
     * @param {number} y stage y
     * @returns {number[]} [tile, zone], -1 where there is none
     */
    zoneAt(x, y) {
        const [ok, lx, ly] = this.transform_stage_point(x, y);
        if (!ok)
            return [-1, -1];
        for (let i = 0; i < this._tiles.length; i++) {
            const {tile, rects} = this._tiles[i];
            const z = rectAt(rects, lx - tile.x, ly - tile.y);
            if (z >= 0)
                return [i, z];
        }
        return [-1, -1];
    }

    describe() {
        const rect = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
        };
        return {
            ...rect(this),
            active: this._active,
            chosen: this._chosen,
            tiles: this._tiles.map(({tile, zones}) => ({...rect(tile),
                number: tile._badge.visible ? tile._badge.text : null,
                chosen: tile.has_style_class_name('w11-snap-tile-chosen'),
                zones: zones.map(zone => ({...rect(zone), hover: zone.hover,
                    active: zone.has_style_class_name('w11-snap-zone-active'),
                    number: zone._badge.visible ? zone._badge.text : null}))})),
        };
    }
});

/* Something on screen that holds the keyboard while it is open and goes
 * away at a click elsewhere — which still lands where it was aimed. */
class Modal {
    constructor(actor, {onKey, onDismiss}) {
        this._actor = actor;
        this._onKey = onKey;
        this._onDismiss = onDismiss;
        this._grab = Main.pushModal(actor, {actionMode: Shell.ActionMode.POPUP});
        global.stage.set_key_focus(actor);
        // The press that opened it is not one that closes it.
        this._armed = false;
        this._armId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._armId = 0;
            this._armed = true;
            return GLib.SOURCE_REMOVE;
        });
        this._eventId = actor.connect('captured-event', (_actor, event) => this._onEvent(event));
    }

    _onEvent(event) {
        const type = event.type();
        if (type === Clutter.EventType.KEY_PRESS)
            return this._onKey(event.get_key_symbol(), event) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        if (type !== Clutter.EventType.BUTTON_PRESS || !this._armed)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (target && (target === this._actor || this._actor.contains(target)))
            return Clutter.EVENT_PROPAGATE;
        this._onDismiss();
        passOnPress(event);
        return Clutter.EVENT_STOP;
    }

    release() {
        if (this._armId)
            GLib.source_remove(this._armId);
        this._armId = 0;
        if (this._eventId)
            this._actor.disconnect(this._eventId);
        this._eventId = 0;
        if (this._grab)
            Main.popModal(this._grab);
        this._grab = null;
    }
}

function appear(actor, rise = -8) {
    const s = scaleFactor();
    actor.remove_all_transitions();
    actor.set({opacity: 0, translation_y: rise * s});
    actor.ease({opacity: 255, translation_y: 0, duration: duration(DURATION.normal), mode: EASE});
}

function vanish(actor) {
    actor.remove_all_transitions();
    actor.ease({opacity: 0, duration: duration(DURATION.fast), mode: EASE,
        onStopped: () => actor.destroy()});
}

export class SnapLayouts {
    constructor() {
        current = this;
        this._flyout = null;
        this._bar = null;
        this._assist = null;
        this._dragId = 0;
        this.lastSnap = null;
        this._grabBeginId = global.display.connect('grab-op-begin',
            (_display, win, op) => this._onGrabBegin(win, op));
        this._grabEndId = global.display.connect('grab-op-end',
            (_display, win, op) => this._onGrabEnd(win, op));
    }

    /* ------------------------------------------------------------ Win+Z */

    /**
     * Open the layouts over a window, as Win+Z does.
     *
     * @param {Meta.Window} win the window to place
     */
    openFor(win) {
        if (this._flyout) {
            this._closeFlyout();
            return;
        }
        this._endAssist();
        if (!snappable(win))
            return;
        const monitor = win.get_monitor();
        const area = workArea(monitor);
        const panel = new SnapPanel(layoutsFor(area), 3);
        applyThemeClass(panel);
        Main.layoutManager.addTopChrome(panel);
        const s = scaleFactor();
        const frame = win.get_frame_rect();
        // At the window's top right, under its title bar's buttons.
        const margin = 8 * s;
        const x = Math.max(area.x + margin, Math.min(frame.x + frame.width - panel.width,
            area.x + area.width - panel.width - margin));
        const y = Math.max(area.y + margin, Math.min(frame.y + SNAP.belowWindowTop * s,
            area.y + area.height - panel.height - margin));
        panel.set_position(Math.round(x), Math.round(y));
        panel.showNumbers();
        appear(panel, -4);
        panel.connect('zone-chosen', (_panel, tile, zone) => {
            this._closeFlyout();
            this._snap(win, panel.layouts[tile], zone, area);
        });
        this._flyout = {panel, win, modal: new Modal(panel, {
            onKey: key => this._onFlyoutKey(key),
            onDismiss: () => this._closeFlyout(),
        })};
    }

    _onFlyoutKey(key) {
        const {panel, win} = this._flyout;
        if (key === Clutter.KEY_Escape) {
            if (panel.chosen >= 0)
                panel.showNumbers();
            else
                this._closeFlyout();
            return true;
        }
        const digit = KEY_DIGITS.get(key);
        if (!digit)
            return false;
        if (panel.chosen < 0) {
            if (digit <= panel.layouts.length)
                panel.showNumbers(digit - 1);
            return true;
        }
        const layout = panel.layouts[panel.chosen];
        if (digit <= layout.zones.length) {
            const area = workArea(win.get_monitor());
            this._closeFlyout();
            this._snap(win, layout, digit - 1, area);
        }
        return true;
    }

    _closeFlyout() {
        if (!this._flyout)
            return;
        const {panel, modal} = this._flyout;
        this._flyout = null;
        modal.release();
        vanish(panel);
    }

    /* -------------------------------------------------- dragging to top */

    _onGrabBegin(win, op) {
        if (op !== Meta.GrabOp.MOVING && op !== Meta.GrabOp.MOVING_UNCONSTRAINED)
            return;
        if (!snappable(win))
            return;
        this._closeFlyout();
        this._endAssist();
        this._dragged = win;
        this._dragId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
            this._followDrag();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _followDrag() {
        const [px, py] = global.get_pointer();
        const s = scaleFactor();
        if (!this._bar) {
            const monitor = global.display.get_monitor_index_for_rect(
                new Mtk.Rectangle({x: px, y: py, width: 1, height: 1}));
            const area = workArea(Math.max(0, monitor));
            // Up against the top of the screen — or of the room under a bar
            // there.
            if (py > area.y + SNAP.barReach * s)
                return;
            const bar = new SnapPanel(layoutsFor(area), 6,
                {reactive: false, styleClass: 'w11-snap-panel w11-snap-bar'});
            applyThemeClass(bar);
            Main.layoutManager.addTopChrome(bar);
            bar.set_position(Math.round(area.x + (area.width - bar.width) / 2),
                Math.round(area.y + SNAP.barTop * s));
            appear(bar);
            this._bar = {bar, area};
            return;
        }
        const {bar, area} = this._bar;
        const [tile, zone] = bar.zoneAt(px, py);
        if (tile !== bar.active[0] || zone !== bar.active[1]) {
            bar.highlight(tile, zone);
            this._showPreview(tile >= 0 ? zoneRect(area, bar.layouts[tile].zones[zone]) : null);
        }
        // Gone once the pointer has left it well behind.
        const margin = 48 * s;
        const [x, y] = [bar.x, bar.y];
        if (px < x - margin || px > x + bar.width + margin || py > y + bar.height + margin)
            this._hideBar();
    }

    _showPreview(rect) {
        if (!rect) {
            if (this._preview)
                vanish(this._preview);
            this._preview = null;
            return;
        }
        if (!this._preview) {
            this._preview = new St.Widget({style_class: 'w11-snap-preview', opacity: 0});
            applyThemeClass(this._preview);
            Main.layoutManager.uiGroup.insert_child_below(this._preview, this._bar?.bar ?? null);
            this._preview.set_position(rect.x, rect.y);
            this._preview.set_size(rect.width, rect.height);
            this._preview.ease({opacity: 255, duration: duration(DURATION.normal), mode: EASE});
            return;
        }
        this._preview.remove_all_transitions();
        this._preview.opacity = 255;
        this._preview.ease({x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            duration: duration(DURATION.fast), mode: EASE});
    }

    _hideBar() {
        this._showPreview(null);
        if (!this._bar)
            return;
        const {bar} = this._bar;
        this._bar = null;
        Main.layoutManager.removeChrome(bar);
        Main.uiGroup.add_child(bar);
        vanish(bar);
    }

    _onGrabEnd(win) {
        if (!this._dragId)
            return;
        GLib.source_remove(this._dragId);
        this._dragId = 0;
        const chosen = this._bar && this._bar.bar.active[0] >= 0
            ? {layout: this._bar.bar.layouts[this._bar.bar.active[0]],
                zone: this._bar.bar.active[1], area: this._bar.area}
            : null;
        this._hideBar();
        this._dragged = null;
        if (!chosen || win.get_compositor_private() === null)
            return;
        // After mutter has finished the move it was making.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (win.get_compositor_private())
                this._snap(win, chosen.layout, chosen.zone, chosen.area);
            return GLib.SOURCE_REMOVE;
        });
    }

    /* ----------------------------------------------------- snap assist */

    _snap(win, layout, zone, area) {
        snapWindow(win, zoneRect(area, layout.zones[zone]));
        this.lastSnap = {title: win.get_title(), layout: layout.id, zone};
        win.activate(global.get_current_time());
        this._startAssist(layout, area, new Map([[zone, win]]), win.get_monitor());
    }

    /* The next zone still empty gets the other windows to choose from. */
    _startAssist(layout, area, filled, monitor) {
        this._endAssist();
        const zone = layout.zones.findIndex((_z, i) => !filled.has(i));
        if (zone < 0)
            return;
        const placed = new Set(filled.values());
        const workspace = global.workspace_manager.get_active_workspace();
        const candidates = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(w => snappable(w) && !placed.has(w) && w.get_monitor() === monitor);
        if (!candidates.length)
            return;
        const rect = zoneRect(area, layout.zones[zone]);
        const s = scaleFactor();
        const inset = 6 * s;
        const overlay = new St.Widget({style_class: 'w11-snap-assist', reactive: true,
            layout_manager: new Clutter.FixedLayout()});
        applyThemeClass(overlay);
        overlay.set_position(rect.x + inset, rect.y + inset);
        overlay.set_size(rect.width - 2 * inset, rect.height - 2 * inset);
        Main.layoutManager.addTopChrome(overlay);
        const inner = {x: 0, y: 0, width: overlay.width, height: overlay.height};
        const aspects = candidates.map(w => {
            const r = w.get_frame_rect();
            return r.height > 0 ? r.width / r.height : 1.5;
        });
        const grid = assistGrid(aspects, inner, s);
        const items = [];
        candidates.forEach((w, i) => {
            const at = grid[i];
            if (!at)
                return;
            const item = this._assistItem(w, at);
            item.connect('clicked', () => {
                const next = new Map(filled);
                next.set(zone, w);
                this._endAssist();
                snapWindow(w, rect);
                w.activate(global.get_current_time());
                this._startAssist(layout, area, next, monitor);
            });
            overlay.add_child(item);
            items.push({item, win: w});
        });
        appear(overlay, 0);
        this._assist = {overlay, items, zone, layout: layout.id, modal: new Modal(overlay, {
            onKey: key => {
                if (key !== Clutter.KEY_Escape)
                    return false;
                this._endAssist();
                return true;
            },
            onDismiss: () => this._endAssist(),
        })};
    }

    _assistItem(win, at) {
        const s = scaleFactor();
        const item = new St.Button({style_class: 'w11-snap-assist-item', can_focus: true,
            reactive: true, track_hover: true});
        item.set_position(at.x, at.y);
        item.set_size(at.width, at.height);
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true});
        item.set_child(box);
        const header = new St.BoxLayout({style_class: 'w11-snap-assist-header'});
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        if (app)
            header.add_child(new St.Icon({gicon: app.get_icon(), icon_size: 16,
                y_align: Clutter.ActorAlign.CENTER}));
        const title = new St.Label({text: win.get_title() ?? app?.get_name() ?? '',
            style_class: 'w11-snap-assist-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        title.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        header.add_child(title);
        box.add_child(header);
        const bin = new St.Widget({style_class: 'w11-snap-assist-preview', x_expand: true,
            y_expand: true, layout_manager: new Clutter.BinLayout()});
        const actor = win.get_compositor_private();
        if (actor) {
            const [sw, sh] = actor.get_size();
            const room = [at.width - 16 * s, at.height - (SNAP.assistTitleHeight + 8) * s];
            const factor = Math.min(room[0] / sw, room[1] / sh, 1);
            bin.add_child(new Clutter.Clone({source: actor, width: Math.round(sw * factor),
                height: Math.round(sh * factor), x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER}));
        }
        box.add_child(bin);
        item._w11Window = win;
        return item;
    }

    _endAssist() {
        if (!this._assist)
            return;
        const {overlay, modal} = this._assist;
        this._assist = null;
        modal.release();
        Main.layoutManager.removeChrome(overlay);
        Main.uiGroup.add_child(overlay);
        vanish(overlay);
    }

    /** What is on screen, for the tests. */
    describe() {
        const rect = actor => {
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
        };
        return {
            flyout: this._flyout ? {...this._flyout.panel.describe(),
                window: this._flyout.win.get_title()} : null,
            bar: this._bar ? this._bar.bar.describe() : null,
            preview: this._preview ? rect(this._preview) : null,
            assist: this._assist ? {...rect(this._assist.overlay), zone: this._assist.zone,
                layout: this._assist.layout,
                items: this._assist.items.map(({item, win}) => ({...rect(item), title: win.get_title()}))} : null,
            dragging: this._dragId !== 0,
            lastSnap: this.lastSnap,
        };
    }

    destroy() {
        global.display.disconnect(this._grabBeginId);
        global.display.disconnect(this._grabEndId);
        if (this._dragId)
            GLib.source_remove(this._dragId);
        this._dragId = 0;
        this._closeFlyout();
        this._hideBar();
        this._endAssist();
        if (current === this)
            current = null;
    }
}
