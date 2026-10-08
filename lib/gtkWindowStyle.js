/* gtkWindowStyle.js — Windows 11's title bar buttons and corners for GTK
 * apps, which draw their own title bars.
 *
 * GTK reads ~/.config/gtk-3.0/gtk.css and ~/.config/gtk-4.0/gtk.css after
 * its theme and libadwaita, so a block there restyles every GTK app: the
 * window buttons become Windows' caption buttons — 46px wide, square,
 * flush with the window's top right, a faint grey under the pointer and
 * #C42B1C red under it on Close (Fluent's values; hover could not be
 * measured), with Windows' thin glyphs (assets/caption) — and windows get
 * 8px corners. GNOME's button layout gains Minimise and Maximise, as
 * Windows always shows them.
 *
 * Only on request (gtk-window-style), as it changes files outside the
 * extension: a marked block in each file, with anything else there left
 * alone, and the glyphs in a folder of their own beside it. Turning it off
 * — or turning the extension off — takes the block and the folder away and
 * gives GNOME's button layout back. The lock screen also turns extensions
 * off; that is not a reason to rewrite the user's files, so then nothing is
 * touched. Apps already open pick it up when they next start.
 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BEGIN = '/* win11-taskbar: Windows 11 title bars — begin; turned off in its settings */';
const END = '/* win11-taskbar: Windows 11 title bars — end */';
const FOLDER = 'win11-taskbar';
const GLYPHS = ['minimize', 'maximize', 'restore', 'close'];
/** What Windows shows on every window: Minimise, Maximise, Close. */
export const WINDOWS_LAYOUT = 'appmenu:minimize,maximize,close';

const glyph = name => `-gtk-recolor(url("${FOLDER}/${name}-symbolic.svg"))`;

/* Mica (windowMica.js): the shell puts the blurred wallpaper below the
 * window at the luminosity of Windows' tint; the window lays its own colour
 * over it at the tint's strength — half in the light style, 0.8 in the
 * dark, light or dark as the app itself is — and solid while it is not the
 * active window, as Windows shows it. The title bar lets that through.
 * theme_bg_color is the window's colour in GTK 3's themes, GTK 4's own and
 * libadwaita alike. */
const MICA4 = `
window.background.csd {
    background-color: alpha(@theme_bg_color, 0.5);
}
@media (prefers-color-scheme: dark) {
    window.background.csd {
        background-color: alpha(@theme_bg_color, 0.8);
    }
}
window.background.csd:backdrop {
    background-color: @theme_bg_color;
}
window.background.csd > .titlebar, window.background.csd headerbar,
window.background.csd .top-bar, window.background.csd .top-bar headerbar {
    background-color: transparent;
    background-image: none;
    box-shadow: none;
}
`;

/* GTK 3 has no media queries to tell a dark theme by: the light strength. */
const MICA3 = `
window.background.csd {
    background-color: alpha(@theme_bg_color, 0.5);
}
window.background.csd:backdrop {
    background-color: @theme_bg_color;
}
window.background.csd > .titlebar, window.background.csd > headerbar.titlebar,
window.background.csd .titlebar headerbar {
    background-color: transparent;
    background-image: none;
    box-shadow: none;
}
`;

