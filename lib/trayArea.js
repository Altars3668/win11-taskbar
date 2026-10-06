/* trayArea.js — the notification area, laid out to the Windows measurements.
 *
 * Measured on Windows 11, right to left: a 12px "show desktop" sliver, a
 * 62px clock, the merged system glyphs at 24px each, the app tray icons at
 * 32x48 with 16x16 glyphs, and a 32x48 chevron that opens the overflow.
 * The overflow panel itself measured 234x114, sitting directly on top of the
 * taskbar and centred on the chevron.
 */

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {placeBeside, sideFacingBar} from './barEdge.js';
import {DBusMenuBridge} from './dbusMenu.js';
import {duration, slideIn, slideOut} from './motion.js';
import {passOnPress} from './shellMenus.js';
import {shellShuttingDown} from './shellShutdown.js';
import {TRAY, TIMING} from './spec.js';
import {applyThemeClass} from './theme.js';

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
import {StatusNotifierHost} from './statusNotifier.js';

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/**
 * Convert a StatusNotifierItem pixmap array into something St can show.
 *
 * The wire format is a list of (width, height, ARGB32 big-endian bytes).
 * GdkPixbuf wants RGBA, so the channels are rotated and the result is
 * re-encoded as PNG, which is the one form both GdkPixbuf and Gio.Icon
 * agree on.
 *
 * @param {Array} pixmaps the a(iiay) payload
 * @returns {Gio.Icon|null} an icon, or null if nothing usable was found
 */
function pixmapToIcon(pixmaps) {
    if (!pixmaps?.length)
        return null;

    // Take the largest; Windows renders tray glyphs at 16px but HiDPI wants
    // the biggest source available.
    let best = null;
    for (const entry of pixmaps) {
        const [w, h] = entry;
        if (w > 0 && h > 0 && (!best || w * h > best[0] * best[1]))
            best = entry;
    }
    if (!best)
        return null;

    const [width, height, argb] = best;
    const rgba = new Uint8Array(argb.length);
    for (let i = 0; i < argb.length; i += 4) {
        rgba[i] = argb[i + 1];      // R
        rgba[i + 1] = argb[i + 2];  // G
        rgba[i + 2] = argb[i + 3];  // B
        rgba[i + 3] = argb[i];      // A
    }

    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            new GLib.Bytes(rgba), GdkPixbuf.Colorspace.RGB, true, 8,
            width, height, width * 4);
        const [ok, buffer] = pixbuf.save_to_bufferv('png', [], []);
        return ok ? Gio.BytesIcon.new(new GLib.Bytes(buffer)) : null;
    } catch (e) {
        logError(e, 'win11-taskbar: cannot decode a tray pixmap');
        return null;
    }
}

