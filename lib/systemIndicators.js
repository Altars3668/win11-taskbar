/* systemIndicators.js — borrow GNOME's Quick Settings into the taskbar.
 *
 * On Windows the network, volume and battery glyphs sit together at the
 * right of the taskbar and open one shared flyout holding Wi-Fi, Bluetooth,
 * airplane mode, the volume and brightness sliders and a link to Settings.
 * GNOME already has exactly that panel — Quick Settings — backed by
 * NetworkManager, UPower and the mixer. Reimplementing it would mean
 * rebuilding all of that and getting it wrong.
 *
 * So we move the real indicator into the taskbar, and restyle and
 * reposition its menu to sit where Windows puts the flyout: anchored to the
 * bottom-right corner rather than centred under the button. It is handed
 * back untouched on disable.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {applyThemeClass} from './theme.js';

/** Measured on Windows: the flyout's margin from the screen corner. */
const CORNER_MARGIN = 12;

/** Indicators worth moving, in the order Windows shows their equivalents. */
const WANTED = ['quickSettings'];

export class SystemIndicators {
    constructor(container, taskbar) {
        this._container = container;
        this._taskbar = taskbar;
        this._borrowed = [];
        this._menuTweaks = [];

        for (const name of WANTED) {
            const indicator = Main.panel.statusArea[name];
            const actor = indicator?.container ?? indicator;
            if (!actor)
                continue;

            const parent = actor.get_parent();
            if (!parent)
                continue;

            // Remember exactly where it came from so disable() is lossless.
            const siblings = parent.get_children();
            this._borrowed.push({
                actor,
                parent,
                index: siblings.indexOf(actor),
            });

            parent.remove_child(actor);
            container.add_child(actor);
            actor.add_style_class_name('w11-system-indicator');

            this._styleMenu(indicator);
        }
    }

    /** Make the Quick Settings flyout look and sit like the Windows one. */
    _styleMenu(indicator) {
        const menu = indicator?.menu;
        if (!menu?.actor)
            return;

        menu.actor.add_style_class_name('w11-quick-settings');
        applyThemeClass(menu.actor);

        // Windows anchors the flyout to the screen corner, not to the glyph
        // that opened it. GNOME's BoxPointer centres on its source actor, so
        // nudge it after it has been laid out.
        const openId = menu.connect('open-state-changed', (_m, open) => {
            if (!open)
                return;
            applyThemeClass(menu.actor);
            this._anchorToCorner(menu);
        });
        this._menuTweaks.push({menu, openId});
    }

    _anchorToCorner(menu) {
        const box = menu._boxPointer ?? menu.actor;
        if (!box)
            return;

        // Wait for the allocation to settle, otherwise the width is stale
        // and the panel lands in the wrong place on first open.
        const laterId = global.compositor.get_laters().add(
            Clutter.LaterType.BEFORE_REDRAW, () => {
                const monitor = Main.layoutManager.monitors[
                    this._taskbar?.monitorIndex ?? Main.layoutManager.primaryIndex] ??
                    Main.layoutManager.primaryMonitor;
                const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
                const margin = CORNER_MARGIN * scale;
                const width = box.allocation.get_width();
                const height = box.allocation.get_height();

                const x = monitor.x + monitor.width - width - margin;
                const y = this._taskbar?.isBottom ?? true
                    ? monitor.y + monitor.height - this._taskbarHeight() - height - margin
                    : monitor.y + this._taskbarHeight() + margin;

                box.set_position(Math.round(x), Math.round(y));
                return GLib.SOURCE_REMOVE;
            });
        this._laterId = laterId;
    }

    _taskbarHeight() {
        return this._taskbar?.height ?? 0;
    }

    /** Put everything back where the shell had it. */
    destroy() {
        for (const {menu, openId} of this._menuTweaks) {
            menu.disconnect(openId);
            menu.actor?.remove_style_class_name('w11-quick-settings');
        }
        this._menuTweaks = [];

        for (const {actor, parent, index} of this._borrowed) {
            if (!actor || actor.get_parent() === null && !parent)
                continue;
            actor.remove_style_class_name('w11-system-indicator');
            const current = actor.get_parent();
            if (current)
                current.remove_child(actor);
            if (parent) {
                parent.insert_child_at_index(actor,
                    Math.min(index, parent.get_n_children()));
            }
        }
        this._borrowed = [];
        this._container = null;
    }
}
