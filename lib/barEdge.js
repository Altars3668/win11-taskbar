/* barEdge.js — what follows from the screen edge the taskbar is on.
 *
 * Windows 11 keeps its taskbar along the bottom; this one may sit on any
 * of the four edges. Everything that opens from the bar opens on its inner
 * side — above a bar at the bottom, to the right of one on the left — and
 * slides in from the bar. Along the bar, a menu is centred on what opened
 * it; a flyout that belongs to the bar's far end (quick settings, the
 * notification centre) sits in the corner there, against the bar.
 *
 * Pure geometry, so it is tested without a compositor
 * (tools/test-layout-options.mjs). Rectangles are {x, y, width, height}
 * in stage pixels.
 */

export const EDGES = ['bottom', 'top', 'left', 'right'];

/**
 * Whether the bar stands upright, along the left or right edge.
 *
 * @param {string} edge one of EDGES
 * @returns {boolean} whether it is vertical
 */
export function isVertical(edge) {
    return edge === 'left' || edge === 'right';
}

/**
 * Which side of a popup faces the bar: the side a BoxPointer's arrow is
 * on, St.Side's TOP, RIGHT, BOTTOM and LEFT being 0 to 3.
 *
 * @param {string} edge one of EDGES
 * @returns {number} the St.Side value
 */
export function sideFacingBar(edge) {
    return {top: 0, right: 1, bottom: 2, left: 3}[edge] ?? 2;
}

/**
 * A displacement of `distance` towards the bar: where something that
 * slides out of the bar starts, and where it goes when it leaves.
 *
 * @param {string} edge one of EDGES
 * @param {number} distance how far
 * @returns {number[]} [dx, dy]
 */
export function towardsBar(edge, distance) {
    switch (edge) {
    case 'top':
        return [0, -distance];
    case 'left':
        return [-distance, 0];
    case 'right':
        return [distance, 0];
    default:
        return [0, distance];
    }
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, Math.max(low, high)));

/**
 * Where a popup goes beside what opened it: on the bar's inner side of the
 * anchor, `gap` away, and centred on it along the bar — or at `alignment`
 * of its own length. It flips to the other side of the anchor only when it
 * does not fit and the other side has room, and stays inside the area.
 *
 * @param {string} edge one of EDGES
 * @param {object} anchor the rectangle it belongs to
 * @param {object} size {width, height} of the popup
 * @param {object} area the rectangle it has to stay in
 * @param {object} [options] tuning
 * @param {number} [options.gap] distance from the anchor
 * @param {number} [options.margin] distance it keeps from the area's edges
 * @param {number} [options.alignment] 0 to 1 along the bar: which point of
 *   the popup lines up with the anchor's centre
 * @returns {{x: number, y: number, flipped: boolean}} its position, and
 *   whether it went to the bar's side of the anchor instead
 */
export function placeBeside(edge, anchor, size, area, {gap = 0, margin = 0, alignment = 0.5} = {}) {
    const vertical = isVertical(edge);
    // Across the bar: the inner side first, the other one if need be.
    const [start, length, room, low, high] = vertical
        ? [anchor.x, anchor.width, size.width, area.x + margin, area.x + area.width - margin]
        : [anchor.y, anchor.height, size.height, area.y + margin, area.y + area.height - margin];
    const before = start - gap - room;
    const after = start + length + gap;
    const fitsBefore = before >= low;
    const fitsAfter = after + room <= high;
    // A bar on the bottom or right opens popups before the anchor.
    const prefersBefore = edge === 'bottom' || edge === 'right';
    let across = prefersBefore
        ? fitsBefore || !fitsAfter ? before : after
        : fitsAfter || !fitsBefore ? after : before;
    const flipped = prefersBefore ? across === after : across === before;
    across = clamp(across, low, high - room);

    // Along the bar: centred on the anchor, kept on the screen.
    const [centre, along, alongLow, alongHigh] = vertical
        ? [anchor.y + anchor.height / 2, size.height, area.y + margin, area.y + area.height - margin]
        : [anchor.x + anchor.width / 2, size.width, area.x + margin, area.x + area.width - margin];
    const alongStart = clamp(centre - along * alignment, alongLow, alongHigh - along);

    return vertical
        ? {x: across, y: alongStart, flipped}
        : {x: alongStart, y: across, flipped};
}

/**
 * Where a flyout that belongs to the bar's far end goes: quick settings
 * and the notification centre open in that corner, `gap` off the bar and
 * `margin` from the screen's edge — measured on Windows as 6 and 12 below
 * a bar along the bottom, bottom right.
 *
 * @param {string} edge one of EDGES
 * @param {object} monitor the bar's monitor
 * @param {number} thickness the bar's thickness
 * @param {object} size {width, height} of the flyout
 * @param {object} [options] tuning
 * @param {number} [options.gap] distance from the bar
 * @param {number} [options.margin] distance from the screen edge along the bar
 * @returns {{x: number, y: number}} its position
 */
export function placeAtEnd(edge, monitor, thickness, size, {gap = 0, margin = 0} = {}) {
    const right = monitor.x + monitor.width;
    const bottom = monitor.y + monitor.height;
    switch (edge) {
    case 'top':
        return {x: right - size.width - margin, y: monitor.y + thickness + gap};
    case 'left':
        return {x: monitor.x + thickness + gap, y: bottom - size.height - margin};
    case 'right':
        return {x: right - thickness - gap - size.width, y: bottom - size.height - margin};
    default:
        return {x: right - size.width - margin, y: bottom - thickness - gap - size.height};
    }
}

/**
 * The part of the monitor beside the bar, which popups have to fit into.
 *
 * @param {string} edge one of EDGES
 * @param {object} monitor the bar's monitor
 * @param {number} thickness the bar's thickness
 * @returns {object} the rectangle
 */
export function besideBar(edge, monitor, thickness) {
    const {x, y, width, height} = monitor;
    switch (edge) {
    case 'top':
        return {x, y: y + thickness, width, height: height - thickness};
    case 'left':
        return {x: x + thickness, y, width: width - thickness, height};
    case 'right':
        return {x, y, width: width - thickness, height};
    default:
        return {x, y, width, height: height - thickness};
    }
}
