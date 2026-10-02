/* taskButton.js — one app button, with Windows 11 click semantics.
 *
 * Geometry and state colours come from lib/spec.js, which records what was
 * measured on a real Windows 11 taskbar. The behaviour below reproduces what
 * Windows does for each gesture; each branch cites the Windows rule it mirrors.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Action, Button as MouseButton, decide} from './clickSemantics.js';
import {DURATION, duration, EASE} from './motion.js';
import {BUTTON, INDICATOR, TIMING} from './spec.js';
import * as Windows from './windows.js';

/**
 * The inside of a task button, laid out by hand.
 *
 * Clutter's BinLayout does not honour a child's x_align/y_align here, so the
 * three pieces are placed explicitly against the measured Windows geometry:
 * the plate inset 2px in the 44x48 cell, the 24x24 icon dead centre, and the
 * indicator pill centred horizontally with its bottom 5px above the taskbar
 * edge (measured rows y=40..42 of 48).
 */
const ButtonContent = GObject.registerClass(
class ButtonContent extends St.Widget {
    _init(plate, icon, indicator) {
        super._init({x_expand: true, y_expand: true});
        this._plate = plate;
        this._icon = icon;
        this._indicator = indicator;
        this.add_child(plate);
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

        const iconSize = iconPx * s;
        place(this._icon, (w - iconSize) / 2, (h - iconSize) / 2, iconSize, iconSize);

        if (this._indicator.visible) {
            const iw = this._indicator.width;
            const ih = INDICATOR.thickness * s;
            place(this._indicator, (w - iw) / 2,
                h - INDICATOR.bottomOffset * s - ih, iw, ih);
        }
    }
});

/** How far the icon grows under the pointer. */
const HOVER_SCALE = 1.12;

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

        this._plate = new St.Widget({style_class: 'w11-task-plate'});
        this._icon = new St.Icon({style_class: 'w11-task-icon'});
        this._indicator = new St.Widget({style_class: 'w11-task-indicator'});

        this._content = new ButtonContent(this._plate, this._icon, this._indicator);
        this.set_child(this._content);

        this.connect('notify::hover', () => this._onHoverChanged());
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
        const s = this._scale();
        this.set_size(BUTTON.width * s, BUTTON.height * s);
        // Measured at 24, but adjustable: on a dense display the measured
        // size can look sparse, and this is cheaper than arguing with it.
        this._iconSize = this._taskbar.settings.get_int('icon-size');
        this._content._iconSize = this._iconSize;
        this._icon.icon_size = this._iconSize;
        this._indicator.set_height(INDICATOR.thickness * s);
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

        this._updateTooltip(windows);
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

        if (immediate) {
            this._indicator.set_width(width);
            this._content?.queue_relayout();
        } else {
            // The pill grows/shrinks rather than snapping — matching the
            // 8px mid-animation width observed on Windows during activation.
            this._indicator.remove_all_transitions();
            this._indicator.ease({
                width,
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
        // Windows opens the jump list on press, not on release.
        if (event.get_button() === MouseButton.SECONDARY) {
            this._cancelHoverTimeout();
            this.emit('menu-requested');
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_button_press_event(event);
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
            duration: duration(DURATION.fast),
            mode: EASE,
        });
    }

    _onHoverChanged() {
        this._animateHover(this.hover);
        if (this.hover) {
            this._cancelLeaveTimeout();
            if (this._hoverTimeoutId || this._windowCount === 0)
                return;
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
            // Give the pointer time to travel from the button into the popup.
            this._cancelLeaveTimeout();
            this._leaveTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, TIMING.thumbnailHideDelayMs, () => {
                    this._leaveTimeoutId = 0;
                    this.emit('preview-dismissed');
                    return GLib.SOURCE_REMOVE;
                });
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
    }
});
