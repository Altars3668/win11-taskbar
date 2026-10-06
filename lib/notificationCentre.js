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

import {placeAtEnd} from './barEdge.js';
import {DURATION, SLIDE, slideIn, slideOut} from './motion.js';
import {passOnRightPress} from './shellMenus.js';
import {shellShuttingDown} from './shellShutdown.js';
import {FLYOUT} from './spec.js';
import {applyThemeClass} from './theme.js';

/** Enough for a six-week month plus the header row. */
const CALENDAR_HEIGHT = 300;

/** The right padding the notification list's scrollbar takes; see the
 * stylesheet. */
const SCROLL_GUTTER = 10;

/* GNOME closes its calendar whenever something shown in it is acted on —
 * a notification opened, a window brought up from one. On this desktop
 * the calendar is these panels, one per taskbar, so they close then too.
 * One wrapper serves them all while any exists. */
const centres = new Set();
let restoreCloseCalendar = null;

function watchCloseCalendar(centre) {
    centres.add(centre);
    if (restoreCloseCalendar)
        return;
    const panel = Main.panel;
    const own = Object.hasOwn(panel, 'closeCalendar');
    const previous = panel.closeCalendar;
    function closeCalendar(...args) {
        previous.apply(this, args);
        for (const each of centres)
            each.close();
    }
    panel.closeCalendar = closeCalendar;
    restoreCloseCalendar = () => {
        // Wrapped again since by someone else: ours stays, closing nothing.
        if (panel.closeCalendar !== closeCalendar)
            return;
        if (own)
            panel.closeCalendar = previous;
        else
            delete panel.closeCalendar;
    };
}

function unwatchCloseCalendar(centre) {
    centres.delete(centre);
    if (centres.size > 0 || !restoreCloseCalendar)
        return;
    restoreCloseCalendar();
    restoreCloseCalendar = null;
}

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
        // Where the bottom edge stays while the height follows the content;
        // null when the panel hangs from a top taskbar instead.
        this._bottom = null;

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
        // Opening a notification opens its app; Windows closes the panel.
        this._messageList.connect('activated', () => this.close());
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
        watchCloseCalendar(this);
        this.connect('captured-event', (_actor, event) => this._onCapturedEvent(event));
        this.connect('destroy', () => this._onDestroy());
    }

    vfunc_allocate(box) {
        // Notifications come and go while the panel is open; on a bottom
        // taskbar its top edge moves for them and its bottom edge stays.
        if (this._bottom !== null)
            box.set_origin(box.x1, this._bottom - box.get_height());
        super.vfunc_allocate(box);
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
            from: this._taskbar.towardsBar(SLIDE),
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
            to: this._taskbar.towardsBar(SLIDE / 2),
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
        const bar = this._taskbar.thickness;
        const edge = this._taskbar.edge;

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
        // The list also takes the gutter its scrollbar sits in.
        this._messageList.set_width(Math.round(inner + SCROLL_GUTTER * s));
        this._calendar.set_width(Math.round(inner));
        const [, dateH] = this._dateLabel.get_preferred_height(inner);
        const chrome = 24 * s + 16 * s; // panel padding plus two gaps

        // The height is whatever is in the panel, up to the screen. A
        // full-height column with two notifications in it looks wrong, and
        // Windows does not do that either. Whatever the calendar leaves
        // goes to the list, which scrolls inside the panel past that
        // rather than pushing it off-screen. St lengths are logical.
        const available = this._taskbar.vertical
            ? monitor.height - top - margin
            : monitor.height - bar - top - gap;
        const listMax = Math.max(0, available - calH - dateH - chrome);
        this._messageList.style = `max-height: ${Math.floor(listMax / s)}px;`;

        this.set_width(Math.round(width));
        // Windows anchors it to the taskbar end, so a short panel sits at
        // the bottom rather than floating at the top of the screen; beside
        // a bar on a side, at the foot of the screen next to the bar.
        const corner = placeAtEnd(edge, monitor, bar, {width, height: 0}, {gap, margin});
        const x = Math.round(corner.x);
        if (edge !== 'top') {
            // Its foot stays put while it grows.
            this._bottom = Math.round(corner.y);
            this.set_position(x, this._bottom - Math.round(this.height));
        } else {
            this._bottom = null;
            this.set_position(x, Math.round(monitor.y + bar + top));
        }
        this.queue_relayout();
    }

    _onCapturedEvent(event) {
        // Closing: nothing in here reacts any more — but crossing events
        // have to pass, Clutter insists on it.
        if (!this._isOpen) {
            const type = event.type();
            return type === Clutter.EventType.ENTER || type === Clutter.EventType.LEAVE
                ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP;
        }
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
        passOnRightPress(event);
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        if (!shellShuttingDown())
            unwatchCloseCalendar(this);
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
