/* statusNotifier.js — a StatusNotifierItem host, so the taskbar can own the
 * notification area the way Windows does.
 *
 * GNOME has no XEmbed system tray; modern apps publish a StatusNotifierItem
 * on the session bus and wait for a host to claim them. The usual answer is
 * the AppIndicator Support extension, but it puts icons in the top bar and
 * has no concept of an overflow area, so it cannot reproduce the Windows
 * notification area. We register as the watcher and host ourselves.
 *
 * Only one watcher can own org.kde.StatusNotifierWatcher at a time. If
 * something else already holds the name (AppIndicator Support, usually), we
 * stand down and say so rather than fight over it.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const ITEM_IFACE = 'org.kde.StatusNotifierItem';

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg type="s" direction="in" name="service"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg type="s" direction="in" name="service"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
    <signal name="StatusNotifierHostUnregistered"/>
  </interface>
</node>`;

const ITEM_XML = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <method name="Activate">
      <arg type="i" direction="in"/><arg type="i" direction="in"/>
    </method>
    <method name="SecondaryActivate">
      <arg type="i" direction="in"/><arg type="i" direction="in"/>
    </method>
    <method name="ContextMenu">
      <arg type="i" direction="in"/><arg type="i" direction="in"/>
    </method>
    <method name="Scroll">
      <arg type="i" direction="in"/><arg type="s" direction="in"/>
    </method>
    <property name="Id" type="s" access="read"/>
    <property name="Category" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="IconThemePath" type="s" access="read"/>
    <property name="AttentionIconName" type="s" access="read"/>
    <property name="OverlayIconName" type="s" access="read"/>
    <property name="IconPixmap" type="a(iiay)" access="read"/>
    <property name="AttentionIconPixmap" type="a(iiay)" access="read"/>
    <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
  </interface>
</node>`;

const ItemProxy = Gio.DBusProxy.makeProxyWrapper(ITEM_XML);

/** One tray item, as a plain observable object. The view layer turns these
 *  into buttons; this class only knows D-Bus. */
