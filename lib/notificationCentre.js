/* notificationCentre.js — the panel Windows opens from the clock.
 *
 * Windows 11 splits what Windows 10 called the Action Centre in two: quick
 * settings on the network/volume/battery glyphs, notifications and the
 * calendar on the clock. This is the second one — measured at 338 wide,
 * running nearly the full height of the screen against the right edge.
 *
 * It is our own panel rather than GNOME's date menu, after trying hard to
 * reuse that one. The problem is structural: the date menu lives in the
 * top bar, which we hide, and a menu cannot open from a hidden actor.
 * Every way of keeping it mapped-but-invisible failed — zero width and
 * clipping still painted the clock label, moving it off-screen dragged its
 * menu off-screen with it, and zero opacity is undone by the shell itself,
 * which makes the panel visible whenever one of its menus opens.
 *
 * The parts inside are still GNOME's: Calendar and CalendarMessageList are
 * ordinary widgets, and instantiating them directly is exactly what the
 * date menu does.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {NotificationList} from './notificationList.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, SLIDE, slideIn, slideOut} from './motion.js';
import {FLYOUT} from './spec.js';

/** Enough for a six-week month plus the header row. */
const CALENDAR_HEIGHT = 300;
import {applyThemeClass} from './theme.js';

export const NotificationCentre = GObject.registerClass(
class NotificationCentre extends St.Widget {
    _init(taskbar) {
        super._init({
            style_class: 'w11-notification-centre',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            can_focus: true,
            visible: false,
            opacity: 0,
        });

        this._taskbar = taskbar;
        this._modal = null;
        this._isOpen = false;
        this._dismissIdleId = 0;

        this._panel = new St.BoxLayout({
            style_class: 'w11-notification-panel',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._panel);

        // Notifications first, calendar underneath — Windows' order, and
        // the reason this is a column rather than GNOME's two columns.
        this._messageList = new NotificationList();
        this._messageList.x_expand = true;
        this._panel.add_child(this._messageList);

        this._dateLabel = new St.Label({
            style_class: 'w11-notification-date',
            x_align: Clutter.ActorAlign.START,
        });
        this._panel.add_child(this._dateLabel);

        this._calendar = new Calendar.Calendar();
        this._calendar.x_expand = true;
        this._calendar.layout_manager.set_column_homogeneous(true);
        const stretch = child => {
            child.x_expand = true;
            child.x_align = Clutter.ActorAlign.FILL;
        };
        this._calendar.connect('child-added', (_calendar, child) => stretch(child));
        this._calendar.get_children().forEach(stretch);
        // Without an event source the calendar never populates: the grid
        // and the month label both stay blank. Until the panel is first
        // opened it has an empty one; see _ensureEventSource().
        this._eventSource = null;
        this._calendar.setEventSource(new Calendar.EmptyEventSource());
        this._panel.add_child(this._calendar);

        Main.layoutManager.addChrome(this);
        applyThemeClass(this);
        this.connect('captured-event', (_actor, event) => this._onCapturedEvent(event));
        this.connect('destroy', () => this._onDestroy());
    }

    get isOpen() {
        return this._isOpen;
    }

    /**
     * The D-Bus source, which shows real appointments as the date menu's
     * does. It reaches the calendar server asynchronously, and GNOME's
     * source cannot be destroyed while that is under way — the reply then
     * lands on disposed objects — so it is made on first open rather than
     * when the extension is enabled, which may be just before it is
     * disabled again or the session ends.
     */
    _ensureEventSource() {
        if (this._eventSource)
            return;
        this._eventSource = new Calendar.DBusEventSource();
        this._calendar.setEventSource(this._eventSource);
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen)
            return;
        const reversing = this.visible;
        this._isOpen = true;

        if (Main.overview.visible)
            Main.overview.hide();

        this._ensureEventSource();
        const now = new Date();
        this._calendar.setDate(now);
        this._dateLabel.text = now.toLocaleDateString(undefined, {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });

        applyThemeClass(this);
        this.visible = true;
        this._reposition();
        this._taskbar.holdVisible(true);

        slideIn(this, {
            from: this._taskbar.isBottom ? SLIDE : -SLIDE,
            ms: DURATION.emphasized,
            fromCurrent: reversing,
        });

        this._modal = Main.pushModal(this, {
            actionMode: Shell.ActionMode.POPUP,
        });
        // A modal grab with nowhere to send key events routes them back
        // here, and the first one closes the panel again. Taking focus
        // gives the grab a target.
        global.stage.set_key_focus(this);

        // Ignore the press that is still in flight from the click that
        // opened us; without this it lands on the backdrop handler below
        // and shuts the panel immediately.
        this._acceptsDismiss = false;
        this._dismissIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._dismissIdleId = 0;
            this._acceptsDismiss = this._isOpen;
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;
        this._acceptsDismiss = false;
        if (this._dismissIdleId) {
            GLib.source_remove(this._dismissIdleId);
            this._dismissIdleId = 0;
        }

        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        this._taskbar.holdVisible(false);
        slideOut(this, {
            to: this._taskbar.isBottom ? SLIDE / 2 : -SLIDE / 2,
            onComplete: () => {
                if (!this._isOpen)
                    this.visible = false;
            },
        });
    }

    _reposition() {
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const monitor = Main.layoutManager.monitors[this._taskbar.monitorIndex] ??
            Main.layoutManager.primaryMonitor;

        // Measured: 338 wide, 12px from the right edge, 8px from the top,
        // 7px above the taskbar.
        const width = FLYOUT.notificationWidth * s;
        const margin = FLYOUT.edgeMargin * s;
        const top = FLYOUT.notificationTopMargin * s;
        const gap = FLYOUT.notificationGap * s;
        const bar = this._taskbar.height;

        // get_preferred_height on the calendar is unreliable before it has
        // been laid out once — it comes back far too small and the grid
        // ends up clipped — so reserve the space a six-week month needs.
        const calH = CALENDAR_HEIGHT * s;
        this._calendar.set_height(Math.round(calH));

        // Both children have to be told the content width. Left to
        // themselves the message list reserves room for a scrollbar and
        // the calendar sizes to its own idea of a month, which is what
        // leaves a strip of empty panel down the right-hand side.
        const inner = width - 26 * s;
        this._messageList.set_width(Math.round(inner));
        this._calendar.set_width(Math.round(inner));
        const [, dateH] = this._dateLabel.get_preferred_height(inner);
        const chrome = 24 * s + 16 * s; // panel padding plus two gaps

        // Take the height from what is actually in the panel, up to the
        // screen. A full-height column with two notifications in it looks
        // wrong, and Windows does not do that either. Whatever is left
        // after the calendar goes to the list, so a long list scrolls
        // inside the panel instead of pushing it off-screen.
        this._messageList.set_height(-1);
        const [, listNat] = this._messageList.get_preferred_height(inner);
        const floor = calH + dateH + chrome;
        const available = monitor.height - bar - top - gap;
        const height = Math.min(Math.max(listNat + floor, floor), available);
        this._messageList.set_height(
            Math.max(0, Math.round(height - floor)));

        this.set_size(Math.round(width), Math.round(height));
        // Windows anchors it to the taskbar end, so a short panel sits at
        // the bottom rather than floating at the top of the screen.
        this.set_position(
            Math.round(monitor.x + monitor.width - width - margin),
            Math.round(this._taskbar.isBottom
                ? monitor.y + monitor.height - bar - gap - height
                : monitor.y + bar + top));
    }

    _onCapturedEvent(event) {
        if (!this._isOpen)
            return Clutter.EVENT_STOP;
        if (event.type() === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (event.type() !== Clutter.EventType.BUTTON_PRESS || !this._acceptsDismiss)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        if (target && (target === this._panel || this._panel.contains(target)))
            return Clutter.EVENT_PROPAGATE;
        this.close();
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        if (this._dismissIdleId)
            GLib.source_remove(this._dismissIdleId);
        this._dismissIdleId = 0;
        this._eventSource?.destroy?.();
        this._eventSource = null;
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        Main.layoutManager.removeChrome(this);
    }
});
