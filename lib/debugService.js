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
 * synthesise. Where only real input will do — GTK's menus react to
 * events, not to API calls — Trigger can also drive a virtual pointer.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {isDark} from './theme.js';
import {QuickMenuToggle} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

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
        this._testAction?.destroy();
        this._testAction = null;
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        this._impl?.unexport();
        this._impl = null;
        // Dropping the last reference removes the virtual devices.
        this._pointer = null;
        this._keyboard = null;
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
                hovered: button.hover,
                iconScale: button._icon.scale_x,
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
                        tooltip: describe(icon._tooltip),
                        menuOpen: icon._menu?.isOpen ?? false,
                        hoverMenu: icon._menuFromHover,
                        menuItems: icon._menu?._getMenuItems().filter(i => i.label)
                            .map(i => ({label: i.label.text, ...describe(i)})) ?? [],
                    })),
                overflowVisible: bar._trayArea?._overflow?.visible ?? false,
            },
            materials: [
                ['taskbar', bar._barSurface],
                ['start', bar.startMenu?._acrylicSurface],
                ['preview', bar.preview?._acrylicSurface],
                ['notifications', bar.notificationCentre?._acrylicSurface],
                ['overflow', bar._trayArea?._overflow?._acrylicSurface],
                ['clipboard', bar.clipboard?._acrylicSurface],
                ['quick', Main.panel.statusArea.quickSettings?.menu?._w11Material],
            ].filter(([, surface]) => surface).map(([name, surface]) => ({
                name, mapped: surface.mapped, sampling: Boolean(surface._paintId),
                clones: surface._clones.size,
                windows: [...surface._clones.keys()].filter(source => source.meta_window).length,
            })),
            systemIndicators: describe(bar._systemBox),
            shell: {
                panelBoxVisible: Main.layoutManager.panelBox.visible,
                panelBoxOpacity: Main.layoutManager.panelBox.opacity,
                panelBoxY: Math.round(Main.layoutManager.panelBox.y),
                overviewVisible: Main.overview.visible,
            },
            themeClasses: {
                taskbar: bar.get_style_class_name?.() ?? null,
                startMenu: bar.startMenu?.get_style_class_name?.() ?? null,
                notification:
                    bar.notificationCentre?.get_style_class_name?.() ?? null,
                preview: bar.preview?.get_style_class_name?.() ?? null,
                quickSettings: Main.panel.statusArea.quickSettings?.menu
                    ?.actor?.get_style_class_name?.() ?? null,
            },
            systemChildren: (() => {
                const out = [];
                const walk = (actor, d) => {
                    if (!actor || d > 5)
                        return;
                    for (const c of actor.get_children()) {
                        const [x, y] = c.get_transformed_position();
                        out.push({
                            d,
                            type: c.constructor?.name ?? '?',
                            name: c.name || null,
                            text: c.text ?? c.get_text?.() ?? null,
                            cls: c.style_class || null,
                            x: Math.round(x), y: Math.round(y),
                            w: Math.round(c.allocation.get_width()),
                            visible: c.visible,
                        });
                        walk(c, d + 1);
                    }
                };
                walk(bar._systemBox, 0);
                return out;
            })(),
            icons: {
                dark: isDark(),
                start: bar._startButton?.child?.gicon?.to_string?.() ?? null,
                taskView: bar._taskViewButton?.child?.gicon?.to_string?.() ?? null,
                chevron: bar._trayArea?._chevron?.child?.gicon?.to_string?.() ?? null,
            },
            notificationCentre: bar.notificationCentre ? {
                ...describe(bar.notificationCentre),
                opacity: bar.notificationCentre.opacity,
                open: bar.notificationCentre.isOpen,
                mapped: bar.notificationCentre.mapped,
                panel: describe(bar.notificationCentre._panel),
                panelOpacity: bar.notificationCentre._panel?.opacity,
                calendar: describe(bar.notificationCentre._calendar),
                weekdays: bar.notificationCentre._calendar?.get_children()
                    .filter(child => child.has_style_class_name?.('calendar-day-heading')).map(describe) ?? [],
                children: bar.notificationCentre._panel
                    ?.get_children().map(c => ({
                        type: c.constructor?.name ?? '?',
                        w: Math.round(c.allocation.get_width()),
                        h: Math.round(c.allocation.get_height()),
                        visible: c.visible,
                    })) ?? [],
            } : null,
            startMenu: bar.startMenu ? {
                ...describe(bar.startMenu),
                open: bar.startMenu.isOpen,
                panel: describe(bar.startMenu._panel),
                tiles: bar.startMenu._pinnedGrid?.get_n_children() ?? 0,
                layout: bar.startMenu._layout ?? null,
                grid: describe(bar.startMenu._pinnedGrid),
                tileStates: bar.startMenu._pinnedGrid?.get_children().map(tile => ({
                    hovered: tile.hover ?? false, ...describe(tile),
                })) ?? [],
                accountButton: describe(bar.startMenu._accountButton),
                avatar: describe(bar.startMenu._avatar),
                accountMenu: describe(bar.startMenu._accountMenu?.actor),
                accountMenuOpen: bar.startMenu._accountMenu?.isOpen ?? false,
                accountMenuItems: bar.startMenu._accountMenu?._getMenuItems()
                    .map(item => item.label?.text).filter(Boolean) ?? [],
                folderButtons: [...(bar.startMenu._folderButtons ?? [])]
                    .map(([name, actor]) => ({name, ...describe(actor)})),
            } : null,
            taskbarMenu: bar._contextMenu ? {
                open: bar._contextMenu.isOpen,
                ...describe(bar._contextMenu.actor),
                items: bar._contextMenu._getMenuItems().filter(i => i.label)
                    .map(i => ({label: i.label.text, ...describe(i)})),
            } : null,
            quickLinks: bar._quickLinks ? {
                open: bar._quickLinks.isOpen,
                items: bar._quickLinks._getMenuItems()
                    .filter(item => item.label)
                    .map(item => ({label: item.label.text, ...describe(item)})),
            } : null,
            quickSettings: (() => {
                const menu = Main.panel.statusArea.quickSettings?.menu;
                if (!menu?.isOpen)
                    return null;
                return {
                    content: describe(menu.box),
                    frame: describe(menu._boxPointer),
                    backgroundAlpha: (menu._w11Material?._tint ?? menu._w11Material ?? menu.box)
                        .get_theme_node().get_background_color().alpha,
                    columns: menu._grid.layout_manager.nColumns,
                    page: menu._w11Pages ? {title: menu._w11Pages.activeTitle,
                        ...describe(menu._w11Pages._page), back: describe(menu._w11Pages._back),
                        gridVisible: menu._grid.visible, footer: describe(menu._w11Pages._footer),
                        footerActions: [...menu._w11Pages._actions.values()].map(record => describe(record.button)),
                        contextOpen: menu._w11Pages._contextMenu?.isOpen ?? false,
                        contextItems: menu._w11Pages._contextMenu?._getMenuItems().filter(item => item.label)
                            .map(item => ({label: item.label.text, ...describe(item)})) ?? [],
                    } : null,
                    editor: menu._w11Editor ? {button: describe(menu._w11Editor._editButton),
                        editing: menu._w11Editor._editing,
                        rows: [...menu._w11Editor._rows.entries()].map(([tile, row]) => ({title: tile.title,
                            ...describe(row.button), action: row.action.text})),
                    } : null,
                    tiles: menu._grid.get_children()
                        .filter(tile => tile.has_style_class_name?.('w11-quick-tile'))
                        .map(tile => ({title: tile.title, ...describe(tile),
                            card: describe(tile._w11Card),
                            labels: describe(tile._w11Labels)})),
                };
            })(),
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

        // The headless shell shows the Overview whenever nothing has
        // focus, which otherwise ends up in every screenshot.
        if (Main.overview.visible && !action.endsWith('-close'))
            Main.overview.hide();

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
        case 'preview-close':
            bar.preview.dismiss();
            return 'dismissed';
        case 'jump-list': {
            const button = [...bar._taskList._buttons.values()]
                .find(b => b.windowCount > 0) ??
                [...bar._taskList._buttons.values()][0];
            if (!button)
                return 'no buttons';
            bar._taskList._openMenu(button, button.app);
            return `menu for ${button.app.get_id()}`;
        }
        case 'task-buttons':
            return JSON.stringify([...bar._taskList._buttons.values()].map(b => {
                const [x, y] = b.get_transformed_position();
                const [w, h] = b.get_transformed_size();
                return [b.app.get_id(), Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
            }));
        case 'jump-list-state': {
            const menu = bar._taskList._menu;
            return JSON.stringify(menu?.isOpen ? menu._app.get_id() : null);
        }
        case 'jump-list-close':
            bar._taskList._closeMenu();
            return 'closed';
        case 'quick-settings': {
            const qs = Main.panel.statusArea.quickSettings;
            if (!qs?.menu)
                return 'no quick settings';
            qs.menu.open(true);
            return 'opened';
        }
        case 'quick-settings-close':
            Main.panel.statusArea.quickSettings?.menu?.close(true);
            return 'closed';
        case 'notifications':
            if (!bar.notificationCentre)
                return 'no notification centre';
            bar.notificationCentre.open();
            return `open=${bar.notificationCentre.isOpen} ` +
                `visible=${bar.notificationCentre.visible}`;
        case 'notifications-close':
            bar.notificationCentre?.close();
            return 'closed';
        case 'test-quick-action': {
            const menu = Main.panel.statusArea.quickSettings.menu;
            if (!this._testAction) {
                this._testAction = new QuickMenuToggle({title: 'Reboot Into',
                    icon_name: 'system-reboot-symbolic', toggle_mode: false});
                this._testAction.menu.setHeader('system-reboot-symbolic', 'Test options');
                const item = new PopupMenu.PopupMenuItem('Test entry — no action');
                item.setSensitive(false);
                this._testAction.menu.addMenuItem(item);
                menu.addItem(this._testAction);
            }
            return 'test-only options added';
        }
        case 'test-quick-action-remove':
            this._testAction?.destroy();
            this._testAction = null;
            return 'removed';
        case 'quick-page-back':
            Main.panel.statusArea.quickSettings.menu._w11Pages?.back();
            return 'back';
        case 'wifi-submenu': {
            const qs = Main.panel.statusArea.quickSettings;
            if (!qs?.menu)
                return 'no quick settings';
            qs.menu.open(true);
            // Find the toggle that owns a sub-page and open it: that is the
            // Wi-Fi list, the Windows "sub-page" equivalent.
            for (const child of qs.menu._grid?.get_children() ?? []) {
                const name = child.constructor?.name ?? '';
                if (child.menu && name.includes('QuickMenuToggle')) {
                    const title = child.title ?? '';
                    if (/wi-?fi|wireless|无线/i.test(title)) {
                        child.menu.open(true);
                        return `opened ${title}`;
                    }
                }
            }
            // Fall back to the first toggle that has one.
            for (const child of qs.menu._grid?.get_children() ?? []) {
                if (child.menu?.open) {
                    child.menu.open(true);
                    return `opened ${child.title ?? 'first sub-page'}`;
                }
            }
            return 'no sub-page found';
        }
        case 'notifications-close':
            Main.panel.statusArea.dateMenu?.menu?.close(true);
            return 'closed';
        case 'maximize-all': {
            let n = 0;
            for (const actor of global.get_window_actors()) {
                const win = actor.meta_window;
                if (win && !win.skip_taskbar) {
                    win.maximize(3); // Meta.MaximizeFlags.BOTH
                    n++;
                }
            }
            return `maximised ${n}`;
        }
        case 'quick-links':
            bar._quickLinks?.open(true);
            return bar._quickLinks ? 'opened' : 'no quick links';
        case 'quick-links-close':
            bar._quickLinks?.close();
            return 'closed';
        case 'clipboard':
            if (!bar.clipboard)
                return 'no clipboard history';
            bar.clipboard._remember('A sample copied line');
            bar.clipboard._remember('https://git.altarscn.com/Geoffrey');
            bar.clipboard.open();
            return `open=${bar.clipboard.isOpen}`;
        case 'clipboard-close':
            bar.clipboard?.close();
            return 'closed';
        case 'virtual-paste-probe': {
            // Does the compositor hand us a virtual keyboard at all?
            // That is what clipboard paste depends on.
            if (!bar.clipboard)
                return 'no clipboard history';
            try {
                bar.clipboard._sendPaste(null);
                return bar.clipboard._virtualKeyboard
                    ? 'virtual keyboard created, keys sent'
                    : 'no device returned';
            } catch (e) {
                return `threw: ${e.message}`;
            }
        }
        case 'hover-first': {
            const button = [...bar._taskList._buttons.values()]
                .find(b => b.windowCount > 0);
            if (!button)
                return 'no running app';
            button.add_style_pseudo_class('hover');
            return 'hovered';
        }
        case 'bg-menu': {
            // Is a desktop menu open, and how many right-click gestures still
            // fire on press (lib/shellMenus.js should leave none)?
            const open = Main.layoutManager._bgManagers.some(m =>
                m.backgroundActor?._backgroundMenu?.isOpen);
            let onPress = 0;
            const walk = actor => {
                onPress += actor.get_actions().filter(a =>
                    a instanceof Clutter.ClickGesture &&
                    a.required_button === Clutter.BUTTON_SECONDARY &&
                    a.recognize_on_press).length;
                actor.get_children().forEach(walk);
            };
            walk(global.stage);
            return JSON.stringify({open, onPress});
        }
        case 'bg-menu-close':
            Main.layoutManager._bgManagers.forEach(m =>
                m.backgroundActor?._backgroundMenu?.close());
            return 'closed';
        case 'pointer-at':
            return JSON.stringify(global.get_pointer());
        case 'windows':
            return JSON.stringify(global.get_window_actors().map(a => {
                const w = a.meta_window;
                const f = w.get_frame_rect();
                const b = w.get_buffer_rect();
                return {
                    title: w.get_title(),
                    wmClass: w.get_wm_class(),
                    type: w.get_window_type(),
                    frame: [f.x, f.y, f.width, f.height],
                    buffer: [b.x, b.y, b.width, b.height],
                    iconGeometry: (() => {
                        const [valid, rect] = w.get_icon_geometry();
                        return valid ? [rect.x, rect.y, rect.width, rect.height] : null;
                    })(),
                    launchOrigin: a._w11LaunchOrigin ?? null,
                    launchAnimationApplied: a._w11LaunchAnimationApplied ?? false,
                };
            }));
        case 'state':
            // What is open, for tests that press keys and look.
            return JSON.stringify({
                clipboard: bar.clipboard?.isOpen ?? null,
                quickSettings: Main.panel.statusArea.quickSettings?.menu?.isOpen ?? null,
                notifications: bar.notificationCentre?.isOpen ?? null,
                startMenu: bar.startMenu?.isOpen ?? null,
                quickLinks: bar._quickLinks?.isOpen ?? null,
            });
        default:
            if (action.startsWith('keys:'))
                return this._runKeyScript(JSON.parse(action.slice(5)));
            if (action.startsWith('pointer:'))
                return this._runPointerScript(JSON.parse(action.slice(8)));
            return `unknown action: ${action}`;
        }
    }

    /**
     * Play a script of pointer steps through a virtual device: {move:
     * [x, y]}, {press: button}, {release: button} or {wait: ms}, with
     * buttons numbered as Clutter numbers them — mutter converts to evdev
     * codes itself. It runs after this call
     * returns, so the test watches the client for the outcome.
     *
     * @param {object[]} steps the script
     * @returns {string} 'scheduled'
     */
    _runPointerScript(steps) {
        if (!this._pointer) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._pointer = seat.create_virtual_device(
                Clutter.InputDeviceType.POINTER_DEVICE);
            // The first absolute motion of a new device loses its x, so
            // spend it on where the pointer already is.
            const [x, y] = global.get_pointer();
            this._pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
        }
        const device = this._pointer;
        const run = from => {
            for (let i = from; i < steps.length; i++) {
                const step = steps[i];
                const now = GLib.get_monotonic_time();
                if (step.wait !== undefined) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, step.wait, () => {
                        run(i + 1);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                if (step.move)
                    device.notify_absolute_motion(now, ...step.move);
                else if (step.press)
                    device.notify_button(now, step.press,
                        Clutter.ButtonState.PRESSED);
                else if (step.release)
                    device.notify_button(now, step.release,
                        Clutter.ButtonState.RELEASED);
            }
        };
        run(0);
        return 'scheduled';
    }

    /**
     * Play key steps through a virtual keyboard: {press: keyval},
     * {release: keyval} or {wait: ms}. Like the pointer script, it runs
     * after this call returns.
     *
     * @param {object[]} steps the script
     * @returns {string} 'scheduled'
     */
    _runKeyScript(steps) {
        if (!this._keyboard) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._keyboard = seat.create_virtual_device(
                Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        const device = this._keyboard;
        const run = from => {
            for (let i = from; i < steps.length; i++) {
                const step = steps[i];
                if (step.wait !== undefined) {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, step.wait, () => {
                        run(i + 1);
                        return GLib.SOURCE_REMOVE;
                    });
                    return;
                }
                device.notify_keyval(GLib.get_monotonic_time(), step.press ?? step.release,
                    step.press !== undefined ? Clutter.KeyState.PRESSED : Clutter.KeyState.RELEASED);
            }
        };
        run(0);
        return 'scheduled';
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
