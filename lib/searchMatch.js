/* 应用与最近项目共用的本地文本匹配，不保存查询或进行联网搜索。 */
function normalized(text) {
    return String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesQuery(query, parts) {
    const tokens = normalized(query).trim().split(/\s+/).filter(Boolean);
    const haystack = normalized(parts.filter(Boolean).join(' '));
    return tokens.every(token => haystack.includes(token));
}
