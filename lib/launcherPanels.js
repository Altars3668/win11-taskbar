/* 跨显示器互斥的本扩展启动面板；不接管其他扩展的弹层。 */
const panels = new Set();
export function registerLauncher(panel) {
    panels.add(panel);
    return () => panels.delete(panel);
}
export function closeOtherLaunchers(current) {
    for (const panel of panels) {
        if (panel !== current) panel.close();
    }
}
