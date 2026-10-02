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
            _('The taskbar stops reserving screen space.')));
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
