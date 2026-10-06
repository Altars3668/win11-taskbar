/* autoHide.js — Windows' "automatically hide the taskbar".
 *
 * Windows slides the bar off the screen edge and brings it back when the
 * pointer pushes against that edge. It also keeps the bar out while it has
 * no reason to show: it does not pop up merely because the pointer passed
 * by, which is why we use a pressure barrier rather than a plain hot edge.
 *
 * The bar stays out while the pointer is over it, while one of its menus is
 * open, and while an app is asking for attention.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Layout from 'resource:///org/gnome/shell/ui/layout.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, duration, EASE} from './motion.js';

/** How hard the pointer must push into the edge, in pixels of travel. */
const PRESSURE_THRESHOLD = 60;
const PRESSURE_TIMEOUT_MS = 1000;



/** How long the bar lingers after the pointer leaves. */
const LINGER_MS = 350;

export class AutoHide {
    constructor(taskbar) {
        this._taskbar = taskbar;
        this._enabled = false;
        this._shown = true;
        this._lingerId = 0;
        this._barrier = null;
        this._pressure = null;

        this._hoverId = taskbar.connect('notify::hover',
            () => this._onHoverChanged());
    }

    /** Turn the behaviour on or off and put the bar in the right place. */
    setEnabled(enabled) {
        if (enabled === this._enabled) {
            if (enabled)
                this._rebuildBarrier();
            return;
        }
        this._enabled = enabled;

        if (enabled) {
            this._rebuildBarrier();
            this._hide();
        } else {
            this._destroyBarrier();
            this._show(true);
        }
    }

    /** Called when the monitor geometry changed. */
    relayout() {
        if (!this._enabled)
            return;
        this._rebuildBarrier();
        // Re-apply the current slide against the new geometry.
        if (this._shown)
            this._show(true);
        else
            this._hide(true);
    }

    /** Keep the bar out while a menu or preview is open. */
    hold(held) {
        this._held = held;
        if (held)
            this._show();
        else
            this._scheduleHide();
    }

    /* ------------------------------------------------------------ private */

    get _monitor() {
        return Main.layoutManager.monitors[this._taskbar.monitorIndex];
    }

    /* The bar slides across itself: up and down along the top or the
     * bottom, sideways on a side. */
    get _axis() {
        return this._taskbar.vertical ? 'x' : 'y';
    }

    _restPosition() {
        const monitor = this._monitor;
        if (!monitor)
            return 0;
        const thickness = this._taskbar.thickness;
        switch (this._taskbar.edge) {
        case 'top':
            return monitor.y;
        case 'left':
            return monitor.x;
        case 'right':
            return monitor.x + monitor.width - thickness;
        default:
            return monitor.y + monitor.height - thickness;
        }
    }

    _hiddenPosition() {
        const monitor = this._monitor;
        if (!monitor)
            return 0;
        // Leave one pixel on screen so the barrier always has something to
        // sit against and the bar never looks like it vanished entirely.
        const thickness = this._taskbar.thickness;
        switch (this._taskbar.edge) {
        case 'top':
            return monitor.y - thickness + 1;
        case 'left':
            return monitor.x - thickness + 1;
        case 'right':
            return monitor.x + monitor.width - 1;
        default:
            return monitor.y + monitor.height - 1;
        }
    }

    _moveTo(value, immediate) {
        this._taskbar.remove_all_transitions();
        if (immediate)
            this._taskbar[this._axis] = value;
        else
            this._taskbar.ease({[this._axis]: value, duration: duration(DURATION.normal),
                mode: EASE});
    }

    _show(immediate = false) {
        this._cancelLinger();
        this._shown = true;
        this._moveTo(this._restPosition(), immediate);
    }

    _hide(immediate = false) {
        if (this._held)
            return;
        this._cancelLinger();
        this._shown = false;
        this._moveTo(this._hiddenPosition(), immediate);
    }

    _scheduleHide() {
        if (!this._enabled)
            return;
        this._cancelLinger();
        this._lingerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LINGER_MS, () => {
            this._lingerId = 0;
            if (!this._taskbar.hover && !this._held)
                this._hide();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelLinger() {
        if (this._lingerId) {
            GLib.source_remove(this._lingerId);
            this._lingerId = 0;
        }
    }

    _onHoverChanged() {
        if (!this._enabled)
            return;
        if (this._taskbar.hover)
            this._show();
        else
            this._scheduleHide();
    }

    _rebuildBarrier() {
        this._destroyBarrier();
        const monitor = this._monitor;
        if (!monitor)
            return;

        // Along the screen edge the bar is on; the pointer may leave it
        // towards the middle of the screen.
        const right = monitor.x + monitor.width;
        const bottom = monitor.y + monitor.height;
        const lines = {
            top: [monitor.x, monitor.y, right, monitor.y, Meta.BarrierDirection.POSITIVE_Y],
            bottom: [monitor.x, bottom, right, bottom, Meta.BarrierDirection.NEGATIVE_Y],
            left: [monitor.x, monitor.y, monitor.x, bottom, Meta.BarrierDirection.POSITIVE_X],
            right: [right, monitor.y, right, bottom, Meta.BarrierDirection.NEGATIVE_X],
        };
        const [x1, y1, x2, y2, directions] = lines[this._taskbar.edge] ?? lines.bottom;
        this._barrier = new Meta.Barrier({
            backend: global.backend, x1, y1, x2, y2, directions,
        });

        this._pressure = new Layout.PressureBarrier(
            PRESSURE_THRESHOLD, PRESSURE_TIMEOUT_MS,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW);
        this._pressure.setBarrierThresholds?.(PRESSURE_THRESHOLD, PRESSURE_THRESHOLD);
        this._pressure.addBarrier(this._barrier);
        this._pressure.connect('trigger', () => this._show());
    }

    _destroyBarrier() {
        if (this._pressure) {
            if (this._barrier)
                this._pressure.removeBarrier(this._barrier);
            this._pressure.destroy();
            this._pressure = null;
        }
        if (this._barrier) {
            this._barrier.destroy();
            this._barrier = null;
        }
    }

    destroy() {
        this._cancelLinger();
        this._destroyBarrier();
        if (this._hoverId) {
            this._taskbar.disconnect(this._hoverId);
            this._hoverId = 0;
        }
    }
}
