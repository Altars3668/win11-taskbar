/* 布局和可选入口的边界回归，不依赖 GNOME 进程。 */
import assert from 'node:assert/strict';
import {startLayout, START_SHORTCUTS} from '../lib/startOptions.js';
import {TRAY} from '../lib/spec.js';

const compact = startLayout('compact', 1920, 1080, 48, 1);
assert.deepEqual([compact.width, compact.height, compact.columns, compact.rows],
    [640, 720, 6, 3]);
const wide = startLayout('wide', 1920, 1080, 48, 1);
assert.deepEqual([wide.width, wide.height, wide.columns, wide.rows],
    [832, 864, 8, 2]);
for (const scale of [1, 2]) {
    for (const [w, h] of [[1920, 1080], [800, 600], [480, 480]]) {
        const layout = startLayout('wide', w, h, 48 * scale, scale);
        assert(layout.width <= w - 26 * scale);
        assert(layout.height <= h - 48 * scale - 26 * scale);
        assert(layout.columns * layout.tileWidth * scale <= layout.width - 64 * scale);
        assert(layout.rows >= 1);
    }
}
assert.equal(new Set(START_SHORTCUTS.map(s => s.id)).size, START_SHORTCUTS.length);
assert(START_SHORTCUTS.some(s => s.id === 'resources' && s.desktop === 'net.nokyan.Resources.desktop'));
assert.deepEqual([TRAY.trayToSystemGap, TRAY.systemToClockGap, TRAY.clockToDesktopGap], [4, 8, 4]);
console.log('布局、缩放和可选入口边界检查通过，0 项失败');
