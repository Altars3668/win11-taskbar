/* 开始菜单固定项与任务栏固定项（GNOME 收藏夹）是两套独立列表，和 Windows 一样。 */
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

/* 首次使用时按 Windows 默认开始菜单的类别取本机已安装的对应应用；每组取第一个存在的。 */
const DEFAULT_GROUPS = [
    ['libreoffice-writer.desktop'],
    ['libreoffice-calc.desktop'],
    ['libreoffice-impress.desktop'],
    ['snap-store_snap-store.desktop', 'org.gnome.Software.desktop'],
    ['org.gnome.Loupe.desktop', 'org.gnome.eog.desktop', 'shotwell.desktop'],
    ['org.gnome.Settings.desktop'],
    ['org.gnome.Calendar.desktop'],
    ['org.gnome.Calculator.desktop'],
    ['org.gnome.clocks.desktop'],
    ['org.gnome.TextEditor.desktop', 'org.gnome.gedit.desktop'],
    ['org.gnome.Nautilus.desktop'],
    ['org.gnome.Showtime.desktop', 'org.gnome.Totem.desktop'],
];

function lookup(id) {
    return Shell.AppSystem.get_default().lookup_app(id);
}

function defaultPins() {
    const ids = [];
    // 默认浏览器放第一位，对应 Windows 开始菜单的 Edge。
    const browser = Gio.AppInfo.get_default_for_type('x-scheme-handler/https', false)?.get_id();
    if (browser && lookup(browser))
        ids.push(browser);
    for (const group of DEFAULT_GROUPS) {
        const id = group.find(candidate => lookup(candidate));
        if (id && !ids.includes(id))
            ids.push(id);
    }
    return ids;
}

/** 任务栏固定沿用 GNOME 收藏夹，但不显示 GNOME “已固定到 Dash”的提示。 */
export function setTaskbarPinned(id, pinned) {
    const favorites = AppFavorites.getAppFavorites();
    if (pinned)
        return favorites._addFavorite ? favorites._addFavorite(id, -1) : favorites.addFavorite(id);
    return favorites._removeFavorite ? favorites._removeFavorite(id) : favorites.removeFavorite(id);
}

export function isTaskbarPinned(id) {
    return AppFavorites.getAppFavorites().isFavorite(id);
}

export class StartPins {
    constructor(settings) {
        this._settings = settings;
        // 只在第一次初始化；之后用户把列表清空也保持为空，不再自动补回。
        if (!settings.get_boolean('start-pins-initialized')) {
            settings.set_strv('start-pinned', defaultPins());
            settings.set_boolean('start-pins-initialized', true);
        }
    }

    ids() {
        return this._settings.get_strv('start-pinned');
    }

    /** 已卸载的应用不显示，但保留在列表里，重新安装后回到原位。 */
    apps() {
        return this.ids().map(lookup).filter(Boolean);
    }

    isPinned(id) {
        return this.ids().includes(id);
    }

    pin(id) {
        if (!this.isPinned(id))
            this._settings.set_strv('start-pinned', [...this.ids(), id]);
    }

    unpin(id) {
        this._settings.set_strv('start-pinned', this.ids().filter(value => value !== id));
    }

    moveToFront(id) {
        this._settings.set_strv('start-pinned', [id, ...this.ids().filter(value => value !== id)]);
    }
}
