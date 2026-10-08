/* 本项目的自适应策略，不是 Windows 实测值。输入只依赖屏幕与实际占用。 */
import {PANEL, SEARCH} from './spec.js';

export function taskbarSizingMode(settings) {
    return !settings.get_user_value('taskbar-size-mode') && settings.get_user_value('taskbar-size')
        ? 'manual' : settings.get_string('taskbar-size-mode');
}

export function taskbarSize(mode, width, height, scale = 1, manual = PANEL.height) {
    if (mode !== 'auto') return Math.max(32, Math.min(96, manual));
    const short = Math.min(width, height) / Math.max(1, scale);
    const long = Math.max(width, height) / Math.max(1, scale);
    if (short <= 800) return 40;
    return short >= 1300 && long >= 2400 ? 56 : 48;
}

export function searchStyle(mode, available, vertical = false, size = PANEL.height) {
    if (mode === 'hidden') return 'hidden';
    if (vertical) return 'icon';
    if (mode !== 'auto') return mode;
    if (available >= SEARCH.box.width + 16) return 'box';
    if (available >= SEARCH['icon-label'].width + 16) return 'icon-label';
    return 'icon';
}

export function taskStripBudget(length, sides, controls, natural, search) {
    return Math.max(0, Math.min(natural, length - sides - controls - search));
}
