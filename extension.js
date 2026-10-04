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
import {ShellMenus} from './lib/shellMenus.js';
import {setGettext as setStartGettext} from './lib/startMenu.js';
import {StatusNotifierHost} from './lib/statusNotifier.js';
import {WindowMotion} from './lib/windowMotion.js';
import {setGettext as setTrayGettext} from './lib/trayArea.js';
import {setGettext as setEditorGettext} from './lib/quickSettingsEditor.js';
import {setGettext as setLinksGettext} from './lib/quickLinks.js';
import {setGettext as setClipGettext} from './lib/clipboardHistory.js';
import {cleanup as cleanupTheme, setExtensionSettings} from './lib/theme.js';

export default class Win11TaskbarExtension extends Extension {
    enable() {
        setGettext(_);
        setMenuGettext(_);
        setStartGettext(_);
        setTrayGettext(_);
        setEditorGettext(_);
        setLinksGettext(_);
        setClipGettext(_);

        this._settings = this.getSettings();
        setExtensionSettings(this._settings);
        this._taskbars = [];
        this._topPanelHidden = false;

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._rebuild());
        this._settingsIds = [
            this._settings.connect('changed::multi-monitor', () => this._rebuild()),
            this._settings.connect('changed::hide-top-panel', () => this._syncTopPanel()),
            this._settings.connect('changed::context-menu-on-release',
                () => this._syncShellMenus()),
        ];

        // One watcher for the whole session, shared by every taskbar.
        if (this._settings.get_boolean('show-tray'))
            this._statusHost = new StatusNotifierHost();

        // Before the taskbars: their menu managers bind the shell's handler
        // when they are made, and should get the one lib/shellMenus.js wraps.
        this._syncShellMenus();
        this._windowMotion = new WindowMotion();
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

        this._shellMenus?.destroy();
        this._shellMenus = null;

        this._destroyTaskbars();
        this._windowMotion?.destroy();
        this._windowMotion = null;

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
                    new Taskbar(index, this._settings, this._statusHost,
                        () => this.openPreferences(), _));
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _destroyTaskbars() {
        for (const bar of this._taskbars ?? [])
            bar.destroy();
        this._taskbars = [];
    }

    /** The shell's own right-click menus follow the same setting as ours. */
    _syncShellMenus() {
        const wanted = this._settings.get_boolean('context-menu-on-release');
        if (wanted && !this._shellMenus) {
            this._shellMenus = new ShellMenus();
        } else if (!wanted && this._shellMenus) {
            this._shellMenus.destroy();
            this._shellMenus = null;
        }
    }

    _syncTopPanel() {
        const shouldHide = this._settings.get_boolean('hide-top-panel');
        if (shouldHide === this._topPanelHidden)
            return;

        if (shouldHide) {
            // Plain hide() is fine now: nothing we need lives in the top
            // bar any more. The notification centre used to, which is why
            // this was once a good deal more complicated.
            //
            // It does have to be held down, though: the shell shows the
            // panel again whenever the Overview opens, so hiding it once
            // is not enough.
            const box = Main.layoutManager.panelBox;
            box.hide();
            this._panelWatchId = box.connect('notify::visible', () => {
                if (box.visible && this._topPanelHidden)
                    box.hide();
            });
            this._topPanelHidden = true;
        } else {
            this._restoreTopPanel();
        }
    }

    _restoreTopPanel() {
        if (!this._topPanelHidden)
            return;
        const box = Main.layoutManager.panelBox;
        this._topPanelHidden = false;
        if (this._panelWatchId) {
            box.disconnect(this._panelWatchId);
            this._panelWatchId = 0;
        }
        box.show();
    }
}
