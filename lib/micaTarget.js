/* GTK 库也被浏览器和 Qt 用于桌面集成；这不代表其窗口由 GTK 绘制。 */
export function gtkMicaTarget(identity, maps = '') {
    const names = [identity.wmClass, identity.appId, identity.gtkApplicationId].filter(Boolean).join(' ').toLowerCase();
    if (/(?:^|[\s./_-])(?:microsoft-edge|msedge|google-chrome|chrome|chromium|firefox|electron|code-insiders|code|brave-browser|vivaldi)(?:$|[\s./_-])/.test(names))
        return false;
    if (/\/(?:msedge|chrome|chromium|firefox|electron|libcef\.so|libQt[56]Gui\.so)(?:[\s./_-]|$)/i.test(maps))
        return false;
    return Boolean(identity.gtkApplicationId) || /\/libgtk-[34]\.so/.test(maps);
}
