/* systemFlyouts.js — reshape GNOME's two system menus into the Windows ones.
 *
 * Windows 11 has two separate flyouts, and this is worth stating because
 * Windows 10 did not: quick settings opens from the network/volume/battery
 * glyphs, the notification centre opens from the clock. They are different
 * panels in different places.
 *
 * GNOME has both already — Quick Settings and the date menu — backed by
 * NetworkManager, UPower, the mixer and the notification daemon.
 * Reimplementing those to get a Windows-shaped Wi-Fi list would mean
 * reimplementing the Wi-Fi list, and it would be worse. So we take the real
 * menus and give them Windows' geometry: measured size, measured margins,
 * anchored to the screen corner instead of centred under their button, no
 * pointer arrow, and the taskbar's own acrylic surface.
 *
 * Everything done here is reverted on disable.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {QuickSettingsEditor} from './quickSettingsEditor.js';
import {ACRYLIC, FLYOUT} from './spec.js';
import {applyThemeClass} from './theme.js';

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/**
 * Depth-first search for an actor by its name.
 *
 * @param {Clutter.Actor} root where to start
 * @param {string} name the actor name to find
 * @returns {Clutter.Actor|null} the actor, or null
 */
function findByName(root, name) {
    if (!root)
        return null;
    if (root.name === name)
        return root;
    for (const child of root.get_children()) {
        const found = findByName(child, name);
        if (found)
            return found;
    }
    return null;
}

/** Where a flyout should sit, in Windows' terms. The notification centre
 *  is not here: it is our own panel now, in lib/notificationCentre.js. */
const Placement = {
    /** Above the taskbar, flush to the right edge. */
    CORNER: 'corner',
};

class FlyoutStyler {
    constructor(menu, {styleClass, placement, width, height, gap, taskbar}) {
        this._menu = menu;
        this._taskbar = taskbar;
        this._placement = placement;
        this._width = width;
        this._height = height;
        this._gap = gap;
        this._styleClass = styleClass;
        this._laterId = 0;

        menu.actor.add_style_class_name(styleClass);
        menu.actor.add_style_class_name('w11-flyout');
        applyThemeClass(menu.actor);

        this._openId = menu.connect('open-state-changed', (_m, open) => {
            if (!open)
                return;
            applyThemeClass(menu.actor);
            this._place();
        });
    }

    /** Give it the taskbar's acrylic, so the two surfaces match. */
    applyAcrylic() {
        const box = this._menu._boxPointer ?? this._menu.actor;
        if (!box || box.get_effect('w11-acrylic'))
            return;
        box.add_effect_with_name('w11-acrylic', new Shell.BlurEffect({
            radius: ACRYLIC.blurRadiusFlyout,
            brightness: 1.0,
            mode: Shell.BlurMode.BACKGROUND,
        }));
    }

    _place() {
        this._cancelLater();
        // The allocation is stale until after the next layout pass, and
        // placing against a stale width puts the panel in the wrong place
        // the first time it opens.
        this._laterId = global.compositor.get_laters().add(
            Clutter.LaterType.BEFORE_REDRAW, () => {
                this._laterId = 0;
                this._placeNow();
                return GLib.SOURCE_REMOVE;
            });
    }

    _placeNow() {
        const box = this._menu._boxPointer ?? this._menu.actor;
        if (!box)
            return;

        const s = scaleFactor();
        const monitor = Main.layoutManager.monitors[
            this._taskbar?.monitorIndex ?? Main.layoutManager.primaryIndex] ??
            Main.layoutManager.primaryMonitor;
        const margin = FLYOUT.edgeMargin * s;
        const barHeight = this._taskbar?.height ?? 0;
        const bottomEdge = this._taskbar?.isBottom ?? true;

        // Only the corner flyout gets a forced size. Forcing one on the
        // notification centre is what made its calendar overflow: GNOME's
        // date menu sizes its calendar and message columns from their own
        // content, and squeezing the container to Windows' 338px just
        // pushes that content outside the panel. Let it size itself and
        // place it instead.
        let width, height;
        if (this._placement === Placement.EDGE) {
            box.set_height(-1);
            box.set_width(-1);
            const [, natW] = box.get_preferred_width(-1);
            width = natW;
            height = Math.min(
                box.get_preferred_height(width)[1],
                monitor.height - barHeight -
                    FLYOUT.notificationTopMargin * s - this._gap * s);
            box.set_height(Math.round(height));
        } else {
            width = this._width * s;
            height = Math.min(this._height * s,
                monitor.height - barHeight - this._gap * s - margin);
            box.set_width(Math.round(width));
            box.set_height(Math.round(height));
        }

        const x = monitor.x + monitor.width - width - margin;
        let y;
        if (this._placement === Placement.EDGE) {
            y = bottomEdge
                ? monitor.y + FLYOUT.notificationTopMargin * s
                : monitor.y + barHeight + FLYOUT.notificationTopMargin * s;
        } else {
            y = bottomEdge
                ? monitor.y + monitor.height - barHeight - height - this._gap * s
                : monitor.y + barHeight + this._gap * s;
        }
        box.set_position(Math.round(x), Math.round(y));
    }

