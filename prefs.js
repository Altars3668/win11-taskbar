/* prefs.js — the preferences window. */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    ExtensionPreferences, gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Win11TaskbarPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

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

        const note = new Adw.PreferencesGroup({
            title: _('A note on fidelity'),
            description: _('Unlike the taskbar, the Start menu\u2019s ' +
                'proportions are not measured from Windows: the measurement ' +
                'machine locked its session before the menu could be read. ' +
                'They follow the published Windows 11 figures.'),
        });
        page.add(note);

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
        group.add(this._switch(settings, 'show-system-indicators',
            _('Move Quick Settings into the taskbar'),
            _('Network, volume and battery. With the top bar hidden these ' +
                'have nowhere else to go.')));

        const overflow = new Adw.PreferencesGroup({
            title: _('Overflow'),
            description: _('Right-click any tray icon to move it between ' +
                'the taskbar and the overflow. The list below is what that ' +
                'writes, comma separated; an item asking for attention is ' +
                'shown regardless.'),
        });
        page.add(overflow);

        const entry = new Adw.EntryRow({title: _('Hidden item ids')});
        entry.text = settings.get_strv('tray-hidden-items').join(', ');
        entry.connect('apply', () => {
            const ids = entry.text.split(',')
                .map(s2 => s2.trim()).filter(s2 => s2);
            settings.set_strv('tray-hidden-items', ids);
        });
        entry.show_apply_button = true;
        overflow.add(entry);

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

        const shortcuts = new Adw.PreferencesGroup({
            title: _('Windows shortcuts'),
            description: _('Super+X opens the Quick Link menu, which is also '
                + 'a right-click of the Start button. Super+V opens '
                + 'clipboard history at the pointer.'),
        });
        page.add(shortcuts);
        shortcuts.add(this._switch(settings, 'clipboard-history',
            _('Keep a clipboard history'),
            _('Choosing an entry copies it; an extension cannot paste for '
              + 'you on Wayland.')));
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