/* GTK 4 and libadwaita: the buttons are windowcontrols' children. */
const GTK4 = `${BEGIN}
window.csd, window.csd > .titlebar, window.csd > headerbar {
    border-top-left-radius: 8px;
    border-top-right-radius: 8px;
}
window.csd {
    border-bottom-left-radius: 8px;
    border-bottom-right-radius: 8px;
}
window.maximized, window.fullscreen, window.tiled, window.tiled-top, window.tiled-left,
window.tiled-right, window.tiled-bottom {
    border-radius: 0;
}
headerbar windowcontrols.end, .titlebar windowcontrols.end {
    margin-right: -6px;
}
headerbar windowcontrols.start, .titlebar windowcontrols.start {
    margin-left: -6px;
}
windowcontrols {
    border-spacing: 0;
    margin-top: -6px;
    margin-bottom: -6px;
}
windowcontrols > button {
    min-width: 46px;
    min-height: 32px;
    margin: 0;
    padding: 0;
    border-radius: 0;
    box-shadow: none;
    background: none;
    color: inherit;
}
windowcontrols > button > image {
    background: none;
    box-shadow: none;
    padding: 0;
    margin: 0;
    /* GTK fits a symbolic image's drawing into half its icon size: 20 for
       Windows' 10px glyphs, drawn in assets/caption at twice that. */
    -gtk-icon-size: 20px;
}
windowcontrols > button:hover { background-color: alpha(currentColor, 0.06); }
windowcontrols > button:active { background-color: alpha(currentColor, 0.04); }
windowcontrols > button.close:hover { background-color: #c42b1c; color: #ffffff; }
windowcontrols > button.close:active { background-color: #c83c31; color: #ffffff; }
windowcontrols.end > button:last-child { border-top-right-radius: 8px; }
window.maximized windowcontrols.end > button:last-child { border-top-right-radius: 0; }
/* 最大化时标题栏自身的 padding 也归零；Chromium 单独读取它，不能仅靠
   windowcontrols 的负 margin 抵消。普通窗口保持原有内边距。 */
window.maximized headerbar.titlebar {
    padding: 0;
}
window.maximized headerbar windowcontrols {
    margin-top: 0;
    margin-bottom: 0;
}
window.maximized headerbar windowcontrols.end { margin-right: 0; }
window.maximized headerbar windowcontrols.start { margin-left: 0; }
windowcontrols > button.minimize > image { -gtk-icon-source: ${glyph('minimize')}; }
windowcontrols > button.maximize > image { -gtk-icon-source: ${glyph('maximize')}; }
window.maximized windowcontrols > button.maximize > image { -gtk-icon-source: ${glyph('restore')}; }
windowcontrols > button.close > image { -gtk-icon-source: ${glyph('close')}; }
${END}
`;

/* GTK 3: the buttons are the header bar's title buttons. */
const GTK3 = `${BEGIN}
.csd decoration, decoration {
    border-radius: 8px 8px 0 0;
}
.maximized decoration, .tiled decoration, .fullscreen decoration {
    border-radius: 0;
}
headerbar.titlebar, .titlebar:not(headerbar) {
    border-radius: 8px 8px 0 0;
}
.maximized headerbar.titlebar, .tiled headerbar.titlebar {
    border-radius: 0;
}
headerbar.titlebar, .titlebar headerbar {
    padding-top: 0;
    padding-bottom: 0;
    padding-right: 0;
}
headerbar button.titlebutton, .titlebar button.titlebutton {
    min-width: 46px;
    min-height: 46px;
    margin: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
    background: none;
    -gtk-icon-shadow: none;
    color: inherit;
}
/* GTK 3 keeps its header bar's spacing, 6px, between the title buttons,
   where Windows has none (measured in the testbed: Maximise ended 52px
   from the right instead of 46): each but the last reaches over the gap. */
headerbar button.titlebutton:not(:last-child), .titlebar button.titlebutton:not(:last-child) {
    margin-right: -6px;
}
headerbar button.titlebutton > image {
    /* GTK 3 fits the glyph into half of a 16px image and has no icon size
       to set; scaled up to Windows' 10px. */
    -gtk-icon-transform: scale(1.25);
}
headerbar button.titlebutton:hover { background-color: alpha(currentColor, 0.06); }
headerbar button.titlebutton:active { background-color: alpha(currentColor, 0.04); }
headerbar button.titlebutton.close:hover { background-color: #c42b1c; color: #ffffff; }
headerbar button.titlebutton.close:active { background-color: #c83c31; color: #ffffff; }
headerbar button.titlebutton.close { border-top-right-radius: 8px; }
.maximized headerbar button.titlebutton.close { border-top-right-radius: 0; }
headerbar button.titlebutton.minimize > image { -gtk-icon-source: ${glyph('minimize')}; }
headerbar button.titlebutton.maximize > image { -gtk-icon-source: ${glyph('maximize')}; }
.maximized headerbar button.titlebutton.maximize > image { -gtk-icon-source: ${glyph('restore')}; }
headerbar button.titlebutton.close > image { -gtk-icon-source: ${glyph('close')}; }
${END}
`;

