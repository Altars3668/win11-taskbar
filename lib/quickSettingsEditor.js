/* quickSettingsEditor.js — let the quick settings panel be edited.
 *
 * Windows 11 puts a pencil in the corner of quick settings; pressing it
 * turns every tile into something you can remove, and offers back the ones
 * you removed earlier. GNOME has no such mode — its panel shows whatever
 * the session provides.
 *
 * This adds one. In edit mode every tile is shown, including the hidden
 * ones, and clicking a tile toggles whether it belongs on the panel
 * instead of doing what the tile normally does. That is a smaller idea
 * than Windows' drag-and-drop grid, but it needs no overlay actors on top
 * of widgets we do not own, and it is the part people actually use.
 *
 * Which tiles are hidden lives in the quick-settings-hidden setting, keyed
 * by the tile's class and title so it survives a restart.
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {applyThemeClass} from './theme.js';

/**
 * A stable key for a tile.
 *
 * The title alone is not enough — sliders and the system row have none —
 * and the class alone collides when two tiles share one. Together they
 * survive a session restart, which is all this needs.
 *
 * @param {Clutter.Actor} tile a quick settings item
 * @returns {string} the key to store it under
 */
function tileKey(tile) {
    const cls = tile.constructor?.$gtype?.name ??
        tile.constructor?.name ?? 'Item';
    const title = tile.title ?? tile.accessible_name ?? '';
    return title ? `${cls}:${title}` : cls;
}

export const QuickSettingsEditor = GObject.registerClass(
class QuickSettingsEditor extends St.BoxLayout {
    _init(settings) {
        super._init({
            style_class: 'w11-qs-editor',
            x_align: Clutter.ActorAlign.END,
        });

        this._settings = settings;
        this._editing = false;
        this._intercepts = new Map();
        this._suppressed = new Map();

        this._editButton = new St.Button({
            style_class: 'w11-qs-edit-button icon-button',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        this._editButton.accessible_name = _('Edit quick settings');
        this._editButton.connect('clicked', () => this.toggleEditing());
        this.add_child(this._editButton);

        this._changedId = settings.connect('changed::quick-settings-hidden',
            () => this.apply());
        this.connect('destroy', () => this._onDestroy());
    }

    get grid() {
        return Main.panel.statusArea.quickSettings?.menu?._grid ?? null;
    }

    /** Every tile in the panel, hidden ones included.
     *
     * The grid also holds a plain Clutter.Actor placeholder, which has no
     * style-class methods — filtering on those rather than on visibility
     * is what keeps this from throwing on it. */
    _tiles() {
        return this.grid?.get_children().filter(c =>
            c !== this && typeof c.add_style_class_name === 'function') ?? [];
    }

    _hidden() {
        return new Set(this._settings.get_strv('quick-settings-hidden'));
    }

    /** Show or hide tiles according to the setting.
     *
     * Only tiles *we* removed are touched. The shell hides tiles of its
     * own accord when the hardware is absent — no Bluetooth adapter, no
     * Bluetooth tile — and forcing those visible fills the panel with
     * blank cards for things the machine cannot do. So each suppression
     * records what the tile's visibility was, and restores exactly that.
     */
    apply() {
        const hidden = this._hidden();
        for (const tile of this._tiles()) {
            const off = hidden.has(tileKey(tile));

            if (off) {
                if (!this._suppressed.has(tile))
                    this._suppressed.set(tile, tile.visible);
                // Shown again during editing, so it can be put back —
                // but only if it was ever showable in the first place.
                tile.visible = this._editing && this._suppressed.get(tile);
                tile.add_style_class_name('w11-qs-tile-hidden');
            } else if (this._suppressed.has(tile)) {
                tile.visible = this._suppressed.get(tile);
                this._suppressed.delete(tile);
                tile.remove_style_class_name('w11-qs-tile-hidden');
            }
        }
    }

    toggleEditing() {
        this._editing = !this._editing;

        this._editButton.child.icon_name = this._editing
            ? 'object-select-symbolic' : 'document-edit-symbolic';
        this._editButton.accessible_name = this._editing
            ? _('Done') : _('Edit quick settings');

        const grid = this.grid;
        if (grid) {
            if (this._editing)
                grid.add_style_class_name('w11-qs-editing');
            else
                grid.remove_style_class_name('w11-qs-editing');
        }

        if (this._editing)
            this._interceptClicks();
        else
            this._releaseClicks();

        this.apply();
    }

    /** While editing, a click on a tile moves it in or out of the panel
     *  rather than doing what the tile does. */
    _interceptClicks() {
        for (const tile of this._tiles()) {
            if (tile === this || this._intercepts.has(tile))
                continue;
            const id = tile.connect('button-press-event', () => {
                this._toggleTile(tile);
                return Clutter.EVENT_STOP;
            });
            this._intercepts.set(tile, id);
        }
    }

    _releaseClicks() {
        for (const [tile, id] of this._intercepts) {
            if (tile.get_parent())
                tile.disconnect(id);
        }
        this._intercepts.clear();
    }

    _toggleTile(tile) {
        const key = tileKey(tile);
        const hidden = this._settings.get_strv('quick-settings-hidden');
        const next = hidden.includes(key)
            ? hidden.filter(k => k !== key)
            : [...hidden, key];
        this._settings.set_strv('quick-settings-hidden', next);
    }

    /** Put the panel back the way the shell had it. */
    reset() {
        this._editing = false;
        this._releaseClicks();
        this.grid?.remove_style_class_name('w11-qs-editing');
        for (const [tile, wasVisible] of this._suppressed) {
            if (tile.get_parent()) {
                tile.visible = wasVisible;
                tile.remove_style_class_name('w11-qs-tile-hidden');
            }
        }
        this._suppressed.clear();
    }

    refreshTheme() {
        applyThemeClass(this);
    }

    _onDestroy() {
        this.reset();
        if (this._changedId) {
            this._settings.disconnect(this._changedId);
            this._changedId = 0;
        }
    }
});

let _gettext = s => s;

/**
 * Install the gettext function this module should use.
 *
 * @param {Function} fn the extension's gettext
 */
export function setGettext(fn) {
    _gettext = fn;
}

function _(s) {
    return _gettext(s);
}