export const StatusItem = GObject.registerClass({
    Signals: {
        'changed': {},
        'gone': {},
    },
}, class StatusItem extends GObject.Object {
    _init(busName, objectPath) {
        super._init();
        this.busName = busName;
        this.objectPath = objectPath;
        this.ready = false;

        this._proxy = new ItemProxy(Gio.DBus.session, busName, objectPath,
            (_p, error) => {
                if (error) {
                    logError(error, `win11-taskbar: cannot reach ${busName}`);
                    this.emit('gone');
                    return;
                }
                this.ready = true;
                this.emit('changed');
                // An app can register before it exports the item — Chromium
                // and Edge do — and then the proxy's first read found nothing
                // and no signal will say otherwise. Read again until it has.
                if (!this._hasIcon())
                    this._refreshSoon(1);
            });

        // Items often have no title of their own; name them after their app.
        this._appName = null;
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [busName]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    const [pid] = conn.call_finish(res).deepUnpack();
                    const app = Shell.WindowTracker.get_default().get_app_from_pid(pid);
                    this._appName = app?.get_name() ?? null;
                    if (this._appName && this._proxy)
                        this.emit('changed');
                } catch {
                    // Gone already; the name watcher will say so.
                }
            });

        // Apps announce changes with bare signals and expect the host to
        // re-read the properties.
        this._signalId = this._proxy.connectSignal
            ? Gio.DBus.session.signal_subscribe(busName, ITEM_IFACE, null,
                objectPath, null, Gio.DBusSignalFlags.NONE,
                () => this._refresh())
            : 0;

        this._watchId = Gio.bus_watch_name(Gio.BusType.SESSION, busName,
            Gio.BusNameWatcherFlags.NONE, null, () => this.emit('gone'));
    }

    _hasIcon() {
        return Boolean(this.iconName || this.iconPixmap?.length);
    }

    _refreshSoon(attempt) {
        this._retryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500 * attempt, () => {
            this._retryId = 0;
            this._refresh(() => {
                if (!this._hasIcon() && attempt < 6)
                    this._refreshSoon(attempt + 1);
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _refresh(done = null) {
        // Re-reading every property is cheap next to the round trip we have
        // already paid, and it keeps us correct whichever signal fired.
        this._proxy.g_connection.call(
            this.busName, this.objectPath,
            'org.freedesktop.DBus.Properties', 'GetAll',
            new GLib.Variant('(s)', [ITEM_IFACE]), null,
            Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                let props = null;
                try {
                    [props] = conn.call_finish(res).deepUnpack();
                } catch {
                    // Not exported yet, or gone mid-flight; the name watcher
                    // tells us about the latter.
                }
                if (!this._proxy)
                    return;
                if (props) {
                    for (const [key, value] of Object.entries(props))
                        this._proxy.set_cached_property(key, value);
                    this.emit('changed');
                }
                done?.();
            });
    }

    get id() {
        return this._proxy?.Id ?? this.busName;
    }

    /** What to call the item: its title, else its tooltip's, else its
     *  app's name — never the bus name, if anything better is known. */
    get title() {
        return this._proxy?.Title || this._proxy?.ToolTip?.[2] || this._appName ||
            this.id;
    }

    get status() {
        return this._proxy?.Status ?? 'Active';
    }

    get category() {
        return this._proxy?.Category ?? 'ApplicationStatus';
    }

    /** Windows hides items the app marks as passive. */
    get isVisible() {
        return this.status !== 'Passive';
    }

    get needsAttention() {
        return this.status === 'NeedsAttention';
    }

    get iconName() {
        return (this.needsAttention
            ? this._proxy?.AttentionIconName : null) || this._proxy?.IconName || '';
    }

    get iconThemePath() {
        return this._proxy?.IconThemePath ?? '';
    }

    get iconPixmap() {
        const pixmaps = this.needsAttention
            ? this._proxy?.AttentionIconPixmap : this._proxy?.IconPixmap;
        return pixmaps?.length ? pixmaps : (this._proxy?.IconPixmap ?? null);
    }

    get tooltipText() {
        const tip = this._proxy?.ToolTip;
        // (iconName, iconPixmap, title, description)
        const text = tip ? [tip[2], tip[3]].filter(s => s).join('\n') : '';
        return text || this.title;
    }

    get menuPath() {
        const path = this._proxy?.Menu;
        return path && path !== '/' ? path : null;
    }

    /** Some items are nothing but a menu: a left click should open it. */
    get isMenuOnly() {
        return !!this._proxy?.ItemIsMenu;
    }

    activate(x, y) {
        this._proxy?.ActivateRemote(x, y, () => {});
    }

    secondaryActivate(x, y) {
        this._proxy?.SecondaryActivateRemote(x, y, () => {});
    }

    contextMenu(x, y) {
        this._proxy?.ContextMenuRemote(x, y, () => {});
    }

    scroll(delta, orientation) {
        this._proxy?.ScrollRemote(delta, orientation, () => {});
    }

    destroy() {
        if (this._retryId) {
            GLib.source_remove(this._retryId);
            this._retryId = 0;
        }
        if (this._watchId) {
            Gio.bus_unwatch_name(this._watchId);
            this._watchId = 0;
        }
        if (this._signalId) {
            Gio.DBus.session.signal_unsubscribe(this._signalId);
            this._signalId = 0;
        }
        this._proxy = null;
    }
});

/** The watcher/host pair. Emits item-added / item-removed. */
export const StatusNotifierHost = GObject.registerClass({
    Signals: {
        'item-added': {param_types: [GObject.TYPE_OBJECT]},
        'item-removed': {param_types: [GObject.TYPE_OBJECT]},
    },
}, class StatusNotifierHost extends GObject.Object {
    _init() {
        super._init();
        this._items = new Map();   // "busName/path" -> StatusItem
        this._acquired = false;
        this._conflict = false;

        this._impl = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);

        this._ownerId = Gio.bus_own_name(Gio.BusType.SESSION, WATCHER_NAME,
            Gio.BusNameOwnerFlags.NONE,
            connection => {
                try {
                    this._impl.export(connection, WATCHER_PATH);
                } catch (e) {
                    logError(e, 'win11-taskbar: cannot export the watcher');
                }
            },
            () => {
                this._acquired = true;
                this._impl.emit_signal('StatusNotifierHostRegistered', null);
            },
            connection => {
                // A closed connection also loses the name — at logout, say.
                if (!connection) {
                    this._acquired = false;
                    return;
                }
                // Someone else owns it — almost always AppIndicator Support.
                this._conflict = true;
                this._acquired = false;
                log('win11-taskbar: another extension already owns ' +
                    `${WATCHER_NAME}, so the taskbar will show no tray ` +
                    'icons. Disable AppIndicator Support (or set show-tray ' +
                    'to false) to pick one.');
            });
    }

    /** True when another extension already owns the watcher name. */
    get hasConflict() {
        return this._conflict;
    }

    get items() {
        return [...this._items.values()];
    }

    /* ------------------------------------------------- D-Bus: the watcher */

    RegisterStatusNotifierItemAsync([service], invocation) {
        // The spec allows either a bus name or an object path here, and
        // which one you get depends on the toolkit that published the item.
        let busName, objectPath;
        if (service.startsWith('/')) {
            busName = invocation.get_sender();
            objectPath = service;
        } else if (service.includes('/')) {
            const slash = service.indexOf('/');
            busName = service.slice(0, slash);
            objectPath = service.slice(slash);
        } else {
            busName = service;
            objectPath = '/StatusNotifierItem';
        }

        const key = `${busName}${objectPath}`;
        if (!this._items.has(key)) {
            const item = new StatusItem(busName, objectPath);
            item.connect('gone', () => this._remove(key));
            this._items.set(key, item);
            this._impl.emit_signal('StatusNotifierItemRegistered',
                new GLib.Variant('(s)', [key]));
            this.emit('item-added', item);
        }
        invocation.return_value(null);
    }

    RegisterStatusNotifierHostAsync([_service], invocation) {
        this._impl.emit_signal('StatusNotifierHostRegistered', null);
        invocation.return_value(null);
    }

    get RegisteredStatusNotifierItems() {
        return [...this._items.keys()];
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    /* ------------------------------------------------------------ private */

    _remove(key) {
        const item = this._items.get(key);
        if (!item)
            return;
        this._items.delete(key);
        this._impl.emit_signal('StatusNotifierItemUnregistered',
            new GLib.Variant('(s)', [key]));
        this.emit('item-removed', item);
        item.destroy();
    }

    destroy() {
        for (const key of [...this._items.keys()])
            this._remove(key);

        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        try {
            this._impl?.unexport();
        } catch {
            // Already gone with the bus name.
        }
        this._impl = null;
    }
});
