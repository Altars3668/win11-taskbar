/* systemIndicators.js — borrow GNOME's Quick Settings into the taskbar.
 *
 * On Windows the network, volume and battery glyphs sit together at the
 * right of the taskbar and open one shared flyout. GNOME already has
 * exactly that: the Quick Settings button in the top bar. Since we hide the
 * top bar, those controls have to come with us or the user loses their
 * volume slider and battery readout.
 *
 * So we reparent the real indicator rather than reimplementing it, and put
 * it back exactly where it was on disable.
 */

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** Indicators worth moving, in the order Windows shows their equivalents. */
const WANTED = ['quickSettings'];

export class SystemIndicators {
    constructor(container) {
        this._container = container;
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
