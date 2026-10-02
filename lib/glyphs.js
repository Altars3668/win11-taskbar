/* glyphs.js — the Windows-shaped icons, drawn rather than loaded.
 *
 * These started as SVG files and did not survive contact with St: an icon
 * loaded through Gio.FileIcon is *not* recoloured, whatever its file name,
 * so `currentColor` fell through to librsvg's default of black and the
 * glyphs vanished on a dark taskbar. Shipping a light and a dark copy did
 * not help either, because St had already cached the texture.
 *
 * Drawing them means the colour comes from the theme node every repaint,
 * so it follows the stylesheet exactly, in either appearance, with no
 * cache to invalidate. The shapes are simple enough that this is also less
 * code than the SVGs were.
 *
 * They are drawn to match Windows' own glyphs. The Start logo itself is a
 * trademark, so the four-pane shape here is the generic one.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

/** Rounded rectangle path, since cairo has no primitive for one. */
function roundedRect(cr, x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    cr.newSubPath();
    cr.arc(x + w - k, y + k, k, -Math.PI / 2, 0);
    cr.arc(x + w - k, y + h - k, k, 0, Math.PI / 2);
    cr.arc(x + k, y + h - k, k, Math.PI / 2, Math.PI);
    cr.arc(x + k, y + k, k, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

/** Each glyph draws into a unit box of the given side length. */
const SHAPES = {
    /** Start: four panes. */
    start(cr, s) {
        const gap = s * 0.09;
        const side = (s - gap) / 2;
        const r = s * 0.045;
        for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
            roundedRect(cr, cx * (side + gap), cy * (side + gap), side, side, r);
        cr.fill();
    },

    /** Task view: a window with a second one behind it. */
    taskView(cr, s) {
        const lw = Math.max(1, s * 0.08);
        cr.setLineWidth(lw);
        cr.setLineJoin(1); // round
        roundedRect(cr, lw / 2, s * 0.12 + lw / 2,
            s * 0.66 - lw, s * 0.56 - lw, s * 0.07);
        cr.stroke();
        cr.moveTo(s * 0.28, s * 0.86);
        cr.lineTo(s * 0.86, s * 0.86);
        cr.lineTo(s * 0.86, s * 0.32);
        cr.stroke();
    },

    /** The notification-area overflow chevron. */
    chevronUp(cr, s) {
        cr.setLineWidth(Math.max(1, s * 0.09));
        cr.setLineCap(1);  // round
        cr.setLineJoin(1);
        cr.moveTo(s * 0.21, s * 0.64);
        cr.lineTo(s * 0.5, s * 0.35);
        cr.lineTo(s * 0.79, s * 0.64);
        cr.stroke();
    },

    /** The thin cross on a thumbnail's close button. */
    close(cr, s) {
        cr.setLineWidth(Math.max(1, s * 0.075));
        cr.setLineCap(1);
        cr.moveTo(s * 0.26, s * 0.26);
        cr.lineTo(s * 0.74, s * 0.74);
        cr.moveTo(s * 0.74, s * 0.26);
        cr.lineTo(s * 0.26, s * 0.74);
        cr.stroke();
    },

    /** Power, for the Start menu footer. */
    power(cr, s) {
        cr.setLineWidth(Math.max(1, s * 0.085));
        cr.setLineCap(1);
        cr.arc(s * 0.5, s * 0.55, s * 0.3, -Math.PI * 0.72, Math.PI * 1.72);
        cr.stroke();
        cr.moveTo(s * 0.5, s * 0.14);
        cr.lineTo(s * 0.5, s * 0.47);
        cr.stroke();
    },
};

export const Glyph = GObject.registerClass(
class Glyph extends St.DrawingArea {
    /**
     * @param {string} shape a key of SHAPES
     * @param {number} size side length in logical pixels
     * @param {object} [params] extra actor properties
     */
    _init(shape, size, params = {}) {
        super._init({
            style_class: 'w11-glyph',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            ...params,
        });
        this._shape = shape;
        this.setSize(size);
    }

    /** Resize for a new scale factor. */
    setSize(size) {
        this._size = size;
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        this.set_size(Math.round(size * s), Math.round(size * s));
        this.queue_repaint();
    }

    vfunc_style_changed() {
        super.vfunc_style_changed();
        // The colour lives in the theme node, so a stylesheet change has to
        // force a repaint — nothing else would.
        this.queue_repaint();
    }

    vfunc_repaint() {
        const draw = SHAPES[this._shape];
        if (!draw)
            return;

        const cr = this.get_context();
        const [w, h] = this.get_surface_size();
        const side = Math.min(w, h);

        const color = this.get_theme_node().get_foreground_color();
        cr.setSourceRGBA(color.red / 255, color.green / 255,
            color.blue / 255, color.alpha / 255);

        cr.translate((w - side) / 2, (h - side) / 2);
        draw(cr, side);

        cr.$dispose();
    }
});
