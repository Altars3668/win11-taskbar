/* dbusMenu.js — turn a com.canonical.dbusmenu tree into a GNOME PopupMenu.
 *
 * A StatusNotifierItem usually exports its context menu over DBusMenu rather
 * than drawing it itself, so a tray that cannot read DBusMenu can show icons
 * but not their menus. This builds the menu lazily: the layout is fetched
 * when the user right-clicks, and again whenever the app says it changed.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MENU_XML = `
<node>
  <interface name="com.canonical.dbusmenu">
    <method name="GetLayout">
      <arg type="i" direction="in" name="parentId"/>
      <arg type="i" direction="in" name="recursionDepth"/>
      <arg type="as" direction="in" name="propertyNames"/>
      <arg type="u" direction="out" name="revision"/>
      <arg type="(ia{sv}av)" direction="out" name="layout"/>
    </method>
    <method name="Event">
      <arg type="i" direction="in" name="id"/>
      <arg type="s" direction="in" name="eventId"/>
      <arg type="v" direction="in" name="data"/>
      <arg type="u" direction="in" name="timestamp"/>
    </method>
    <method name="AboutToShow">
      <arg type="i" direction="in" name="id"/>
      <arg type="b" direction="out" name="needUpdate"/>
    </method>
    <signal name="LayoutUpdated">
      <arg type="u" name="revision"/><arg type="i" name="parent"/>
    </signal>
    <signal name="ItemsPropertiesUpdated">
      <arg type="a(ia{sv})" name="updated"/>
      <arg type="a(ias)" name="removed"/>
    </signal>
  </interface>
</node>`;

const MenuProxy = Gio.DBusProxy.makeProxyWrapper(MENU_XML);

/** Fetches a DBusMenu and mirrors it into an existing PopupMenu. */
export class DBusMenuBridge {
    constructor(busName, objectPath, menu, onRebuild = () => {}) {
        this._menu = menu;
        this._onRebuild = onRebuild;
        this._revision = 0;
        this._refreshId = 0;
        this._inFlight = false;
        this._pendingRefresh = false;
        this._pendingAbout = false;
        this._busName = busName;
        this._objectPath = objectPath;
        this._destroyed = false;

        this._proxy = new MenuProxy(Gio.DBus.session, busName, objectPath,
            (_p, error) => {
                if (this._destroyed)
                    return;
                if (error) {
                    logError(error, `win11-taskbar: no DBusMenu at ${objectPath}`);
                    return;
                }
                this._layoutId = this._proxy.connectSignal('LayoutUpdated',
                    (_proxy, _sender, [revision]) => {
                        if (revision > this._revision)
                            this._queueRefresh();
                    });
                this._propsId = this._proxy.connectSignal('ItemsPropertiesUpdated',
                    () => this._queueRefresh());
                this.refresh();
            });
    }

    /** Re-read the whole layout. DBusMenu trees are small; a full refresh is
     *  simpler than diffing and fast enough to be unnoticeable. */
    _queueRefresh() {
        if (this._destroyed || this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._refreshId = 0;
            this.refresh(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    refresh(aboutToShow = true) {
        if (this._destroyed || !this._proxy)
            return;
        if (this._inFlight) {
            this._pendingRefresh = true;
            this._pendingAbout ||= aboutToShow;
            return;
        }
        this._inFlight = true;
        const fetch = () => {
            if (this._destroyed)
                return;
            this._proxy.GetLayoutRemote(0, -1, [], (result, error) => {
                this._inFlight = false;
                if (this._destroyed)
                    return;
                if (!error && result) {
                    const [revision, layout] = result;
                    this._revision = revision;
                    this._rebuild(layout);
                }
                if (this._pendingRefresh) {
                    const about = this._pendingAbout;
                    this._pendingRefresh = this._pendingAbout = false;
                    if (about)
                        this.refresh(true);
                    else
                        this._queueRefresh();
                }
            });
        };
        // 只有用户主动打开才发 AboutToShow。信号刷新若也调用它，会形成
        // AboutToShow → LayoutUpdated → AboutToShow 的反馈风暴。
        if (aboutToShow)
            this._proxy.AboutToShowRemote(0, fetch);
        else
            fetch();
    }

    _rebuild(layout) {
        this._menu.removeAll();
        const [, , children] = layout;
        for (const child of children)
            this._addItem(this._menu, child.deepUnpack ? child.deepUnpack() : child);

        if (this._menu.isEmpty()) {
            const empty = new PopupMenu.PopupMenuItem(_('No menu'));
            empty.setSensitive(false);
            this._menu.addMenuItem(empty);
        }
        // 宿主的折叠操作属于附加项，必须在异步 removeAll 后补回。
        this._onRebuild();
    }

    _addItem(parent, node) {
        const [id, props, children] = node;
        const get = (key, fallback) =>
            props[key] ? props[key].deepUnpack() : fallback;

        if (get('visible', true) === false)
            return;

        const type = get('type', 'standard');
        if (type === 'separator') {
            parent.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            return;
        }

        // DBusMenu marks accelerator positions with a single underscore.
        const label = get('label', '').replace(/_([^_])/g, '$1');
        const toggleType = get('toggle-type', '');
        const hasSubmenu = get('children-display', '') === 'submenu' &&
            children.length > 0;

        let item;
        if (hasSubmenu) {
            item = new PopupMenu.PopupSubMenuMenuItem(label);
            for (const child of children) {
                this._addItem(item.menu,
                    child.deepUnpack ? child.deepUnpack() : child);
            }
        } else if (toggleType === 'checkmark' || toggleType === 'radio') {
            item = new PopupMenu.PopupSwitchMenuItem(label,
                get('toggle-state', 0) === 1);
            item.connect('toggled', () => this._send(id, 'clicked'));
        } else {
            const iconName = get('icon-name', '');
            item = iconName
                ? new PopupMenu.PopupImageMenuItem(label, iconName)
                : new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._send(id, 'clicked'));
        }

        if (get('enabled', true) === false)
            item.setSensitive(false);

        parent.addMenuItem(item);
    }

    _send(id, eventId) {
        this._proxy?.EventRemote(id, eventId,
            new GLib.Variant('s', ''),
            Math.floor(GLib.get_monotonic_time() / 1000) >>> 0,
            () => {});
    }

    destroy() {
        this._destroyed = true;
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = 0;
        this._pendingRefresh = this._pendingAbout = false;
        if (this._proxy) {
            if (this._layoutId)
                this._proxy.disconnectSignal(this._layoutId);
            if (this._propsId)
                this._proxy.disconnectSignal(this._propsId);
        }
        this._proxy = null;
    }
}

let _gettext = s => s;

/**
 * Install the gettext function this module should use.
 *
 * @param {Function} fn the extension's gettext
 */
export function setGettext(fn) {
    _gettext = fn;
}

function _(s) {
    return _gettext(s);
}
