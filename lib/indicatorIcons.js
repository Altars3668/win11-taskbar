/* 只替换正常有线连接的拓扑图标；其他网络状态继续使用 GNOME 的语义图标。 */
export function wiredIndicatorIcon(iconName) {
    return iconName === 'network-wired-symbolic' ? 'computer-symbolic' : iconName;
}
