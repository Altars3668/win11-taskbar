/* windowFrames.js — Windows 11's window corners, edge and shadow.
 *
 * Measured on the reference machine (a Settings window over the desktop):
 * corners of 8px; a 1px edge, the outermost pixel of the window, in a
 * translucent grey, rgba(123,123,123,0.375), over whatever is behind; and a
 * shadow that is light at the sides (alpha 0.16 at the edge, 0.11 at 8px,
 * 0.06 at 16px, gone by 40px) and darker and longer below (0.30 at the
 * edge, 0.23 at 12px, 0.22 at 16px).
 *
 * Every window gets them, as every window on Windows has them. Windows that
 * draw a shadow of their own — GTK's, Chromium's and Electron's with their
 * own title bars, mutter's round X11 windows — lose it: whatever a window
 * draws outside its frame is dropped, and Windows' shadow drawn instead.
 * Windows that draw none, square-cornered — Qt, undecorated windows — get
 * the corners as well. Maximised, tiled and full screen windows keep square
 * corners and no shadow, as on Windows.
 *
 * The corners and the edge are a shader on the window actor; the shadow
 * is an image of the measured shadow (assets/window-shadow.png) stretched
 * round the frame by its nine slices, drawn with cairo in a widget just
 * below the window that follows it — nothing is drawn under the window
 * itself. (St's border-image did not reproduce the image faithfully.)
 */
import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {WINDOW_FRAME} from './spec.js';

