/* 自适应值不回写设置；物理 4K/2× 与逻辑 1080p 必须一致。 */
import assert from 'node:assert/strict';
import {taskbarSize, taskbarSizingMode, searchStyle, taskStripBudget} from '../lib/adaptiveLayout.js';
import {startLayout} from '../lib/startOptions.js';
let checks = 0;
const check = (label, run) => { run(); checks++; console.log(`  ok   ${label}`); };
check('紧凑、标准、宽松与竖屏', () => {
    assert.equal(taskbarSize('auto', 1366, 768, 1, 64), 40);
    assert.equal(taskbarSize('auto', 1920, 1080, 1, 64), 48);
    assert.equal(taskbarSize('auto', 2560, 1440, 1, 64), 56);
    assert.equal(taskbarSize('auto', 1080, 1920, 1, 64), 48);
});
check('升级时保留旧手动粗细，显式 auto 可覆盖', () => {
    const settings = (size, mode) => ({get_user_value: key => key === 'taskbar-size' ? size : mode,
        get_string: () => mode ?? 'auto'});
    assert.equal(taskbarSizingMode(settings(64, null)), 'manual');
    assert.equal(taskbarSizingMode(settings(null, null)), 'auto');
    assert.equal(taskbarSizingMode(settings(64, 'auto')), 'auto');
});
check('物理与逻辑 HiDPI 不重复放大', () => {
    assert.equal(taskbarSize('auto', 3840, 2160, 2, 64), taskbarSize('auto', 1920, 1080, 1, 64));
    const normal = startLayout('auto', 1920, 1032, 1);
    const hidpi = startLayout('auto', 3840, 2064, 2);
    assert.deepEqual([hidpi.width / 2, hidpi.height / 2, hidpi.columns, hidpi.rows],
        [normal.width, normal.height, normal.columns, normal.rows]);
});
check('保留手动厚度和搜索样式', () => {
    assert.equal(taskbarSize('manual', 1366, 768, 1, 64), 64);
    assert.equal(searchStyle('box', 10, false, 48), 'box');
    assert.equal(searchStyle('hidden', 500, true, 48), 'hidden');
});
check('按剩余空间逐级降级；侧边仅图标', () => {
    assert.equal(searchStyle('auto', 500, false, 48), 'box');
    assert.equal(searchStyle('auto', 180, false, 48), 'icon-label');
    assert.equal(searchStyle('auto', 80, false, 48), 'icon');
    assert.equal(searchStyle('auto', 500, true, 48), 'icon');
});
check('应用过多时限制可滚动区域而不缩按钮', () => {
    assert.equal(taskStripBudget(800, 250, 100, 2000, 100), 350);
    assert.equal(taskStripBudget(1920, 300, 200, 600, 100), 600);
});
check('自动开始菜单六/八列且保留小屏空间', () => {
    assert.equal(startLayout('auto', 1920, 1032, 1).columns, 6);
    assert.equal(startLayout('auto', 2560, 1384, 1).columns, 8);
    const small = startLayout('auto', 480, 520, 1);
    assert(small.width <= 454 && small.height <= 494 && small.columns < 6);
});
check('无当前布局状态作为反馈，无自激振荡', () => {
    const sizes = Array.from({length: 50}, () => taskbarSize('auto', 1920, 1080, 1, 48));
    assert.equal(new Set(sizes).size, 1);
});
console.log(`自适应布局：${checks} 项通过，0 项失败`);
