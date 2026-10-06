/* motion.js — one place for how things move.
 *
 * Windows 11 animates with short, decelerating curves: things arrive
 * quickly and settle, nothing bounces. Three durations cover the whole
 * taskbar, and the visual-design checklist caps transitions at 300ms, so
 * none of these go near it.
 *
 * Every duration passes through `duration()`, which returns 0 when the
 * desktop has animations switched off — the reduce-motion case. Motion is
 * never the only signal for a state change here, so dropping it loses
 * nothing.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/** Decelerating, no overshoot — Fluent's standard curve. */
export const EASE = Clutter.AnimationMode.EASE_OUT_CUBIC;

/** Leaving is quicker than arriving, as it is on Windows. */
export const EASE_OUT = Clutter.AnimationMode.EASE_OUT_QUAD;

export const DURATION = {
    /** Pressed/hover feedback, and anything that must feel instant. */
    fast: 80,
    /** A flyout fading in, an indicator changing width. */
    normal: 150,
    /** The Start menu, which travels further. */
    emphasized: 200,
};

/** How far a panel slides as it appears, in logical pixels. */
export const SLIDE = 24;

/**
 * A duration, honouring the desktop's animation setting.
 *
 * @param {number} ms the duration to use when animations are on
 * @returns {number} ms, or 0 when the user has asked for no animation
 */
export function duration(ms) {
    return St.Settings.get().enable_animations ? ms : 0;
}

/* A slide is a distance down the screen — negative is up — or, for
 * things beside a bar standing on a side, an [x, y] displacement. */
function offset(slide) {
    return Array.isArray(slide) ? slide : [0, slide];
}

/**
 * Show an actor the way Windows shows a flyout: fading in while sliding a
 * short distance from the edge it belongs to.
 *
 * @param {Clutter.Actor} actor the actor to reveal
 * @param {object} [options] tuning
 * @param {number|number[]} [options.from] slide distance; negative comes
 *   from above; [dx, dy] slides from the side as well
 * @param {number} [options.ms] duration before reduce-motion is applied
 * @param {Function} [options.onComplete] called when it finishes
 */
export function slideIn(actor, {from = SLIDE, ms = DURATION.normal,
    fromCurrent = false, onComplete = null} = {}) {
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const time = duration(ms);
    actor.remove_all_transitions();

    // A zero-length ease is not reliably applied, so with animations off
    // the end state has to be set directly — otherwise the actor stays at
    // the opacity 0 we were about to animate away from, and never appears.
    if (time === 0) {
        actor.opacity = 255;
        actor.translation_x = 0;
        actor.translation_y = 0;
        onComplete?.();
        return;
    }

    // 反向操作沿用当前画面，不重新跳回起点。
    if (!fromCurrent) {
        const [dx, dy] = offset(from);
        actor.opacity = 0;
        actor.translation_x = dx * scale;
        actor.translation_y = dy * scale;
    }
    actor.ease({
        opacity: 255,
        translation_x: 0,
        translation_y: 0,
        duration: time,
        mode: EASE,
        onComplete,
    });
}

/**
 * Hide an actor, reversing slideIn.
 *
 * @param {Clutter.Actor} actor the actor to hide
 * @param {object} [options] tuning
 * @param {number|number[]} [options.to] slide distance, as for slideIn
 * @param {number} [options.ms] duration before reduce-motion is applied
 * @param {Function} [options.onComplete] called when it finishes
 */
export function slideOut(actor, {to = SLIDE / 2, ms = DURATION.fast,
    onComplete = null} = {}) {
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    const time = duration(ms);
    actor.remove_all_transitions();

    if (time === 0) {
        actor.opacity = 0;
        actor.translation_x = 0;
        actor.translation_y = 0;
        onComplete?.();
        return;
    }

    const [dx, dy] = offset(to);
    actor.ease({
        opacity: 0,
        translation_x: dx * scale,
        translation_y: dy * scale,
        duration: time,
        mode: EASE_OUT,
        onComplete: () => {
            actor.translation_x = 0;
            actor.translation_y = 0;
            onComplete?.();
        },
    });
}
