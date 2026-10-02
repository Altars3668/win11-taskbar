/* windows.js — which windows a task button represents, and in what order.
 *
 * Windows' taskbar shows one button per app, covering the windows on the
 * current virtual desktop (and, with "show taskbar on all displays", the
 * windows on that display). We reproduce that filter here so every other
 * module agrees on what "the windows of this app" means.
 */

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

/** Windows that never get a taskbar button, matching Windows' own rules:
 *  tool windows, windows with WS_EX_NOACTIVATE, and anything that asked to
 *  be skipped. GNOME exposes the equivalent as skip_taskbar. */
function isTaskbarWindow(win) {
    if (!win || win.skip_taskbar)
        return false;
    const type = win.get_window_type();
    return type === Meta.WindowType.NORMAL ||
           type === Meta.WindowType.DIALOG ||
           type === Meta.WindowType.MODAL_DIALOG;
}

/**
 * The windows an app contributes to one taskbar.
 *
 * @param {Shell.App} app the application
 * @param {object} opts filtering options
 * @param {boolean} opts.isolateWorkspaces only windows on the active workspace
 * @param {number} opts.monitorIndex restrict to this monitor, or -1 for all
 * @returns {Meta.Window[]} windows in stable, stacking-independent order
 */
export function getAppWindows(app, opts = {}) {
    const {isolateWorkspaces = true, monitorIndex = -1} = opts;
    let windows = app.get_windows().filter(isTaskbarWindow);

    if (isolateWorkspaces) {
        const active = global.workspace_manager.get_active_workspace();
        // A window "on all workspaces" belongs to every desktop, exactly as a
        // pinned-to-all-desktops window does on Windows.
        windows = windows.filter(w => w.is_on_all_workspaces() ||
                                      w.get_workspace() === active);
    }

    if (monitorIndex >= 0)
        windows = windows.filter(w => w.get_monitor() === monitorIndex);

    // Windows orders the thumbnails by the order the windows were opened, not
    // by stacking order, so the strip does not reshuffle as you click around.
    return windows.sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
}

/** True when this app owns the currently focused window. */
export function isAppFocused(app) {
    return Shell.WindowTracker.get_default().focus_app === app;
}

/** The focused window of this app, if any. */
export function getFocusedWindow(app, opts) {
    const focus = global.display.focus_window;
    if (!focus)
        return null;
    return getAppWindows(app, opts).find(w => w === focus) ?? null;
}

/**
 * The window a plain click should raise next, cycling in open order.
 * Windows' Ctrl+click walks the group in the same order the thumbnails show.
 *
 * @param {Shell.App} app the application
 * @param {object} opts filtering options
 * @returns {Meta.Window|null} the next window to raise
 */
export function getNextWindow(app, opts) {
    const windows = getAppWindows(app, opts);
    if (windows.length === 0)
        return null;
    const focus = global.display.focus_window;
    const idx = windows.indexOf(focus);
    if (idx < 0) {
        // Nothing of ours is focused: go to the one the user saw last.
        return windows.reduce((best, w) =>
            (!best || w.get_user_time() > best.get_user_time()) ? w : best, null);
    }
    return windows[(idx + 1) % windows.length];
}

/** Raise and focus a window, undoing minimisation the way Windows does. */
export function activateWindow(win, timestamp) {
    const ts = timestamp || global.get_current_time();
    const workspace = win.get_workspace();
    if (workspace && workspace !== global.workspace_manager.get_active_workspace())
        workspace.activate_with_focus(win, ts);
    else
        win.activate(ts);
}
