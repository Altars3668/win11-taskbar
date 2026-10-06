/* captionButtons.js — where a window's own title bar has its Maximise
 * button, so that the snap layouts can open when the pointer rests on it.
 *
 * Nothing tells the shell where an app draws its buttons. Those here put
 * Minimise, Maximise and Close side by side at the window's top right, and
 * were measured in the testbed (2026-10-06) by hovering each button and
 * seeing what lit up, the window both as it opened and maximised:
 * - GTK 4 with Windows' title bars on (gtkWindowStyle.js): Maximise 46 wide,
 *   ending 46px from the right in libadwaita apps (the text editor), 44px
 *   in a plain GTK 4 header bar; 45 high in libadwaita, 37 in plain GTK 4;
 * - GTK 3 with them on: 46 wide, 45 high, ending 46px from the right once
 *   the 6px GTK 3 keeps between its title buttons is taken back;
 * - Edge (Chromium's own title bar): round 28px buttons 32px apart,
 *   Maximise 34px from the right and 7px down, 37 and 6 maximised;
 * - VS Code (Electron's): the same, 3px down, 2 maximised.
 * BUTTONS holds the area covering each case. Which of them draws a window
 * is read once per process, from what it runs and what it has loaded,
 * without holding up the shell; until then, and for anything else, there
 * is no button.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

/** Maximise, by who draws it: how far its right edge is from the frame's,
 *  its width, how far down from the frame's top, and its height. */
export const BUTTONS = {
    gtk4: {right: 44, width: 48, top: 0, height: 46},
    gtk3: {right: 46, width: 46, top: 0, height: 46},
    chromium: {right: 34, width: 31, top: 6, height: 29},
    electron: {right: 34, width: 28, top: 2, height: 29},
};

/** The toolkits that only draw Windows' buttons with gtkWindowStyle.js on. */
const STYLED = new Set(['gtk4', 'gtk3']);

const kinds = new Map();

function readText(path) {
    return new Promise(resolve => {
        const file = Gio.File.new_for_path(path);
        file.load_contents_async(null, (_file, result) => {
            try {
                resolve(new TextDecoder().decode(file.load_contents_finish(result)[1]));
            } catch {
                resolve('');
            }
        });
    });
}

/* Chromium and Electron load GTK 3 too, for their dialogs: they are told
 * apart first, by their program and the archive an Electron app ships. */
async function classify(pid) {
    const maps = await readText(`/proc/${pid}/maps`);
    let exe = '';
    try {
        exe = GLib.file_read_link(`/proc/${pid}/exe`);
    } catch {}
    const resources = GLib.build_filenamev([GLib.path_get_dirname(exe), 'resources']);
    if (exe && ['app.asar', 'app/package.json'].some(name =>
        GLib.file_test(GLib.build_filenamev([resources, name]), GLib.FileTest.EXISTS)))
        return 'electron';
    if (/\/(msedge|chrome|chromium|brave|vivaldi-bin)$/.test(exe))
        return 'chromium';
    if (/\/libgtk-4\.so/.test(maps))
        return 'gtk4';
    if (/\/libgtk-3\.so/.test(maps))
        return 'gtk3';
    return null;
}

/**
 * Where a window's Maximise button is, if it is known.
 *
 * @param {Meta.Window} win the window
 * @param {boolean} styled whether Windows' title bars are on for GTK apps
 * @param {Function} [learnt] called once a process not seen before has been
 *   read, so that a pointer already resting on its button counts
 * @returns {object|null} the button's rectangle on the stage, or null
 */
export function maximiseButton(win, styled, learnt = null) {
    const pid = win.get_pid();
    if (pid <= 0)
        return null;
    if (!kinds.has(pid)) {
        kinds.set(pid, null);
        classify(pid).then(kind => {
            if (!kinds.has(pid))
                return;
            kinds.set(pid, kind);
            learnt?.();
        });
        return null;
    }
    const kind = kinds.get(pid);
    const metrics = kind ? BUTTONS[kind] : null;
    if (!metrics || (STYLED.has(kind) && !styled))
        return null;
    const frame = win.get_frame_rect();
    // Stage pixels: logical ones where monitors are laid out logically.
    const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
    return {x: frame.x + frame.width - (metrics.right + metrics.width) * s, y: frame.y + metrics.top * s,
        width: metrics.width * s, height: metrics.height * s};
}

/** Forget what was learnt of processes, as the extension stops. */
export function forget() {
    kinds.clear();
}
