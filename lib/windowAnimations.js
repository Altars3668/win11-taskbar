/* windowAnimations.js — windows open, close, minimise and restore the way
 * Windows 11 animates them (lib/spec.js, WINDOW_MOTION).
 *
 * GNOME runs these animations itself, and its handlers were bound when
 * the shell started, so they cannot be swapped for others. What they do
 * is call each window actor's ease() with the end state; so each actor's
 * ease() is wrapped, and when GNOME is mapping, destroying, minimising or
 * unminimising that actor the wrapper changes where it starts, where it
 * ends, how long it takes and its curve. GNOME still completes the effect
 * itself. A window launched from the taskbar keeps its own way in
 * (windowMotion.js), which wraps ease() above this one.
 */
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {WINDOW_MOTION} from './spec.js';

let current = null;

/**
 * The last few animations this module shaped, oldest first, for the tests.
 *
 * @returns {object[]|null} the log, or null while it is off
 */
export function animationLog() {
    return current?.log ?? null;
}

const LOG_LENGTH = 20;

export class WindowAnimations {
    constructor() {
        this._wrapped = new Map(); // actor -> restore
        this.log = [];
        current = this;
        for (const actor of global.get_window_actors())
            this._wrap(actor);
        // A window's actor joins the window group before it is mapped.
        this._addedId = global.window_group.connect('child-added',
            (_group, actor) => this._wrap(actor));
    }

    _wrap(actor) {
        if (!actor.meta_window || this._wrapped.has(actor))
            return;
        const original = actor.ease;
        const owned = Object.hasOwn(actor, 'ease');
        let active = true;
        let destroyId = 0;
        let wrapper;
        const restore = () => {
            if (!active)
                return;
            active = false;
            // Another wrapper put on top later stays; this one then only
            // passes calls on (windowMotion.js does the same).
            if (actor.ease === wrapper) {
                if (owned)
                    actor.ease = original;
                else
                    delete actor.ease;
            }
            if (destroyId)
                actor.disconnect(destroyId);
            destroyId = 0;
            this._wrapped.delete(actor);
        };
        wrapper = params => original.call(actor,
            active ? this._reshape(actor, params) ?? params : params);
        actor.ease = wrapper;
        this._wrapped.set(actor, restore);
        destroyId = actor.connect('destroy', () => {
            destroyId = 0;
            restore();
        });
    }

    /* What GNOME is easing the actor into, and what Windows would do
     * instead; null leaves GNOME's animation alone. */
    _reshape(actor, params) {
        const wm = Main.wm;
        const spec = WINDOW_MOTION;
        let phase = null;
        let reshaped = null;
        if (wm._mapping.has(actor) && params.opacity === 255 &&
            params.scale_x === 1 && params.scale_y === 1) {
            // A launch from the taskbar comes out of its button instead.
            if (actor._w11LaunchOrigin)
                return null;
            // GNOME has just set its own start: unfolding from the bottom.
            actor.set_pivot_point(0.5, 0.5);
            actor.set_scale(spec.openScale, spec.openScale);
            actor.opacity = 0;
            phase = 'map';
            reshaped = {...params, duration: spec.openMs,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC};
        } else if (wm._destroying.has(actor) &&
                   (params.opacity === 0 || params.scale_y === 0)) {
            actor.set_pivot_point(0.5, 0.5);
            phase = 'destroy';
            reshaped = {...params, opacity: 0, scale_x: spec.closeScale,
                scale_y: spec.closeScale, duration: spec.closeMs,
                mode: Clutter.AnimationMode.EASE_IN_QUAD};
        } else if (wm._minimizing.has(actor)) {
            // Into the button GNOME aims at — the taskbar's, which sets
            // every window's icon geometry.
            phase = 'minimize';
            reshaped = {...params, duration: spec.minimizeMs,
                mode: Clutter.AnimationMode.EASE_IN_CUBIC};
        } else if (wm._unminimizing.has(actor)) {
            // GNOME brings it back at full opacity; Windows fades it in.
            if (params.opacity === undefined)
                actor.opacity = 0;
            phase = 'unminimize';
            reshaped = {...params, opacity: 255, duration: spec.restoreMs,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC};
        }
        if (!phase)
            return null;
        this.log.push({
            phase,
            title: actor.meta_window?.get_title() ?? null,
            scale: [actor.scale_x, actor.scale_y],
            pivot: actor.get_pivot_point(),
            opacity: actor.opacity,
            to: {opacity: reshaped.opacity ?? null, scale_x: reshaped.scale_x ?? null,
                scale_y: reshaped.scale_y ?? null},
            duration: reshaped.duration,
            mode: Object.keys(Clutter.AnimationMode)
                .find(name => Clutter.AnimationMode[name] === reshaped.mode) ?? reshaped.mode,
        });
        if (this.log.length > LOG_LENGTH)
            this.log.shift();
        return reshaped;
    }

    destroy() {
        global.window_group.disconnect(this._addedId);
        for (const restore of [...this._wrapped.values()])
            restore();
        this.log = [];
        if (current === this)
            current = null;
    }
}
