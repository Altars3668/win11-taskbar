/* notificationList.js — the notifications half of the clock's panel.
 *
 * Windows 式独立通知卡片：保留 GNOME 通知操作，不把同一来源叠成多层阴影。
 *
 * Cards come and go the way Windows moves them. A dismissed card slides
 * out to the right and fades, then the gap it leaves closes up — the panel
 * takes its height from this list, so its top edge comes down with it. A
 * card that arrives while the panel is open fades in from the right.
 * "Clear all" sends every card out at once, one just after another.
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationMessage} from 'resource:///org/gnome/shell/ui/messageList.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {DURATION, EASE, duration} from './motion.js';
import {shellShuttingDown} from './shellShutdown.js';

let _ = s => s;

/**
 * Install the gettext function this module should use.
 *
 * @param {Function} fn the extension's gettext
 */
export function setGettext(fn) {
    _ = fn;
}

/** How far after the previous one each card leaves on "Clear all". */
const STAGGER = 30;

/** How far a new card travels in from the right, in logical pixels. */
const ARRIVE = 40;

export const NotificationList = GObject.registerClass({
    GTypeName: 'W11FlatNotificationList',
    Signals: {
        // A notification here was opened.
        'activated': {},
    },
}, class NotificationList extends St.BoxLayout {
    _init() {
        super._init({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'w11-flat-notification-list'});
        this._sources = new Map();
        this._messages = new Map();
        // Cards on their way out: no longer in _messages, still on screen.
        this._leaving = new Set();
        this._stagger = -1;

        const header = new St.BoxLayout({style_class: 'w11-notification-header', x_expand: true});
        header.add_child(new St.Label({text: _('Notifications'), x_expand: true,
            style_class: 'w11-notification-title', y_align: Clutter.ActorAlign.CENTER}));
        this._clearButton = new St.Button({label: _('Clear all'), can_focus: true,
            style_class: 'w11-notification-clear', y_align: Clutter.ActorAlign.CENTER});
        this._clearButton.connect('clicked', () => this._clearAll());
        header.add_child(this._clearButton);
        this.add_child(header);

        this._scrollView = new St.ScrollView({style_class: 'w11-notification-scroll',
            x_expand: true, y_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._cards = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, style_class: 'w11-notification-cards'});
        this._scrollView.set_child(this._cards);
        // So the stylesheet can widen the scrollbar under the pointer.
        const scrollBar = this._scrollView.get_children()
            .find(child => child instanceof St.ScrollBar &&
                child.orientation === Clutter.Orientation.VERTICAL);
        if (scrollBar)
            scrollBar.track_hover = true;
        this.add_child(this._scrollView);
        this._empty = new St.Label({text: _('No new notifications'), x_align: Clutter.ActorAlign.CENTER,
            style_class: 'w11-notification-empty'});
        this.add_child(this._empty);

        this._trayId = Main.messageTray.connect('source-added', (_tray, source) => this._addSource(source));
        for (const source of Main.messageTray.getSources())
            this._addSource(source);
        this._sync();
        this.connect('destroy', () => this._onDestroy());
    }

    _addSource(source) {
        if (this._sources.has(source))
            return;
        const added = source.connect('notification-added', (_source, notification) => this._add(notification));
        const removed = source.connect('notification-removed', (_source, notification) => this._remove(notification));
        const destroyed = source.connect('destroy', () => this._removeSource(source));
        this._sources.set(source, {added, removed, destroyed});
        for (const notification of source.notifications)
            this._add(notification);
    }

    _add(notification) {
        if (this._messages.has(notification))
            return;
        const message = new NotificationMessage(notification);
        message.add_style_class_name('w11-flat-notification-card');
        message.x_expand = true;
        const ids = [notification.connect('destroy', () => this._remove(notification))];
        // The card itself, not the notification: opening one can destroy it
        // before any later handler of its 'activated' has run.
        message.connect('clicked', () => this.emit('activated'));
        this._messages.set(notification, {message, ids});
        this._cards.insert_child_at_index(message, 0);
        this._sync();
        this._arrive(message);
    }

    _arrive(message) {
        const time = duration(DURATION.emphasized);
        if (!this.mapped || time === 0)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        message.opacity = 0;
        message.translation_x = ARRIVE * scale;
        message.ease({opacity: 255, translation_x: 0, duration: time, mode: EASE});
    }

    _remove(notification) {
        const record = this._messages.get(notification);
        if (!record)
            return;
        this._messages.delete(notification);
        for (const id of record.ids)
            notification.disconnect(id);
        this._leave(record.message);
        this._sync();
    }

    /* Slide the card out to the right, then close the gap it leaves. It is
     * invisible by then, so its height can shrink without its contents
     * being seen to squash; the margin above it shrinks with it. */
    _leave(message) {
        const slide = duration(DURATION.normal);
        if (this._destroyed || !message.mapped || slide === 0) {
            message.destroy();
            return;
        }
        this._leaving.add(message);
        message.connect('destroy', () => {
            this._leaving.delete(message);
            this._sync();
        });
        message.reactive = false;
        message.remove_all_transitions();
        const delay = this._stagger < 0 ? 0 : duration(STAGGER * this._stagger++);
        message.ease({
            translation_x: message.width,
            opacity: 0,
            delay,
            duration: slide,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._leaving.has(message))
                    return;
                message.ease({
                    height: 0,
                    margin_top: 0,
                    duration: duration(DURATION.emphasized),
                    mode: EASE,
                    onComplete: () => {
                        if (this._leaving.has(message))
                            message.destroy();
                    },
                });
            },
        });
    }

    _clearAll() {
        // Top to bottom, newest first, each a moment after the last.
        this._stagger = 0;
        for (const notification of [...this._messages.keys()].reverse())
            notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
        this._stagger = -1;
    }

    _sync() {
        if (this._destroyed)
            return;
        const any = this._messages.size > 0;
        this._clearButton.visible = any;
        this._scrollView.visible = any || this._leaving.size > 0;
        if (any) {
            this._empty.hide();
            this._empty.remove_all_transitions();
            return;
        }
        // The last card has gone, or is going: the empty line takes its
        // room from the start, so the panel shrinks straight to its final
        // height, and shows once the cards are out of the way.
        if (!this._empty.visible) {
            this._empty.show();
            this._empty.opacity = this.mapped ? 0 : 255;
        }
        if (this._leaving.size === 0 && this._empty.opacity < 255) {
            this._empty.ease({opacity: 255, duration: duration(DURATION.normal),
                mode: EASE});
        }
    }

    _removeSource(source) {
        const record = this._sources.get(source);
        if (!record)
            return;
        this._sources.delete(source);
        for (const id of Object.values(record))
            source.disconnect(id);
        for (const notification of [...this._messages.keys()]) {
            if (notification.source === source)
                this._remove(notification);
        }
    }

    _onDestroy() {
        // The cards go with the list; nothing is animated or synced now.
        this._destroyed = true;
        this._leaving.clear();
        // At shell exit the tray and its sources go too, in no order.
        if (shellShuttingDown())
            return;
        Main.messageTray.disconnect(this._trayId);
        for (const [source, ids] of this._sources) {
            for (const id of Object.values(ids))
                source.disconnect(id);
        }
        this._sources.clear();
        for (const [notification, record] of this._messages) {
            for (const id of record.ids)
                notification.disconnect(id);
        }
        this._messages.clear();
    }
});
