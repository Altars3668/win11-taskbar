/* sliderThumb.js — the quick settings sliders' thumb, as Windows 11 has it.
 *
 * GNOME paints a slider's handle into the same drawing as its track: a flat
 * disc that never changes. Windows 11's is a white disc with a hairline
 * edge and an accent dot in the middle, which grows while the pointer is on
 * the slider and shrinks while it is held, both eased; while it is dragged,
 * the value shows in a small tip above it.
 *
 * GNOME's handle stays for its geometry — the track runs between its two
 * extreme positions — and the stylesheet paints it in no colour. This
 * thumb is placed exactly where GNOME would have drawn it. A slider is a
 * drawing area, which lays out no children, so the thumb shares an overlay
 * with it inside the slider's bin, and is moved by translation; it takes
 * no input, so every press still reaches the slider.
 */
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {DURATION, EASE, duration} from './motion.js';
import {applyThemeClass} from './theme.js';

/* The dot's size at rest and while held, against its size under the
 * pointer: 12, 10 and 14px in a 20px thumb. */
const DOT_REST = 12 / 14;
const DOT_HELD = 10 / 14;

export class SliderThumb {
    /**
     * @param {object} slider a GNOME Slider (ui/slider.js)
     */
    constructor(slider) {
        this._slider = slider;
        this._held = false;

        this._thumb = new St.Widget({style_class: 'w11-slider-thumb',
            layout_manager: new Clutter.BinLayout()});
        this._dot = new St.Widget({style_class: 'w11-slider-thumb-dot',
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER,
            x_expand: true, y_expand: true, scale_x: DOT_REST, scale_y: DOT_REST});
        this._dot.set_pivot_point(0.5, 0.5);
        this._thumb.add_child(this._dot);

        this._bin = slider.get_parent();
        this._overlay = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        this._bin.set_child(this._overlay);
        this._overlay.add_child(slider);
        this._overlay.add_child(this._thumb);

        this._tip = new St.Label({style_class: 'w11-slider-tip', visible: false});
        Main.uiGroup.add_child(this._tip);

        this._signals = [
            [slider, slider.connect('notify::value', () => this._place())],
            [slider, slider.connect('notify::allocation', () => this._place())],
            [this._thumb, this._thumb.connect('notify::allocation', () => this._place())],
            [slider, slider.connect('notify::hover', () => this._sizeDot())],
            [slider, slider.connect('drag-begin', () => this._hold(true))],
            [slider, slider.connect('drag-end', () => this._hold(false))],
            [slider, slider.connect('destroy', () => this._onSliderDestroy())],
        ];
        this._place();
    }

    get slider() {
        return this._slider;
    }

    _hold(held) {
        this._held = held;
        this._sizeDot();
        this._tip.visible = held;
        if (held) {
            applyThemeClass(this._tip);
            Main.uiGroup.set_child_above_sibling(this._tip, null);
            this._place();
        }
    }

    _sizeDot() {
        const scale = this._held ? DOT_HELD : this._slider.hover ? 1 : DOT_REST;
        this._dot.ease({scale_x: scale, scale_y: scale,
            duration: duration(DURATION.fast), mode: EASE});
    }

    /* Where GNOME's own handle is: its radius in from either end, along the
     * value, mirrored for right-to-left text. */
    _place() {
        const slider = this._slider;
        const width = slider.allocation.get_width();
        const height = slider.allocation.get_height();
        if (!(width > 0))
            return;
        const radius = slider._handleRadius ?? 0;
        const max = slider.maximumValue || 1;
        let x = radius + (width - 2 * radius) * slider.value / max;
        if (slider.get_text_direction() === Clutter.TextDirection.RTL)
            x = width - x;
        // Moved from wherever the overlay put it, by translation alone —
        // once it has been put somewhere.
        const box = this._thumb.allocation;
        if (![box.x1, box.x2, box.y1, box.y2].every(Number.isFinite))
            return;
        this._thumb.translation_x = Math.round(x - (box.x1 + box.x2) / 2);
        this._thumb.translation_y = Math.round(height / 2 - (box.y1 + box.y2) / 2);
        if (this._tip.visible)
            this._placeTip();
    }

    _placeTip() {
        this._tip.text = `${Math.round(this._slider.value * 100)}`;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const [tx, ty] = this._thumb.get_transformed_position();
        const [tw] = this._thumb.get_transformed_size();
        const [, tipW] = this._tip.get_preferred_width(-1);
        const [, tipH] = this._tip.get_preferred_height(tipW);
        if (![tx, ty, tw].every(Number.isFinite))
            return;
        this._tip.set_position(Math.round(tx + tw / 2 - tipW / 2), Math.round(ty - tipH - 8 * scale));
    }

    _onSliderDestroy() {
        this._signals = [];
        this._tip.destroy();
        this._slider = null;
    }

    destroy() {
        const slider = this._slider;
        if (!slider)
            return;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._tip.destroy();
        this._slider = null;
        // The slider goes back into its bin as GNOME made it.
        this._overlay.remove_child(slider);
        this._bin.set_child(slider);
        this._overlay.destroy();
    }
}
