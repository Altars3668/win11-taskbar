/* windowPreview.js — the thumbnail flyout Windows shows above a task button.
 *
 * Windows draws a rounded panel centred over the button, holding one live
 * thumbnail per window, each captioned with the window icon, its title and a
 * close button. Hovering a thumbnail peeks at that window; clicking it
 * activates it; middle-clicking or hitting the X closes it.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** A thumbnail flyout is close to the bar, so it travels less than the
 *  Start menu does. */
const SLIDE_SHORT = 10;

import {DURATION, duration, EASE, slideIn, slideOut} from './motion.js';
import {THUMBNAIL, TIMING} from './spec.js';
import * as Windows from './windows.js';

/** One thumbnail: live window content plus its caption row. */
const Thumbnail = GObject.registerClass({
    Signals: {
        'activated': {},
        'closed': {},
        'peek-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class Thumbnail extends St.Button {
    _init(window, app) {
        super._init({
            style_class: 'w11-thumb',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
        });

        this._window = window;
        this._peeked = false;

        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this.set_child(box);

        const header = new St.BoxLayout({style_class: 'w11-thumb-header'});
        box.add_child(header);

        header.add_child(new St.Icon({
            gicon: app.get_icon(),
            icon_size: 16,
            style_class: 'w11-thumb-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this._label = new St.Label({
            text: window.get_title() ?? app.get_name(),
            style_class: 'w11-thumb-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        header.add_child(this._label);

        this._closeButton = new St.Button({
            style_class: 'w11-thumb-close',
            child: new St.Icon({
                icon_name: 'window-close-symbolic',
                style_class: 'w11-thumb-close-icon',
            }),
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._closeButton.connect('clicked', () => {
            this._window.delete(global.get_current_time());
            this.emit('closed');
        });
        header.add_child(this._closeButton);

        this._cloneBin = new St.Widget({
            style_class: 'w11-thumb-content',
            layout_manager: new Clutter.BinLayout(),
        });
        box.add_child(this._cloneBin);
        this._buildClone();

        this._titleId = window.connect('notify::title',
            () => (this._label.text = window.get_title() ?? ''));

        this.connect('notify::hover', () => this._onHover());
        this.connect('destroy', () => this._onDestroy());
    }

    get window() {
        return this._window;
    }

    _buildClone() {
        const actor = this._window.get_compositor_private();
        if (!actor)
            return;

        const [sw, sh] = actor.get_size();
        if (sw <= 0 || sh <= 0)
            return;

        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const maxW = THUMBNAIL.maxWidth * scale;
        const maxH = THUMBNAIL.maxHeight * scale;
        const factor = Math.min(maxW / sw, maxH / sh, 1);

        this._clone = new Clutter.Clone({
            source: actor,
            width: Math.round(sw * factor),
            height: Math.round(sh * factor),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cloneBin.add_child(this._clone);
    }

    /** Aero Peek: while the pointer rests on a thumbnail, Windows reveals that
     *  window and fades the others out. The flyout owns the actual fading so
     *  that only one peek can be active at a time. */
    _onHover() {
        if (this.hover === this._peeked)
            return;
        this._peeked = this.hover;
        this.emit('peek-changed', this._peeked);
    }

    vfunc_clicked(button) {
        if (button === Clutter.BUTTON_MIDDLE) {
            this._window.delete(global.get_current_time());
            this.emit('closed');
            return;
        }
        Windows.activateWindow(this._window, global.get_current_time());
        this.emit('activated');
    }

    _onDestroy() {
        if (this._titleId) {
            this._window.disconnect(this._titleId);
            this._titleId = 0;
        }
    }
});

/** The flyout panel itself. One instance is reused for every button. */
export const WindowPreview = GObject.registerClass(
class WindowPreview extends St.Widget {
    _init(taskbar) {
        super._init({
            style_class: 'w11-preview',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            visible: false,
            opacity: 0,
        });

        this._taskbar = taskbar;
        this._button = null;
        this._hideTimeoutId = 0;
        this._stageEventId = 0;
        this._peekWindow = null;
        this._peeked = new Map();

        this._box = new St.BoxLayout({
            style_class: 'w11-preview-box',
            orientation: Clutter.Orientation.HORIZONTAL,
        });
        this.add_child(this._box);

        // No trackFullscreen here: the layout manager forces visible=true on
        // actors it tracks for fullscreen, which would reveal the empty popup.
        Main.layoutManager.addChrome(this);

        this.connect('notify::hover', () => {
            if (this.hover)
                this._cancelHide();
            else
                this.scheduleHide();
        });
        this.connect('destroy', () => this._onDestroy());
    }

    get currentButton() {
        return this._button;
    }

    /**
     * Show the flyout for a button's app.
     *
     * @param {object} button the TaskButton the pointer is on
     * @param {Shell.App} app the app whose windows to show
     */
    show(button, app) {
        this._cancelHide();

        const windows = Windows.getAppWindows(app, this._taskbar.windowFilter);
        if (windows.length === 0) {
            this.hide();
            return;
        }

        // Rebuild only when the button or the window set changed, so that a
        // re-hover over the same button does not restart the clones.
        const signature = `${button}:${windows.map(w => w.get_id()).join(',')}`;
        if (signature !== this._signature) {
            this._signature = signature;
            this._box.destroy_all_children();
            for (const win of windows) {
                const thumb = new Thumbnail(win, app);
                thumb.connect('peek-changed', (t, on) => this._setPeek(on ? t.window : null));
                thumb.connect('activated', () => this.dismiss());
                thumb.connect('closed', () => {
                    // Let the window actually go away before we re-measure.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (this._button)
                            this.show(this._button, this._button.app);
                        return GLib.SOURCE_REMOVE;
                    });
                });
                this._box.add_child(thumb);
            }
        }

        this._button = button;
        this.visible = true;
        this._taskbar.holdVisible(true);
        this._reposition(button);

        slideIn(this, {
            from: this._taskbar.isBottom ? SLIDE_SHORT : -SLIDE_SHORT,
        });

        this._connectStageWatcher();
    }

    _reposition(button) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [bx, by] = button.get_transformed_position();
        const bw = button.allocation.get_width();

        // Measure before placing: the box grows with the number of thumbnails.
        const [, natW] = this.get_preferred_width(-1);
        const [, natH] = this.get_preferred_height(natW);

        const monitor = Main.layoutManager.findMonitorForActor(button) ??
                        Main.layoutManager.primaryMonitor;

        // Windows centres the flyout on the button and clamps it to the screen.
        let x = Math.round(bx + bw / 2 - natW / 2);
        x = Math.max(monitor.x + THUMBNAIL.spacing * scale,
            Math.min(x, monitor.x + monitor.width - natW - THUMBNAIL.spacing * scale));

        const gap = THUMBNAIL.offsetFromPanel * scale;
        const y = this._taskbar.isBottom
            ? by - natH - gap
            : by + button.allocation.get_height() + gap;

        this.set_position(x, Math.round(y));
    }

    /** Start the grace period before hiding, so the pointer can cross the gap. */
    scheduleHide() {
        this._cancelHide();
        this._hideTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, TIMING.thumbnailHideDelayMs, () => {
                this._hideTimeoutId = 0;
                if (!this.hover && !this._button?.hover)
                    this.dismiss();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelHide() {
        if (this._hideTimeoutId) {
            GLib.source_remove(this._hideTimeoutId);
            this._hideTimeoutId = 0;
        }
    }

    /** Aero Peek. Fade every other window out so the hovered one stands alone,
     *  exactly as Windows does while the pointer rests on a thumbnail. The
     *  faded actors are tracked so they are always restored, including if the
     *  extension is disabled mid-peek. */
    _setPeek(window) {
        if (this._peekWindow === window)
            return;
        this._peekWindow = window;
        this._clearPeek();

        if (!window || !this._taskbar.settings.get_boolean('aero-peek'))
            return;

        const target = window.get_compositor_private();
        if (!target)
            return;

        for (const actor of global.get_window_actors()) {
            if (actor === target || !actor.visible)
                continue;
            const win = actor.meta_window;
            if (win?.is_on_all_workspaces() === false &&
                win.get_workspace() !== global.workspace_manager.get_active_workspace())
                continue;
            this._peeked.set(actor, actor.opacity);
            actor.remove_all_transitions();
            actor.ease({
                opacity: 0,
                duration: duration(DURATION.normal),
                mode: EASE,
            });
        }
    }

    _clearPeek() {
        for (const [actor, opacity] of this._peeked) {
            if (actor.get_parent() === null)
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

    /** Hide immediately. */
    dismiss() {
        this._setPeek(null);
        this._cancelHide();
        this._taskbar.holdVisible(false);
        this._disconnectStageWatcher();
        if (!this.visible)
            return;
        slideOut(this, {
            to: this._taskbar.isBottom ? SLIDE_SHORT / 2 : -SLIDE_SHORT / 2,
            onComplete: () => {
                this.visible = false;
                this._button = null;
                this._signature = null;
                this._box.destroy_all_children();
            },
        });
    }

    _connectStageWatcher() {
        if (this._stageEventId)
            return;
        this._stageEventId = global.stage.connect('captured-event', (actor, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const target = event.get_source();
            if (this.contains(target) || this._button?.contains(target))
                return Clutter.EVENT_PROPAGATE;
            this.dismiss();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _disconnectStageWatcher() {
        if (this._stageEventId) {
            global.stage.disconnect(this._stageEventId);
            this._stageEventId = 0;
        }
    }

    _onDestroy() {
        this._clearPeek();
        this._cancelHide();
        this._disconnectStageWatcher();
        Main.layoutManager.removeChrome(this);
    }
});
