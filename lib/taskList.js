/* taskList.js — the strip of task buttons, kept in sync with reality.
 *
 * Windows lists pinned apps first, in the order they were pinned, then the
 * running apps that are not pinned, in the order they first appeared. A
 * button disappears when its app is neither pinned nor running any longer.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import {JumpList} from './jumpList.js';
import {TaskButton} from './taskButton.js';
import * as Windows from './windows.js';

export const TaskList = GObject.registerClass(
class TaskList extends St.BoxLayout {
    _init(taskbar) {
        super._init({
            style_class: 'w11-task-list',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: false,
            y_expand: true,
        });

        this._taskbar = taskbar;
        this._buttons = new Map(); // app id -> TaskButton
        this._menu = null;
        this._syncId = 0;

        this._appSystem = Shell.AppSystem.get_default();
        this._favorites = AppFavorites.getAppFavorites();

        this._signals = [];
        this._connect(this._appSystem, 'app-state-changed', () => this.queueSync());
        this._connect(this._appSystem, 'installed-changed', () => this.queueSync());
        this._connect(this._favorites, 'changed', () => this.queueSync());
        this._connect(global.display, 'notify::focus-window', () => this._syncStates());
        this._connect(this._taskbar.settings, 'changed::flash-attention', () => this._syncStates());
        this._connect(global.display, 'window-created', () => this.queueSync());
        this._connect(global.window_manager, 'switch-workspace', () => this.queueSync());
        this._connect(global.workspace_manager, 'active-workspace-changed',
            () => this.queueSync());

        this.connect('destroy', () => this._onDestroy());
        this.sync();
    }

    _connect(obj, signal, cb) {
        this._signals.push([obj, obj.connect(signal, cb)]);
    }

    /** Coalesce bursts of events into one rebuild on the next idle. */
    queueSync() {
        if (this._syncId)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncId = 0;
            this.sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** The apps that deserve a button right now, in Windows' order. */
    _targetApps() {
        const apps = [];
        const seen = new Set();

        if (this._taskbar.settings.get_boolean('show-pinned')) {
            for (const app of this._favorites.getFavorites()) {
                apps.push(app);
                seen.add(app.get_id());
            }
        }

        // Apps GNOME counts as running, and those that only take in windows
        // GNOME could not place.
        const candidates = [...this._appSystem.get_running(), ...Windows.fosterApps()];
        const running = candidates
            .filter(app => !seen.has(app.get_id()) && seen.add(app.get_id()))
            .filter(app => Windows.getAppWindows(app, this._taskbar.windowFilter).length > 0);

        // get_running() is ordered by most-recently-used; Windows keeps the
        // order the apps appeared in, so sort by the oldest window we see.
        running.sort((a, b) => {
            const seq = app => Math.min(...Windows.getAppWindows(
                app, this._taskbar.windowFilter).map(w => w.get_stable_sequence()));
            return seq(a) - seq(b);
        });

        return [...apps, ...running];
    }

    /** Rebuild the button set, reusing the buttons that should stay. */
    sync() {
        const target = this._targetApps();
        const wanted = new Set(target.map(a => a.get_id()));

        for (const [id, button] of [...this._buttons]) {
            if (!wanted.has(id)) {
                if (this._menu?.sourceActor === button)
                    this._closeMenu();
                button.destroy();
                this._buttons.delete(id);
            }
        }

        target.forEach((app, index) => {
            let button = this._buttons.get(app.get_id());
            if (!button) {
                button = this._makeButton(app);
                this._buttons.set(app.get_id(), button);
                this.insert_child_at_index(button, index);
            } else {
                this.set_child_at_index(button, index);
            }
            button.sync();
        });
    }

    /** Cheap path: only the indicators changed, no buttons came or went. */
    _syncStates() {
        for (const button of this._buttons.values())
            button.sync();
    }

    _makeButton(app) {
        const button = new TaskButton(app, this._taskbar);

        button.connect('preview-requested', (btn, fromClick) => {
            const preview = this._taskbar.preview;
            // A click on an already-open flyout closes it, as on Windows.
            if (fromClick && preview.visible && preview.currentButton === btn)
                preview.dismiss();
            else
                preview.show(btn, app);
        });

        button.connect('preview-dismissed', () => {
            this._taskbar.preview.scheduleHide();
        });

        button.connect('menu-requested', () => this._openMenu(button, app));

        return button;
    }

    _openMenu(button, app) {
        this._taskbar.preview.dismiss();
        this._closeMenu();

        this._taskbar.holdVisible(true);
        this._menu = new JumpList(button, app, this._taskbar);
        this._menu.connect('open-state-changed', (menu, open) => {
            if (!open) {
                this._taskbar.holdVisible(false);
                // Only this menu: another may have opened since — a right
                // click on a second button closes the first menu and opens
                // the next before this idle runs.
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (this._menu === menu)
                        this._closeMenu();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
        this._menu.open(true);
    }

    _closeMenu() {
        if (!this._menu)
            return;
        const menu = this._menu;
        this._menu = null;
        menu.destroy();
    }

    /** Re-apply measured geometry after a scale change. */
    updateMetrics() {
        for (const button of this._buttons.values())
            button.updateMetrics();
    }

    _onDestroy() {
        if (this._syncId) {
            GLib.source_remove(this._syncId);
            this._syncId = 0;
        }
        this._closeMenu();
        for (const [obj, id] of this._signals)
            obj.disconnect(id);
        this._signals = [];
        this._buttons.clear();
    }
});
