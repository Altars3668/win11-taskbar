/* windows.js — which windows a task button represents, and in what order.
 *
 * Windows' taskbar shows one button per app, covering the windows on the
 * current virtual desktop (and, with "show taskbar on all displays", the
 * windows on that display). We reproduce that filter here so every other
 * module agrees on what "the windows of this app" means.
 */

import GLib from 'gi://GLib';
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

/* The process that started a process, from /proc; 0 if it is unknown. */
function parentPid(pid) {
    try {
        const [, bytes] = GLib.file_get_contents(`/proc/${pid}/stat`);
        const text = new TextDecoder().decode(bytes);
        // The command name in parentheses may hold anything; the fields
        // after its closing parenthesis do not.
        return Number(text.slice(text.lastIndexOf(')') + 2).split(' ')[1]) || 0;
    } catch {
        return 0;
    }
}

function executable(pid) {
    try {
        return GLib.file_read_link(`/proc/${pid}/exe`);
    } catch {
        return null;
    }
}

/* The app a program file is, by its name, as GNOME finds an app by a
 * window's WM_CLASS. */
function appForProgram(path) {
    const name = GLib.path_get_basename(path);
    const system = Shell.AppSystem.get_default();
    return system.lookup_startup_wmclass(name) ?? system.lookup_desktop_wmclass(name);
}

/**
 * The app a window belongs to when GNOME could not tell.
 *
 * GNOME places a window by its WM_CLASS or application id. A window that
 * gives neither — WeChat's built-in browser, a helper process that names
 * nothing — becomes an app of its own, without an icon. Windows shows such
 * a window on the button of the program that started it, and so does this:
 * the nearest process up its tree that is an app, by its windows or by its
 * program's name — provided the window's own program is installed inside
 * that app's directory, so that whatever was merely run from a terminal is
 * not taken for the terminal's.
 *
 * @param {Meta.Window} win a window
 * @returns {Shell.App|null} the app it belongs to, or null
 */
function fosterApp(win) {
    const tracker = Shell.WindowTracker.get_default();
    const placed = tracker.get_window_app(win);
    // Worked out again whenever GNOME places the window anew — when it
    // names its class late, say.
    if (win._w11Foster?.placed === placed)
        return win._w11Foster.app;
    let found = null;
    const pid = win.get_pid();
    const program = pid > 0 && !win.get_wm_class() && !win.get_gtk_application_id()
        ? executable(pid) : null;
    if (program && placed?.is_window_backed()) {
        const shell = executable('self');
        let ancestor = pid;
        for (let depth = 0; depth < 6 && !found; depth++) {
            ancestor = parentPid(ancestor);
            const path = ancestor > 1 ? executable(ancestor) : null;
            if (!path || path === shell)
                break;
            const app = tracker.get_app_from_pid(ancestor) ?? appForProgram(path);
            if (!app || app.is_window_backed())
                continue;
            if (program.startsWith(`${GLib.path_get_dirname(path)}/`))
                found = app;
            break;
        }
    }
    win._w11Foster = {placed, app: found};
    return found;
}

/* The windows GNOME left without an app, by the app that takes them in. */
function fosteredWindows() {
    const result = new Map();
    for (const app of Shell.AppSystem.get_default().get_running()) {
        if (!app.is_window_backed())
            continue;
        for (const win of app.get_windows()) {
            const owner = fosterApp(win);
            if (owner)
                result.set(owner, [...result.get(owner) ?? [], win]);
        }
    }
    return result;
}

/**
 * The app a window shows under on the taskbar.
 *
 * @param {Meta.Window} win a window
 * @returns {Shell.App|null} its app
 */
export function windowApp(win) {
    return fosterApp(win) ?? Shell.WindowTracker.get_default().get_window_app(win);
}

/**
 * The apps that take in windows GNOME left without one, whether or not
 * GNOME counts them as running.
 *
 * @returns {Shell.App[]} the apps
 */
export function fosterApps() {
    return [...fosteredWindows().keys()];
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
    // An app GNOME made up for a window it could not place gives that
    // window up to the app that takes it in.
    let windows = app.is_window_backed()
        ? app.get_windows().filter(win => !fosterApp(win))
        : [...app.get_windows(), ...fosteredWindows().get(app) ?? []];
    windows = windows.filter(isTaskbarWindow);

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
    const focus = global.display.focus_window;
    if (focus && fosterApp(focus))
        return fosterApp(focus) === app;
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
