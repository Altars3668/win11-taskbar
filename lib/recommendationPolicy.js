/* 最近项目的纯过滤策略；不访问文件系统或用户配置。 */
export const RECOMMENDED_TYPES = [
    ['documents', 'Documents'], ['images', 'Images'], ['audio', 'Audio'],
    ['video', 'Video'], ['archives', 'Archives'], ['code', 'Code'], ['other', 'Other'],
];

export const RECOMMENDATION_KEYS = ['recommended-enabled', 'recommended-files', 'recommended-folders',
    'recommended-hidden', 'recommended-include-directories', 'recommended-exclude-directories',
    'recommended-types', 'recommended-extensions', 'recommended-days', 'recommended-limit'];

export function recommendationPolicy(settings) {
    return {
        enabled: settings.get_boolean('recommended-enabled'),
        files: settings.get_boolean('recommended-files'),
        folders: settings.get_boolean('recommended-folders'),
        showHidden: settings.get_boolean('recommended-hidden'),
        includeDirectories: settings.get_strv('recommended-include-directories'),
        excludeDirectories: settings.get_strv('recommended-exclude-directories'),
        types: settings.get_strv('recommended-types'),
        extensions: settings.get_strv('recommended-extensions'),
        days: settings.get_int('recommended-days'),
        limit: settings.get_int('recommended-limit'),
    };
}

export function normalizedDirectory(value) {
    const path = typeof value === 'string' ? value : null;
    if (!path?.startsWith('/') || path.includes('\0'))
        return null;
    const parts = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return '/' + parts.join('/');
}

export function withinDirectory(path, directory) {
    const p = normalizedDirectory(path);
    const d = normalizedDirectory(directory);
    return Boolean(p && d && (d === '/' || p === d || p.startsWith(d + '/')));
}

const EXTENSIONS = {
    images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'tif', 'tiff', 'heic'],
    audio: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'],
    video: ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'],
    archives: ['zip', 'gz', 'xz', 'bz2', '7z', 'rar', 'tar', 'zst'],
    code: ['py', 'js', 'ts', 'jsx', 'tsx', 'r', 'do', 'jl', 'c', 'cpp', 'h', 'rs', 'go', 'sh', 'tex', 'json', 'xml'],
    documents: ['pdf', 'txt', 'md', 'doc', 'docx', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'csv'],
};

export function documentCategory(entry) {
    const mime = (entry.mime ?? '').toLowerCase();
    if (mime.startsWith('image/')) return 'images';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (/zip|compressed|tar|rar|archive/.test(mime)) return 'archives';
    if (/javascript|json|xml|python|shellscript|source/.test(mime)) return 'code';
    const name = (entry.name ?? entry.path ?? '').toLowerCase();
    for (const [category, extensions] of Object.entries(EXTENSIONS)) {
        if (extensions.some(ext => name.endsWith('.' + ext)))
            return category;
    }
    if (mime.startsWith('text/') || /pdf|word|officedocument|spreadsheet|presentation|opendocument/.test(mime))
        return 'documents';
    return 'other';
}

export function recommendationMatches(entry, policy, now = Date.now()) {
    if (policy.enabled === false || entry.exists === false || !normalizedDirectory(entry.path))
        return false;
    const kind = entry.kind ?? 'file';
    if (kind === 'folder' ? policy.folders === false : policy.files === false)
        return false;
    const paths = [entry.path, entry.resolvedPath].filter(Boolean);
    if (!policy.showHidden && (entry.hidden || paths.some(path => path.split('/').some(part => part.startsWith('.')))))
        return false;
    if (paths.some(path => (policy.excludeDirectories ?? []).some(dir => withinDirectory(path, dir))))
        return false;
    const included = policy.includeDirectories ?? [];
    if (included.length && !paths.every(path => included.some(dir => withinDirectory(path, dir))))
        return false;
    if (kind !== 'folder') {
        const types = policy.types ?? [];
        if (types.length && !types.includes(documentCategory(entry)))
            return false;
        const extensions = (policy.extensions ?? []).map(e => e.trim().replace(/^\./, '').toLowerCase()).filter(Boolean);
        if (extensions.length && !extensions.some(ext => (entry.name ?? '').toLowerCase().endsWith('.' + ext)))
            return false;
    }
    // 只使用 XBEL 的访问/应用打开记录；未知时间可在“不限时间”模式中出现。
    const accessed = entry.accessed ?? 0;
    if (policy.days > 0 && (!accessed || accessed < now - policy.days * 86400000 || accessed > now + 60000))
        return false;
    return true;
}

export function recommendedEntries(entries, policy, now = Date.now()) {
    const limit = Math.max(1, Math.min(100, policy.limit ?? 5));
    const unique = new Map();
    for (const entry of entries) {
        const key = entry.uri ?? entry.path;
        if (recommendationMatches(entry, policy, now) &&
            (!unique.has(key) || (entry.accessed ?? 0) > (unique.get(key).accessed ?? 0)))
            unique.set(key, entry);
    }
    return [...unique.values()].sort((a, b) => (b.accessed ?? 0) - (a.accessed ?? 0)).slice(0, limit);
}
