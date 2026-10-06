/* prefs.js — the preferences window. */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {START_SHORTCUTS} from './lib/startOptions.js';

import {
    ExtensionPreferences, gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Win11TaskbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._cleanup = [];
        this._cancellable = new Gio.Cancellable();
        window.connect('close-request', () => {
            this._cancellable.cancel();
            for (const cleanup of this._cleanup)
                cleanup();
            this._cleanup = [];
            return false;
        });

        window.add(this._layoutPage(settings));
        window.add(this._startPage(settings));
        window.add(this._trayPage(settings));
        window.add(this._behaviourPage(settings));
        window.add(this._clockPage(settings));
    }

    _layoutPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Layout'),
            icon_name: 'preferences-desktop-display-symbolic',
        });

        const placement = new Adw.PreferencesGroup({title: _('Placement')});
        page.add(placement);

        placement.add(this._combo(settings, 'position', _('Screen edge'),
            [['bottom', _('Bottom')], ['top', _('Top')]]));
        placement.add(this._combo(settings, 'alignment', _('Task button alignment'),
            [['center', _('Centre (Windows 11)')], ['left', _('Left (Windows 10)')]]));
        placement.add(this._switch(settings, 'auto-hide', _('Automatically hide'),
            _('Slides out of the way until the pointer pushes the edge.')));
        placement.add(this._switch(settings, 'reserve-space',
            _('Reserve screen space'),
            _('Turn off to let maximised windows run under the bar and show '
              + 'through its acrylic surface.')));
        placement.add(this._switch(settings, 'hide-top-panel', _('Hide the GNOME top bar'),
            _('Windows has a single bar.')));

        const monitors = new Adw.PreferencesGroup({title: _('Displays')});
        page.add(monitors);
        monitors.add(this._switch(settings, 'multi-monitor', _('Show on every display')));
        monitors.add(this._switch(settings, 'isolate-monitors',
            _('Only show windows from this display')));
        monitors.add(this._switch(settings, 'isolate-workspaces',
            _('Only show windows from the current workspace'),
            _('Matches the Windows virtual-desktop default.')));

        const appearance = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(appearance);
        appearance.add(this._combo(settings, 'theme', _('Colour scheme'),
            [['auto', _('Follow the desktop')], ['light', _('Light')],
             ['dark', _('Dark')]]));

        const iconRow = new Adw.SpinRow({
            title: _('Task icon size'),
            subtitle: _('24 is the measured Windows size.'),
            adjustment: new Gtk.Adjustment({
                lower: 16, upper: 40, step_increment: 2, page_increment: 4,
            }),
        });
        settings.bind('icon-size', iconRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
        appearance.add(iconRow);

        const parts = new Adw.PreferencesGroup({title: _('Elements')});
        page.add(parts);
        parts.add(this._switch(settings, 'show-start-button', _('Start button')));
        parts.add(this._switch(settings, 'show-task-view-button', _('Task View button')));
        parts.add(this._switch(settings, 'show-pinned', _('Pinned apps')));
        parts.add(this._switch(settings, 'show-clock', _('Clock')));
        parts.add(this._switch(settings, 'show-desktop-button',
            _('"Show desktop" sliver')));
        parts.add(this._switch(settings, 'acrylic', _('Blur the desktop behind the bar'),
            _('Approximates the acrylic material Windows uses.')));
        parts.add(this._switch(settings, 'hide-overview-dash',
            _('Hide the Overview\u2019s dash'),
            _('The taskbar already shows the same apps.')));

        return page;
    }

    _startPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Start'),
            icon_name: 'view-app-grid-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: _('Start menu'),
            description: _('Search, pinned apps, all apps, recent documents ' +
                'and a power menu. Right-click a tile to pin or unpin it.'),
        });
        page.add(group);

        group.add(this._switch(settings, 'start-menu',
            _('Use the built-in Start menu'),
            _('When off, the Start button opens GNOME\u2019s app grid.')));
        group.add(this._switch(settings, 'super-opens-start',
            _('The Super key opens it'),
            _('Matches the Windows key. When off, Super opens the Overview.')));

        group.add(this._combo(settings, 'start-layout', _('Menu size'), [
            ['compact', _('Compact \u2014 six columns')],
            ['wide', _('Wide \u2014 eight columns (Insider)')],
            ['custom', _('Custom size')],
            ['fullscreen', _('Full-screen Start')],
            ['app-grid', _('GNOME application screen')],
        ]));
        // A Start of one's own size: the pinned grid takes the columns and
        // rows that fit, and the menu never outgrows the screen.
        const sizeRows = [
            ['start-width', _('Width'),
                _('Every 96 pixels holds another column of pinned apps.')],
            ['start-height', _('Height'),
                _('Every 84 pixels holds another row of pinned apps.')],
        ].map(([key, title, subtitle]) => {
            const row = new Adw.SpinRow({
                title,
                subtitle,
                adjustment: new Gtk.Adjustment({
                    lower: 480, upper: 4000, step_increment: 16, page_increment: 96,
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            return row;
        });
        const syncSize = () => {
            const custom = settings.get_string('start-layout') === 'custom';
            for (const row of sizeRows)
                row.visible = custom;
        };
        const sizeId = settings.connect('changed::start-layout', syncSize);
        this._cleanup.push(() => settings.disconnect(sizeId));
        syncSize();
        const folders = new Adw.PreferencesGroup({
            title: _('Shortcuts beside the power button'),
            description: _('Choose which folders and apps appear in Start. Task Manager remains available in the Win+X menu.'),
        });
        page.add(folders);
        for (const shortcut of START_SHORTCUTS) {
            const row = this._arraySwitch(settings, 'start-folders', shortcut.id, _(shortcut.label));
            row.add_prefix(new Gtk.Image({icon_name: shortcut.icon}));
            folders.add(row);
        }

        return page;
    }

    _trayPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Tray'),
            icon_name: 'preferences-system-notifications-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Notification area'),
            description: _('The taskbar hosts StatusNotifierItem icons ' +
                'itself. Only one extension can do that, so disable ' +
                'AppIndicator Support if it is enabled \u2014 you do not ' +
                'need both.'),
        });
        page.add(group);

        group.add(this._switch(settings, 'show-tray',
            _('Show tray icons')));
        group.add(this._switch(settings, 'show-input-method', _('Input language panel'),
            _('Choose a configured Fcitx input method or GNOME keyboard source.')));
        group.add(this._switch(settings, 'show-system-indicators',
            _('Move Quick Settings into the taskbar'),
            _('Network, volume and battery. With the top bar hidden these ' +
                'have nowhere else to go.')));

        group.add(this._combo(settings, 'tray-hover', _('When hovering an icon'), [
            ['menu', _('Program menu (tooltip when unavailable)')],
            ['tooltip', _('Tooltip (Windows default)')],
            ['none', _('Nothing')],
        ]));
        const overflow = new Adw.PreferencesGroup({
            title: _('Fold icons into the overflow'),
            description: _('Select the programs to keep behind the chevron. An item asking for attention is temporarily shown in the taskbar.'),
        });
        page.add(overflow);
        this._watchTrayRows(settings, overflow);

        return page;
    }

    _behaviourPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Behaviour'),
            icon_name: 'input-mouse-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Previews and menus'),
            description: _('Hover delay is 400 ms, matching the MouseHoverTime ' +
                'value measured on Windows.'),
        });
        page.add(group);
        group.add(this._switch(settings, 'aero-peek',
            _('Peek at a window when hovering its thumbnail'),
            _('Fades the other windows out, as Aero Peek does.')));
        group.add(this._switch(settings, 'jumplist-recent',
            _('Show recent documents in the jump list')));
        group.add(this._switch(settings, 'flash-attention',
            _('Show flashing on taskbar apps'),
            _('An app that needs attention flashes its button instead of '
              + 'showing GNOME’s “is ready” notification.')));

        const shortcuts = new Adw.PreferencesGroup({
            title: _('Windows shortcuts'),
            description: _('Super+X opens the Quick Link menu, which is also '
                + 'a right-click of the Start button. Super+V opens '
                + 'clipboard history at the pointer.'),
        });
        page.add(shortcuts);
        shortcuts.add(this._switch(settings, 'clipboard-history',
            _('Keep a clipboard history'),
            _('Select an entry to paste it into the previously focused application.')));
        shortcuts.add(this._switch(settings, 'super-number-keys',
            _('Super+1…9 reach taskbar buttons'),
            _('As on Windows. GNOME binds these to the favourites list, '
              + 'which disagrees once something unpinned is running.')));

        const keyList = new Adw.PreferencesGroup({title: _('Also bound')});
        page.add(keyList);
        for (const [combo, what] of [
            ['Super+X', _('Quick Link menu (also right-click Start)')],
            ['Super+V', _('Clipboard history, at the pointer')],
            ['Super+A', _('Quick settings')],
            ['Super+N', _('Notification centre')],
            ['Super+D', _('Show the desktop')],
            ['Super+E', _('File manager')],
            ['Super+I', _('Settings')],
            ['Super+R', _('Run')],
            ['Super+T', _('Step through taskbar buttons')],
        ])
            keyList.add(new Adw.ActionRow({title: combo, subtitle: what}));

        const mouse = new Adw.PreferencesGroup({title: _('Mouse')});
        page.add(mouse);
        mouse.add(this._switch(settings, 'context-menu-on-release',
            _('Open context menus on release'),
            _('Windows opens a right-click menu when the button comes back '
              + 'up. Opening it on press breaks right-drag gestures, which '
              + 'some applications use.')));

        const help = new Adw.PreferencesGroup({title: _('Click reference')});
        page.add(help);
        for (const [gesture, effect] of [
            [_('Click'), _('Activate, or minimise if already focused')],
            [_('Click (2+ windows)'), _('Open the thumbnail flyout')],
            [_('Ctrl+click'), _('Cycle through the app’s windows')],
            [_('Shift+click, middle click'), _('Open a new window')],
            [_('Right click'), _('Jump list')],
        ])
            help.add(new Adw.ActionRow({title: gesture, subtitle: effect}));

        return page;
    }

    _clockPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Clock'),
            icon_name: 'preferences-system-time-symbolic',
        });
        const group = new Adw.PreferencesGroup({title: _('Clock')});
        page.add(group);

        group.add(this._switch(settings, 'clock-24-hour', _('24-hour clock')));
        group.add(this._switch(settings, 'clock-show-seconds', _('Show seconds')));

        const row = new Adw.EntryRow({title: _('Date format (strftime)')});
        settings.bind('clock-date-format', row, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(row);

        return page;
    }

    /* ----------------------------------------------------------- helpers */

    _arraySwitch(settings, key, id, title, cleanup = this._cleanup) {
        const row = new Adw.SwitchRow({title});
        const sync = () => {
            row.active = settings.get_strv(key).includes(id);
        };
        sync();
        row.connect('notify::active', () => {
            const values = settings.get_strv(key);
            if (row.active === values.includes(id))
                return;
            settings.set_strv(key, row.active ? [...values, id] : values.filter(value => value !== id));
        });
        const signal = settings.connect(`changed::${key}`, sync);
        cleanup.push(() => settings.disconnect(signal));
        return row;
    }

    _busCall(name, path, iface, method, args) {
        return new Promise((resolve, reject) => {
            Gio.DBus.session.call(name, path, iface, method, args, null,
                Gio.DBusCallFlags.NONE, 3000, this._cancellable, (connection, result) => {
                    try {
                        resolve(connection.call_finish(result).deepUnpack());
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    _watchTrayRows(settings, group) {
        const watcher = 'org.kde.StatusNotifierWatcher';
        const properties = 'org.freedesktop.DBus.Properties';
        let generation = 0;
        let rows = [];
        let rowCleanup = [];
        const refresh = async () => {
            const ticket = ++generation;
            const items = new Map();
            try {
                const [variant] = await this._busCall(watcher, '/StatusNotifierWatcher', properties, 'Get',
                    new GLib.Variant('(ss)', [watcher, 'RegisteredStatusNotifierItems']));
                await Promise.all(variant.deepUnpack().map(async service => {
                    const slash = service.indexOf('/');
                    const name = slash < 0 ? service : service.slice(0, slash);
                    const path = slash < 0 ? '/StatusNotifierItem' : service.slice(slash);
                    try {
                        const [props] = await this._busCall(name, path, properties, 'GetAll',
                            new GLib.Variant('(s)', ['org.kde.StatusNotifierItem']));
                        const id = props.Id?.deepUnpack() || name;
                        items.set(id, {title: props.Title?.deepUnpack() || id,
                            icon: props.IconName?.deepUnpack() || 'application-x-executable-symbolic'});
                    } catch {
                        // 程序可能恰好退出；保留已存的折叠选择。
                    }
                }));
            } catch {
                // 托盘关闭或宿主不存在时，仍允许取消离线程序的折叠选择。
            }
            if (this._cancellable.is_cancelled() || ticket !== generation)
                return;
            for (const cleanup of rowCleanup)
                cleanup();
            rowCleanup = [];
            for (const row of rows)
                group.remove(row);
            rows = [];
            for (const id of settings.get_strv('tray-hidden-items')) {
                if (!items.has(id))
                    items.set(id, {title: id, offline: true});
            }
            for (const [id, item] of items) {
                const row = this._arraySwitch(settings, 'tray-hidden-items', id, item.title, rowCleanup);
                row.subtitle = item.offline ? _('Not currently running') : id;
                row.add_prefix(new Gtk.Image({icon_name: item.icon ?? 'application-x-executable-symbolic'}));
                group.add(row);
                rows.push(row);
            }
            if (rows.length === 0) {
                const row = new Adw.ActionRow({title: _('No tray programs are running')});
                group.add(row);
                rows.push(row);
            }
        };
        const signal = Gio.DBus.session.signal_subscribe(watcher, watcher, null, '/StatusNotifierWatcher',
            null, Gio.DBusSignalFlags.NONE, refresh);
        this._cleanup.push(() => {
            generation++;
            Gio.DBus.session.signal_unsubscribe(signal);
            rowCleanup.forEach(cleanup => cleanup());
        });
        refresh();
    }

    _switch(settings, key, title, subtitle = null) {
        const row = new Adw.SwitchRow({title});
        if (subtitle)
            row.subtitle = subtitle;
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _combo(settings, key, title, options) {
        const model = new Gtk.StringList();
        for (const [, label] of options)
            model.append(label);

        const row = new Adw.ComboRow({title, model});
        const values = options.map(([value]) => value);
        row.selected = Math.max(0, values.indexOf(settings.get_string(key)));
        row.connect('notify::selected',
            () => settings.set_string(key, values[row.selected]));
        return row;
    }
}
