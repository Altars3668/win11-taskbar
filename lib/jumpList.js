/* jumpList.js — the right-click menu Windows calls a Jump List.
 *
 * Windows orders it, top to bottom: recent documents, then the app's own
 * tasks, a separator, the app name (which starts a new instance), the
 * pin/unpin item, and finally the window-closing items. We keep that order,
 * sourcing the tasks from the .desktop file's Actions and the recent
 * documents from recently-used.xbel.
 *
 * Note we parse the XBEL file ourselves rather than calling
 * Gtk.RecentManager: gnome-shell does not link GTK, so importing it here
 * would fail at runtime even though it works fine in prefs.js.
 */

import Gio from 'gi://Gio';
import {recentForApplication} from './recentDocuments.js';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {sideFacingBar} from './barEdge.js';
import {applyThemeClass} from './theme.js';
import {setTaskbarPinned} from './startPins.js';
import * as Windows from './windows.js';

/** How many recent documents Windows shows by default. */
const MAX_RECENT = 10;

export class JumpList extends PopupMenu.PopupMenu {
    constructor(button, app, taskbar) {
        super(button, 0.5, sideFacingBar(taskbar.edge));

        this._app = app;
        this._taskbar = taskbar;
        this.actor.add_style_class_name('w11-jumplist');
        applyThemeClass(this.actor);

        this._recentSection = new PopupMenu.PopupMenuSection();
        this.addMenuItem(this._recentSection);
        this._build();
        this._recentUnsubscribe = taskbar.recentDocuments.subscribe(() => {
            this._addRecentItems(this._app.get_app_info());
        });
        this.actor.connect('destroy', () => {
            this._recentUnsubscribe?.();
            this._recentUnsubscribe = null;
        });
        taskbar.recentDocuments.refresh();

        Main.uiGroup.add_child(this.actor);
        this.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(button);
        this._manager.addMenu(this);
        taskbar.applyAcrylicToPopup(this);
    }

    _build() {
        const appInfo = this._app.get_app_info();

        this._addRecentItems(appInfo);
        this._addTaskItems(appInfo);

        if (!this.isEmpty())
            this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // The app name launches a new instance — Windows' bold first entry.
        const launch = new PopupMenu.PopupImageMenuItem(
            this._app.get_name(), this._app.get_icon());
        launch.connect('activate', () => {
            this._app.open_new_window(-1);
            Main.overview.hide();
        });
        this.addMenuItem(launch);

        this._addPinItem();
        this._addWindowItems();
    }

    _addRecentItems(appInfo) {
        this._recentSection.removeAll();
        if (!appInfo || !this._taskbar.settings.get_boolean('jumplist-recent')) return;
        const matches = recentForApplication(this._taskbar.recentDocuments.entries, appInfo, MAX_RECENT);
        if (!matches.length) return;
        this._recentSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Recent')));
        for (const item of matches) {
            const entry = new PopupMenu.PopupMenuItem(item.name);
            entry.connect('activate', () => this._app.launch(global.get_current_time(),
                [Gio.File.new_for_uri(item.uri)], -1));
            this._recentSection.addMenuItem(entry);
        }
    }

    _addTaskItems(appInfo) {
        if (!appInfo)
            return;
        const actions = appInfo.list_actions();
        if (actions.length === 0)
            return;

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(_('Tasks')));
        for (const action of actions) {
            const item = new PopupMenu.PopupMenuItem(
                appInfo.get_action_name(action));
            item.connect('activate', () => {
                this._app.launch_action(action, global.get_current_time(), -1);
                Main.overview.hide();
            });
            this.addMenuItem(item);
        }
    }

    _addPinItem() {
        const favorites = AppFavorites.getAppFavorites();
        const id = this._app.get_id();
        const pinned = favorites.isFavorite(id);

        const item = new PopupMenu.PopupImageMenuItem(
            pinned ? _('Unpin from taskbar') : _('Pin to taskbar'),
            pinned ? 'list-remove-symbolic' : 'list-add-symbolic');
        // 只改任务栏固定；开始菜单固定是另一套列表。
        item.connect('activate', () => setTaskbarPinned(id, !pinned));
        this.addMenuItem(item);
    }

    _addWindowItems() {
        const windows = Windows.getAppWindows(this._app, this._taskbar.windowFilter);
        if (windows.length === 0)
            return;

        this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const label = windows.length > 1 ? _('Close all windows') : _('Close window');
        const close = new PopupMenu.PopupImageMenuItem(label, 'window-close-symbolic');
        close.connect('activate', () => {
            const ts = global.get_current_time();
            for (const win of windows)
                win.delete(ts);
        });
        this.addMenuItem(close);
    }
}

/** Translation shim: the extension installs its own gettext domain, but the
 *  menu is built before the Extension object is reachable from here. */
let _gettext = s => s;

/**
 * Install the gettext function the menus should use.
 *
 * @param {Function} fn the extension's gettext
 */
export function setGettext(fn) {
    _gettext = fn;
}

function _(s) {
    return _gettext(s);
}
