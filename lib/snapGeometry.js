/* snapGeometry.js — Windows 11's snap layouts, as numbers.
 *
 * Measured on the reference machine (2026-10-06, 1920x1080): Win+Z opens a
 * 344x244 flyout at the window's top right, 31px below its top, with three
 * rows of 98x64 tiles 12px apart: a row of suggested snap groups, then the
 * six layouts below, in this order. Dragging a window against the top of
 * the screen opens the same tiles in a single row, a 90px-high bar 24px
 * from the top, centred. Each tile draws its zones with 4px between them.
 * Snap groups are not offered here; the six layouts are.
 *
 * Dragging a window to an edge of the screen places it as well, measured
 * the same day: see EDGE.
 *
 * Pure geometry, so it is unit-tested without a compositor
 * (tools/test-layout-options.mjs). Rectangles are {x, y, width, height}.
 */

/** Zones as fractions of the work area: [x, y, width, height]. */
export const LAYOUTS = [
    {id: 'halves', zones: [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1]]},
    {id: 'two-thirds', zones: [[0, 0, 2 / 3, 1], [2 / 3, 0, 1 / 3, 1]]},
    {id: 'thirds', zones: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]},
    {id: 'half-quarters', zones: [[0, 0, 1 / 2, 1], [1 / 2, 0, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]]},
    {id: 'quarters', zones: [[0, 0, 1 / 2, 1 / 2], [1 / 2, 0, 1 / 2, 1 / 2],
        [0, 1 / 2, 1 / 2, 1 / 2], [1 / 2, 1 / 2, 1 / 2, 1 / 2]]},
    {id: 'wide-middle', zones: [[0, 0, 1 / 4, 1], [1 / 4, 0, 1 / 2, 1], [3 / 4, 0, 1 / 4, 1]]},
];

export const SNAP = {
    tileWidth: 98,
    tileHeight: 64,
    tileGap: 12,
    zoneGap: 4,
    zoneRadius: 4,
    padding: 12,
    /** The flyout's top, below the window's top. */
    belowWindowTop: 31,
    /** The bar's top, below the top of the work area. */
    barTop: 24,
    /** How near the top a dragged window's pointer has to come — and
     *  within the bar's width: 6px to its left, the bar stays up. */
    barReach: 8,
    /** Snap assist: thumbnails 195 high, 24 apart, the grid 13 in. */
    assistItemHeight: 195,
    assistTitleHeight: 40,
    assistGap: 24,
    assistInset: 13,
    assistMaxWidth: 288,
};

/** Where a dragged window goes at the screen's edges, measured on the
 *  reference machine (2026-10-06, 1920x1080, the taskbar along the bottom)
 *  by carrying a window to them a pixel at a time, held at either end of
 *  its title bar — only the pointer counts:
 *  - the pointer 63px from the left or right edge puts the window in that
 *    half, 64px does not; once there it stays until the pointer is 138px
 *    away (136 stays, 140 does not);
 *  - along those edges, within 138px of the top or the bottom of the work
 *    area it goes in that corner's quarter instead, either way: 137 is the
 *    quarter, 138 the half;
 *  - 6px from the top, away from the snap bar, maximises it (8 does not),
 *    until the pointer is 20px down (16 still does, 24 not). A corner
 *    takes precedence over the top.
 *  The preview of the place is the place kept 8px off the work area's
 *  edges — not off the middle, where two places meet. Moving from one place
 *  to another waits 100ms first, so that running along an edge does not
 *  flicker between them. */
export const EDGE = {
    sideEnter: 64,
    sideLeave: 138,
    corner: 138,
    topEnter: 6,
    topLeave: 20,
    inset: 8,
    settle: 100,
};

/* The places at the edges: each the zone of the layout snap assist then
 * fills the rest of. */
