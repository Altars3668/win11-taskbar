/* windowMica.js — Windows 11's Mica below GTK windows.
 *
 * Mica is the desktop wallpaper, blurred far past recognition, under a
 * window's own background: what makes a Windows 11 title bar faintly take
 * on the wallpaper's tone. Windows (WinUI's MicaController) gives the
 * blurred wallpaper the luminosity of the theme's tint — #F3F3F3 in the
 * light style, #202020 in the dark — keeping only its hue and saturation,
 * so a window is as light or as dark as its theme on any wallpaper; then it
 * lays the tint over that, at 0.5 in the light style and 0.8 in the dark.
 *
 * The first half is the shell's. The wallpaper is blurred once per monitor,
 * in an actor never shown itself; below each GTK window goes a frame-sized
 * piece of that blur — a clone lined up with the screen — which a shader
 * brings to the tint's luminosity and rounds at the corners as the window
 * is. The second half is the app's own: gtkWindowStyle.js has GTK lay the
 * window's own colour over it at Windows' strength, light or dark as that
 * app is, and solid while the window is not the active one, as Windows
 * shows it then. The shell goes by the desktop's colour scheme, which the
 * apps follow; an app that keeps a scheme of its own still reads, its own
 * colour over the rest.
 *
 * That style sheet reaches every window GTK 3 or 4 draws, so every one of
 * them needs Mica below it, or it would be clear right through: not only
 * an app's main windows, which carry its application id, but its dialogs
 * too, and the windows of apps that are no GtkApplication, Firefox among
 * them. Those have nothing on them to tell; the libraries their process
 * has loaded do.
 */
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** How far the wallpaper is blurred: past recognition, as Mica's is. */
const BLUR_RADIUS = 120;
const RADIUS = 8;
/** The tint's luminosity, which the wallpaper takes: #F3F3F3, #202020. */
const LUMINOSITY = {light: 0xf3 / 255, dark: 0x20 / 255};
const MIRRORED = ['visible', 'opacity', 'scale-x', 'scale-y', 'translation-x', 'translation-y'];
/** The windows with a background of their own: dialogs as well. */
const TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY];

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

const DECLARATIONS = `
uniform vec2 size;
uniform vec2 pad;
uniform vec2 extent;
uniform float radius;
uniform float luminosity;
float lum(vec3 c) {
    return dot(c, vec3(0.3, 0.59, 0.11));
}
vec3 withLuminosity(vec3 c, float l) {
    c += l - lum(c);
    float n = min(min(c.r, c.g), c.b);
    float x = max(max(c.r, c.g), c.b);
    if (n < 0.0)
        c = l + (c - l) * l / max(l - n, 0.0001);
    if (x > 1.0)
        c = l + (c - l) * (1.0 - l) / max(x - l, 0.0001);
    return c;
}
`;

// The luminosity blend of the compositing specifications (the colour given
// the luminosity, its hue kept and its saturation as far as fits), inside
// the corners. In the texture's own pixels.
const CODE = `
vec2 p = cogl_tex_coord_in[0].xy * size - pad;
vec2 half_size = extent * 0.5;
vec2 q = abs(p - half_size) - (half_size - vec2(radius));
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
float inside = clamp(0.5 - d, 0.0, 1.0);
float a = cogl_color_out.a;
vec3 rgb = a > 0.0 ? cogl_color_out.rgb / a : vec3(0.0);
cogl_color_out = vec4(withLuminosity(rgb, luminosity), 1.0) * a * inside;
`;

