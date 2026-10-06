#!/usr/bin/gjs -m
/* fake-tray-item.js — publish a StatusNotifierItem so the tray can be tested.
 *
 * There is no guarantee any app with a tray icon is installed, and the test
 * shell runs on its own bus anyway, so the test supplies its own item.
 *
 *   gjs -m tools/fake-tray-item.js [id] [icon-name] [--late] [--theme-path]
 *
 * Runs until killed. Also exports a DBusMenu with a couple of entries, so
 * the right-click path gets exercised too. Like real apps, it registers again
 * whenever the watcher comes back — when the extension is turned off and on.
 *
 * --theme-path does what Chromium and Edge do: the icon is a PNG in a
 * private directory named by IconThemePath, the title is empty and only the
 * tooltip names the app. --late registers with the watcher before the item
 * is exported, as a racing app can, so the host's first read finds nothing.
 * --blink swaps the icon and says so every 300 ms, as WeChat does while a
 * message is unread.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const id = ARGV[0] ?? 'win11-taskbar-test';
const iconName = ARGV[1] ?? 'dialog-information-symbolic';
const notifyOnAbout = ARGV.includes('--notify-about');
const late = ARGV.includes('--late');
const themePath = ARGV.includes('--theme-path');
const blink = ARGV.includes('--blink');
let aboutCount = 0;
let layoutCount = 0;
let revision = 1;

const ITEM_XML = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
    <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
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
    <property name="TestAboutCount" type="u" access="read"/>
    <property name="TestLayoutCount" type="u" access="read"/>
    <signal name="NewIcon"/>
    <signal name="NewStatus"><arg type="s"/></signal>
  </interface>
</node>`;

const MENU_XML = `
<node>
  <interface name="com.canonical.dbusmenu">
    <method name="GetLayout">
      <arg type="i" direction="in"/><arg type="i" direction="in"/>
      <arg type="as" direction="in"/>
      <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="Event">
      <arg type="i" direction="in"/><arg type="s" direction="in"/>
      <arg type="v" direction="in"/><arg type="u" direction="in"/>
    </method>
    <method name="AboutToShow">
      <arg type="i" direction="in"/><arg type="b" direction="out"/>
    </method>
    <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
  </interface>
</node>`;

const item = {
    Id: id,
    Category: 'ApplicationStatus',
    Status: 'Active',
    Title: `Test item (${id})`,
    IconName: iconName,
    IconThemePath: '',
    AttentionIconName: '',
    OverlayIconName: '',
    IconPixmap: [],
    AttentionIconPixmap: [],
    ToolTip: ['', [], `Test item (${id})`, 'Published by tools/fake-tray-item.js'],
    Menu: '/MenuBar',
    ItemIsMenu: false,
    get TestAboutCount() { return aboutCount; },
    get TestLayoutCount() { return layoutCount; },
    Activate(x, y) {
        print(`Activate ${x},${y}`);
    },
    SecondaryActivate(x, y) {
        print(`SecondaryActivate ${x},${y}`);
    },
    ContextMenu(x, y) {
        print(`ContextMenu ${x},${y}`);
    },
    Scroll(delta, orientation) {
        print(`Scroll ${delta} ${orientation}`);
    },
};

function menuItem(itemId, label, extra = {}) {
    const props = {label: new GLib.Variant('s', label)};
    for (const [k, v] of Object.entries(extra))
        props[k] = v;
    return new GLib.Variant('(ia{sv}av)', [itemId, props, []]);
}

const menu = {
    GetLayout(_parentId, _depth, _props) {
        layoutCount++;
        const children = [
            menuItem(1, 'First entry'),
            new GLib.Variant('(ia{sv}av)',
                [2, {type: new GLib.Variant('s', 'separator')}, []]),
            menuItem(3, 'Second entry'),
            menuItem(4, 'Disabled entry',
                {enabled: new GLib.Variant('b', false)}),
        ];

        // wrapJSObject 会根据返回签名封装 tuple；这里再包 Variant 会变成错误类型。
        return [revision, [0, {'children-display': new GLib.Variant('s', 'submenu')}, children]];
    },
    Event(eventItemId, eventId, _data, _timestamp) {
        print(`menu event: item ${eventItemId} ${eventId}`);
    },
    AboutToShow(_itemId) {
        aboutCount++;
        if (notifyOnAbout) {
            revision++;
            menuImpl.emit_signal('LayoutUpdated', new GLib.Variant('(ui)', [revision, 0]));
        }
        return notifyOnAbout;
    },
};

if (themePath) {
    const GdkPixbuf = (await import('gi://GdkPixbuf')).default;
    const dir = GLib.dir_make_tmp('fake-tray-XXXXXX');
    const pixbuf = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 32, 32);
    pixbuf.fill(0x1e88e5ff);
    pixbuf.savev(GLib.build_filenamev([dir, `${iconName}.png`]), 'png', [], []);
    item.IconThemePath = dir;
    item.Title = '';
    item.ToolTip = ['', [], 'Fake Chromium', ''];
}

const itemImpl = Gio.DBusExportedObject.wrapJSObject(ITEM_XML, item);
const menuImpl = Gio.DBusExportedObject.wrapJSObject(MENU_XML, menu);

const busName = `org.kde.StatusNotifierItem-${GLib.uuid_string_random().replace(/-/g, '')}-1`;

Gio.bus_own_name(Gio.BusType.SESSION, busName, Gio.BusNameOwnerFlags.NONE,
    connection => {
        const exportAll = () => {
            itemImpl.export(connection, '/StatusNotifierItem');
            menuImpl.export(connection, '/MenuBar');
        };
        if (late) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
                exportAll();
                print('exported');
                return GLib.SOURCE_REMOVE;
            });
        } else {
            exportAll();
        }
    },
    (connection, name) => {
        // Whenever a watcher appears — now, and again after the extension
        // is turned off and on — as libappindicator and Qt do.
        Gio.bus_watch_name_on_connection(connection, 'org.kde.StatusNotifierWatcher',
            Gio.BusNameWatcherFlags.NONE, () => {
                connection.call('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
                    'org.kde.StatusNotifierWatcher', 'RegisterStatusNotifierItem',
                    new GLib.Variant('(s)', [name]), null,
                    Gio.DBusCallFlags.NONE, -1, null,
                    (conn, res) => {
                        try {
                            conn.call_finish(res);
                            print(`registered ${name}`);
                        } catch (e) {
                            printerr(`could not register: ${e.message}`);
                        }
                    });
            }, null);
    },
    () => printerr(`lost the bus name ${busName}`));

if (blink) {
    let lit = true;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
        lit = !lit;
        item.IconName = lit ? iconName : 'dialog-warning-symbolic';
        itemImpl.emit_signal('NewIcon', null);
        return GLib.SOURCE_CONTINUE;
    });
}

new GLib.MainLoop(null, false).run();
