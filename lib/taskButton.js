/* taskButton.js — one app button, with Windows 11 click semantics.
 *
 * Geometry and state colours come from lib/spec.js, which records what was
 * measured on a real Windows 11 taskbar. The behaviour below reproduces what
 * Windows does for each gesture; each branch cites the Windows rule it mirrors.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Action, Button as MouseButton, decide} from './clickSemantics.js';
import {DURATION, duration, EASE} from './motion.js';
import {BUTTON, INDICATOR, TIMING} from './spec.js';
import * as Windows from './windows.js';
import {noteLaunch} from './windowMotion.js';

/**
 * The inside of a task button, laid out by hand.
 *
 * Clutter's BinLayout does not honour a child's x_align/y_align here, so the
 * three pieces are placed explicitly against the measured Windows geometry:
 * the plate inset 2px in the 44x48 cell, the 24x24 icon dead centre, and the
 * indicator pill centred horizontally with its bottom 5px above the taskbar
 * edge (measured rows y=40..42 of 48). The pill keeps to the screen edge
 * wherever the bar is: on a bar standing on a side it stands upright, 5px
 * in from that edge.
 */
const ButtonContent = GObject.registerClass(
class ButtonContent extends St.Widget {
    _init(plate, flash, icon, indicator) {
        super._init({x_expand: true, y_expand: true});
        this._plate = plate;
        this._flash = flash;
        this._icon = icon;
        this._indicator = indicator;
        this.add_child(plate);
        this.add_child(flash);
        this.add_child(icon);
        this.add_child(indicator);
    }

    vfunc_allocate(box) {
        this.set_allocation(box);

        const w = box.get_width();
        const h = box.get_height();
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const iconPx = this._iconSize ?? BUTTON.iconSize;

        const place = (actor, x, y, aw, ah) => {
            const b = new Clutter.ActorBox();
            b.set_origin(Math.round(x), Math.round(y));
            b.set_size(Math.round(aw), Math.round(ah));
            actor.allocate(b);
        };

        const inset = BUTTON.plateInset * s;
        place(this._plate, inset, inset, w - 2 * inset, h - 2 * inset);
        place(this._flash, inset, inset, w - 2 * inset, h - 2 * inset);

        const iconSize = iconPx * s;
        place(this._icon, (w - iconSize) / 2, (h - iconSize) / 2, iconSize, iconSize);

        if (this._indicator.visible) {
            const t = INDICATOR.thickness * s;
            const offset = INDICATOR.bottomOffset * s;
            const iw = this._indicator.width;
            const ih = this._indicator.height;
            switch (this._edge) {
            case 'top':
                place(this._indicator, (w - iw) / 2, offset, iw, t);
                break;
            case 'left':
                place(this._indicator, offset, (h - ih) / 2, t, ih);
                break;
            case 'right':
                place(this._indicator, w - offset - t, (h - ih) / 2, t, ih);
                break;
            default:
                place(this._indicator, (w - iw) / 2, h - offset - t, iw, t);
            }
        }
    }
});

/** How far the pointer may travel between press and release and still
 *  count as a click rather than a gesture. */
const DRAG_THRESHOLD = 8;

/** How far the icon grows under the pointer. */
const HOVER_SCALE = 1.08;

/* An app asking for attention: Windows flashes its button seven times —
 * ForegroundFlashCount — at about the caret's blink rate, then leaves it
 * lit until the window is used. */
const FLASH_COUNT = 7;
const FLASH_HALF_MS = 500;

/** What the pill under the icon should look like right now. */
const IndicatorState = {
    NONE: 'none',         // pinned, not running — Windows draws nothing
    INACTIVE: 'inactive', // running, not focused — 6px grey pill
    ACTIVE: 'active',     // owns the focused window — 18px accent pill
};

