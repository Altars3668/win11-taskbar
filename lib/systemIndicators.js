/* systemIndicators.js — borrow GNOME's Quick Settings into the taskbar.
 *
 * On Windows the network, volume and battery glyphs sit together at the
 * right of the taskbar and open one shared flyout holding Wi-Fi, Bluetooth,
 * airplane mode, the volume and brightness sliders and a link to Settings.
 * GNOME already has exactly that panel — Quick Settings — backed by
 * NetworkManager, UPower and the mixer. Reimplementing it would mean
 * rebuilding all of that and getting it wrong.
 *
 * This module only moves the indicator — leaving out GNOME's power-off icon
 * where there is no battery, as Windows has none there; lib/systemFlyouts.js
 * reshapes the menu it opens. Everything is handed back untouched on
 * disable.
 */

import Clutter from 'gi://Clutter';
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
        this._orientation = Clutter.Orientation.HORIZONTAL;
        this._addedIds = new Map();

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
                indicator,
                parent,
                index: siblings.indexOf(actor),
            });

            parent.remove_child(actor);
            container.add_child(actor);
            actor.add_style_class_name('w11-system-indicator');
        }
        this._hidePowerOffIcon();
    }

    /* Where there is no battery GNOME shows a power-off icon in its place;
     * a Windows desktop shows nothing there — powering off is the Start
     * menu's, and Win+X's. A battery's icon stays, as on Windows. */
    _hidePowerOffIcon() {
        const system = Main.panel.statusArea.quickSettings?._system;
        const toggle = system?._systemItem?.powerToggle;
        const icon = system?._indicator;
        if (!toggle || !icon)
            return;
        const sync = () => (icon.visible = toggle.visible);
        this._power = {icon, toggle, id: toggle.connect('notify::visible', sync)};
        sync();
    }

    /**
     * Lay the icons along the bar: GNOME's row becomes a column on a bar
     * standing on a side.
     *
     * @param {Clutter.Orientation} orientation the bar's
     */
    setOrientation(orientation) {
        this._orientation = orientation;
        // Each of GNOME's indicators is a row of its own, and more arrive
        // later: the network's, other extensions'.
        const lay = box => {
            if (box instanceof St.BoxLayout)
                box.orientation = this._orientation;
        };
        for (const {indicator} of this._borrowed) {
            const box = indicator?._indicators;
            if (!box)
                continue;
            lay(box);
            box.get_children().forEach(lay);
            if (!this._addedIds.has(box))
                this._addedIds.set(box, box.connect('child-added', (_box, child) => lay(child)));
        }
    }

    /** Put everything back where the shell had it. */
    destroy() {
        if (this._power) {
            this._power.toggle.disconnect(this._power.id);
            this._power.icon.visible = true;
            this._power = null;
        }
        this.setOrientation(Clutter.Orientation.HORIZONTAL);
        for (const [box, id] of this._addedIds)
            box.disconnect(id);
        this._addedIds.clear();
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