/** One tray icon button. Measured 32x48 with a 16x16 glyph. */
const TrayIcon = GObject.registerClass({
    Signals: {'hide-requested': {}, 'activated': {}},
}, class TrayIcon extends St.Button {
    _init(item, taskbar) {
        super._init({
            style_class: 'w11-tray-icon',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
        });

        this._item = item;
        this._taskbar = taskbar;
        this._menu = null;
        this._bridge = null;
        this._hoverId = 0;
        this._watchId = 0;
        this._tooltip = null;
        this._menuFromHover = false;
        this._awaySince = 0;
        this.connect('notify::hover', () => this._onHoverChanged());
        this._hoverSettingId = taskbar.settings.connect('changed::tray-hover', () => {
            this.dismissHover();
            this._onHoverChanged();
        });

        this._icon = new St.Icon({
            style_class: 'w11-tray-glyph',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(this._icon);

        this._changedId = item.connect('changed', () => this.sync());
        this.connect('destroy', () => this._onDestroy());

        this.updateMetrics();
        this.sync();
    }

    get item() {
        return this._item;
    }

    updateMetrics() {
        this.set_size(...this._taskbar.cellSize(TRAY.iconButtonWidth));
        this._icon.icon_size = TRAY.iconSize;
    }

    sync() {
        const name = this._item.iconName;
        if (name) {
            const themePath = this._item.iconThemePath;
            if (themePath) {
                // Apps that ship their own icons give a path the icon theme
                // does not know about.
                const file = Gio.File.new_for_path(
                    GLib.build_filenamev([themePath, `${name}.png`]));
                this._icon.gicon = file.query_exists(null)
                    ? new Gio.FileIcon({file})
                    : new Gio.ThemedIcon({name});
            } else {
                this._icon.gicon = new Gio.ThemedIcon({name});
            }
        } else {
            this._icon.gicon = pixmapToIcon(this._item.iconPixmap);
        }

        this.accessible_name = this._item.tooltipText;
        if (this._tooltip)
            this._tooltip.text = this._item.tooltipText;
        if (this._item.needsAttention)
            this.add_style_class_name('w11-tray-attention');
        else
            this.remove_style_class_name('w11-tray-attention');
    }

    vfunc_button_press_event(event) {
        const button = event.get_button();
        const [x, y] = this.get_transformed_position();

        if (button === Clutter.BUTTON_SECONDARY) {
            // Same rule as the task buttons: wait for the release unless
            // the setting says otherwise.
            if (!this._taskbar.settings.get_boolean('context-menu-on-release')) {
                this._openMenu();
                return Clutter.EVENT_STOP;
            }
            this._rightPressAt = event.get_coords();
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_MIDDLE) {
            this._item.secondaryActivate(Math.round(x), Math.round(y));
            this.emit('activated');
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_PRIMARY) {
            // An item that is really just a menu opens its menu on a plain
            // click, which is what Windows does for those too.
            if (this._item.isMenuOnly && this._item.menuPath) {
                this._openMenu();
            } else {
                this._item.activate(Math.round(x), Math.round(y));
                this.emit('activated');
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() === Clutter.BUTTON_SECONDARY &&
            this._rightPressAt) {
            const [px, py] = this._rightPressAt;
            this._rightPressAt = null;
            const [x, y] = event.get_coords();
            if (Math.hypot(x - px, y - py) <= 8)
                this._openMenu();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(event) {
        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP)
            this._item.scroll(-1, 'vertical');
        else if (direction === Clutter.ScrollDirection.DOWN)
            this._item.scroll(1, 'vertical');
        else if (direction === Clutter.ScrollDirection.LEFT)
            this._item.scroll(-1, 'horizontal');
        else if (direction === Clutter.ScrollDirection.RIGHT)
            this._item.scroll(1, 'horizontal');
        return Clutter.EVENT_STOP;
    }

    _onHoverChanged() {
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = 0;
        if (!this.hover) {
            this._tooltip?.destroy();
            this._tooltip = null;
            return;
        }
        const mode = this._taskbar.settings.get_string('tray-hover');
        if (mode === 'none' || this._menu?.isOpen)
            return;
        this._taskbar._trayArea?.dismissHover(this);
        this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TIMING.menuShowDelayMs, () => {
            this._hoverId = 0;
            if (this.hover && this.mapped) {
                if (mode === 'menu' && this._item.menuPath)
                    this._openMenu(true);
                else
                    this._showTooltip();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _showTooltip() {
        this._tooltip?.destroy();
        this._tooltip = new St.Label({style_class: 'w11-tray-tooltip',
            text: this._item.tooltipText, reactive: false});
        this._tooltip.clutter_text.line_wrap = true;
        this._tooltip.clutter_text.ellipsize = 3;
        applyThemeClass(this._tooltip);
        Main.layoutManager.addChrome(this._tooltip);
        const s = scaleFactor();
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(this) ?? Main.layoutManager.primaryMonitor;
        const [, naturalWidth] = this._tooltip.get_preferred_width(-1);
        const width = Math.min(naturalWidth, 320 * s, monitor.width - 16 * s);
        const [, height] = this._tooltip.get_preferred_height(width);
        this._tooltip.set_size(width, height);
        // Beside the icon, on the bar's inner side.
        const place = placeBeside(this._taskbar.edge, {x, y, width: w, height: h},
            {width, height}, monitor, {gap: 8 * s, margin: 8 * s});
        this._tooltip.set_position(Math.round(place.x), Math.round(place.y));
    }

    _containsPointer(actor) {
        if (!actor?.mapped)
            return false;
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        const [px, py] = global.get_pointer();
        return px >= x && px < x + w && py >= y && py < y + h;
    }

    _watchHoverMenu() {
        if (this._watchId)
            return;
        this._awaySince = 0;
        this._watchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            if (!this._menuFromHover || !this._menu?.isOpen) {
                this._watchId = 0;
                return GLib.SOURCE_REMOVE;
            }
            const inside = this._containsPointer(this) || this._containsPointer(this._menu.actor) ||
                this._menu._getMenuItems().some(item => item.menu && this._containsPointer(item.menu.actor));
            if (inside) {
                this._awaySince = 0;
            } else {
                const now = GLib.get_monotonic_time();
                this._awaySince ||= now;
                if (now - this._awaySince >= TIMING.thumbnailHideDelayMs * 1000) {
                    this._watchId = 0;
                    this._menuFromHover = false;
                    this._menu.close(false);
                    return GLib.SOURCE_REMOVE;
                }
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    dismissHover() {
        for (const key of ['_hoverId', '_watchId']) {
            if (this[key])
                GLib.source_remove(this[key]);
            this[key] = 0;
        }
        this._tooltip?.destroy();
        this._tooltip = null;
        if (this._menuFromHover)
            this._menu?.close(false);
        this._menuFromHover = false;
    }

    _openMenu(fromHover = false) {
        const wasHover = this._menuFromHover;
        this._tooltip?.destroy();
        this._tooltip = null;
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = 0;
        const path = this._item.menuPath;
        if (!path) {
            // 悬停不能调用程序的 ContextMenu，否则无法管理它的关闭和焦点。
            if (fromHover)
                this._showTooltip();
            else {
                const [x, y] = this.get_transformed_position();
                this._item.contextMenu(Math.round(x), Math.round(y));
            }
            return;
        }
        if (this._menuPath && this._menuPath !== path) {
            this._bridge?.destroy();
            this._menu?.destroy();
            this._menu = null;
        }
        this._menuPath = path;
        if (!this._menu) {
            this._menu = new PopupMenu.PopupMenu(this, 0.5,
                sideFacingBar(this._taskbar.edge));
            this._menu.actor.add_style_class_name('w11-tray-menu');
            applyThemeClass(this._menu.actor);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();
            this._manager = new PopupMenu.PopupMenuManager(this);
            this._manager.addMenu(this._menu);
            this._taskbar.applyAcrylicToPopup(this._menu);
            this._bridge = new DBusMenuBridge(this._item.busName, path, this._menu,
                () => this._addVisibilityItem());
            this._addVisibilityItem();
        } else {
            this._bridge?.refresh();
        }
        this._menuFromHover = fromHover;
        if (fromHover || wasHover)
            this._menu.open(true);
        else
            this._menu.toggle();
        if (fromHover)
            this._watchHoverMenu();
    }

    /** Windows lets you move an icon between the bar and the overflow from
     *  its own context menu; the DBusMenu the app provides knows nothing
     *  about that, so the entry is appended after it. */
    _addVisibilityItem() {
        if (!this._menu)
            return;
        const settings = this._taskbar.settings;
        const hidden = settings.get_strv('tray-hidden-items');
        const isHidden = hidden.includes(this._item.id);

        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const item = new PopupMenu.PopupMenuItem(
            isHidden ? _('Show icon in taskbar') : _('Hide icon'));
        item.connect('activate', () => this.toggleHidden());
        this._menu.addMenuItem(item);
    }

    /** Move this icon between the taskbar and the overflow. */
    toggleHidden() {
        const settings = this._taskbar.settings;
        const hidden = settings.get_strv('tray-hidden-items');
        const id = this._item.id;
        const next = hidden.includes(id)
            ? hidden.filter(h => h !== id)
            : [...hidden, id];
        settings.set_strv('tray-hidden-items', next);
    }

    _onDestroy() {
        this.dismissHover();
        if (this._hoverSettingId)
            this._taskbar.settings.disconnect(this._hoverSettingId);
        this._hoverSettingId = 0;
        if (this._changedId) {
            this._item.disconnect(this._changedId);
            this._changedId = 0;
        }
        this._bridge?.destroy();
        this._bridge = null;
        this._menu?.destroy();
        this._menu = null;
    }
});

/** The overflow popup behind the chevron. Measured 234x114.
 *
 * A light-dismiss flyout, as Windows' is: a press anywhere else closes it
 * and still lands where it was made — a window is activated, a taskbar
 * button clicks — and Esc closes it too. A press on the chevron only
 * closes it. Activating an icon in it closes it as well.
 *
 * 'opening' is emitted as it starts to open, 'closed' once it has gone. */
const OverflowPanel = GObject.registerClass({
    Signals: {'opening': {}, 'closed': {}},
}, class OverflowPanel extends St.Widget {
    _init(taskbar) {
        super._init({
            style_class: 'w11-tray-overflow',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
            opacity: 0,
        });

        this._taskbar = taskbar;
        this._isOpen = false;
        this._anchor = null;
        this._icons = [];
        this._modal = null;
        this._acceptsDismiss = false;
        this._dismissIdleId = 0;
        this._grid = new St.Widget({
            style_class: 'w11-tray-overflow-grid',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
            }),
        });
        this.add_child(this._grid);

        this.connect('captured-event', (_actor, event) => this._onCapturedEvent(event));
        Main.layoutManager.addChrome(this);
        this.connect('destroy', () => {
            this._release();
            Main.layoutManager.removeChrome(this);
        });
    }

    get isOpen() {
        return this._isOpen;
    }

    get grid() {
        return this._grid;
    }

    /**
     * Fill the grid and place it above the chevron.
     *
     * @param {St.Button} anchor the chevron button
     * @param {Array} icons the tray icon actors to show
     */
    show(anchor, icons) {
        // Only when the icons or their order changed: an icon taken out of
        // the grid and put back closes whatever it had open — its hover
        // menu among them — and a blinking icon changes twice a second.
        const same = icons.length === this._icons.length &&
            icons.every((icon, i) => icon === this._icons[i] && icon.get_parent() === this._grid);
        if (!same) {
            const layout = this._grid.layout_manager;
            for (const child of this._grid.get_children())
                this._grid.remove_child(child);
            for (const icon of icons)
                icon.get_parent()?.remove_child(icon);

            // Measured 234x114 for the panel: with 9px padding that is a
            // 4-column grid of 54x48 cells, two rows deep.
            const columns = 4;
            icons.forEach((icon, i) => {
                layout.attach(icon, i % columns, Math.floor(i / columns), 1, 1);
            });
            this._icons = [...icons];
        }

        const wasOpen = this._isOpen;
        const reversing = this.visible;
        this._isOpen = true;
        this._anchor = anchor;
        this.visible = true;
        this._reposition(anchor);
        if (wasOpen)
            return;
        this.emit('opening');
        slideIn(this, {from: this._taskbar.towardsBar(10), fromCurrent: reversing});
        this._modal = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        // A modal grab with nowhere to send keys sends them back here; Esc
        // among them.
        global.stage.set_key_focus(this);
        // The click that opened it is not one that closes it.
        this._acceptsDismiss = false;
        this._dismissIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._dismissIdleId = 0;
            this._acceptsDismiss = this._isOpen;
            return GLib.SOURCE_REMOVE;
        });
    }

    _onCapturedEvent(event) {
        const type = event.type();
        // Closing: nothing in here reacts any more — but crossing events
        // have to pass, Clutter insists on it.
        if (!this._isOpen) {
            return type === Clutter.EventType.ENTER || type === Clutter.EventType.LEAVE
                ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }
        if (type === Clutter.EventType.KEY_PRESS && event.get_key_symbol() === Clutter.KEY_Escape) {
            this.dismiss();
            return Clutter.EVENT_STOP;
        }
        if (type !== Clutter.EventType.BUTTON_PRESS || !this._acceptsDismiss)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (target && (target === this || this.contains(target)))
            return Clutter.EVENT_PROPAGATE;
        const anchor = this._anchor;
        this.dismiss();
        if (!target || !(target === anchor || anchor?.contains(target)))
            passOnPress(event);
        return Clutter.EVENT_STOP;
    }

    _release() {
        this._acceptsDismiss = false;
        if (this._dismissIdleId) {
            GLib.source_remove(this._dismissIdleId);
            this._dismissIdleId = 0;
        }
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
    }

    _reposition(anchor) {
        const s = scaleFactor();
        const [ax, ay] = anchor.get_transformed_position();
        const [aw, ah] = anchor.get_transformed_size();
        const [, natW] = this.get_preferred_width(-1);
        const [, natH] = this.get_preferred_height(natW);

        const monitor = Main.layoutManager.findMonitorForActor(anchor) ??
            Main.layoutManager.primaryMonitor;

        // Centred on the chevron and clamped to the screen, sitting right on
        // the taskbar edge.
        const {x, y} = placeBeside(this._taskbar.edge, {x: ax, y: ay, width: aw, height: ah},
            {width: natW, height: natH}, monitor, {margin: 4 * s});
        this.set_position(Math.round(x), Math.round(y));
    }

    dismiss() {
        if (!this._isOpen)
            return;
        this._isOpen = false;
        this._release();
        slideOut(this, {
            to: this._taskbar.towardsBar(5),
            onComplete: () => {
                if (this._isOpen)
                    return;
                this.visible = false;
                for (const child of this._grid.get_children())
                    this._grid.remove_child(child);
                this._icons = [];
                this.emit('closed');
            },
        });
    }
});

/** The whole notification area. */
export const TrayArea = GObject.registerClass(
class TrayArea extends St.BoxLayout {
    _init(taskbar) {
        super._init({
            style_class: 'w11-tray-area',
            orientation: Clutter.Orientation.HORIZONTAL,
            y_expand: true,
        });

        this._taskbar = taskbar;
        this._icons = new Map(); // StatusItem -> TrayIcon
        this._itemIds = new Map();

        this._chevron = new St.Button({
            style_class: 'w11-shell-button w11-tray-chevron',
            can_focus: true,
            track_hover: true,
            visible: false,
            child: new St.Icon({
                icon_name: 'pan-up-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        this._chevron.accessible_name = 'Show hidden icons';
        this._chevron.connect('clicked', () => this._toggleOverflow());
        this.add_child(this._chevron);

        this._iconBox = new St.BoxLayout({
            style_class: 'w11-tray-icons',
            y_expand: true,
        });
        this.add_child(this._iconBox);

        this._overflow = new OverflowPanel(taskbar);
        taskbar.applyAcrylicTo(this._overflow);
        applyThemeClass(this._overflow);
        this._chevron.child.set_pivot_point(0.5, 0.5);
        this._overflow.connect('opening', () => this._turnChevron(true));
        this._overflow.connect('closed', () => this._turnChevron(false));

        // Only the first taskbar runs the host: one watcher per session.
        this._host = taskbar.statusHost;
        if (this._host) {
            this._addedId = this._host.connect('item-added',
                (_h, item) => this._addItem(item));
            this._removedId = this._host.connect('item-removed',
                (_h, item) => this._removeItem(item));
            for (const item of this._host.items)
                this._addItem(item);
        }

        this._hiddenId = taskbar.settings.connect('changed::tray-hidden-items',
            () => this._reflow());

        this.connect('destroy', () => this._onDestroy());
        this.updateMetrics();
    }

    updateMetrics() {
        this._chevron.set_size(...this._taskbar.cellSize(TRAY.overflowButtonWidth));
        for (const icon of this._icons.values())
            icon.updateMetrics();
    }

    /* Along the bar, and the chevron pointing to where the hidden icons
     * open. */
    setOrientation(orientation) {
        this.orientation = orientation;
        this._iconBox.orientation = orientation;
        this._chevron.child.icon_name = {
            top: 'pan-down-symbolic',
            left: 'pan-end-symbolic',
            right: 'pan-start-symbolic',
        }[this._taskbar.edge] ?? 'pan-up-symbolic';
    }

    /** Re-tag the bits that live outside the taskbar's actor tree. */
    refreshTheme() {
        applyThemeClass(this._overflow);
        for (const icon of this._icons.values()) {
            if (icon._menu?.actor)
                applyThemeClass(icon._menu.actor);
        }
    }

    _addItem(item) {
        if (this._icons.has(item))
            return;
        const icon = new TrayIcon(item, this._taskbar);
        // An icon in the overflow that opens its program closes the
        // overflow, as on Windows.
        icon.connect('activated', () => {
            if (this._overflow && icon.get_parent() === this._overflow.grid)
                this._overflow.dismiss();
        });
        this._icons.set(item, icon);
        this._itemIds.set(item, item.connect('changed', () => this._reflow()));
        this._reflow();
    }

    _removeItem(item) {
        const icon = this._icons.get(item);
        if (!icon)
            return;
        this._icons.delete(item);
        item.disconnect(this._itemIds.get(item));
        this._itemIds.delete(item);
        icon.destroy();
        this._reflow();
    }

    /** Split the icons between the strip and the overflow panel. */
    _reflow() {
        const hidden = new Set(
            this._taskbar.settings.get_strv('tray-hidden-items'));

        const visible = [];
        const overflowed = [];
        for (const [item, icon] of this._icons) {
            if (!item.isVisible)
                continue;
            // An item asking for attention is always shown, even if hidden —
            // Windows pulls it out of the overflow too.
            if (hidden.has(item.id) && !item.needsAttention)
                overflowed.push(icon);
            else
                visible.push(icon);
        }

        // Only what changes place moves. Every item's every change comes
        // here — a blinking icon twice a second — and an icon taken out and
        // put back closes whatever it had open, its hover menu among them,
        // which the pointer still on it then opened again.
        for (const icon of this._icons.values()) {
            const parent = icon.get_parent();
            if (!parent)
                continue;
            if (visible.includes(icon) ? parent !== this._iconBox
                : !(overflowed.includes(icon) && parent === this._overflow.grid))
                parent.remove_child(icon);
        }
        visible.forEach((icon, index) => {
            if (icon.get_parent() !== this._iconBox)
                this._iconBox.insert_child_at_index(icon, index);
            else if (this._iconBox.get_child_at_index(index) !== icon)
                this._iconBox.set_child_at_index(icon, index);
        });

        this._overflowed = overflowed;
        this._chevron.visible = overflowed.length > 0;
        if (overflowed.length === 0)
            this._overflow.dismiss();
        else if (this._overflow.isOpen)
            this._overflow.show(this._chevron, overflowed);
    }

    dismissHover(except = null) {
        for (const icon of this._icons.values()) {
            if (icon !== except)
                icon.dismissHover();
        }
    }

    /* While the hidden icons are open the chevron points back at the bar:
     * half a turn clockwise as they open, and back once they have gone, as
     * Windows turns it. */
    _turnChevron(open) {
        const icon = this._chevron.child;
        const angle = open ? 180 : 0;
        icon.remove_transition('rotation-angle-z');
        const ms = duration(TRAY.chevronTurnMs);
        if (ms === 0) {
            icon.rotation_angle_z = angle;
            return;
        }
        icon.ease({rotation_angle_z: angle, duration: ms, mode: Clutter.AnimationMode.EASE_OUT_EXPO});
    }

    _toggleOverflow() {
        if (this._overflow.isOpen)
            this._overflow.dismiss();
        else
            this._overflow.show(this._chevron, this._overflowed ?? []);
    }

    _onDestroy() {
        if (this._host) {
            if (this._addedId)
                this._host.disconnect(this._addedId);
            if (this._removedId)
                this._host.disconnect(this._removedId);
        }
        if (this._hiddenId) {
            this._taskbar.settings.disconnect(this._hiddenId);
            this._hiddenId = 0;
        }
        for (const [item, id] of this._itemIds)
            item.disconnect(id);
        this._itemIds.clear();
        // At shell exit the overflow panel and the icons go with the rest
        // of the stage, possibly first.
        if (shellShuttingDown())
            return;
        this.dismissHover();
        // 弹层销毁会级联销毁其中的按钮，先移出由 TrayArea 持有的图标。
        for (const icon of this._icons.values())
            icon.get_parent()?.remove_child(icon);
        this._overflow?.destroy();
        this._overflow = null;
        for (const icon of this._icons.values())
            icon.destroy();
        this._icons.clear();
    }
});
