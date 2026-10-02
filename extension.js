/* extension.js — entry point.
 *
 * Creates one taskbar per monitor (Windows shows the bar on every display by
 * default) and, optionally, gets the native GNOME top bar out of the way so
 * the screen has a single bar, as Windows does.
 */

import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DebugService} from './lib/debugService.js';
import {setGettext as setMenuGettext} from './lib/dbusMenu.js';
import {setGettext} from './lib/jumpList.js';
import {Taskbar} from './lib/panel.js';
import {setGettext as setStartGettext} from './lib/startMenu.js';
import {StatusNotifierHost} from './lib/statusNotifier.js';
import {setGettext as setTrayGettext} from './lib/trayArea.js';
import {cleanup as cleanupTheme, setExtensionSettings} from './lib/theme.js';

export default class Win11TaskbarExtension extends Extension {
    enable() {
        setGettext(_);
        setMenuGettext(_);
        setStartGettext(_);
        setTrayGettext(_);

        this._settings = this.getSettings();
        setExtensionSettings(this._settings);
        this._taskbars = [];
        this._topPanelHidden = false;

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._rebuild());
        this._settingsIds = [
            this._settings.connect('changed::multi-monitor', () => this._rebuild()),
            this._settings.connect('changed::hide-top-panel', () => this._syncTopPanel()),
        ];

        // One watcher for the whole session, shared by every taskbar.
        if (this._settings.get_boolean('show-tray'))
            this._statusHost = new StatusNotifierHost();

        this._rebuild();
        this._syncTopPanel();

        if (this._settings.get_boolean('debug-service'))
            this._debug = new DebugService(() => this._taskbars);
    }

    disable() {
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }

        this._debug?.destroy();
        this._debug = null;

        this._destroyTaskbars();

        this._statusHost?.destroy();
        this._statusHost = null;

        this._restoreTopPanel();
        cleanupTheme();

        this._settings = null;
    }

    _rebuild() {
        // monitors-changed can fire several times while outputs settle.
        if (this._rebuildId)
            GLib.source_remove(this._rebuildId);
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._destroyTaskbars();

            const indices = this._settings.get_boolean('multi-monitor')
                ? Main.layoutManager.monitors.map((_m, i) => i)
                : [Main.layoutManager.primaryIndex];

            for (const index of indices) {
                this._taskbars.push(
                    new Taskbar(index, this._settings, this._statusHost));
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyTaskbars() {
        for (const bar of this._taskbars ?? [])
            bar.destroy();
        this._taskbars = [];
    }

    _syncTopPanel() {
        const shouldHide = this._settings.get_boolean('hide-top-panel');
        if (shouldHide === this._topPanelHidden)
            return;

        if (shouldHide) {
            // Hiding the panelBox (rather than the panel) also drops its
            // strut, so windows get the space back.
            Main.layoutManager.panelBox.hide();
            this._topPanelHidden = true;
        } else {
            this._restoreTopPanel();
        }
    }

    _restoreTopPanel() {
        if (!this._topPanelHidden)
            return;
        Main.layoutManager.panelBox.show();
        this._topPanelHidden = false;
    }
}
