/* 任务栏空白处的 Windows 11 两项菜单；独立锚点随右键位置移动。 */
import St from 'gi://St';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {sideFacingBar} from './barEdge.js';
import {applyThemeClass} from './theme.js';

export class TaskbarMenu extends PopupMenu.PopupMenu {
    constructor(taskbar, openPreferences, gettext) {
        const anchor = new St.Widget({width: 1, height: 1, reactive: false});
        Main.uiGroup.add_child(anchor);
        super(anchor, 0, sideFacingBar(taskbar.edge));
        this._anchor = anchor;
        this.actor.add_style_class_name('w11-tray-menu');
        this.actor.add_style_class_name('w11-taskbar-menu');
        applyThemeClass(this.actor);
        const resources = Shell.AppSystem.get_default().lookup_app('net.nokyan.Resources.desktop');
        const manager = new PopupMenu.PopupImageMenuItem(gettext('Task Manager'), 'utilities-system-monitor-symbolic');
        manager.setSensitive(Boolean(resources));
        manager.connect('activate', () => resources?.activate_full(-1, global.get_current_time()));
        this.addMenuItem(manager);
        const preferences = new PopupMenu.PopupImageMenuItem(gettext('Taskbar settings'), 'emblem-system-symbolic');
        preferences.add_style_class_name('w11-taskbar-settings-item');
        preferences.connect('activate', openPreferences);
        this.addMenuItem(preferences);
        Main.uiGroup.add_child(this.actor);
        this.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(taskbar);
        this._manager.addMenu(this);
        taskbar.applyAcrylicToPopup(this);
    }

    openAt(x, y) {
        this.close(false);
        this._anchor.set_position(Math.round(x), Math.round(y));
        applyThemeClass(this.actor);
        this.open(true);
    }

    destroy() {
        super.destroy();
        this._anchor.destroy();
    }
}
