/* extension.js — entry point.
 *
 * Creates one taskbar per monitor (Windows shows the bar on every display by
 * default) and, optionally, gets the native GNOME top bar out of the way so
 * the screen has a single bar, as Windows does.
 */

import GLib from 'gi://GLib';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AttentionToasts} from './lib/attentionToasts.js';
import {DebugService} from './lib/debugService.js';
import {NotificationPersistence} from './lib/notificationPersistence.js';
import {setGettext as setMenuGettext} from './lib/dbusMenu.js';
import {setGettext} from './lib/jumpList.js';
import {Taskbar} from './lib/panel.js';
import {ShellMenus} from './lib/shellMenus.js';
import {unwatchShellShutdown, watchShellShutdown} from './lib/shellShutdown.js';
import {setGettext as setStartGettext} from './lib/startMenu.js';
import {StatusNotifierHost} from './lib/statusNotifier.js';
import {SnapLayouts} from './lib/snapLayouts.js';
import {WindowAnimations} from './lib/windowAnimations.js';
import {WindowMotion} from './lib/windowMotion.js';
import {setGettext as setTrayGettext} from './lib/trayArea.js';
import {setGettext as setEditorGettext} from './lib/quickSettingsEditor.js';
import {setGettext as setLinksGettext} from './lib/quickLinks.js';
import {setGettext as setClipGettext} from './lib/clipboardHistory.js';
import {setGettext as setNotificationGettext} from './lib/notificationList.js';
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
        setNotificationGettext(_);

        this._settings = this.getSettings();
        setExtensionSettings(this._settings);
        watchShellShutdown();
        this._taskbars = [];
        this._topPanelHidden = false;

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this._rebuild());
        this._settingsIds = [
            this._settings.connect('changed::multi-monitor', () => this._rebuild()),
            // Every menu and flyout takes its side from the bar's edge when
            // it is made; a bar on another edge is made afresh.
            this._settings.connect('changed::position', () => this._rebuild()),
            this._settings.connect('changed::hide-top-panel', () => this._syncTopPanel()),
            this._settings.connect('changed::context-menu-on-release',
                () => this._syncShellMenus()),
            this._settings.connect('changed::window-animations',
                () => this._syncWindowAnimations()),
            // Win+Z is bound with the taskbar's other keys, so they are
            // bound afresh.
            this._settings.connect('changed::snap-layouts', () => {
                this._syncSnapLayouts();
                this._rebuild();
            }),
        ];

        // One watcher for the whole session, shared by every taskbar.
        if (this._settings.get_boolean('show-tray'))
            this._statusHost = new StatusNotifierHost();

        // Before the taskbars: their menu managers bind the shell's handler
        // when they are made, and should get the one lib/shellMenus.js wraps.
        this._syncShellMenus();
        this._syncWindowAnimations();
        this._syncSnapLayouts();
        this._windowMotion = new WindowMotion();
        this._notificationPersistence = new NotificationPersistence();
        this._attentionToasts = new AttentionToasts();
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
        this._windowAnimations?.destroy();
        this._windowAnimations = null;
        this._snapLayouts?.destroy();
        this._snapLayouts = null;
        this._notificationPersistence?.destroy();
        this._notificationPersistence = null;
        this._attentionToasts?.destroy();
        this._attentionToasts = null;

        this._statusHost?.destroy();
        this._statusHost = null;

        this._restoreTopPanel();
        cleanupTheme();
        unwatchShellShutdown();

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

    /** Windows' window animations, or GNOME's. */
    _syncWindowAnimations() {
        const wanted = this._settings.get_boolean('window-animations');
        if (wanted && !this._windowAnimations) {
            this._windowAnimations = new WindowAnimations();
        } else if (!wanted && this._windowAnimations) {
            this._windowAnimations.destroy();
            this._windowAnimations = null;
        }
    }

    /** Windows 11's snap layouts, while they are wanted. */
    _syncSnapLayouts() {
        const wanted = this._settings.get_boolean('snap-layouts');
        if (wanted && !this._snapLayouts) {
            this._snapLayouts = new SnapLayouts();
        } else if (!wanted && this._snapLayouts) {
            this._snapLayouts.destroy();
            this._snapLayouts = null;
        }
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
            const layout = Main.layoutManager;
            const box = layout.panelBox;
            // GNOME 50 的 strut 计算不检查 visible；隐藏演员仍会保留顶边工作区。
            const data = layout._trackedActors.find(record => record.actor === box);
            this._panelStrutData = data ?? null;
            this._panelHadStrut = data?.affectsStruts ?? false;
            if (data)
                data.affectsStruts = false;
            layout._queueUpdateRegions();
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
        if (this._panelStrutData &&
            Main.layoutManager._trackedActors.includes(this._panelStrutData))
            this._panelStrutData.affectsStruts = this._panelHadStrut;
        this._panelStrutData = null;
        Main.layoutManager._queueUpdateRegions();
        box.show();
    }
}
