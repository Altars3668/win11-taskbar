/* notificationPersistence.js — an application's notifications outlive it.
 *
 * Windows keeps what an application posted in the notification centre
 * until the user clears it, whether or not the application is still
 * running. GNOME does not: when the D-Bus connection a notification came
 * in on goes away and the notification belongs to a known application,
 * the shell destroys that application's whole source with everything in
 * it. An application that quits or restarts, or that posts from a helper
 * process that exits at once, takes its notifications with it — which
 * left the panel holding little but the shell's own.
 *
 * This keeps them. Resident notifications still go: a running application
 * keeps those up to date (a player's "now playing"), and they would go
 * stale. An application that has gone can no longer hear a notification's
 * actions, so using one opens the application instead — on Windows,
 * clicking an old notification launches the application that sent it.
 */
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {FdoNotificationDaemonSource} from 'resource:///org/gnome/shell/ui/notificationDaemon.js';

export class NotificationPersistence {
    constructor() {
        // Notifications whose application's connection has gone.
        const orphaned = new WeakSet();
        const daemon = Main.notificationDaemon?._fdoNotificationDaemon ?? null;

        // Sources bind this when they are made, so it covers the ones made
        // from now on — by the time anything has posted, that is all.
        const proto = FdoNotificationDaemonSource.prototype;
        const originalVanished = proto._onNameVanished;
        function onNameVanished() {
            // Sources with no application are never destroyed for this.
            if (!this.app)
                return;
            // The daemon would route the application's next notifications
            // here, watching a connection that has already gone; let them
            // start a source of their own.
            if (daemon?._sourcesForApp?.get(this.app) === this)
                daemon._sourcesForApp.delete(this.app);
            for (const notification of [...this.notifications]) {
                if (notification.resident)
                    notification.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
                else
                    orphaned.add(notification);
            }
        }
        proto._onNameVanished = onNameVanished;

        // Using a notification first hands its application a startup
        // token, then tells it which action. With the application gone,
        // nobody takes the token — and while it is outstanding the shell
        // counts the application as starting, so activating it does
        // nothing. Skip both, and open the application.
        const isOrphaned = (daemonSelf, id) => {
            const notification = daemonSelf._notifications.get(id);
            return notification && orphaned.has(notification) ? notification : null;
        };
        const wraps = {
            _emitActivationToken(source, id) {
                return isOrphaned(this, id) ? undefined
                    : wraps._emitActivationToken.original.call(this, source, id);
            },
            _emitActionInvoked(id, action) {
                const notification = isOrphaned(this, id);
                if (notification)
                    notification.source.openApp();
                else
                    wraps._emitActionInvoked.original.call(this, id, action);
            },
        };
        for (const [name, wrapper] of Object.entries(wraps)) {
            if (!daemon)
                break;
            wrapper.own = Object.hasOwn(daemon, name);
            wrapper.original = daemon[name];
            daemon[name] = wrapper;
        }

        this._restore = () => {
            // Left in place if someone else has wrapped them since.
            if (proto._onNameVanished === onNameVanished)
                proto._onNameVanished = originalVanished;
            for (const [name, wrapper] of Object.entries(wraps)) {
                if (daemon?.[name] !== wrapper)
                    continue;
                if (wrapper.own)
                    daemon[name] = wrapper.original;
                else
                    delete daemon[name];
            }
        };
    }

    destroy() {
        this._restore?.();
        this._restore = null;
    }
}
