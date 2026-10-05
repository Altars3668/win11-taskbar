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

export function startLayout(mode, monitorWidth, monitorHeight, barHeight, scale) {
    const fullscreen = mode === 'fullscreen';
    const wide = mode === 'wide' || fullscreen;
    const gap = START_MENU.gapFromPanel * scale;
    const width = fullscreen ? monitorWidth - gap * 2 :
        Math.min((wide ? START_MENU.width : 640) * scale, monitorWidth - gap * 2);
    const height = Math.min((fullscreen ? monitorHeight / scale : wide ? START_MENU.height : 720) * scale,
        monitorHeight - barHeight - gap * 2);
    const contentWidth = Math.max(1, width / scale - START_MENU.padding * 2);
    const columns = Math.max(1, Math.min(fullscreen ? 12 : wide ? 8 : 6,
        Math.floor(contentWidth / 72)));
    const tileWidth = Math.min(START_MENU.tileWidth, contentWidth / columns);
    // 搜索、标题、页脚和边距先保留；小屏幕滚动固定项，不挤掉电源入口。
    const rows = Math.max(1, Math.min(wide ? 2 : 3,
        Math.floor((height / scale - 300) / START_MENU.tileHeight)));
    return {width, height, columns, rows, tileWidth};
}
