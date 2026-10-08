/* 真正的 GLib XBEL 解析和 Gio 异步文件查询；只创建临时测试数据。 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseRecentBookmarks, RecentDocuments, recentForApplication} from '../lib/recentDocuments.js';

let checks = 0;
function check(label, condition) {
    if (!condition) throw new Error(label);
    checks++; print(`  ok   ${label}`);
}
const root = GLib.dir_make_tmp('w11-recent-tests-XXXXXX');
const store = `${root}/recently-used.xbel`;
const uri = path => Gio.File.new_for_path(path).get_uri();
const write = (path, content) => GLib.file_set_contents(path, content);
const escape = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const bookmark = (path, visited = '2026-10-08T09:00:00Z', mime = 'application/pdf') =>
    `<bookmark href="${escape(uri(path))}" modified="2026-10-08T10:00:00Z" ${visited ? `visited="${visited}"` : ''}>
      <info><metadata owner="http://freedesktop.org"><mime:mime-type type="${mime}"/>
      <bookmark:applications><bookmark:application name="test-editor" exec="test-editor %u" count="1" modified="2026-10-08T08:00:00Z"/>
      </bookmark:applications></metadata></info></bookmark>`;
const xbel = entries => `<?xml version="1.0"?><xbel version="1.0" xmlns:bookmark="http://www.freedesktop.org/standards/desktop-bookmarks" xmlns:mime="http://www.freedesktop.org/standards/shared-mime-info">${entries.join('')}</xbel>`;
const filename = `${root}/中文 & a.pdf `;
const folder = `${root}/文件夹`;
const link = `${root}/alias.pdf`;
const linkDir = `${root}/alias-dir`;
write(filename, 'fixture');
GLib.mkdir_with_parents(folder, 0o700);
Gio.File.new_for_path(link).make_symbolic_link(filename, null);
Gio.File.new_for_path(linkDir).make_symbolic_link(folder, null);
write(`${folder}/child.pdf`, 'fixture');
write(store, xbel([bookmark(filename), bookmark(folder, '', 'inode/directory'),
    bookmark(link), bookmark(`${linkDir}/child.pdf`), bookmark(`${root}/gone.pdf`)]));
const provider = new RecentDocuments(store, {ttl: 60000});
try {
    const parsed = parseRecentBookmarks(xbel([bookmark(filename)]));
    check('XML 转义和 Unicode URI 不丢失', parsed.length === 1 && parsed[0].uri === uri(filename));
    check('记录访问时间，不取磁盘 mtime 或 XBEL modified', parsed[0].accessed === Date.parse('2026-10-08T09:00:00Z'));
    check('应用记录和 MIME 被保留', parsed[0].applications.includes('test-editor') && parsed[0].mime === 'application/pdf');
    const applicationTime = parseRecentBookmarks(xbel([bookmark(filename, '')]));
    check('无 visited 时使用真实应用打开记录', applicationTime[0].accessed === Date.parse('2026-10-08T08:00:00Z'));
    const unknownTime = parseRecentBookmarks(xbel([`<bookmark href="${escape(uri(filename))}"/>`]));
    check('没有访问或应用记录时保持未知时间', unknownTime[0].accessed === 0);
    check('畸形 XML 安全降级', parseRecentBookmarks('<xbel><bookmark').length === 0);
    const firstPromise = provider.refresh();
    check('并发消费者复用同一个读取', firstPromise === provider.refresh());
    const entries = await firstPromise;
    check('异步查询排除消失文件', entries.length === 4 && entries.every(e => e.exists));
    check('文件和文件夹分类正确', entries.find(e => e.path === folder)?.kind === 'folder');
    check('直接软链接和祖先软链接均解析', entries.find(e => e.path === link)?.resolvedPath === filename &&
        entries.find(e => e.path === `${linkDir}/child.pdf`)?.resolvedPath === `${folder}/child.pdf`);
    const info = {get_id: () => 'test-editor.desktop', get_display_name: () => 'Test Editor', get_supported_types: () => []};
    check('Jump List 按应用筛选', recentForApplication(entries, info).length === 4 &&
        recentForApplication(entries, {...info, get_id: () => 'unrelated.desktop'}).length === 0);
    check('未失效时直接复用缓存快照', await provider.refresh() === entries);
    Gio.File.new_for_path(filename).delete(null);
    provider.invalidate();
    const refreshed = await provider.refresh();
    check('失效后消失文件和断开的链接被清理', refreshed.length === 2);
    provider.destroy();
    check('销毁后不启动读取或留下监听', (await provider.refresh()).length === 0 && provider._listeners.size === 0 && !provider._monitor);
    const stalled = new RecentDocuments(store, {timeout: 15});
    stalled._read = () => new Promise(() => {});
    let settled = false;
    stalled.refresh().then(() => { settled = true; });
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        resolve(); return GLib.SOURCE_REMOVE;
    }));
    const bounded = settled && !stalled._pending;
    stalled.destroy();
    check('慢挂载不响应取消时，外层读取仍按期限结束', bounded);
} finally {
    provider.destroy();
    for (const path of [store, filename, link, `${folder}/child.pdf`, linkDir, folder, root]) {
        try { Gio.File.new_for_path(path).delete(null); } catch { /* 已删除的 fixture。 */ }
    }
}
print(`最近项目读取器：${checks} 项通过，0 项失败`);