    _cancelLater() {
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
    }

    refreshTheme() {
        applyThemeClass(this._menu?.actor);
    }

    destroy() {
        this._cancelLater();
        if (this._openId) {
            this._menu.disconnect(this._openId);
            this._openId = 0;
        }
        const box = this._menu._boxPointer ?? this._menu.actor;
        box?.remove_effect_by_name('w11-acrylic');
        // Hand the sizing back to the shell.
        box?.set_size(-1, -1);
        this._menu.actor?.remove_style_class_name(this._styleClass);
        this._menu.actor?.remove_style_class_name('w11-flyout');
        this._menu = null;
    }
}

/** Takes over both system flyouts for as long as it lives. */
export class SystemFlyouts {
    constructor(taskbar) {
        this._taskbar = taskbar;
        this._stylers = [];
        this._gridColumns = null;

        const quickSettings = Main.panel.statusArea.quickSettings;
        if (quickSettings?.menu) {
            const styler = new FlyoutStyler(quickSettings.menu, {
                styleClass: 'w11-quick-settings',
                placement: Placement.CORNER,
                width: FLYOUT.quickSettingsWidth,
                height: FLYOUT.quickSettingsHeight,
                gap: FLYOUT.quickSettingsGap,
                taskbar,
            });
            styler.applyAcrylic();
            this._stylers.push(styler);
            this._narrowGrid(quickSettings.menu);

            // Windows lets the panel be edited; GNOME does not, so the
            // control is ours and lives at the end of the grid.
            if (taskbar.settings.get_boolean('quick-settings-editable')) {
                this._editor = new QuickSettingsEditor(taskbar.settings);
                quickSettings.menu._grid?.add_child(this._editor);
                this._editor.apply();
            }

            this._reorderGrid(quickSettings.menu._grid);
            // The shell adds and removes tiles as hardware comes and
            // goes, so the banding has to be reapplied.
            this._gridWatchId = quickSettings.menu._grid?.connect(
                'child-added', () => this._queueReorder());
            this._gridRemovedId = quickSettings.menu._grid?.connect(
                'child-removed', () => this._queueReorder());
        }

    }

    /**
     * Put the panel in Windows' order.
     *
     * GNOME interleaves everything: the round system buttons sit at the
     * top, sliders land between rows of tiles, and the result reads as a
     * jumble of circles and rectangles. Windows is strictly banded —
     * tiles, then sliders, then a single row of system buttons along the
     * bottom — and reordering the grid's children gets exactly that
     * without touching the controls themselves.
     *
     * @param {Clutter.Actor} grid the quick settings grid
     */
    _reorderGrid(grid) {
        if (!grid)
            return;

        const tiles = [];
        const sliders = [];
        const system = [];
        const rest = [];

        for (const child of grid.get_children()) {
            const name = child.constructor?.$gtype?.name ??
                child.constructor?.name ?? '';
            if (name.includes('Slider'))
                sliders.push(child);
            else if (name.includes('SystemItem') || name.includes('System'))
                system.push(child);
            else if (name.includes('Toggle'))
                tiles.push(child);
            else
                rest.push(child);
        }

        // The editor control, if present, belongs after everything.
        const editor = this._editor;
        const ordered = [...tiles, ...sliders, ...system,
            ...rest.filter(c => c !== editor)];
        if (editor)
            ordered.push(editor);

        ordered.forEach((child, index) => grid.set_child_at_index(child, index));
    }

    /** Windows' quick settings is a narrow panel, so the two-column grid
     *  GNOME sizes for a wider menu has to be told the new width. The
     *  column count itself stays at GNOME's: at 361px, three columns leave
     *  no room for a toggle's label. */
    _narrowGrid(menu) {
        const grid = menu._grid;
        if (!grid)
            return;
        const s = scaleFactor();
        const inner = (FLYOUT.quickSettingsWidth - 2 * 12) * s;
        grid.set_style(`width: ${Math.round(inner)}px;`);
        this._gridStyled = grid;
    }

    /** Re-tag the menus after an appearance change. They live under
     *  Main.uiGroup, so the panel's own sweep does not reach them. */
    refreshTheme() {
        for (const styler of this._stylers)
            styler.refreshTheme();
        this._editor?.refreshTheme();
    }

    _queueReorder() {
        if (this._reorderId)
            return;
        this._reorderId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._reorderId = 0;
            this._reorderGrid(Main.panel.statusArea.quickSettings?.menu?._grid);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._reorderId) {
            GLib.source_remove(this._reorderId);
            this._reorderId = 0;
        }
        const grid = Main.panel.statusArea.quickSettings?.menu?._grid;
        if (grid) {
            if (this._gridWatchId)
                grid.disconnect(this._gridWatchId);
            if (this._gridRemovedId)
                grid.disconnect(this._gridRemovedId);
        }
        this._editor?.destroy();
        this._editor = null;
        this._gridStyled?.set_style(null);
        this._gridStyled = null;
        for (const styler of this._stylers)
            styler.destroy();
        this._stylers = [];
        this._taskbar = null;
    }
}
