/* 无箭头菜单的显式锚点；避免 BoxPointer 把宽按钮中心当成左边界。
 * 按偏好方向放在锚点上方或下方，放不下时翻到另一侧，并限制在工作区内。
 * 传入 point 时按该点定位（如右键处），不读取锚点演员的几何。 */
import Clutter from 'gi://Clutter';
import Mtk from 'gi://Mtk';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';
import {duration} from './motion.js';

export function anchorPopup(menu, source, {gap = 8, bottom = true, alignment = 0.5, point = null} = {}) {
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
        const margin = 8 * scale;
        const width = box.get_width();
        const height = box.get_height();
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));

        const px = clamp(x + w / 2 - width * alignment, area.x + margin,
            area.x + area.width - width - margin);
        const above = y - height - gap * scale;
        const below = y + h + gap * scale;
        const fitsAbove = above >= area.y + margin;
        const fitsBelow = below + height <= area.y + area.height - margin;
        let py = bottom
            ? fitsAbove || !fitsBelow ? above : below
            : fitsBelow || !fitsAbove ? below : above;
        py = clamp(py, area.y + margin, Math.max(area.y + margin, area.y + area.height - height - margin));
        menu._w11OpensAbove = py < y;
        // 从锚点正上（下）方长出：原点放在锚点中心对应的位置。
        const pivotX = width > 0 ? clamp((x + w / 2 - px) / width, 0, 1) : alignment;
        menu._w11PivotX = pivotX;
        this.set_pivot_point(pivotX, menu._w11OpensAbove ? 1 : 0);

        let parent = this.get_parent();
        while (parent) {
            const [ok, lx, ly] = parent.transform_stage_point(px, py);
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
        const opensAbove = menu._w11OpensAbove ?? bottom;
        actor.remove_all_transitions();
        actor.set_pivot_point(menu._w11PivotX ?? alignment, opensAbove ? 1 : 0);
        actor.set({opacity: 0, scale_x: 0.98, scale_y: 0.98, translation_y: opensAbove ? 4 : -4});
        actor.ease({opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0,
            duration: duration(150), mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    };
}