const DECLARATIONS = `
uniform vec4 bounds;
uniform vec2 size;
uniform vec2 pad;
uniform float radius;
uniform float edge_width;
uniform vec4 edge;
float roundedDistance(vec2 p, vec4 b, float r) {
    vec2 centre = (b.xy + b.zw) * 0.5;
    vec2 half_size = (b.zw - b.xy) * 0.5;
    vec2 q = abs(p - centre) - (half_size - vec2(r));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;

// Inside the frame: the corners cut round, the outermost pixel the edge.
// Outside it nothing is kept: all that is ever there is the shadow mutter
// draws round an undecorated X11 window, and ours replaces it. In the
// texture's own pixels, so the edges are smoothed over one of them.
const CODE = `
vec2 p = cogl_tex_coord_in[0].xy * size - pad;
float d = roundedDistance(p, bounds, radius);
float inside = clamp(0.5 - d, 0.0, 1.0);
float ring = clamp(d + edge_width + 0.5, 0.0, 1.0);
cogl_color_out = mix(cogl_color_out, edge, ring) * inside;
`;

/**
 * Where an effect's offscreen texture starts on the stage. Clutter draws
 * the actor's paint box — which takes in what the actor paints outside
 * itself, mutter's shadow round an undecorated X11 window among it — grown
 * so rounding never clips it: the right and bottom edges rounded up past
 * 0.75px and the size by 3 (_clutter_actor_box_enlarge_for_effects).
 *
 * @param {Clutter.Actor} actor the effect's
 * @returns {number[]} x, y in stage pixels
 */
export function textureOrigin(actor) {
    const [painted, box] = actor.get_paint_box();
    if (!painted)
        return [0, 0];
    const right = Math.ceil(box.x2 + 0.75);
    const bottom = Math.ceil(box.y2 + 0.75);
    return [right - Math.round(box.x2 - box.x1) - 3, bottom - Math.round(box.y2 - box.y1) - 3];
}

export const FrameEffect = GObject.registerClass({GTypeName: 'W11FrameEffect'},
class FrameEffect extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._bounds = this.get_uniform_location('bounds');
        this._size = this.get_uniform_location('size');
        this._pad = this.get_uniform_location('pad');
        this._radius = this.get_uniform_location('radius');
        this._edgeWidth = this.get_uniform_location('edge_width');
        this._edge = this.get_uniform_location('edge');
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    /**
     * Where the frame lies in the actor, and how to draw it.
     *
     * @param {number[]} bounds the frame: x0, y0, x1, y1 in actor pixels
     * @param {number} radius the corners', in actor pixels
     * @param {number[]} edge the edge's colour, premultiplied RGBA
     */
    setFrame(bounds, radius, edge) {
        this._frame = bounds;
        this._cornerRadius = radius;
        this.set_uniform_float(this._edge, 4, edge);
        this.queue_repaint();
    }

    /* The actor is drawn into a texture a little bigger than it
     * (textureOrigin), at its resource scale. The stage is in logical
     * pixels when GNOME lays monitors out by scale
     * (scale-monitor-framebuffer): then at a scale of 2 the texture has
     * twice the pixels. Every time the texture is drawn, the frame is put
     * into the texture's own pixels, at the actor's size and place right
     * now — mid-animation too, scaled. */
    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        const texture = this.get_texture();
        if (actor && texture && this._frame && actor.width > 0 && actor.height > 0) {
            const scale = actor.get_resource_scale();
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            const [left, top] = textureOrigin(actor);
            const [sx, sy] = [w / actor.width * scale, h / actor.height * scale];
            const [x0, y0, x1, y1] = this._frame;
            this.set_uniform_float(this._size, 2, [texture.get_width(), texture.get_height()]);
            this.set_uniform_float(this._pad, 2, [(x - left) * scale, (y - top) * scale]);
            this.set_uniform_float(this._bounds, 4, [x0 * sx, y0 * sy, x1 * sx, y1 * sy]);
            this.set_uniform_float(this._radius, 1, [this._cornerRadius * Math.min(sx, sy)]);
            // The edge is one logical pixel wide: St's scale of them where
            // the stage is in the monitors' pixels, the texture's where not.
            this.set_uniform_float(this._edgeWidth, 1, [scale * scaleFactor()]);
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

const EFFECT = 'w11-window-frame';

let shadowImage = null;

/* The shadow image, loaded once. */
function shadowSurface() {
    if (!shadowImage) {
        const path = GLib.build_filenamev([GLib.path_get_dirname(GLib.path_get_dirname(
            GLib.filename_from_uri(import.meta.url)[0])), 'assets', 'window-shadow.png']);
        shadowImage = Cairo.ImageSurface.createFromPNG(path);
    }
    return shadowImage;
}

/**
 * Paint Windows' window shadow into a drawing area at its size: the image's
 * corners as they are, its edges stretched along the window, its middle —
 * the window — left out. The area reaches past the window by
 * WINDOW_FRAME.shadow on each side.
 *
 * @param {St.DrawingArea} area the area, on its 'repaint'
 */
export function paintShadow(area) {
    const cr = area.get_context();
    const [width, height] = area.get_surface_size();
    const image = shadowSurface();
    const [iw, ih] = [image.getWidth(), image.getHeight()];
    const s = scaleFactor();
    const {left, right, top, bottom} = WINDOW_FRAME.shadowSlices;
    const [l, r, t, b] = [left * s, right * s, top * s, bottom * s];
    cr.setOperator(Cairo.Operator.CLEAR);
    cr.paint();
    cr.setOperator(Cairo.Operator.OVER);
    const slice = (sx, sy, sw, sh, dx, dy, dw, dh) => {
        if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0)
            return;
        cr.save();
        cr.rectangle(dx, dy, dw, dh);
        cr.clip();
        cr.translate(dx, dy);
        cr.scale(dw / sw, dh / sh);
        cr.setSourceSurface(image, -sx, -sy);
        cr.getSource().setExtend(Cairo.Extend.PAD);
        cr.paint();
        cr.restore();
    };
    const [mw, mh] = [iw - left - right, ih - top - bottom];
    slice(0, 0, left, top, 0, 0, l, t);
    slice(left, 0, mw, top, l, 0, width - l - r, t);
    slice(iw - right, 0, right, top, width - r, 0, r, t);
    slice(0, top, left, mh, 0, t, l, height - t - b);
    slice(iw - right, top, right, mh, width - r, t, r, height - t - b);
    slice(0, ih - bottom, left, bottom, 0, height - b, l, b);
    slice(left, ih - bottom, mw, bottom, l, height - b, width - l - r, b);
    slice(iw - right, ih - bottom, right, bottom, width - r, height - b, r, b);
    cr.$dispose();
}
const TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];
/* What the shadow mirrors of its window, so it fades and scales with it
 * through every animation; its place and size follow by constraints. */
const MIRRORED = ['visible', 'opacity', 'scale-x', 'scale-y', 'translation-x', 'translation-y'];

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

let current = null;

/**
 * The windows given Windows' frame, for the tests.
 *
 * @returns {object[]|null} one record per window, or null while it is off
 */
export function framedWindows() {
    return current?.describe() ?? null;
}

export class WindowFrames {
    constructor() {
        this._records = new Map(); // actor -> record
        current = this;
        for (const actor of global.get_window_actors())
            this._track(actor);
        this._addedId = global.window_group.connect('child-added',
            (_group, actor) => this._track(actor));
        this._restackId = global.display.connect('restacked', () => this._restack());
    }

    _track(actor) {
        const win = actor.meta_window;
        if (!win || this._records.has(actor))
            return;
        const record = {actor, win, shadow: null, ids: [], framed: false};
        this._records.set(actor, record);
        const sync = () => this._sync(record);
        for (const signal of ['size-changed', 'position-changed', 'notify::maximized-horizontally',
            'notify::maximized-vertically', 'notify::fullscreen', 'notify::window-type'])
            record.ids.push([win, win.connect(signal, sync)]);
        // A new window gets its first size without size-changed: the
        // actor's first frame and its allocation say when it has one.
        for (const signal of ['first-frame', 'notify::allocation'])
            record.ids.push([actor, actor.connect(signal, sync)]);
        record.ids.push([actor, actor.connect('destroy', () => this._untrack(record))]);
        sync();
    }

    _wanted(record) {
        const {actor, win} = record;
        if (!TYPES.includes(win.get_window_type()) || win.is_fullscreen() ||
            win.get_maximize_flags())
            return false;
        const frame = win.get_frame_rect();
        return frame.width > 0 && frame.height > 0 && actor.width > 0;
    }

    _sync(record) {
        const wanted = this._wanted(record);
        const {actor, win} = record;
        if (!wanted) {
            this._unframe(record);
            return;
        }
        let effect = actor.get_effect(EFFECT);
        if (!effect) {
            effect = new FrameEffect();
            actor.add_effect_with_name(EFFECT, effect);
        }
        const frame = win.get_frame_rect();
        const buffer = win.get_buffer_rect();
        const s = scaleFactor();
        const [x0, y0] = [frame.x - buffer.x, frame.y - buffer.y];
        const [r, g, b, a] = WINDOW_FRAME.edge;
        effect.setFrame([x0, y0, x0 + frame.width, y0 + frame.height],
            WINDOW_FRAME.radius * s, [r / 255 * a, g / 255 * a, b / 255 * a, a]);
        if (!record.shadow)
            this._addShadow(record);
        // Round the frame, wherever it lies in the window's buffer — a shadow
        // of its own grows and shrinks round it as the window gains and
        // loses focus.
        const {left, right, top, bottom} = WINDOW_FRAME.shadow;
        record.offsets = [x0, y0];
        record.follow.x.offset = x0 - left * s;
        record.follow.y.offset = y0 - top * s;
        record.follow.width.offset = frame.width - buffer.width + (left + right) * s;
        record.follow.height.offset = frame.height - buffer.height + (top + bottom) * s;
        record.pivot();
        record.framed = true;
    }

    _addShadow(record) {
        const {actor} = record;
        const s = scaleFactor();
        const {left, right, top, bottom} = WINDOW_FRAME.shadow;
        const shadow = new St.DrawingArea({style_class: 'w11-window-shadow', reactive: false});
        shadow.connect('repaint', paintShadow);
        // The window's actor grown by the image's margins; _sync moves the
        // offsets to the frame.
        record.follow = {};
        for (const [name, coordinate, offset] of [['x', Clutter.BindCoordinate.X, -left * s],
            ['y', Clutter.BindCoordinate.Y, -top * s], ['width', Clutter.BindCoordinate.WIDTH, (left + right) * s],
            ['height', Clutter.BindCoordinate.HEIGHT, (top + bottom) * s]]) {
            record.follow[name] = new Clutter.BindConstraint({source: actor, coordinate, offset});
            shadow.add_constraint(record.follow[name]);
        }
        record.shadow = shadow;
        global.window_group.insert_child_below(shadow, actor);
        record.bindings = MIRRORED.map(property =>
            actor.bind_property(property, shadow, property, GObject.BindingFlags.SYNC_CREATE));
        // Scaling about the same point of the screen as the window.
        record.pivot = () => {
            const [px, py] = actor.get_pivot_point();
            const [ox, oy] = record.offsets ?? [0, 0];
            const [sw, sh] = [shadow.width, shadow.height];
            if (sw > 0 && sh > 0)
                shadow.set_pivot_point((left * s - ox + px * actor.width) / sw, (top * s - oy + py * actor.height) / sh);
        };
        record.pivotId = actor.connect('notify::pivot-point', record.pivot);
        shadow.connect('notify::allocation', record.pivot);
    }

    _unframe(record) {
        record.actor.remove_effect_by_name?.(EFFECT);
        this._dropShadow(record);
        record.framed = false;
    }

    /* The shadow goes, and everything tying it to its window first. */
    _dropShadow(record) {
        if (record.pivotId)
            record.actor.disconnect(record.pivotId);
        record.pivotId = 0;
        for (const binding of record.bindings ?? [])
            binding.unbind();
        record.bindings = null;
        record.shadow?.destroy();
        record.shadow = null;
        record.follow = null;
        record.pivot = null;
    }

    _untrack(record) {
        for (const [object, id] of record.ids)
            object.disconnect(id);
        record.ids = [];
        // The actor is going: its effect goes with it.
        this._dropShadow(record);
        this._records.delete(record.actor);
    }

    /* Each shadow just below its window, wherever the window went. */
    _restack() {
        for (const {actor, shadow} of this._records.values()) {
            if (shadow && shadow.get_parent() === actor.get_parent())
                actor.get_parent().set_child_below_sibling(shadow, actor);
        }
    }

    describe() {
        return [...this._records.values()].map(({actor, win, shadow, framed}) => ({
            title: win.get_title(),
            framed,
            effect: Boolean(actor.get_effect(EFFECT)),
            shadow: shadow ? {x: Math.round(shadow.x), y: Math.round(shadow.y),
                w: Math.round(shadow.width), h: Math.round(shadow.height), visible: shadow.visible,
                below: actor.get_parent()?.get_children().indexOf(shadow) ===
                    actor.get_parent()?.get_children().indexOf(actor) - 1} : null,
        }));
    }

    destroy() {
        global.window_group.disconnect(this._addedId);
        global.display.disconnect(this._restackId);
        for (const record of [...this._records.values()]) {
            this._unframe(record);
            this._untrack(record);
        }
        if (current === this)
            current = null;
    }
}
