/* 布局和可选入口的边界回归，不依赖 GNOME 进程。 */
import assert from 'node:assert/strict';
import {startLayout, START_SHORTCUTS} from '../lib/startOptions.js';
import {besideBar, isVertical, placeAtEnd, placeBeside, sideFacingBar, towardsBar} from '../lib/barEdge.js';
import {assistGrid, LAYOUTS, layoutsFor, rectAt, tileZones, zoneRect} from '../lib/snapGeometry.js';
import {TRAY} from '../lib/spec.js';

// 区域是任务栏旁边的空间：1920×1080 的屏幕减去底部 48px 的任务栏。
const compact = startLayout('compact', 1920, 1080 - 48, 1);
assert.deepEqual([compact.width, compact.height, compact.columns, compact.rows],
    [640, 720, 6, 3]);
const wide = startLayout('wide', 1920, 1080 - 48, 1);
assert.deepEqual([wide.width, wide.height, wide.columns, wide.rows],
    [832, 864, 8, 2]);
// 自定义大小：默认值与紧凑布局一致，宽度换列数，高度换固定项行数。
const own = (width, height, w = 1920, h = 1080 - 48, scale = 1) =>
    startLayout('custom', w, h, scale, {width, height});
assert.deepEqual(Object.values(own(640, 720)), Object.values(compact));
assert.deepEqual([own(832, 864).columns, own(832, 864).rows], [8, 5]);
assert.deepEqual([own(1200, 1000).width, own(1200, 1000).columns, own(1200, 1000).rows], [1200, 11, 6]);
assert.deepEqual([own(300, 300).width, own(300, 300).height, own(300, 300).columns], [480, 480, 4]);
assert.deepEqual([own(4000, 4000).width, own(4000, 4000).height], [1920 - 26, 1032 - 26]);
assert.deepEqual([own(800, 900, 3840, 2160 - 96, 2).width, own(800, 900, 3840, 2160 - 96, 2).columns], [1600, 7]);
for (const scale of [1, 2]) {
    for (const [w, h] of [[1920, 1080], [800, 600], [480, 480]]) {
        for (const layout of [startLayout('wide', w, h - 48 * scale, scale),
            startLayout('custom', w, h - 48 * scale, scale, {width: 4000, height: 4000})]) {
            assert(layout.width <= w - 26 * scale);
            assert(layout.height <= h - 48 * scale - 26 * scale);
            assert(layout.columns * layout.tileWidth * scale <= layout.width - 64 * scale);
            assert(layout.rows >= 1);
        }
    }
}
// 任务栏四个边：弹层放在锚点内侧、沿任务栏居中，放不下才翻面，始终留在区域内。
const screen = {x: 0, y: 0, width: 1920, height: 1080};
const size = {width: 200, height: 100};
const near = (a, b) => Object.keys(b).every(k => a[k] === b[k]);
assert(near(placeBeside('bottom', {x: 900, y: 1032, width: 44, height: 48}, size, screen, {gap: 8}),
    {x: 822, y: 924, flipped: false}));
assert(near(placeBeside('top', {x: 900, y: 0, width: 44, height: 48}, size, screen, {gap: 8}),
    {x: 822, y: 56, flipped: false}));
assert(near(placeBeside('left', {x: 0, y: 500, width: 48, height: 44}, size, screen, {gap: 8}),
    {x: 56, y: 472, flipped: false}));
assert(near(placeBeside('right', {x: 1872, y: 500, width: 48, height: 44}, size, screen, {gap: 8}),
    {x: 1664, y: 472, flipped: false}));
// 靠屏幕一端时沿任务栏方向夹在边距内；放不下的一侧翻到另一侧。
assert(near(placeBeside('left', {x: 0, y: 1030, width: 48, height: 44}, size, screen, {gap: 8, margin: 4}),
    {x: 56, y: 976}));
assert(near(placeBeside('bottom', {x: 900, y: 40, width: 44, height: 48}, size, screen, {gap: 8, margin: 4}),
    {y: 96, flipped: true}));
assert(near(placeBeside('top', {x: 0, y: 0, width: 44, height: 48}, size, screen, {alignment: 0}),
    {x: 22, y: 48}));
