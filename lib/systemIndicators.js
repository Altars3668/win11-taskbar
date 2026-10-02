/* systemIndicators.js — borrow GNOME's Quick Settings into the taskbar.
 *
 * On Windows the network, volume and battery glyphs sit together at the
 * right of the taskbar and open one shared flyout holding Wi-Fi, Bluetooth,
 * airplane mode, the volume and brightness sliders and a link to Settings.
 * GNOME already has exactly that panel — Quick Settings — backed by
 * NetworkManager, UPower and the mixer. Reimplementing it would mean
 * rebuilding all of that and getting it wrong.
 *
 * This module only moves the indicator; lib/systemFlyouts.js reshapes the
 * menu it opens. Everything is handed back untouched on disable.
 */

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Indicators worth moving, in the order Windows shows their equivalents.
 *
 * The date menu is deliberately not here. Its menu is the notification
 * centre, so it has to stay mapped — but every attempt to move it here
 * and hide it left the clock label showing somewhere: zero width, clipping
 * and an off-screen position were each defeated in turn. extension.js
 * solves it from the other end by moving the whole top bar off-screen
 * instead of hiding it, so the date menu keeps working where it is. */
const WANTED = ['quickSettings'];

export class SystemIndicators {
    constructor(container, taskbar) {
        this._container = container;
        this._taskbar = taskbar;
        this._borrowed = [];

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
        }
    }

    /** Put everything back where the shell had it. */
    destroy() {
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
