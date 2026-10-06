/* 无箭头菜单的显式锚点；避免 BoxPointer 把宽按钮中心当成左边界。
 * 按任务栏所在的边放在锚点内侧（底边任务栏放上方、左边任务栏放右侧……），放不下时翻到
 * 另一侧，并限制在工作区内。传入 point 时按该点定位（如右键处），不读取锚点演员的几何。 */
import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {isVertical, placeBeside} from './barEdge.js';
import {duration} from './motion.js';

/**
 * Place a menu beside what opened it, rather than where its BoxPointer
 * would.
 *
 * @param {PopupMenu.PopupMenu} menu the menu
 * @param {Clutter.Actor} source what it belongs to
 * @param {object} [options] tuning
 * @param {number} [options.gap] logical distance from the source
 * @param {string} [options.edge] the edge of the bar it opens from: the
 *   menu goes on the other side of the source — above it for 'bottom',
 *   below for 'top', to the right for 'left', to the left for 'right'
 * @param {number} [options.alignment] which point of the menu, 0 to 1
 *   along the bar, lines up with the source's centre
 * @param {number[]} [options.point] a point to open at instead of the source
 */
export function anchorPopup(menu, source, {gap = 8, edge = 'bottom', alignment = 0.5, point = null} = {}) {
    const vertical = isVertical(edge);
    const pointer = menu._boxPointer;
    const originalPosition = pointer._reposition;
    pointer._reposition = function (box) {
        originalPosition.call(this, box);
        const [x, y] = point ?? source.get_transformed_position();
        const [w, h] = point ? [1, 1] : source.get_transformed_size();
        // 刚创建、尚未分配的演员几何是 NaN；此时保留原生位置，等下一次分配。
        if (![x, y, w, h].every(Number.isFinite))
            return;
        const index = global.display.get_monitor_index_for_rect(new Mtk.Rectangle({
            x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(w)),
            height: Math.max(1, Math.round(h))}));
        const area = Main.layoutManager.getWorkAreaForMonitor(Math.max(0, index));
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = box.get_width();
        const height = box.get_height();
        const place = placeBeside(edge, {x, y, width: w, height: h}, {width, height},
            {x: area.x, y: area.y, width: area.width, height: area.height},
            {gap: gap * scale, margin: 8 * scale, alignment});
        // Above (or left of) the source, or below (right of) it.
        menu._w11OpensBefore = vertical ? place.x < x : place.y < y;
        // 从锚点旁边长出：原点放在锚点中心对应的位置。
        const along = vertical
            ? height > 0 ? (y + h / 2 - place.y) / height : alignment
            : width > 0 ? (x + w / 2 - place.x) / width : alignment;
        const pivotAlong = Math.max(0, Math.min(along, 1));
        const pivotAcross = menu._w11OpensBefore ? 1 : 0;
        menu._w11Pivot = vertical ? [pivotAcross, pivotAlong] : [pivotAlong, pivotAcross];
        this.set_pivot_point(...menu._w11Pivot);

        let parent = this.get_parent();
        while (parent) {
            const [ok, lx, ly] = parent.transform_stage_point(place.x, place.y);
            if (ok) {
                box.set_origin(Math.round(lx), Math.round(ly));
                break;
            }
            parent = parent.get_parent();
        }
    };
    const open = menu.open;
    menu.open = function () {
        const alreadyOpen = this.isOpen;
        open.call(this, PopupAnimation.NONE);
        if (alreadyOpen || !this.isOpen)
            return;
        const actor = this.actor;
        const before = menu._w11OpensBefore ?? (edge === 'bottom' || edge === 'right');
        // A short way out of the source, towards where the menu opened.
        const shift = before ? 4 : -4;
        actor.remove_all_transitions();
        actor.set_pivot_point(...menu._w11Pivot ??
            (vertical ? [before ? 1 : 0, alignment] : [alignment, before ? 1 : 0]));
        actor.set({opacity: 0, scale_x: 0.98, scale_y: 0.98,
            translation_x: vertical ? shift : 0, translation_y: vertical ? 0 : shift});
        actor.ease({opacity: 255, scale_x: 1, scale_y: 1, translation_x: 0, translation_y: 0,
            duration: duration(150), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    };
}