// 快捷设置一类的角落浮层：在任务栏末端的角上，离任务栏 6、离屏幕边 12。
const corner = {width: 360, height: 386};
assert.deepEqual(placeAtEnd('bottom', screen, 48, corner, {gap: 6, margin: 12}), {x: 1548, y: 640});
assert.deepEqual(placeAtEnd('top', screen, 48, corner, {gap: 6, margin: 12}), {x: 1548, y: 54});
assert.deepEqual(placeAtEnd('left', screen, 48, corner, {gap: 6, margin: 12}), {x: 54, y: 682});
assert.deepEqual(placeAtEnd('right', screen, 48, corner, {gap: 6, margin: 12}), {x: 1506, y: 682});
assert.deepEqual(besideBar('left', screen, 64), {x: 64, y: 0, width: 1856, height: 1080});
assert.deepEqual(besideBar('right', screen, 64), {x: 0, y: 0, width: 1856, height: 1080});
assert.deepEqual(besideBar('top', screen, 64), {x: 0, y: 64, width: 1920, height: 1016});
assert.deepEqual(towardsBar('left', 10), [-10, 0]);
assert.deepEqual(towardsBar('bottom', 10), [0, 10]);
assert.deepEqual(['top', 'right', 'bottom', 'left'].map(sideFacingBar), [0, 1, 2, 3]);
assert(isVertical('left') && isVertical('right') && !isVertical('top') && !isVertical('bottom'));
// 竖放任务栏时开始菜单的可用区域是任务栏旁边的整列。
const beside = besideBar('left', screen, 48);
assert.deepEqual([startLayout('compact', beside.width, beside.height, 1).height,
    startLayout('fullscreen', beside.width, beside.height, 1).height], [720, 1080 - 26]);
// 贴靠布局：六种布局；区块在工作区里边对边，不留缝也不重叠。
const work = {x: 0, y: 0, width: 1920, height: 1032};
assert.deepEqual(LAYOUTS.map(l => l.id), ['halves', 'two-thirds', 'thirds', 'half-quarters', 'quarters', 'wide-middle']);
const rects = id => LAYOUTS.find(l => l.id === id).zones.map(z => zoneRect(work, z));
assert.deepEqual(rects('halves'), [{x: 0, y: 0, width: 960, height: 1032}, {x: 960, y: 0, width: 960, height: 1032}]);
assert.deepEqual(rects('two-thirds').map(r => r.width), [1280, 640]);
assert.deepEqual(rects('thirds').map(r => [r.x, r.width]), [[0, 640], [640, 640], [1280, 640]]);
assert.deepEqual(rects('quarters').map(r => [r.x, r.y, r.width, r.height]),
    [[0, 0, 960, 516], [960, 0, 960, 516], [0, 516, 960, 516], [960, 516, 960, 516]]);
for (const layout of LAYOUTS) {
    const area = layout.zones.map(z => zoneRect({x: 13, y: 7, width: 1001, height: 777}, z))
        .reduce((sum, r) => sum + r.width * r.height, 0);
    assert.equal(area, 1001 * 777, layout.id);
}
// 竖屏时同样的布局转过来，上下排。
const portrait = layoutsFor({x: 0, y: 0, width: 1080, height: 1872});
assert.deepEqual(portrait[0].zones.map(z => zoneRect({x: 0, y: 0, width: 1080, height: 1872}, z)),
    [{x: 0, y: 0, width: 1080, height: 936}, {x: 0, y: 936, width: 1080, height: 936}]);
// 实测：98×64 的格子里三等分的区块各 30px 宽、相隔 4px。
assert.deepEqual(tileZones(LAYOUTS[2].zones, 98, 64, 4).map(r => [r.x, r.width]), [[0, 30], [34, 30], [68, 30]]);
assert.deepEqual(tileZones(LAYOUTS[0].zones, 98, 64, 4).map(r => [r.x, r.width, r.height]), [[0, 47, 64], [51, 47, 64]]);
assert.deepEqual(tileZones(LAYOUTS[4].zones, 98, 64, 4).map(r => [r.x, r.y, r.width, r.height]),
    [[0, 0, 47, 30], [51, 0, 47, 30], [0, 34, 47, 30], [51, 34, 47, 30]]);
assert.equal(rectAt(rects('halves'), 1000, 10), 1);
assert.equal(rectAt(rects('halves'), 1920, 10), -1);
// 贴靠辅助：缩略图 195 高、间隔 24，每行居中，整体在剩余区块里居中。
const zone = {x: 960, y: 0, width: 960, height: 1032};
const grid = assistGrid(Array(10).fill(16 / 9), zone);
assert(grid.every(r => r && r.height === 195 && r.width <= 288));
const rows = [...new Set(grid.map(r => r.y))];
assert.deepEqual(rows.map((y, i) => i ? y - rows[i - 1] : 0).slice(1), [219, 219, 219]);
for (const y of rows) {
    const row = grid.filter(r => r.y === y);
    const mid = (row[0].x + row.at(-1).x + row.at(-1).width) / 2;
    assert(Math.abs(mid - (zone.x + zone.width / 2)) <= 1);
}
assert(Math.abs((rows[0] + rows.at(-1) + 195) / 2 - 516) <= 1);
assert.deepEqual(assistGrid(Array(30).fill(1.5), {x: 0, y: 0, width: 500, height: 300}).filter(Boolean).length, 1);
assert.equal(new Set(START_SHORTCUTS.map(s => s.id)).size, START_SHORTCUTS.length);
assert(START_SHORTCUTS.some(s => s.id === 'resources' && s.desktop === 'net.nokyan.Resources.desktop'));
assert.deepEqual([TRAY.trayToSystemGap, TRAY.systemToClockGap, TRAY.clockToDesktopGap], [4, 8, 4]);
console.log('布局、缩放和可选入口边界检查通过，0 项失败');
