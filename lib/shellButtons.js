/* shellButtons.js — the fixed controls around the task strip.
 *
 * Start, Task View, the clock and the "show desktop" sliver. Sizes come from
 * lib/spec.js; each one was measured on the real taskbar.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, duration, EASE} from './motion.js';
import {LAYOUT, SEARCH, TRAY} from './spec.js';
import {clearWindowPeek, setWindowPeek} from './windowPeek.js';

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

let _gettext = s => s;

/**
 * Install the gettext function the labels here use.
 *
 * @param {Function} fn gettext
 */
export function setGettext(fn) {
    _gettext = fn;
}

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

/* What Start shows: what Ubuntu's own dock shows on its Show Apps button
 * — the session's app-grid icon, which in the Ubuntu session with Ubuntu's
 * icons is Ubuntu's logo — and GNOME's grid of dots wherever there is no
 * such icon, as there. Not start-here: Adwaita draws GNOME's foot there. */
function startIcon() {
    return new Gio.ThemedIcon({names: [
        `view-app-grid-${Main.sessionMode.currentMode}-symbolic`,
        'view-app-grid-symbolic',
    ]});
}

/** The Start button. Measured 45x48. */
export const StartButton = GObject.registerClass({
    Signals: {'context-menu': {}},
}, class StartButton extends St.Button {
    _init(bar) {
        super._init({
            style_class: 'w11-shell-button w11-start-button',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            child: new St.Icon({
                gicon: startIcon(),
                style_class: 'w11-start-icon',
            }),
        });
        this.accessible_name = 'Start';
        this._bar = bar;
        this.updateMetrics();
    }

    updateMetrics() {
        this.set_size(...this._bar.cellSize(LAYOUT.startButtonWidth, true));
        this.child.icon_size = this._bar.glyphSize(LAYOUT.startIconSize);
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
    _init(bar) {
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
        this._bar = bar;
        this.updateMetrics();
    }

    updateMetrics() {
        this.set_size(...this._bar.cellSize(LAYOUT.taskViewButtonWidth, true));
        this.child.icon_size = this._bar.glyphSize(LAYOUT.taskViewIconSize);
    }


    vfunc_clicked() {
        if (Main.overview.visible)
            Main.overview.hide();
        else
            Main.overview.show(1); // ControlsState.WINDOW_PICKER
    }
});

/** Search, in the styles the taskbar settings offer (SEARCH in spec.js):
 *  none, the icon, the icon and its label, the box. Only the icon fits
 *  across a bar standing on a side. The panel opens Start on a click, its
 *  search box taking the keys as it opens. */
export const SearchButton = GObject.registerClass(
class SearchButton extends St.Button {
    _init(bar) {
        super._init({
            style_class: 'w11-shell-button w11-search-button',
            can_focus: true,
            track_hover: true,
        });
        this._bar = bar;
        this._glyph = new St.Icon({
            icon_name: 'system-search-symbolic',
            style_class: 'w11-shell-icon w11-search-glyph',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            text: _gettext('Search'),
            style_class: 'w11-search-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        // The pill is drawn round what it holds: the glyph and the label,
        // centred, or at its start in the box.
        this._content = new St.BoxLayout({style_class: 'w11-search-content', y_expand: true});
        this._content.add_child(this._glyph);
        this._content.add_child(this._label);
        this._pill = new St.Bin({
            style_class: 'w11-search-pill',
            child: this._content,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(this._pill);
        this.accessible_name = _gettext('Search');
        this._style = 'box';
        this.updateMetrics();
    }

    /**
     * Show it in one of the taskbar settings' styles.
     *
     * @param {string} style 'hidden', 'icon', 'icon-label' or 'box'
     */
    setStyle(style) {
        this._style = style;
        this.updateMetrics();
    }

    /** The style shown: the one chosen, or the icon across a side bar. */
    get style() {
        return this._style !== 'hidden' && this._bar.vertical ? 'icon' : this._style;
    }

    updateMetrics() {
        const style = this.style;
        this.visible = style !== 'hidden';
        if (!this.visible)
            return;
        for (const name of ['icon', 'icon-label', 'box']) {
            if (name === style)
                this.add_style_class_name(`w11-search-${name}`);
            else
                this.remove_style_class_name(`w11-search-${name}`);
        }
        const spec = SEARCH[style];
        const s = scaleFactor();
        // The icon's cell is nearly square, as Task View's; the label and
        // the box keep their lengths on any bar.
        this.set_size(...this._bar.cellSize(spec.width, style === 'icon'));
        this._glyph.icon_size = this._bar.glyphSize(spec.glyph);
        this._label.visible = style !== 'icon';
        this._content.x_align = style === 'box' ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
        this._content.x_expand = style === 'box';
        if (spec.pill)
            this._pill.set_size(spec.pill * s, this._bar.glyphSize(SEARCH.pillHeight) * s);
        else
            this._pill.set_size(-1, -1);
    }
});

/** The clock. Measured 62x48, two stacked lines: time over date. */
export const Clock = GObject.registerClass(
class Clock extends St.Button {
    _init(bar, onClicked) {
        super._init({
            style_class: 'w11-shell-button w11-clock',
            can_focus: true,
            track_hover: true,
        });

        this._bar = bar;
        this._settings = bar.settings;
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
        // On a bar standing on a side, "6:19 AM" goes onto two lines.
        this._time.clutter_text.line_wrap = true;
        this._time.clutter_text.ellipsize = 0; // Pango.EllipsizeMode.NONE
        this.connect('notify::mapped', () => {
            if (this.mapped)
                this._update();
        });

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
        if (this._bar.vertical) {
            // Upright, the bar is as wide as the clock gets: the two lines
            // stack in its width, and the cell is as tall as they are.
            this.set_size(this._bar.thickness, -1);
            this.set_style(null);
        } else {
            this.set_size(-1, this._bar.thickness);
            // St 的 min-width 是内容宽度，padding 另加；CSS 像素还会自行按主题缩放。
            this.set_style(`min-width: ${TRAY.clockWidth - TRAY.clockPadding * 2}px;`);
        }
        this._update?.();
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
        // Windows' short date, which follows the locale. A bar on a side
        // narrower than the date drops the year, as Windows 10's did.
        const format = this._settings.get_string('clock-date-format') || '%Y/%-m/%-d';
        this._date.text = now.format(format);
        // Only measured on the stage, where it has a theme to measure with.
        if (this._bar.vertical && this._date.get_stage() &&
            this._date.get_preferred_width(-1)[1] >
            this._bar.thickness - TRAY.clockPadding * scaleFactor())
            this._date.text = now.format('%-m/%-d');
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
    _init(bar) {
        super._init({
            style_class: 'w11-shell-button w11-show-desktop',
            can_focus: true,
            track_hover: true,
        });
        this.accessible_name = 'Show desktop';
        this._bar = bar;
        // St.Button 的单边框未可靠绘制；分隔线是独立的非交互子演员。
        this._line = new St.Widget({style_class: 'w11-show-desktop-line', reactive: false});
        this.set_child(this._line);
        this._minimized = [];
        this._peekTimeoutId = 0;
        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('destroy', () => {
            if (this._peekTimeoutId)
                GLib.source_remove(this._peekTimeoutId);
            this._peekTimeoutId = 0;
            clearWindowPeek(this, true);
        });
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
        const actors = global.get_window_actors().filter(actor => {
            const win = actor.meta_window;
            return win && !win.skip_taskbar && actor.visible &&
                (win.is_on_all_workspaces() || win.get_workspace() === workspace);
        });
        setWindowPeek(this, actors, PEEK_OPACITY);
    }

    _clearPeek() {
        clearWindowPeek(this);
    }

    updateMetrics() {
        this.set_size(...this._bar.cellSize(TRAY.showDesktopWidth));
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const s = scaleFactor();
        const [width, height] = box.get_size();
        const line = TRAY.showDesktopLineWidth * s;
        const span = this._bar.vertical ? width : height;
        const inset = Math.min(TRAY.showDesktopLineInset * s, Math.max(0, (span - line) / 2));
        this._line.allocate(this._bar.vertical
            ? new Clutter.ActorBox({x1: inset, y1: 0, x2: width - inset, y2: line})
            : new Clutter.ActorBox({x1: 0, y1: inset, x2: line, y2: height - inset}));
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
