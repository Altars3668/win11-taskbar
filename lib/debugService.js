/* debugService.js — a D-Bus surface for verifying the taskbar against the
 * Windows measurements.
 *
 * GNOME 50 no longer exposes Eval or an unguarded screenshot, so there is no
 * way from outside to check that a button really is 44x48 or that an
 * indicator really is 18px wide. This service closes that gap: it reports the
 * live geometry of every part of the bar in the same vocabulary as
 * lib/spec.js, so a test can diff measured-on-Windows against
 * rendered-on-GNOME.
 *
 * It is off unless the debug-service setting is on. DumpGeometry only
 * reads; Trigger exists so a test can open the Start menu or the tray
 * overflow, which otherwise need pointer input the test harness cannot
 * synthesise.
 */

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

const IFACE = `
<node>
  <interface name="org.gnome.Shell.Extensions.Win11Taskbar">
    <method name="DumpGeometry">
      <arg type="s" name="json" direction="out"/>
    </method>
    <method name="Screenshot">
      <arg type="s" name="path" direction="in"/>
      <arg type="b" name="success" direction="out"/>
    </method>
    <method name="Trigger">
      <arg type="s" name="action" direction="in"/>
      <arg type="s" name="result" direction="out"/>
    </method>
  </interface>
</node>`;

export class DebugService {
    constructor(getTaskbars) {
        this._getTaskbars = getTaskbars;
        this._impl = Gio.DBusExportedObject.wrapJSObject(IFACE, this);
        this._impl.export(Gio.DBus.session,
            '/org/gnome/Shell/Extensions/Win11Taskbar');
        this._nameId = Gio.bus_own_name(Gio.BusType.SESSION,
            'org.gnome.Shell.Extensions.Win11Taskbar',
            Gio.BusNameOwnerFlags.NONE, null, null, null);
    }

    destroy() {
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        this._impl?.unexport();
        this._impl = null;
    }

    /** Geometry of every live piece, in stage coordinates. */
    DumpGeometry() {
        const describe = actor => {
            if (!actor)
                return null;
            const [x, y] = actor.get_transformed_position();
            return {
                x: Math.round(x), y: Math.round(y),
                w: Math.round(actor.allocation.get_width()),
                h: Math.round(actor.allocation.get_height()),
                visible: actor.visible,
            };
        };

        const bars = this._getTaskbars().map(bar => ({
            monitor: bar.monitorIndex,
            panel: describe(bar),
            startButton: describe(bar._startButton),
            taskViewButton: describe(bar._taskViewButton),
            clock: describe(bar._clock),
            showDesktop: describe(bar._showDesktop),
            centerZone: describe(bar._centerZone),
            buttons: [...bar._taskList._buttons.entries()].map(([id, button]) => ({
                id,
                ...describe(button),
                windows: button.windowCount,
                indicator: describe(button._indicator),
                indicatorState: button._indicatorState,
                icon: describe(button._icon),
            })),
            preview: {
                ...describe(bar.preview),
                thumbnails: bar.preview?._box?.get_children().length ?? 0,
            },
            tray: {
                ...describe(bar._trayArea),
                chevronVisible: bar._trayArea?._chevron?.visible ?? false,
                chevron: describe(bar._trayArea?._chevron),
                icons: [...(bar._trayArea?._icons ?? new Map()).entries()]
                    .map(([item, icon]) => ({
                        id: item.id,
                        status: item.status,
                        ...describe(icon),
                        glyph: describe(icon._icon),
                    })),
                overflowVisible: bar._trayArea?._overflow?.visible ?? false,
            },
            systemIndicators: describe(bar._systemBox),
            startMenu: bar.startMenu ? {
                ...describe(bar.startMenu),
                open: bar.startMenu.isOpen,
                panel: describe(bar.startMenu._panel),
                tiles: bar.startMenu._pinnedGrid?.get_n_children() ?? 0,
            } : null,
        }));

        const focus = global.display.focus_window;
        return JSON.stringify({
            scaleFactor: St.ThemeContext.get_for_stage(global.stage).scale_factor,
            monitors: global.display.get_n_monitors(),
            focus: focus ? {
                title: focus.get_title(),
                wmClass: focus.get_wm_class(),
                app: Shell.WindowTracker.get_default().get_window_app(focus)?.get_id(),
                skipTaskbar: focus.skip_taskbar,
                workspace: focus.get_workspace()?.index() ?? -1,
            } : null,
            focusApp: Shell.WindowTracker.get_default().focus_app?.get_id() ?? null,
            activeWorkspace: global.workspace_manager.get_active_workspace().index(),
            bars,
        }, null, 1);
    }

    /**
     * Open or close a piece of UI that normally needs a click.
     *
     * @param {string} action one of start-menu, start-menu-close,
     *   tray-overflow, preview-first
     * @returns {string} what happened, for the test to assert on
     */
    Trigger(action) {
        const bar = this._getTaskbars()[0];
        if (!bar)
            return 'no taskbar';

        switch (action) {
        case 'start-menu':
            bar.startMenu?.open();
            return bar.startMenu ? 'opened' : 'no start menu';
        case 'start-menu-close':
            bar.startMenu?.close();
            return 'closed';
        case 'start-menu-all-apps':
            bar.startMenu?._toggleAllApps();
            return 'toggled';
        case 'tray-overflow':
            bar._trayArea?._toggleOverflow();
            return 'toggled';
        case 'preview-first': {
            const button = [...bar._taskList._buttons.values()]
                .find(b => b.windowCount > 0);
            if (!button)
                return 'no running app';
            bar.preview.show(button, button.app);
            return `showing ${button.app.get_id()}`;
        }
        default:
            return `unknown action: ${action}`;
        }
    }

    /** Grab the screen from inside the shell, where it is permitted. */
    Screenshot(path) {
        const shooter = new Shell.Screenshot();
        const stream = Gio.File.new_for_path(path)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        const [w, h] = global.stage.get_size();

        shooter.screenshot_area(0, 0, w, h, stream, () => {});
        return true;
    }
}