const EDGE_PLACES = {
    'left': {layout: 'halves', index: 0},
    'right': {layout: 'halves', index: 1},
    'top-left': {layout: 'quarters', index: 0},
    'top-right': {layout: 'quarters', index: 1},
    'bottom-left': {layout: 'quarters', index: 2},
    'bottom-right': {layout: 'quarters', index: 3},
};

/**
 * Where a window dragged with the pointer at a point goes, if it is at an
 * edge of the work area: a half, a quarter at a corner, or the whole of it
 * at the top.
 *
 * @param {number} x the pointer
 * @param {number} y the pointer
 * @param {object} area the work area of the monitor the pointer is on
 * @param {number} scale the UI scale
 * @param {string|null} previous the place it went last, which the pointer
 *   has to go further to leave than to reach
 * @returns {object|null} {place, zone, layout, index}: the place's name,
 *   its zone as fractions of the area, and the layout and zone of it snap
 *   assist goes on with — no layout when it is the whole area
 */
export function edgePlace(x, y, area, scale = 1, previous = null) {
    const reach = (side, enter, leave) =>
        (previous === side || previous?.endsWith(`-${side}`) ? leave : enter) * scale;
    const fromLeft = x - area.x;
    const fromRight = area.x + area.width - 1 - x;
    const fromTop = y - area.y;
    const fromBottom = area.y + area.height - 1 - y;
    let side = null;
    if (fromLeft < reach('left', EDGE.sideEnter, EDGE.sideLeave))
        side = 'left';
    else if (fromRight < reach('right', EDGE.sideEnter, EDGE.sideLeave))
        side = 'right';
    if (side) {
        const corner = EDGE.corner * scale;
        const place = fromTop < corner ? `top-${side}` : fromBottom < corner ? `bottom-${side}` : side;
        const {layout, index} = EDGE_PLACES[place];
        return {place, zone: LAYOUTS.find(l => l.id === layout).zones[index], layout, index};
    }
    if (fromTop <= (previous === 'top' ? EDGE.topLeave : EDGE.topEnter) * scale)
        return {place: 'top', zone: [0, 0, 1, 1], layout: null, index: -1};
    return null;
}

/**
 * The preview of a place: the place, kept off the edges of the work area
 * it touches, but not off its neighbours.
 *
 * @param {object} area the work area
 * @param {object} rect the place
 * @param {number} inset how far off, in pixels
 * @returns {object} the rectangle
 */
export function previewRect(area, rect, inset) {
    const left = rect.x <= area.x ? inset : 0;
    const top = rect.y <= area.y ? inset : 0;
    const right = rect.x + rect.width >= area.x + area.width ? inset : 0;
    const bottom = rect.y + rect.height >= area.y + area.height ? inset : 0;
    return {x: rect.x + left, y: rect.y + top, width: rect.width - left - right,
        height: rect.height - top - bottom};
}

/**
 * The size of a panel of layout tiles, in logical pixels: the flyout's
 * rows of three, or the bar's single row.
 *
 * @param {number} count how many tiles
 * @param {number} columns how many to a row
 * @returns {number[]} [width, height]
 */
export function panelSize(count, columns) {
    const rows = Math.ceil(count / columns);
    return [2 * SNAP.padding + columns * SNAP.tileWidth + (columns - 1) * SNAP.tileGap,
        2 * SNAP.padding + rows * SNAP.tileHeight + (rows - 1) * SNAP.tileGap];
}

/**
 * The layouts for a work area: on a portrait one Windows stacks them —
 * the same layouts turned on their side.
 *
 * @param {object} area the work area
 * @returns {object[]} layouts as in LAYOUTS
 */
export function layoutsFor(area) {
    if (area.height <= area.width)
        return LAYOUTS;
    return LAYOUTS.map(({id, zones}) => ({id, zones: zones.map(([x, y, w, h]) => [y, x, h, w])}));
}

/**
 * Where a zone lies in a work area. Neighbouring zones share their edge
 * exactly, so windows snapped side by side meet without a gap or overlap.
 *
 * @param {object} area the work area
 * @param {number[]} zone [x, y, width, height] as fractions
 * @returns {object} the rectangle
 */