const MicaEffect = GObject.registerClass({GTypeName: 'W11MicaEffect'},
class MicaEffect extends Shell.GLSLEffect {
    _init() {
        super._init();
        this._size = this.get_uniform_location('size');
        this._pad = this.get_uniform_location('pad');
        this._extent = this.get_uniform_location('extent');
        this._radius = this.get_uniform_location('radius');
        this._luminosity = this.get_uniform_location('luminosity');
        this._cornerRadius = 0;
        this.set(0, LUMINOSITY.light);
    }

    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, CODE, false);
    }

    /**
     * How to draw the wallpaper.
     *
     * @param {number} radius the corners', in the actor's pixels
     * @param {number} luminosity what the wallpaper is brought to, 0 to 1
     */
    set(radius, luminosity) {
        this._cornerRadius = radius;
        this.set_uniform_float(this._luminosity, 1, [luminosity]);
        this.queue_repaint();
    }

    /* The actor in the texture's own pixels, as FrameEffect has it
     * (windowFrames.js): at its size and place right now, scaled or not. */
    vfunc_paint_target(node, paintContext) {
        const actor = this.get_actor();
        const texture = this.get_texture();
        if (actor && texture && actor.width > 0 && actor.height > 0) {
            const scale = actor.get_resource_scale();
            const [x, y] = actor.get_transformed_position();
            const [w, h] = actor.get_transformed_size();
            const left = Math.ceil(x + w + 0.75) - Math.round(w) - 3;
            const top = Math.ceil(y + h + 0.75) - Math.round(h) - 3;
            const shrink = Math.min(w / actor.width, h / actor.height);
            this.set_uniform_float(this._size, 2, [texture.get_width(), texture.get_height()]);
            this.set_uniform_float(this._pad, 2, [(x - left) * scale, (y - top) * scale]);
            this.set_uniform_float(this._extent, 2, [w * scale, h * scale]);
            this.set_uniform_float(this._radius, 1, [this._cornerRadius * shrink * scale]);
        }
        super.vfunc_paint_target(node, paintContext);
    }
});

/* Whether a process draws with GTK 3 or 4: whether it has loaded the
 * library. Read without holding up the shell. */
function loadsGtk(pid) {
    return new Promise(resolve => {
        const file = Gio.File.new_for_path(`/proc/${pid}/maps`);
        file.load_contents_async(null, (_file, result) => {
            try {
                const [, bytes] = file.load_contents_finish(result);
                resolve(/\/libgtk-[34]\.so/.test(new TextDecoder().decode(bytes)));
            } catch {
                resolve(false);
            }
        });
    });
}

let current = null;

/**
 * The windows with Mica behind them, for the tests.
 *
 * @returns {object[]|null} one record per window, or null while it is off
 */
export function micaWindows() {
    return current?.describe() ?? null;
}

/**
 * A clone of a window as the screen shows it: with its Mica below it, when
 * it has one. A clone of the window actor alone leaves clear what GTK
 * leaves clear for Mica.
 *
 * @param {Meta.WindowActor} actor the window's
 * @param {number} width the clone's
 * @param {number} height the clone's
 * @returns {Clutter.Actor} the clone
 */
export function windowClone(actor, width, height) {
    const clone = new Clutter.Clone({source: actor, width, height});
    const record = current?._records.get(actor);
    if (!record?.mica || actor.width <= 0 || actor.height <= 0)
        return clone;
    const [sx, sy] = [width / actor.width, height / actor.height];
    const [ox, oy] = record.offsets ?? [0, 0];
    const both = new Clutter.Actor({width, height});
    both.add_child(new Clutter.Clone({source: record.mica, x: ox * sx, y: oy * sy,
        width: record.mica.width * sx, height: record.mica.height * sy}));
    both.add_child(clone);
    both._w11WindowClone = clone;
    return both;
}

