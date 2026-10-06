/* 开始菜单可选入口与屏幕约束；prefs 和 Shell 共用同一份定义。 */
import {START_MENU} from './spec.js';

export const START_SHORTCUTS = [
    {id: 'files', label: 'File Explorer', icon: 'folder-symbolic', desktop: 'org.gnome.Nautilus.desktop'},
    {id: 'settings', label: 'Settings', icon: 'emblem-system-symbolic', desktop: 'org.gnome.Settings.desktop'},
    {id: 'documents', label: 'Documents', icon: 'folder-documents-symbolic', directory: 'DOCUMENTS'},
    {id: 'downloads', label: 'Downloads', icon: 'folder-download-symbolic', directory: 'DOWNLOAD'},
    {id: 'music', label: 'Music', icon: 'folder-music-symbolic', directory: 'MUSIC'},
    {id: 'pictures', label: 'Pictures', icon: 'folder-pictures-symbolic', directory: 'PICTURES'},
    {id: 'videos', label: 'Videos', icon: 'folder-videos-symbolic', directory: 'VIDEOS'},
    {id: 'network', label: 'Network', icon: 'network-workgroup-symbolic', uri: 'network:///'},
    {id: 'home', label: 'Personal folder', icon: 'user-home-symbolic', directory: 'HOME'},
    {id: 'resources', label: 'Task Manager', icon: 'utilities-system-monitor-symbolic', desktop: 'net.nokyan.Resources.desktop'},
];

/** The smallest custom Start: four columns, one row of pins. */
export const START_CUSTOM_MIN = {width: 480, height: 480};

/**
 * The Start menu's size and grid.
 *
 * @param {string} mode compact, wide, custom or fullscreen
 * @param {number} areaWidth the room beside the taskbar, in device pixels:
 *   the monitor's width, less the bar when it stands on a side
 * @param {number} areaHeight likewise across: the monitor's height, less
 *   the bar when it lies along the top or bottom
 * @param {number} scale the monitor's scale factor
 * @param {{width: number, height: number}} [custom] the size of a custom
 *   Start, in logical pixels
 * @returns {{width, height, columns, rows, tileWidth}} device pixels, and
 *   the pinned grid
 */
export function startLayout(mode, areaWidth, areaHeight, scale, custom = null) {
    const fullscreen = mode === 'fullscreen';
    const wide = mode === 'wide' || fullscreen;
    const own = mode === 'custom' && custom;
    const gap = START_MENU.gapFromPanel * scale;
    const roomWidth = areaWidth - gap * 2;
    const roomHeight = areaHeight - gap * 2;
    let width, height;
    if (fullscreen) {
        [width, height] = [roomWidth, roomHeight];
    } else if (own) {
        width = Math.min(Math.max(custom.width, START_CUSTOM_MIN.width) * scale, roomWidth);
        height = Math.min(Math.max(custom.height, START_CUSTOM_MIN.height) * scale, roomHeight);
    } else {
        width = Math.min((wide ? START_MENU.width : 640) * scale, roomWidth);
        height = Math.min((wide ? START_MENU.height : 720) * scale, roomHeight);
    }
    const contentWidth = Math.max(1, width / scale - START_MENU.padding * 2);
    // A custom Start takes as many whole tiles as its width holds — six
    // at the compact 640, eight at the Insider 832.
    const most = fullscreen ? 12 : own ? 12 : wide ? 8 : 6;
    const columns = Math.max(1, Math.min(most,
        Math.floor(contentWidth / (own ? START_MENU.tileWidth : 72))));
    const tileWidth = Math.min(START_MENU.tileWidth, contentWidth / columns);
    // 搜索、标题、页脚和边距先保留；小屏幕滚动固定项，不挤掉电源入口。
    // A custom Start spends its height on rows of pins: three at the
    // compact 720, as the compact layout has.
    const rows = own
        ? Math.max(1, Math.min(8, Math.floor((height / scale - 420) / START_MENU.tileHeight)))
        : Math.max(1, Math.min(wide ? 2 : 3,
            Math.floor((height / scale - 300) / START_MENU.tileHeight)));
    return {width, height, columns, rows, tileWidth};
}