export const TaskButton = GObject.registerClass({
    Signals: {
        'preview-requested': {param_types: [GObject.TYPE_BOOLEAN]},
        'preview-dismissed': {},
        'menu-requested': {},
        'reorder-requested': {param_types: [GObject.TYPE_INT]},
    },
}, class TaskButton extends St.Button {
    _init(app, taskbar) {
        super._init({
            style_class: 'w11-task-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
        });

        this._app = app;
        this._taskbar = taskbar;
        this._hoverTimeoutId = 0;
        this._leaveTimeoutId = 0;
        this._indicatorState = null;
        this._windowCount = 0;
        this._originalIconGeometry = new Map();

        this._attention = false;
        this._watched = new Map();

        this._plate = new St.Widget({style_class: 'w11-task-plate'});
        this._flash = new St.Widget({style_class: 'w11-task-flash', opacity: 0, visible: false});
        this._icon = new St.Icon({style_class: 'w11-task-icon'});
        this._indicator = new St.Widget({style_class: 'w11-task-indicator'});

        this._content = new ButtonContent(this._plate, this._flash, this._icon, this._indicator);
        this.set_child(this._content);

        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('notify::allocation', () => this._syncIconGeometry());
        this.connect('notify::mapped', () => this._syncIconGeometry());
        this.connect('destroy', () => this._onDestroy());

        this.updateMetrics();
        this.sync();
    }

    get app() {
        return this._app;
    }

    get windowCount() {
        return this._windowCount;
    }

    _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    /** Re-apply the measured geometry; called on construction and on scale change. */
    updateMetrics() {
        // 44 along a 48px bar, and as much more or less as the bar is.
        this.set_size(...this._taskbar.cellSize(BUTTON.width, true));
        // Measured at 24, but adjustable: on a dense display the measured
        // size can look sparse, and this is cheaper than arguing with it.
        // The setting is for a 48px bar; a thicker or thinner one scales it,
        // keeping a margin round it.
        this._iconSize = Math.max(16, Math.min(
            this._taskbar.glyphSize(this._taskbar.settings.get_int('icon-size')),
            this._taskbar.size - 12));
        this._content._iconSize = this._iconSize;
        this._content._edge = this._taskbar.edge;
        this._icon.icon_size = this._iconSize;
        this._applyIndicatorWidth(true);
    }

    _windows() {
        return Windows.getAppWindows(this._app, this._taskbar.windowFilter);
    }

    /** Recompute icon, indicator and tooltip from the current window set. */
    sync() {
        const windows = this._windows();
        this._windowCount = windows.length;

        if (!this._icon.gicon)
            this._icon.gicon = this._app.get_icon();

        const focused = windows.length > 0 && Windows.isAppFocused(this._app) &&
            windows.includes(global.display.focus_window);

        let state;
        if (windows.length === 0)
            state = IndicatorState.NONE;
        else if (focused)
            state = IndicatorState.ACTIVE;
        else
            state = IndicatorState.INACTIVE;

        if (state !== this._indicatorState) {
            this._indicatorState = state;
            this._applyIndicatorWidth(false);
        }

        // Windows dims the icon of a pinned app that is not running.
        this._icon.opacity = windows.length === 0 ? 255 : 255;
        this.remove_style_pseudo_class('active-app');
        if (state === IndicatorState.ACTIVE)
            this.add_style_pseudo_class('active-app');

        // Windows stacks a second outline behind the button for 2+ windows.
        if (windows.length > 1)
            this.add_style_class_name('w11-task-multi');
        else
            this.remove_style_class_name('w11-task-multi');

        this._watchAttention(windows);
        this._syncAttention(this._taskbar.settings.get_boolean('flash-attention') &&
            windows.some(win => (win.demands_attention || win.urgent) && !win.has_focus()));

        this._updateTooltip(windows);
        this._syncIconGeometry();
    }

    get attention() {
        return this._attention;
    }

    /* GNOME tells a window, not its app, that it wants attention. */
    _watchAttention(windows) {
        for (const win of windows) {
            if (this._watched.has(win))
                continue;
            this._watched.set(win, [
                win.connect('notify::demands-attention', () => this.sync()),
                win.connect('notify::urgent', () => this.sync()),
                win.connect('unmanaged', () => this._watched.delete(win)),
            ]);
        }
    }

    _syncAttention(attention) {
        if (attention === this._attention)
            return;
        this._attention = attention;
        const flash = this._flash;
        flash.remove_all_transitions();
        if (!attention) {
            flash.ease({opacity: 0, duration: duration(DURATION.fast), mode: EASE,
                onStopped: () => {
                    if (!this._attention)
                        flash.hide();
                }});
            return;
        }
        flash.show();
        const half = duration(FLASH_HALF_MS);
        if (!half) {
            flash.opacity = 255;
            return;
        }
        flash.opacity = 0;
        // Seven times dark again, and lit at the end.
        flash.ease({opacity: 255, duration: half, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: 2 * FLASH_COUNT, autoReverse: true});
    }

    _syncIconGeometry() {
        if (!this.mapped)
            return;
        const [x, y] = this._icon.get_transformed_position();
        const [width, height] = this._icon.get_transformed_size();
        if (width <= 0 || height <= 0)
            return;
        const rect = new Mtk.Rectangle({x: Math.round(x), y: Math.round(y),
            width: Math.round(width), height: Math.round(height)});
        for (const win of this._windows()) {
            if (this._taskbar.settings.get_boolean('multi-monitor') &&
                win.get_monitor() !== this._taskbar.monitorIndex)
                continue;
            if (!this._originalIconGeometry.has(win)) {
                const [valid, original] = win.get_icon_geometry();
                this._originalIconGeometry.set(win, valid ? original : null);
            }
            win.set_icon_geometry(rect);
        }
    }

    _applyIndicatorWidth(immediate) {
        const s = this._scale();
        let width;
        switch (this._indicatorState) {
        case IndicatorState.ACTIVE:
            width = INDICATOR.activeWidth * s;
            break;
        case IndicatorState.INACTIVE:
            width = INDICATOR.inactiveWidth * s;
            break;
        default:
            width = 0;
        }

        this._indicator.visible = width > 0;
        this._indicator.remove_style_pseudo_class('active');
        if (this._indicatorState === IndicatorState.ACTIVE)
            this._indicator.add_style_pseudo_class('active');

        if (!this._indicator.visible)
            return;

        // Its length runs along the bar: its width on the top or bottom,
        // its height on a side.
        const [lengthKey, thicknessKey] = this._taskbar.vertical
            ? ['height', 'width'] : ['width', 'height'];
        this._indicator[thicknessKey] = INDICATOR.thickness * s;

        // Off the stage — a button being built — there is nothing to see
        // animate, and easing the length would ask St for a style it cannot
        // compute until the button is placed.
        if (immediate || !this.mapped) {
            this._indicator.remove_all_transitions();
            this._indicator[lengthKey] = width;
            this._content?.queue_relayout();
        } else {
            // The pill grows/shrinks rather than snapping — matching the
            // 8px mid-animation width observed on Windows during activation.
            this._indicator.remove_all_transitions();
            this._indicator.ease({
                [lengthKey]: width,
                duration: duration(INDICATOR.widthTransitionMs),
                mode: EASE,
            });
        }
    }

    _updateTooltip(windows) {
        // Windows' accessible name is "<title> - <app> - N 个运行窗口 [已固定]".
        const name = this._app.get_name();
        if (windows.length === 0)
            this.accessible_name = name;
        else if (windows.length === 1)
            this.accessible_name = `${windows[0].get_title()} — ${name}`;
        else
            this.accessible_name = `${name} — ${windows.length}`;
    }

    /* ---------------------------------------------------------------- input */

    vfunc_button_press_event(event) {
        if (event.get_button() === MouseButton.SECONDARY) {
            this._cancelHoverTimeout();
            if (!this._menuOnRelease()) {
                this.emit('menu-requested');
                return Clutter.EVENT_STOP;
            }
            // Wait for the button to come back up. Opening the menu on
            // press is what breaks right-drag gestures: the application
            // never sees the drag because a menu grabbed the pointer.
            this._rightPressAt = event.get_coords();
            return Clutter.EVENT_STOP;
        }
        // GNOME 50 的 St.Button 用 ClickGesture 处理普通点击，没有父类虚函数。
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() === MouseButton.SECONDARY &&
            this._rightPressAt) {
            const [px, py] = this._rightPressAt;
            this._rightPressAt = null;
            const [x, y] = event.get_coords();
            // A release that travelled was a gesture, not a click.
            if (Math.hypot(x - px, y - py) <= DRAG_THRESHOLD)
                this.emit('menu-requested');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _menuOnRelease() {
        return this._taskbar.settings.get_boolean('context-menu-on-release');
    }

    /** Super+N and Super+T land here: activate, or launch if not running. */
    activateFromKeyboard() {
        const timestamp = global.get_current_time();
        const windows = this._windows();
        if (windows.length === 0) {
            noteLaunch(this._app, this._icon);
            this._app.activate_full(-1, timestamp);
            return;
        }
        const next = Windows.getNextWindow(this._app, this._taskbar.windowFilter);
        Windows.activateWindow(next ?? windows[0], timestamp);
    }

    vfunc_clicked(button) {
        const event = Clutter.get_current_event();
        const state = event ? event.get_state() : 0;
        const timestamp = global.get_current_time();

        this._cancelHoverTimeout();

        const windows = this._windows();
        const preview = this._taskbar.preview;

        // The decision itself lives in clickSemantics.js, where it is a pure
        // function over this state and is unit-tested without a compositor.
        const {action, windowIndex} = decide({
            button,
            ctrl: (state & Clutter.ModifierType.CONTROL_MASK) !== 0,
            shift: (state & Clutter.ModifierType.SHIFT_MASK) !== 0,
            windowCount: windows.length,
            focusedIndex: windows.indexOf(global.display.focus_window),
            previewOpen: preview.visible && preview.currentButton === this,
        });

        switch (action) {
        case Action.LAUNCH:
            noteLaunch(this._app, this._icon);
            this._app.activate_full(-1, timestamp);
            break;
        case Action.NEW_WINDOW:
            this._openNewWindow(timestamp);
            break;
        case Action.ACTIVATE:
        case Action.CYCLE:
            Windows.activateWindow(windows[windowIndex], timestamp);
            break;
        case Action.MINIMIZE:
            windows[windowIndex].minimize();
            break;
        case Action.SHOW_PREVIEW:
            this.emit('preview-requested', true);
            break;
        case Action.HIDE_PREVIEW:
            preview.dismiss();
            break;
        case Action.MENU:
            this.emit('menu-requested');
            break;
        }
    }

    _openNewWindow(timestamp) {
        noteLaunch(this._app, this._icon,
            this._app.state !== Shell.AppState.STOPPED && this._app.get_n_windows() > 0);
        // open_new_window only works once the app is running; before that
        // the normal launch path is the one that opens a window.
        if (this._app.state === Shell.AppState.STOPPED ||
            this._app.get_n_windows() === 0)
            this._app.activate_full(-1, timestamp);
        else
            this._app.open_new_window(-1);
    }

    /* --------------------------------------------------------------- hover */

    /** A little lift under the pointer. Windows' own hover is just the
     *  plate, but with nothing else moving it reads as unresponsive on a
     *  large display — Dash to Panel's icon nudge is the reference here. */
    _animateHover(hovered) {
        const scale = hovered ? HOVER_SCALE : 1.0;
        this._icon.set_pivot_point(0.5, 0.5);
        this._icon.remove_all_transitions();
        this._icon.ease({
            scale_x: scale,
            scale_y: scale,
            duration: duration(hovered ? 130 : 65),
            mode: hovered ? Clutter.AnimationMode.EASE_OUT_BACK : Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _onHoverChanged() {
        this._animateHover(this.hover);
        if (this.hover) {
            this._cancelLeaveTimeout();
            if (this._hoverTimeoutId || this._windowCount === 0)
                return;
            // A flyout already open for another button moves over at once;
            // only the first one waits for the hover time.
            const preview = this._taskbar.preview;
            if (preview?.isOpen && preview.currentButton !== this) {
                this.emit('preview-requested', false);
                return;
            }
            // Windows waits MouseHoverTime (measured: 400ms) before the
            // thumbnail flyout appears.
            this._hoverTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, TIMING.thumbnailShowDelayMs, () => {
                    this._hoverTimeoutId = 0;
                    if (this.hover)
                        this.emit('preview-requested', false);
                    return GLib.SOURCE_REMOVE;
                });
        } else {
            this._cancelHoverTimeout();
            // 只由预览保留一次跨越间隙的宽限期，不叠加两轮延迟。
            this._cancelLeaveTimeout();
            this.emit('preview-dismissed');
        }
    }

    _cancelHoverTimeout() {
        if (this._hoverTimeoutId) {
            GLib.source_remove(this._hoverTimeoutId);
            this._hoverTimeoutId = 0;
        }
    }

    _cancelLeaveTimeout() {
        if (this._leaveTimeoutId) {
            GLib.source_remove(this._leaveTimeoutId);
            this._leaveTimeoutId = 0;
        }
    }

    _onDestroy() {
        this._cancelHoverTimeout();
        this._cancelLeaveTimeout();
        this._indicator?.remove_all_transitions();
        this._flash?.remove_all_transitions();
        for (const [win, ids] of this._watched) {
            for (const id of ids)
                win.disconnect(id);
        }
        this._watched.clear();
        for (const [win, original] of this._originalIconGeometry) {
            if (win.get_compositor_private())
                win.set_icon_geometry(original);
        }
        this._originalIconGeometry.clear();
    }
});
