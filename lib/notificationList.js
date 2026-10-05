/* Windows 式独立通知卡片：保留 GNOME 通知操作，不把同一来源叠成多层阴影。 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationMessage} from 'resource:///org/gnome/shell/ui/messageList.js';

export const NotificationList = GObject.registerClass({GTypeName: 'W11FlatNotificationList'},
class NotificationList extends St.BoxLayout {
    _init() {
        super._init({orientation: Clutter.Orientation.VERTICAL, x_expand: true,
            style_class: 'w11-flat-notification-list', clip_to_allocation: true});
        this._sources = new Map();
        this._messages = new Map();
        this._scrollView = new St.ScrollView({x_expand: true, y_expand: true, overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC});
        this._cards = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, style_class: 'w11-notification-cards'});
        this._scrollView.set_child(this._cards);
        this.add_child(this._scrollView);
        this._empty = new St.Label({text: 'No new notifications', x_align: Clutter.ActorAlign.CENTER,
            style_class: 'w11-notification-empty'});
        this._cards.add_child(this._empty);
        this._trayId = Main.messageTray.connect('source-added', (_tray, source) => this._addSource(source));
        for (const source of Main.messageTray.getSources())
            this._addSource(source);
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
        const record = {message, destroyId: notification.connect('destroy', () => this._remove(notification))};
        this._messages.set(notification, record);
        this._cards.insert_child_at_index(message, 0);
        this._empty.hide();
    }

    _remove(notification) {
        const record = this._messages.get(notification);
        if (!record)
            return;
        this._messages.delete(notification);
        notification.disconnect(record.destroyId);
        record.message.destroy();
        this._empty.visible = this._messages.size === 0;
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
        Main.messageTray.disconnect(this._trayId);
        for (const source of [...this._sources.keys()])
            this._removeSource(source);
    }
});