function readText(file) {
    try {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
}

function ensureFolder(folder) {
    try {
        folder.make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
}

function writeText(file, text) {
    ensureFolder(file.get_parent());
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/* The text without our block in it — as it was before, whatever else the
 * user keeps there. */
function withoutBlock(text) {
    const start = text.indexOf(BEGIN);
    const end = text.indexOf(END);
    if (start < 0 || end < start)
        return text;
    const before = text.slice(0, start).replace(/\n+$/, '');
    const after = text.slice(end + END.length).replace(/^\n+/, '');
    return [before, after].filter(Boolean).join('\n') + (before || after ? '\n' : '');
}

export class GtkWindowStyle {
    /**
     * @param {Gio.Settings} settings the extension's settings
     * @param {string} extensionPath where the glyphs are
     */
    constructor(settings, extensionPath) {
        this._settings = settings;
        this._path = extensionPath;
        this._wm = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._changedIds = ['gtk-window-style', 'gtk-mica'].map(key =>
            settings.connect(`changed::${key}`, () => this.sync()));
        this.sync();
    }

    _files() {
        const config = GLib.get_user_config_dir();
        const mica = this._settings.get_boolean('gtk-mica');
        // The Mica rules go just inside the end of the block.
        const withMica = (css, extra) => mica ? css.replace(END, `${extra.trim()}\n${END}`) : css;
        return [['gtk-3.0', withMica(GTK3, MICA3)], ['gtk-4.0', withMica(GTK4, MICA4)]].map(([dir, css]) =>
            ({dir: Gio.File.new_for_path(GLib.build_filenamev([config, dir])), css}));
    }

    sync() {
        if (this._settings.get_boolean('gtk-window-style'))
            this._apply();
        else
            this._remove();
    }

    /* Idempotent: what is already there as it should be is not rewritten. */
    _apply() {
        for (const {dir, css} of this._files()) {
            const file = dir.get_child('gtk.css');
            const current = readText(file) ?? '';
            const base = withoutBlock(current);
            const wanted = base ? `${base.replace(/\n*$/, '\n')}\n${css}` : css;
            if (current !== wanted)
                writeText(file, wanted);
            const folder = dir.get_child(FOLDER);
            for (const name of GLYPHS) {
                const source = Gio.File.new_for_path(GLib.build_filenamev(
                    [this._path, 'assets', 'caption', `${name}-symbolic.svg`]));
                const target = folder.get_child(`${name}-symbolic.svg`);
                if (readText(target) !== readText(source)) {
                    ensureFolder(folder);
                    source.copy(target, Gio.FileCopyFlags.OVERWRITE, null, null);
                }
            }
        }
        const layout = this._wm.get_string('button-layout');
        if (layout !== WINDOWS_LAYOUT) {
            this._settings.set_string('gtk-window-style-layout', layout);
            this._wm.set_string('button-layout', WINDOWS_LAYOUT);
        }
    }

    _remove() {
        for (const {dir} of this._files()) {
            const file = dir.get_child('gtk.css');
            const current = readText(file);
            if (current !== null && current.includes(BEGIN)) {
                const rest = withoutBlock(current);
                if (rest.trim())
                    writeText(file, rest);
                else
                    file.delete(null);
            }
            const folder = dir.get_child(FOLDER);
            for (const name of GLYPHS) {
                try {
                    folder.get_child(`${name}-symbolic.svg`).delete(null);
                } catch {}
            }
            try {
                folder.delete(null);
            } catch {}
        }
        // Only the layout we set goes back; one the user has changed since
        // stays theirs.
        const saved = this._settings.get_string('gtk-window-style-layout');
        if (saved && this._wm.get_string('button-layout') === WINDOWS_LAYOUT)
            this._wm.set_string('button-layout', saved);
        if (saved)
            this._settings.set_string('gtk-window-style-layout', '');
    }

    destroy() {
        for (const id of this._changedIds)
            this._settings.disconnect(id);
        // The extension turned off in a session: its changes go with it.
        // Locking the screen turns it off too, and that leaves them.
        if (!Main.sessionMode.isLocked && Main.sessionMode.currentMode !== 'unlock-dialog' &&
            this._settings.get_boolean('gtk-window-style'))
            this._remove();
        this._wm = null;
    }
}