export function zoneRect(area, [fx, fy, fw, fh]) {
    const x0 = Math.round(area.x + fx * area.width);
    const x1 = Math.round(area.x + (fx + fw) * area.width);
    const y0 = Math.round(area.y + fy * area.height);
    const y1 = Math.round(area.y + (fy + fh) * area.height);
    return {x: x0, y: y0, width: x1 - x0, height: y1 - y0};
}

/**
 * How a tile draws its zones: the tile split up as the work area is, with
 * a gap between zones but none at the tile's own edge. The gaps come out
 * of the zones evenly — a tile 98 wide in thirds is three zones of 30, as
 * measured.
 *
 * @param {number[][]} zones the layout's zones
 * @param {number} width the tile's width
 * @param {number} height the tile's height
 * @param {number} gap between zones
 * @returns {object[]} rectangles within the tile
 */
export function tileZones(zones, width, height, gap) {
    const span = (start, size, length) => {
        const a = Math.round(start * (length + gap));
        const b = Math.round((start + size) * (length + gap)) - gap;
        return [a, b - a];
    };
    return zones.map(([fx, fy, fw, fh]) => {
        const [x, w] = span(fx, fw, width);
        const [y, h] = span(fy, fh, height);
        return {x, y, width: w, height: h};
    });
}

/**
 * Which rectangle holds a point.
 *
 * @param {object[]} rects the rectangles
 * @param {number} x the point
 * @param {number} y the point
 * @returns {number} its index, or -1
 */
export function rectAt(rects, x, y) {
    return rects.findIndex(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
}

/**
 * Snap assist's thumbnails, laid out as Windows lays them out in the zone
 * still to fill: rows of items of one height, each as wide as its window's
 * shape allows, 24 apart, every row centred and the whole centred in the
 * zone, 13 in from its edges. Items that do not fit are left out.
 *
 * @param {number[]} aspects each window's width / height
 * @param {object} zone the zone
 * @param {number} scale the monitor's scale factor
 * @returns {object[]} a rectangle per item, in order; null for one left out
 */
export function assistGrid(aspects, zone, scale = 1) {
    const inset = SNAP.assistInset * scale;
    const gap = SNAP.assistGap * scale;
    const itemHeight = SNAP.assistItemHeight * scale;
    const preview = (SNAP.assistItemHeight - SNAP.assistTitleHeight) * scale;
    const maxWidth = SNAP.assistMaxWidth * scale;
    const room = {width: zone.width - 2 * inset, height: zone.height - 2 * inset};
    const widths = aspects.map(a => Math.max(itemHeight / 2, Math.min(maxWidth, preview * (a || 1.5))));
    const rows = [];
    let row = [];
    let used = 0;
    widths.forEach((w, i) => {
        const need = row.length ? used + gap + w : w;
        if (row.length && need > room.width) {
            rows.push(row);
            row = [];
            used = 0;
        }
        row.push(i);
        used = row.length > 1 ? used + gap + w : w;
    });
    if (row.length)
        rows.push(row);
    const fits = Math.max(1, Math.floor((room.height + gap) / (itemHeight + gap)));
    const shown = rows.slice(0, fits);
    const total = shown.length * itemHeight + (shown.length - 1) * gap;
    const out = aspects.map(() => null);
    let y = zone.y + inset + (room.height - total) / 2;
    for (const r of shown) {
        const rowWidth = r.reduce((sum, i) => sum + widths[i], 0) + (r.length - 1) * gap;
        let x = zone.x + inset + (room.width - rowWidth) / 2;
        for (const i of r) {
            out[i] = {x: Math.round(x), y: Math.round(y), width: Math.round(widths[i]),
                height: Math.round(itemHeight)};
            x += widths[i] + gap;
        }
        y += itemHeight + gap;
    }
    return out;
}
