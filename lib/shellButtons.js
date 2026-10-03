/* shellButtons.js — the fixed controls around the task strip.
 *
 * Start, Task View, the clock and the "show desktop" sliver. Sizes come from
 * lib/spec.js; each one was measured on the real taskbar.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, duration, EASE} from './motion.js';
import {BUTTON, LAYOUT, TRAY} from './spec.js';

/** How long the pointer must rest on the sliver before the desktop shows
 *  through, and how transparent the windows go. */
const PEEK_DELAY_MS = 350;
const PEEK_OPACITY = 20;

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/** Shared by the buttons here; the setting itself lives on the taskbar,
 *  but these are built before it hands itself around. */
let _onRelease = () => true;

/**
 * Tell this module how to read the context-menu timing setting.
 *
 * @param {Function} fn returns true when menus should wait for release
 */
export function setContextMenuTiming(fn) {
    _onRelease = fn;
}

function onRelease() {
    return _onRelease();
}

/** The Start button. Measured 45x48. */
export const StartButton = GObject.registerClass({
    Signals: {'context-menu': {}},
}, class StartButton extends St.Button {
    _init() {
        super._init({
            style_class: 'w11-shell-button w11-start-button',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            child: new St.Icon({
                icon_name: 'view-app-grid-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        this.accessible_name = 'Start';
        this.updateMetrics();
    }

    updateMetrics() {
        const s = scaleFactor();
        this.set_size(LAYOUT.startButtonWidth * s, BUTTON.height * s);
    }


    // No vfunc_clicked: the panel connects to 'clicked' and opens its own
    // Start menu. Falling back to the Overview here would mean two things
    // could open at once.

    vfunc_button_press_event(event) {
        // Right-clicking Start is the other way into the Quick Link menu,
        // and the one most people reach for. Like every other context
        // menu here it waits for the release — see the task button.
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            if (!onRelease()) {
                this.emit('context-menu');
                return Clutter.EVENT_STOP;
            }
            this._rightPressAt = event.get_coords();
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
                this.emit('context-menu');
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

/** Task View. Measured 44x48 — the same cell as an app button. */
export const TaskViewButton = GObject.registerClass(
class TaskViewButton extends St.Button {
    _init() {
        super._init({
            style_class: 'w11-shell-button w11-taskview-button',
            can_focus: true,
            track_hover: true,
            child: new St.Icon({
                icon_name: 'focus-windows-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        this.accessible_name = 'Task View';
        this.updateMetrics();
    }

    updateMetrics() {
        const s = scaleFactor();
        this.set_size(LAYOUT.taskViewButtonWidth * s, BUTTON.height * s);
    }


    vfunc_clicked() {
        if (Main.overview.visible)
            Main.overview.hide();
        else
            Main.overview.show(1); // ControlsState.WINDOW_PICKER
    }
});

/** The clock. Measured 62x48, two stacked lines: time over date. */
export const Clock = GObject.registerClass(
class Clock extends St.Button {
    _init(settings, onClicked) {
        super._init({
            style_class: 'w11-shell-button w11-clock',
            can_focus: true,
            track_hover: true,
        });

        this._settings = settings;
        this._onClicked = onClicked;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(box);

        this._time = new St.Label({
            style_class: 'w11-clock-time',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._date = new St.Label({
            style_class: 'w11-clock-date',
            x_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._time);
        box.add_child(this._date);

        // GnomeDesktop's wall clock fires on every minute boundary and on
        // timezone changes, so we never poll.
        this._wallClock = new GnomeDesktop.WallClock();
        this._clockId = this._wallClock.connect('notify::clock', () => this._update());

        this._settingsId = this._settings.connect('changed::clock-show-seconds',
            () => this._restartClock());

        this.connect('destroy', () => this._onDestroy());
        this._restartClock();
        this.updateMetrics();
    }

    updateMetrics() {
        const s = scaleFactor();
        this.set_height(BUTTON.height * s);
        this.set_style(`min-width: ${TRAY.clockWidth * s}px;`);
    }

    _restartClock() {
        if (this._secondsId) {
            GLib.source_remove(this._secondsId);
            this._secondsId = 0;
        }
        if (this._settings.get_boolean('clock-show-seconds')) {
            this._secondsId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT, 1, () => {
                    this._update();
                    return GLib.SOURCE_CONTINUE;
                });
        }
        this._update();
    }

    _update() {
        const now = GLib.DateTime.new_now_local();
        const showSeconds = this._settings.get_boolean('clock-show-seconds');
        const h24 = this._settings.get_boolean('clock-24-hour');

        let timeFormat;
        if (h24)
            timeFormat = showSeconds ? '%H:%M:%S' : '%H:%M';
        else
            timeFormat = showSeconds ? '%I:%M:%S %p' : '%I:%M %p';

        this._time.text = now.format(timeFormat);
        // Windows' short date, which follows the locale.
        this._date.text = now.format(this._settings.get_string('clock-date-format') ||
            '%Y/%-m/%-d');
    }

    vfunc_clicked() {
        // 使用任务栏自己的日历；顶栏隐藏后，原生日历没有有效锚点。
        this._onClicked?.();
    }

    _onDestroy() {
        if (this._clockId) {
            this._wallClock.disconnect(this._clockId);
            this._clockId = 0;
        }
        if (this._secondsId) {
            GLib.source_remove(this._secondsId);
            this._secondsId = 0;
        }
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        this._wallClock = null;
    }
});

/** The "show desktop" sliver at the very end. Measured 12x48. */
export const ShowDesktopButton = GObject.registerClass(
class ShowDesktopButton extends St.Button {
    _init() {
        super._init({
            style_class: 'w11-shell-button w11-show-desktop',
            can_focus: true,
            track_hover: true,
        });
        this.accessible_name = 'Show desktop';
        this._minimized = [];
        this._peeked = new Map();
        this._peekTimeoutId = 0;
        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('destroy', () => this._clearPeek());
        this.updateMetrics();
    }

    /** Aero Peek.
     *
     * Resting the pointer on the sliver makes Windows fade every window
     * out so the desktop shows through, and bring them back on leaving.
     * This is the other half of the control — the click already
     * minimises and restores — and it is what makes the sliver useful
     * rather than a stray 12px of nothing. */
    _onHoverChanged() {
        if (this.hover) {
            if (this._peekTimeoutId)
                return;
            this._peekTimeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT, PEEK_DELAY_MS, () => {
                    this._peekTimeoutId = 0;
                    if (this.hover)
                        this._startPeek();
                    return GLib.SOURCE_REMOVE;
                });
        } else {
            if (this._peekTimeoutId) {
                GLib.source_remove(this._peekTimeoutId);
                this._peekTimeoutId = 0;
            }
            this._clearPeek();
        }
    }

    _startPeek() {
        const workspace = global.workspace_manager.get_active_workspace();
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            if (!win || win.skip_taskbar || !actor.visible)
                continue;
            if (!win.is_on_all_workspaces() && win.get_workspace() !== workspace)
                continue;
            this._peeked.set(actor, actor.opacity);
            actor.remove_all_transitions();
            actor.ease({
                opacity: PEEK_OPACITY,
                duration: duration(DURATION.normal),
                mode: EASE,
            });
        }
    }

    _clearPeek() {
        for (const [actor, opacity] of this._peeked) {
            if (!actor.get_parent())
                continue;
            actor.remove_all_transitions();
            actor.ease({
                opacity,
                duration: duration(DURATION.normal),
                mode: EASE,
            });
        }
        this._peeked.clear();
    }

    updateMetrics() {
        const s = scaleFactor();
        this.set_size(TRAY.showDesktopWidth * s, BUTTON.height * s);
    }

    vfunc_clicked() {
        // Drop the peek first: restoring its opacities afterwards would
        // fight whatever the click does.
        this._clearPeek();

        // Windows toggles: the first click minimises everything, the second
        // restores exactly what it minimised.
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = workspace.list_windows()
            .filter(w => !w.skip_taskbar && !w.minimized);

        if (windows.length > 0) {
            this._minimized = windows;
            for (const win of windows)
                win.minimize();
        } else {
            for (const win of this._minimized) {
                if (win.get_compositor_private())
                    win.unminimize();
            }
            this._minimized = [];
        }
    }
});
