/* 共享最近项目快照：用 GLib 解析 XML，用 Gio 异步验证本地路径。
 * 只读 XBEL 中的条目，不扫描目录；Start、搜索和 Jump List 共用缓存。 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {normalizedDirectory} from './recommendationPolicy.js';

function optional(read, fallback) {
    try { return read() ?? fallback; } catch { return fallback; }
}

// BookmarkFile 会把缺失的 visited/应用时间补成“现在”；只从原始、已验证 XML
// 的开始标签收集实际时间。XML 合法性、URI、MIME 与应用列表仍由 GLib 解析。
function recordedTimes(text) {
    const times = new Map();
    let current = null;
    const decode = value => value.replace(/&(amp|lt|gt|quot|apos|#x[\da-f]+|#\d+);/gi, (_match, entity) => {
        const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};
        if (named[entity]) return named[entity];
        const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    });
    for (const [tag] of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>/g)) {
        if (tag.startsWith('<!--') || tag.startsWith('<![CDATA[')) continue;
        if (/^<\/bookmark\s*>/.test(tag)) { current = null; continue; }
        const attributes = Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)]
            .map(([, key, , value]) => [key, decode(value)]));
        if (/^<bookmark(?=\s|\/?>)/.test(tag)) {
            current = attributes.href;
            times.set(current, Date.parse(attributes.visited ?? '') || 0);
            if (tag.endsWith('/>')) current = null;
        } else if (current && /^<bookmark:application\b/.test(tag)) {
            times.set(current, Math.max(times.get(current) ?? 0, Date.parse(attributes.modified ?? '') || 0));
        }
    }
    return times;
}

export function parseRecentBookmarks(text) {
    if (!/<xbel\b/.test(text) || !/<\/xbel\s*>\s*$/.test(text)) return [];
    const bookmarks = new GLib.BookmarkFile();
    try {
        bookmarks.load_from_data(text);
    } catch {
        return [];
    }
    const times = recordedTimes(text);
    return bookmarks.get_uris().filter(uri => uri.startsWith('file://')).map(uri => {
        const applications = optional(() => bookmarks.get_applications(uri), []);
        return {uri, mime: optional(() => bookmarks.get_mime_type(uri), ''), applications,
            accessed: times.get(uri) ?? 0};
    }).sort((a, b) => b.accessed - a.accessed);
}

function loadText(file, cancellable) {
    return new Promise((resolve, reject) => file.load_contents_async(cancellable, (source, result) => {
        try {
            const [, bytes] = source.load_contents_finish(result);
            resolve(new TextDecoder().decode(bytes));
        } catch (error) { reject(error); }
    }));
}

function queryInfo(path, cancellable, cache) {
    if (!cache.has(path)) {
        cache.set(path, new Promise((resolve, reject) => {
            Gio.File.new_for_path(path).query_info_async(
                'standard::type,standard::is-symlink,standard::symlink-target,standard::is-hidden,standard::content-type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, cancellable, (file, result) => {
                    try { resolve(file.query_info_finish(result)); } catch (error) { reject(error); }
                });
        }));
    }
    return cache.get(path);
}

async function resolvePath(path, cancellable, cache, hops = 0) {
    if (hops > 16 || cancellable.is_cancelled())
        throw new Error('最近项目路径无法安全解析');
    path = normalizedDirectory(path);
    if (!path) throw new Error('不是本地绝对路径');
    if (path === '/') return {path, info: await queryInfo(path, cancellable, cache)};
    const parent = await resolvePath(GLib.path_get_dirname(path), cancellable, cache, hops);
    if (parent.info.get_file_type() !== Gio.FileType.DIRECTORY)
        throw new Error('父路径不是目录');
    const resolved = GLib.build_filenamev([parent.path, GLib.path_get_basename(path)]);
    const info = await queryInfo(resolved, cancellable, cache);
    if (!info.get_is_symlink()) return {path: resolved, info};
    const target = info.get_symlink_target();
    return resolvePath(GLib.path_is_absolute(target) ? target :
        GLib.build_filenamev([parent.path, target]), cancellable, cache, hops + 1);
}

export function recentForApplication(entries, appInfo, limit = 10) {
    if (!appInfo) return [];
    const id = (appInfo.get_id() ?? '').replace(/\.desktop$/, '').toLowerCase();
    const name = (appInfo.get_display_name?.() ?? '').toLowerCase();
    const supported = appInfo.get_supported_types() ?? [];
    return entries.filter(entry => entry.applications.some(application => {
        const app = application.toLowerCase();
        return app && (app === id || app === name || id.endsWith('.' + app));
    }) || supported.includes(entry.mime)).slice(0, limit);
}

export class RecentDocuments {
    constructor(path = null, {ttl = 30000, maxEntries = 500, timeout = 5000} = {}) {
        this._file = Gio.File.new_for_path(path ?? GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']));
        this._ttl = ttl;
        this._maxEntries = maxEntries;
        this._timeout = timeout;
        this._listeners = new Set();
        this.entries = [];
        this._generation = 0;
        this._dirty = true;
        this._updated = 0;
        this._timer = 0;
        this._destroyed = false;
        try {
            this._monitor = this._file.get_parent().monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', (_monitor, file, other) => {
                if (file?.equal(this._file) || other?.equal(this._file)) this.invalidate();
            });
        } catch {
            this._monitor = null;
        }
    }

    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    invalidate() {
        if (this._destroyed) return;
        this._dirty = true;
        this._generation++;
        this._cancellable?.cancel();
        this._cancelLoad?.();
        this._cancelLoad = null;
        this._pending = null;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._timer = 0;
            if (this._listeners.size) this.refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    refresh() {
        if (this._destroyed) return Promise.resolve([]);
        if (this._pending) return this._pending;
        if (!this._dirty && Date.now() - this._updated < this._ttl) return Promise.resolve(this.entries);
        const ticket = ++this._generation;
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        let finish;
        const stopped = new Promise(resolve => { finish = () => resolve(null); });
        this._cancelLoad = finish;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._timeout, () => {
            timer = 0;
            cancellable.cancel();
            finish();
            return GLib.SOURCE_REMOVE;
        });
        this._pending = Promise.race([this._read(cancellable).catch(() => []), stopped]).then(entries => {
            if (ticket !== this._generation || this._destroyed) return this.entries;
            if (entries && !cancellable.is_cancelled()) this.entries = entries;
            // 慢挂载不响应取消也不能卡住后续消费者；失败快照同样短暂缓存，避免重试风暴。
            this._dirty = false;
            this._updated = Date.now();
            for (const listener of this._listeners) listener(this.entries);
            return this.entries;
        }).finally(() => {
            if (timer) GLib.source_remove(timer);
            if (ticket === this._generation) {
                this._pending = null;
                this._cancellable = null;
                this._cancelLoad = null;
            }
        });
        return this._pending;
    }

    async _read(cancellable) {
        const parsed = parseRecentBookmarks(await loadText(this._file, cancellable)).slice(0, this._maxEntries);
        const cache = new Map();
        const out = [];
        let index = 0;
        const worker = async () => {
            while (index < parsed.length && !cancellable.is_cancelled()) {
                const entry = parsed[index++];
                const file = Gio.File.new_for_uri(entry.uri);
                const path = file.get_path();
                if (!file.is_native() || !path || GLib.uri_parse_scheme(entry.uri) !== 'file') continue;
                // file://host 不作为本机路径处理，避免静默访问远端挂载。
                const [, hostname] = optional(() => GLib.filename_from_uri(entry.uri), [null, 'remote']);
                if (hostname && hostname !== 'localhost') continue;
                try {
                    const resolved = await resolvePath(path, cancellable, cache);
                    const type = resolved.info.get_file_type();
                    if (![Gio.FileType.REGULAR, Gio.FileType.DIRECTORY].includes(type)) continue;
                    out.push({...entry, path, resolvedPath: resolved.path, exists: true,
                        name: file.get_basename(), dir: file.get_parent()?.get_basename() ?? '',
                        hidden: resolved.info.get_is_hidden(),
                        kind: type === Gio.FileType.DIRECTORY ? 'folder' : 'file',
                        mime: entry.mime || resolved.info.get_content_type() || ''});
                } catch { /* 消失、断开或无权读取的条目不进入快照。 */ }
            }
        };
        await Promise.all(Array.from({length: 6}, worker));
        return out.sort((a, b) => b.accessed - a.accessed);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        this._generation++;
        this._cancellable?.cancel();
        this._cancelLoad?.();
        this._cancelLoad = this._cancellable = this._pending = null;
        this._monitor?.cancel();
        this._monitor = null;
        if (this._timer) GLib.source_remove(this._timer);
        this._timer = 0;
        this._listeners.clear();
        this.entries = [];
    }
}
