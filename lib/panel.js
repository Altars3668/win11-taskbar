/* panel.js — the taskbar surface itself.
 *
 * Windows 11 lays the bar out in three independent zones: a left zone pinned
 * to the screen edge, a centre zone centred on the *screen* midpoint (not on
 * the space left between the other two), and a right zone pinned to the other
 * edge. We measured this: on a 1920px screen the widgets button sat at x=6,
 * the app strip spanned 606..1315 (midpoint 960.5 = screen centre) and the
 * tray started at 1592. A BinLayout with three differently-aligned children
 * reproduces exactly that.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AutoHide} from './autoHide.js';
import {LAYOUT, PANEL} from './spec.js';
import {Clock, ShowDesktopButton, StartButton, TaskViewButton} from './shellButtons.js';
import {StartMenu} from './startMenu.js';
import {SuperKeyHandler} from './superKey.js';
import {SystemIndicators} from './systemIndicators.js';
import {TaskList} from './taskList.js';
import {TrayArea} from './trayArea.js';
import {WindowPreview} from './windowPreview.js';

export const Taskbar = GObject.registerClass(
class Taskbar extends St.Widget {
    _init(monitorIndex, settings, statusHost) {
        super._init({
            name: 'w11Taskbar',
            style_class: 'w11-taskbar',
            reactive: true,
            track_hover: true,
        });

        this._monitorIndex = monitorIndex;
        this._settings = settings;
        this._statusHost = statusHost;
        this._settingsIds = [];

        this._buildZones();

        this._addToChrome();

        this._applyAcrylic();
        this._watchColorScheme();

        this.preview = new WindowPreview(this);

        this._taskList = new TaskList(this);
        this._centerZone.add_child(this._taskList);

        // Only borrow the shell's own indicators once, onto the primary bar.
        if (this._settings.get_boolean('show-system-indicators') &&
            monitorIndex === Main.layoutManager.primaryIndex)
            this._systemIndicators = new SystemIndicators(this._systemBox);

        if (this._settings.get_boolean('start-menu')) {
            this.startMenu = new StartMenu(this);
            this._startButton.connect('clicked', () => this.startMenu.toggle());
            if (monitorIndex === Main.layoutManager.primaryIndex &&
                this._settings.get_boolean('super-opens-start')) {
                this._superKey = new SuperKeyHandler(
                    () => this.startMenu.toggle());
            }
        } else {
            // Without our menu, fall back to GNOME's app grid.
            this._startButton.connect('clicked', () => {
                if (Main.overview.visible)
                    Main.overview.hide();
                else
                    Main.overview.show(2); // ControlsState.APP_GRID
            });
        }

        this._autoHide = new AutoHide(this);
        this._autoHide.setEnabled(this._settings.get_boolean('auto-hide'));

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this.relayout());
        this._scaleId = St.ThemeContext.get_for_stage(global.stage).connect(
            'notify::scale-factor', () => this._onScaleChanged());

        for (const key of ['position', 'alignment', 'auto-hide', 'show-start-button',
            'show-task-view-button', 'show-clock', 'show-desktop-button', 'acrylic',
            'show-tray', 'hide-overview-dash']) {
            this._settingsIds.push(
                this._settings.connect(`changed::${key}`, () => this._onSettingsChanged()));
        }

        this.connect('destroy', () => this._onDestroy());

        this._applyVisibility();
        if (monitorIndex === Main.layoutManager.primaryIndex)
            this._syncOverviewDash();
        this.relayout();
    }

    /** The Overview's dash duplicates what the taskbar already shows, so
     *  hide it while we are the taskbar. Restored on disable. */
    _syncOverviewDash() {
        const dash = Main.overview.dash;
        if (!dash)
            return;
        const hide = this._settings.get_boolean('hide-overview-dash');
        if (hide && this._dashHidden !== true) {
            this._dashWasVisible = dash.visible;
            dash.hide();
            this._dashHidden = true;
        } else if (!hide && this._dashHidden) {
            if (this._dashWasVisible)
                dash.show();
            this._dashHidden = false;
        }
    }

    _restoreOverviewDash() {
        if (!this._dashHidden)
            return;
        const dash = Main.overview.dash;
        if (dash && this._dashWasVisible)
            dash.show();
        this._dashHidden = false;
    }

    /* -------------------------------------------------------------- chrome */

    /** Register with the layout manager. Only trackFullscreen and
     *  affectsStruts are accepted here; the input region follows the actor
     *  automatically. */
    _addToChrome() {
        Main.layoutManager.addChrome(this, {
            affectsStruts: !this._settings.get_boolean('auto-hide'),
            trackFullscreen: true,
        });
        this._inChrome = true;
    }

    _removeFromChrome() {
        if (!this._inChrome)
            return;
        Main.layoutManager.removeChrome(this);
        this._inChrome = false;
    }

    /* -------------------------------------------------------------- theme */

    /** The acrylic surface. Windows blurs whatever is behind the bar — our
     *  sampling of one screen row ranged from rgb(232,222,215) to
     *  rgb(245,244,248), i.e. the wallpaper showed through. St cannot do
     *  backdrop-filter, so we attach the compositor's own blur effect and let
     *  the stylesheet supply the tint on top. */
    _applyAcrylic() {
        if (!this._settings.get_boolean('acrylic')) {
            this.remove_effect_by_name('w11-acrylic');
            return;
        }
        if (this.get_effect('w11-acrylic'))
            return;

        const blur = new Shell.BlurEffect({
            radius: 60,
            brightness: 1.0,
            mode: Shell.BlurMode.BACKGROUND,
        });
        this.add_effect_with_name('w11-acrylic', blur);
    }

    /** Follow the desktop's light/dark preference, as the taskbar does. */
    _watchColorScheme() {
        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._colorSchemeId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._applyColorScheme());
        this._applyColorScheme();
    }

    _applyColorScheme() {
        const dark = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const toggle = (actor, on) => {
            if (on)
                actor.add_style_class_name('dark');
            else
                actor.remove_style_class_name('dark');
        };
        toggle(this, dark);
        if (this.preview)
            toggle(this.preview, dark);
    }

    /* --------------------------------------------------------------- state */

    get settings() {
        return this._settings;
    }

    /** The shared StatusNotifierItem host, or null if another extension
     *  already owns the watcher name. */
    get statusHost() {
        return this._statusHost;
    }

    /** Keep the bar out while a flyout or jump list is on screen. */
    holdVisible(held) {
        this._autoHide?.hold(held);
    }

    get monitorIndex() {
        return this._monitorIndex;
    }

    get isBottom() {
        return this._settings.get_string('position') !== 'top';
    }

    /** How every module should filter an app's windows for *this* taskbar. */
    get windowFilter() {
        return {
            isolateWorkspaces: this._settings.get_boolean('isolate-workspaces'),
            monitorIndex: this._settings.get_boolean('isolate-monitors')
                ? this._monitorIndex : -1,
        };
    }

    /* -------------------------------------------------------------- layout */

    _buildZones() {
        this._leftZone = new St.BoxLayout({style_class: 'w11-zone w11-zone-left'});
        this._centerZone = new St.BoxLayout({style_class: 'w11-zone w11-zone-center'});
        this._rightZone = new St.BoxLayout({style_class: 'w11-zone w11-zone-right'});

        this.add_child(this._leftZone);
        this.add_child(this._centerZone);
        this.add_child(this._rightZone);

        // Measured: a 1px line along the inner edge. It is drawn *over* the
        // 48px band rather than shrinking it — on Windows the buttons are a
        // full 48px tall and the line sits on top of them.
        this._separator = new St.Widget({style_class: 'w11-separator'});
        this.add_child(this._separator);

        this._startButton = new StartButton();
        this._taskViewButton = new TaskViewButton();
        this._centerZone.add_child(this._startButton);
        this._centerZone.add_child(this._taskViewButton);

        // Right to left on Windows: show-desktop, clock, system glyphs,
        // app tray icons, overflow chevron.
        this._trayArea = new TrayArea(this);
        this._rightZone.add_child(this._trayArea);

        this._systemBox = new St.BoxLayout({
            style_class: 'w11-system-area',
            y_expand: true,
        });
        this._rightZone.add_child(this._systemBox);

        this._clock = new Clock(this._settings);
        this._showDesktop = new ShowDesktopButton();
        this._rightZone.add_child(this._clock);
        this._rightZone.add_child(this._showDesktop);
    }

    /**
     * Three independent zones. The centre zone is centred on the *screen*,
     * not in the space left over between the other two — that is what we
     * measured on Windows, where the app strip's midpoint landed on the
     * screen midpoint (960.5 on a 1920px screen) while the widgets button
     * stayed at x=6 and the tray started at x=1592.
     *
     * Clutter's BinLayout ignores a child BoxLayout's x_align here, so the
     * placement is done by hand. When the centre zone would collide with a
     * side zone we push it aside rather than let them overlap, which is also
     * what Windows does.
     *
     * @param {Clutter.ActorBox} box the area to allocate within
     */
    vfunc_allocate(box) {
        this.set_allocation(box);

        const width = box.get_width();
        const height = box.get_height();
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const edge = LAYOUT.edgePadding * s;

        const place = (actor, x, w) => {
            const child = new Clutter.ActorBox();
            child.set_origin(Math.round(x), 0);
            child.set_size(Math.round(w), height);
            actor.allocate(child);
        };

        const [, leftW] = this._leftZone.get_preferred_width(height);
        const [, centerW] = this._centerZone.get_preferred_width(height);
        const [, rightW] = this._rightZone.get_preferred_width(height);

        place(this._leftZone, edge, leftW);
        place(this._rightZone, width - rightW, rightW);

        let centerX;
        if (this._settings.get_string('alignment') === 'left') {
            centerX = edge + leftW;
        } else {
            centerX = (width - centerW) / 2;
            // Never let the strip run under the side zones.
            centerX = Math.max(centerX, edge + leftW);
            centerX = Math.min(centerX, width - rightW - centerW);
        }
        place(this._centerZone, centerX, centerW);

        const line = new Clutter.ActorBox();
        const lineH = PANEL.borderWidth * s;
        line.set_origin(0, this.isBottom ? 0 : height - lineH);
        line.set_size(width, lineH);
        this._separator.allocate(line);
    }

    /** Alignment is handled in vfunc_allocate; this just asks for a redo. */
    _applyAlignment() {
        this.queue_relayout();
    }

    _applyVisibility() {
        this._startButton.visible = this._settings.get_boolean('show-start-button');
        this._taskViewButton.visible = this._settings.get_boolean('show-task-view-button');
        this._clock.visible = this._settings.get_boolean('show-clock');
        this._showDesktop.visible = this._settings.get_boolean('show-desktop-button');
        this._trayArea.visible = this._settings.get_boolean('show-tray');
    }

    /** Place the bar on its monitor and reserve the strut. */
    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!monitor) {
            this.hide();
            return;
        }
        this.show();

        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const height = PANEL.height * s;

        this.set_size(monitor.width, height);
        this.set_x(monitor.x);
        // When auto-hide owns the vertical position, let it decide; otherwise
        // park the bar against its edge.
        if (this._autoHide && this._settings.get_boolean('auto-hide'))
            this._autoHide.relayout();
        else
            this.set_y(this.isBottom ? monitor.y + monitor.height - height : monitor.y);

        this.remove_style_class_name('w11-taskbar-top');
        this.remove_style_class_name('w11-taskbar-bottom');
        this.add_style_class_name(this.isBottom
            ? 'w11-taskbar-bottom' : 'w11-taskbar-top');

        this._applyAlignment();
    }

    _onScaleChanged() {
        this._startButton.updateMetrics();
        this._taskViewButton.updateMetrics();
        this._clock.updateMetrics();
        this._showDesktop.updateMetrics();
        this._taskList.updateMetrics();
        this._trayArea.updateMetrics();
        this.relayout();
    }

    _onSettingsChanged() {
        this._applyVisibility();
        this._applyAcrylic();
        this._syncOverviewDash();
        // Toggling auto-hide changes whether we reserve space, and the
        // layout manager only reads that when the actor is registered.
        // trackChrome() is for descendants of existing chrome, not for
        // re-registering the chrome actor itself, so re-add instead.
        this._removeFromChrome();
        this._addToChrome();
        this._autoHide.setEnabled(this._settings.get_boolean('auto-hide'));
        this.relayout();
        this._taskList.queueSync();
    }

    _onDestroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }
        if (this._scaleId) {
            St.ThemeContext.get_for_stage(global.stage).disconnect(this._scaleId);
            this._scaleId = 0;
        }
        if (this._colorSchemeId) {
            this._interfaceSettings.disconnect(this._colorSchemeId);
            this._colorSchemeId = 0;
        }
        this._interfaceSettings = null;

        this._autoHide?.destroy();
        this._autoHide = null;

        // Hand the shell's indicators back before anything else is torn down.
        this._systemIndicators?.destroy();
        this._systemIndicators = null;

        this._restoreOverviewDash();

        this._superKey?.destroy();
        this._superKey = null;
        this.startMenu?.destroy();
        this.startMenu = null;

        this.preview?.destroy();
        this.preview = null;

        this._removeFromChrome();
    }
});
