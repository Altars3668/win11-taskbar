/* snapPreview.js — where a dragged window is about to go, shown as Windows
 * 11 shows it.
 *
 * Measured on the reference machine (2026-10-06, the light theme), over a
 * backdrop of our own in bands of white and dark grey, frame by frame:
 * - a sheet of what is behind, blurred by a gaussian of 30px — Windows'
 *   acrylic blur — with a light grey, rgb(205,205,205), at 0.46 over it;
 *   a 1px edge, rgba(94,94,94,0.43), over the blur rather than the grey;
 *   8px corners; and below it the shadow of a window, light at the sides
 *   and darker below. The grey's fine grain is acrylic's noise;
 * - it lies below the window being dragged, which stays on top;
 * - it grows out of the window, quickly at first — 60% of the way in 40ms,
 *   93% in 135ms, there by 200ms, an exponential ease-out of 300ms — and
 *   moves to another place the same way;
 * - when the pointer leaves the edge it shrinks back into the window in
 *   about 90ms, slowly at first, and is gone.
 * Where the places are, and when, is EDGE in snapGeometry.js. Nothing of
 * the dark theme was measured: its grey is the light one's counterpart
 * (stylesheet.css).
 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {AcrylicSurface} from './acrylicSurface.js';
import {duration} from './motion.js';
import {WINDOW_FRAME} from './spec.js';
import {applyThemeClass} from './theme.js';
import {paintShadow} from './windowFrames.js';

/** The blur's radius: St's blur takes twice the gaussian's sigma. */
const BLUR_RADIUS = 60;
const GROW_MS = 300;
const SHRINK_MS = 90;

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

export const SnapPreview = GObject.registerClass({GTypeName: 'W11SnapPreview'},
class SnapPreview extends St.Widget {
    /**
     * @param {Meta.Window} win the window being dragged, left out of what
     *   shows through
     */
    _init(win) {
        super._init({reactive: false});
        this._shadow = new St.DrawingArea({reactive: false});
        this._shadow.connect('repaint', paintShadow);
        this._material = new AcrylicSurface(BLUR_RADIUS, true, 'w11-snap-preview');
        this._material.exclude = win;
        // The material stops a pixel short of its edge; the edge is drawn
        // on top, in that pixel.
        this._edge = new St.Widget({style_class: 'w11-snap-preview-edge', reactive: false});
        this.add_child(this._shadow);
        this.add_child(this._material);
        this.add_child(this._edge);
        applyThemeClass(this);
        this.target = null;
        this._gone = false;
        this.connect('destroy', () => {
            this._gone = true;
        });
    }

    _go() {
        if (!this._gone)
            this.destroy();
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        const [width, height] = box.get_size();
        const s = scaleFactor();
        const {left, right, top, bottom} = WINDOW_FRAME.shadow;
        this._shadow.allocate(new Clutter.ActorBox({x1: -left * s, y1: -top * s,
            x2: width + right * s, y2: height + bottom * s}));
        const inside = new Clutter.ActorBox({x1: 0, y1: 0, x2: width, y2: height});
        this._material.allocate(inside);
        this._edge.allocate(inside);
    }

    _ease(rect, ms, mode, onStopped) {
        this.remove_all_transitions();
        const time = duration(ms);
        if (time === 0) {
            this.set({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
            onStopped?.();
            return;
        }
        this.ease({x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            duration: time, mode, onStopped});
    }

    /**
     * Grow out of the window into a place.
     *
     * @param {object} from the window's frame
     * @param {object} to the preview of the place
     */
    grow(from, to) {
        this.set({x: from.x, y: from.y, width: from.width, height: from.height, opacity: 255});
        this.moveTo(to);
    }

    /**
     * Move to another place.
     *
     * @param {object} to the preview of the place
     */
    moveTo(to) {
        this.target = to;
        this._ease(to, GROW_MS, Clutter.AnimationMode.EASE_OUT_EXPO);
    }

    /**
     * Shrink back into the window, and go.
     *
     * @param {object} into the window's frame
     */
    shrink(into) {
        this.target = null;
        this._ease(into, SHRINK_MS, Clutter.AnimationMode.EASE_IN_QUAD, () => this._go());
    }

    /** Go at once, fading: the window has been let go into the place. */
    dismiss() {
        this.target = null;
        this.remove_all_transitions();
        const time = duration(SHRINK_MS);
        if (time === 0) {
            this._go();
            return;
        }
        this.ease({opacity: 0, duration: time, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: () => this._go()});
    }
});
