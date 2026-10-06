/* 布局和可选入口的边界回归，不依赖 GNOME 进程。 */
import assert from 'node:assert/strict';
import {startLayout, START_SHORTCUTS} from '../lib/startOptions.js';
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
assert.equal(new Set(START_SHORTCUTS.map(s => s.id)).size, START_SHORTCUTS.length);
assert(START_SHORTCUTS.some(s => s.id === 'resources' && s.desktop === 'net.nokyan.Resources.desktop'));
assert.deepEqual([TRAY.trayToSystemGap, TRAY.systemToClockGap, TRAY.clockToDesktopGap], [4, 8, 4]);
console.log('布局、缩放和可选入口边界检查通过，0 项失败');
