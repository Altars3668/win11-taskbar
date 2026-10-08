/* 推荐策略只吃快照；边界和未知字段不得由磁盘修改时间补齐。 */
import assert from 'node:assert/strict';
import {documentCategory, normalizedDirectory, recommendationMatches, recommendedEntries} from '../lib/recommendationPolicy.js';
import {wiredIndicatorIcon} from '../lib/indicatorIcons.js';

let checks = 0;
const check = (label, run) => { run(); checks++; console.log(`  ok   ${label}`); };
const now = Date.UTC(2026, 9, 8, 12);
const item = {uri: 'file:///home/test/Documents/a.pdf', path: '/home/test/Documents/a.pdf',
    name: 'a.pdf', mime: 'application/pdf', kind: 'file', exists: true, accessed: now};
const matches = (entry = item, policy = {}) => recommendationMatches(entry, policy, now);
check('仅正常有线连接使用显示器图标', () => {
    assert.equal(wiredIndicatorIcon('network-wired-symbolic'), 'computer-symbolic');
    for (const icon of ['network-wired-acquiring-symbolic', 'network-wired-disconnected-symbolic',
        'network-wired-no-route-symbolic', 'network-wireless-signal-excellent-symbolic',
        'network-vpn-symbolic', null])
        assert.equal(wiredIndicatorIcon(icon), icon);
});
check('开关、文件和文件夹分别控制', () => {
    assert(matches()); assert(!matches(item, {enabled: false}));
    assert(!matches(item, {files: false})); assert(matches({...item, kind: 'folder'}, {files: false}));
    assert(!matches({...item, kind: 'folder'}, {folders: false}));
});
check('目录路径标准化与相邻目录边界', () => {
    assert.equal(normalizedDirectory('/home/test/./Documents/../Documents/'), '/home/test/Documents');
    assert.equal(normalizedDirectory('relative'), null);
    assert(matches(item, {includeDirectories: ['/home/test/Documents/']}));
    assert(!matches(item, {includeDirectories: ['/home/test/Document']}));
});
check('排除优先且软链接不能绕开白名单', () => {
    assert(!matches(item, {includeDirectories: ['/home/test'], excludeDirectories: ['/home/test/Documents']}));
    const link = {...item, resolvedPath: '/private/a.pdf'};
    assert(!matches(link, {includeDirectories: ['/home/test']}));
    assert(!matches(link, {excludeDirectories: ['/private']}));
});
check('隐藏路径、远程和消失条目不默认推荐', () => {
    assert(!matches({...item, path: '/home/test/.secret/a.pdf'}));
    assert(!matches({...item, resolvedPath: '/home/test/.secret/a.pdf'}));
    assert(!matches({...item, path: null, uri: 'https://example.com/a.pdf'}));
    assert(!matches({...item, exists: false}));
    assert(matches({...item, hidden: true}, {showHidden: true}));
});
check('类型、大小写扩展名与多段后缀', () => {
    assert(matches(item, {types: ['documents'], extensions: ['.PDF']}));
    assert(!matches(item, {types: ['images']}));
    assert.equal(documentCategory({...item, name: 'a.png', mime: ''}), 'images');
    assert(matches({...item, name: 'archive.tar.gz'}, {extensions: ['tar.gz']}));
    assert(matches({...item, kind: 'folder'}, {types: ['images'], extensions: ['png']}));
});
check('按访问记录而非磁盘修改时间过滤', () => {
    assert(matches({...item, accessed: now - 7 * 86400000}, {days: 7}));
    assert(!matches({...item, accessed: now - 7 * 86400000 - 1}, {days: 7}));
    assert(!matches({...item, accessed: 0, modified: now}, {days: 7}));
    assert(matches({...item, accessed: 0}, {days: 0}));
    assert(!matches({...item, accessed: now + 86400000}, {days: 7}));
});
check('先过滤、再按最近访问去重、最后限量', () => {
    const entries = [
        {...item, accessed: now - 100}, {...item, accessed: now - 500},
        {...item, uri: 'file:///home/test/Documents/b.pdf', path: '/home/test/Documents/b.pdf', accessed: now - 200},
        {...item, uri: 'file:///private/a.pdf', path: '/private/a.pdf', accessed: now + 10},
    ];
    const filtered = recommendedEntries(entries, {includeDirectories: ['/home/test'], limit: 2}, now);
    assert.equal(filtered.length, 2); assert.equal(filtered[0].accessed, now - 100);
    assert.deepEqual(recommendedEntries(entries, {enabled: false}, now), []);
});
console.log(`有线图标与推荐策略：${checks} 项通过，0 项失败`);
