/* 无箭头菜单的显式锚点；避免 BoxPointer 把宽按钮中心当成左边界。 */
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {PopupAnimation} from 'resource:///org/gnome/shell/ui/boxpointer.js';

export function anchorPopup(menu, source, {gap = 8, bottom = true} = {}) {
    const pointer = menu._boxPointer;
    const originalPosition = pointer._reposition;
    pointer._reposition = function (box) {
        originalPosition.call(this, box);
        const [x, y] = source.get_transformed_position();
        const [w, h] = source.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(source) ?? Main.layoutManager.primaryMonitor;
        const px = Math.max(monitor.x + 8, Math.min(x, monitor.x + monitor.width - box.get_width() - 8));
        const py = bottom ? y - box.get_height() - gap : y + h + gap;
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
        actor.remove_all_transitions();
        actor.set_pivot_point(0, bottom ? 1 : 0);
        actor.set({opacity: 0, scale_x: 0.98, scale_y: 0.98, translation_y: bottom ? 4 : -4});
        actor.ease({opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0,
            duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    };
}