export class WindowMica {
    constructor() {
        current = this;
        this._sources = new Map(); // monitor index -> {actor, manager}: the blurred wallpaper
        this._records = new Map(); // actor -> record
        this._gtkProcesses = new Map(); // pid -> Promise<boolean>: whether it draws with GTK
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._schemeId = this._interface.connect('changed::color-scheme', () => {
            for (const record of this._records.values())
                this._sync(record);
        });
        this._addedId = global.window_group.connect('child-added',
            (_group, actor) => this._track(actor));
        this._restackId = global.display.connect('restacked', () => this._restack());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._rebuild());
        // Last, with everything they need in place: the windows already open.
        for (const actor of global.get_window_actors())
            this._track(actor);
    }

    /* The wallpaper of a monitor, blurred, at the monitor's size. A copy
     * of our own, from GNOME's BackgroundManager, which also follows the
     * wallpaper setting: the desktop's own sits in the window group, where
     * mutter paints only what no window covers — its clones too — so a
     * clone of it is empty just where Mica is wanted, behind a window. It is
     * drawn only through its clones, which do not mind where their source
     * is: it sits far off the screen, never seen itself. */
    _source(monitorIndex) {
        const known = this._sources.get(monitorIndex);
        if (known)
            return known.actor;
        const monitor = Main.layoutManager.monitors[monitorIndex];
        if (!monitor)
            return null;
        const actor = new Clutter.Actor({reactive: false, x: -monitor.width * 4, y: -monitor.height * 4,
            width: monitor.width, height: monitor.height});
        Main.layoutManager.uiGroup.add_child(actor);
        const manager = new Background.BackgroundManager({container: actor, monitorIndex,
            controlPosition: false, vignette: false});
        actor.add_effect_with_name('w11-mica-blur', new Shell.BlurEffect({
            radius: BLUR_RADIUS * scaleFactor(), brightness: 1, mode: Shell.BlurMode.ACTOR}));
        this._sources.set(monitorIndex, {actor, manager});
        return actor;
    }

    _dropSources() {
        for (const {actor, manager} of this._sources.values()) {
            manager.destroy();
            actor.destroy();
        }
        this._sources.clear();
    }

    _track(actor) {
        const win = actor.meta_window;
        if (!win || this._records.has(actor))
            return;
        // An application id is GTK's own; without one, the process says.
        const record = {actor, win, pid: win.get_pid(), gtk: Boolean(win.get_gtk_application_id?.()),
            mica: null, ids: [], bindings: null};
        this._records.set(actor, record);
        const sync = () => this._sync(record);
        for (const signal of ['size-changed', 'position-changed', 'notify::maximized-horizontally',
            'notify::maximized-vertically', 'notify::fullscreen', 'notify::window-type', 'workspace-changed'])
            record.ids.push([win, win.connect(signal, sync)]);
        for (const signal of ['first-frame', 'notify::allocation'])
            record.ids.push([actor, actor.connect(signal, sync)]);
        record.ids.push([actor, actor.connect('destroy', () => this._untrack(record))]);
        if (!record.gtk && record.pid > 0)
            this._askProcess(record);
        sync();
    }

    _askProcess(record) {
        let answer = this._gtkProcesses.get(record.pid);
        if (!answer) {
            answer = loadsGtk(record.pid);
            this._gtkProcesses.set(record.pid, answer);
        }
        answer.then(gtk => {
            if (!gtk || this._records.get(record.actor) !== record)
                return;
            record.gtk = true;
            this._sync(record);
        });
    }

    /* What the style sheet reaches: a window GTK draws, with its own title
     * bar — mutter's title bar round an X11 window keeps GTK's off it. */
    _wanted({win, gtk}) {
        return gtk && TYPES.includes(win.get_window_type()) && !win.is_fullscreen() &&
            !(win.get_client_type() === Meta.WindowClientType.X11 && win.decorated);
    }

    _sync(record) {
        if (!this._wanted(record)) {
            this._drop(record);
            return;
        }
        const {actor, win} = record;
        const frame = win.get_frame_rect();
        const monitorIndex = win.get_monitor();
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const source = monitor && this._source(monitorIndex);
        if (!source || frame.width <= 0 || frame.height <= 0)
            return;
        if (!record.mica || record.monitor !== monitorIndex)
            this._build(record, source, monitorIndex);
        const {mica, clone} = record;
        // Following the window wherever it goes — out of the taskbar as it
        // opens too — over its frame, inside the shadow GTK draws round it.
        const buffer = win.get_buffer_rect();
        record.offsets = [frame.x - buffer.x, frame.y - buffer.y];
        record.followX.offset = record.offsets[0];
        record.followY.offset = record.offsets[1];
        mica.set_size(frame.width, frame.height);
        clone.set_position(monitor.x - frame.x, monitor.y - frame.y);
        this._syncPivot(record);
        // Light or dark as the desktop is, which the apps follow.
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        record.luminosity = dark ? LUMINOSITY.dark : LUMINOSITY.light;
        const square = win.get_maximize_flags() !== 0;
        record.effect.set(square ? 0 : RADIUS * scaleFactor(), record.luminosity);
    }

    _build(record, source, monitorIndex) {
        this._drop(record);
        const {actor} = record;
        const monitor = Main.layoutManager.monitors[monitorIndex];
        const mica = new Clutter.Actor({reactive: false, clip_to_allocation: true});
        const clone = new Clutter.Clone({source, width: monitor.width, height: monitor.height});
        mica.add_child(clone);
        const effect = new MicaEffect();
        mica.add_effect_with_name('w11-mica', effect);
        const followX = new Clutter.BindConstraint({source: actor, coordinate: Clutter.BindCoordinate.X});
        const followY = new Clutter.BindConstraint({source: actor, coordinate: Clutter.BindCoordinate.Y});
        mica.add_constraint(followX);
        mica.add_constraint(followY);
        global.window_group.insert_child_below(mica, actor);
        record.bindings = MIRRORED.map(property =>
            actor.bind_property(property, mica, property, GObject.BindingFlags.SYNC_CREATE));
        record.pivotId = actor.connect('notify::pivot-point', () => this._syncPivot(record));
        Object.assign(record, {mica, clone, effect, followX, followY, monitor: monitorIndex});
    }

    /* Scaling about the same point of the screen as the window. */
    _syncPivot(record) {
        const {actor, mica} = record;
        if (!mica || mica.width <= 0 || mica.height <= 0)
            return;
        const [px, py] = actor.get_pivot_point();
        const [ox, oy] = record.offsets ?? [0, 0];
        mica.set_pivot_point((px * actor.width - ox) / mica.width, (py * actor.height - oy) / mica.height);
    }

    _drop(record) {
        if (record.pivotId)
            record.actor.disconnect(record.pivotId);
        record.pivotId = 0;
        for (const binding of record.bindings ?? [])
            binding.unbind();
        record.bindings = null;
        record.mica?.destroy();
        Object.assign(record, {mica: null, clone: null, effect: null,
            followX: null, followY: null, monitor: -1});
    }

    _untrack(record) {
        for (const [object, id] of record.ids)
            object.disconnect(id);
        record.ids = [];
        this._drop(record);
        this._records.delete(record.actor);
        // A process gone, its number may come round again for another.
        if (![...this._records.values()].some(other => other.pid === record.pid))
            this._gtkProcesses.delete(record.pid);
    }

    _restack() {
        for (const {actor, mica} of this._records.values()) {
            if (mica && mica.get_parent() === actor.get_parent())
                actor.get_parent().set_child_below_sibling(mica, actor);
        }
    }

    /* New monitors, new wallpapers: everything is built again. */
    _rebuild() {
        for (const record of this._records.values())
            this._drop(record);
        this._dropSources();
        for (const record of this._records.values())
            this._sync(record);
    }

    describe() {
        return [...this._records.values()].map(({win, gtk, mica, luminosity}) => ({
            title: win.get_title(),
            gtk,
            mica: mica ? {x: Math.round(mica.x), y: Math.round(mica.y), w: Math.round(mica.width),
                h: Math.round(mica.height), visible: mica.visible,
                dark: luminosity === LUMINOSITY.dark} : null,
        }));
    }

    destroy() {
        global.window_group.disconnect(this._addedId);
        global.display.disconnect(this._restackId);
        this._interface.disconnect(this._schemeId);
        this._interface = null;
        Main.layoutManager.disconnect(this._monitorsId);
        for (const record of [...this._records.values()])
            this._untrack(record);
        this._dropSources();
        if (current === this)
            current = null;
    }
}
