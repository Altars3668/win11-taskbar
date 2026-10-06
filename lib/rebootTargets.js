/* rebootTargets.js — the systems the computer can restart into, for the
 * power menus.
 *
 * Another extension (Custom Reboot) lists boot entries — Windows, another
 * Linux, the firmware — in a quick settings tile; choosing one sets it as
 * the next boot and asks to restart. Windows keeps its power choices in
 * Start and Win+X, not in quick settings, so the tile stays hidden there
 * (quickPages.js) and its entries are offered beside Restart instead. Each
 * one runs the tile's own item, so the other extension does the work.
 */
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Whether a quick settings item is the tile for rebooting into another
 * system.
 *
 * @param {Clutter.Actor} actor a child of the quick settings grid
 * @returns {boolean} whether it is
 */
export function isRebootTile(actor) {
    const type = actor.constructor?.$gtype?.name ?? actor.constructor?.name ?? '';
    return /RebootQuickMenu/.test(type) || /reboot\s*into/i.test(actor.title ?? '');
}

/**
 * The boot entries on offer, in the tile's order.
 *
 * @returns {{label: string, activate: Function}[]} the entries, or none
 */
export function rebootTargets() {
    const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
    const tile = grid?.get_children().find(isRebootTile);
    // Its entries have a section of their own; the rest of its menu is
    // about the other extension itself.
    const section = tile?._itemsSection;
    return section?._getMenuItems()
        .filter(item => item.label && item.visible)
        .map(item => ({
            label: item.label.text,
            activate: () => item.activate(Clutter.get_current_event()),
        })) ?? [];
}
