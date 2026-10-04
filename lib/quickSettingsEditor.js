/* 快捷控制编辑页：明确的添加/移除与完成操作，不拦截原生开关点击。 */
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function tileKey(tile) {
    const type = tile.constructor?.$gtype?.name ?? tile.constructor?.name ?? 'Item';
    const title = tile.title ?? tile.accessible_name ?? '';
    return title ? `${type}:${title}` : type;
}

export const QuickSettingsEditor = GObject.registerClass({GTypeName: 'W11QuickSettingsEditorV2'},
class QuickSettingsEditor extends St.BoxLayout {
    _init(settings, pages = null) {
        super._init({style_class: 'w11-qs-editor', x_align: Clutter.ActorAlign.END});
        this._settings = settings;
        this._pages = pages;
        this._editing = false;
        this._records = new Map();
        this._rows = new Map();
        this._editButton = new St.Button({style_class: 'w11-qs-edit-button icon-button', can_focus: true,
            accessible_name: _('Edit quick settings'), child: new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 16})});
        this._editButton.connect('clicked', () => this.toggleEditing());
        this.add_child(this._editButton);
        this._changedId = settings.connect('changed::quick-settings-hidden', () => this.apply());
        this.connect('destroy', () => this._onDestroy());
    }

    get grid() {
        return Main.panel.statusArea.quickSettings?.menu?._grid ?? null;
    }

    setPages(pages) {
        this._pages = pages;
    }

    _tiles() {
        return this.grid?.get_children().filter(tile => !tile._w11FooterAction &&
            typeof tile.title === 'string' && /Toggle/.test(tile.constructor?.$gtype?.name ?? tile.constructor?.name ?? '')) ?? [];
    }

    apply() {
        const hidden = new Set(this._settings.get_strv('quick-settings-hidden'));
        for (const tile of this._tiles()) {
            let record = this._records.get(tile);
            if (!record) {
                record = {nativeVisible: tile.visible, updating: false};
                record.visibilityId = tile.connect('notify::visible', () => {
                    if (record.updating)
                        return;
                    record.nativeVisible = tile.visible;
                    this.apply();
                });
                record.destroyId = tile.connect('destroy', () => this._records.delete(tile));
                this._records.set(tile, record);
            }
            record.updating = true;
            tile.visible = record.nativeVisible && !hidden.has(tileKey(tile));
            record.updating = false;
        }
        for (const [tile, row] of this._rows) {
            const off = hidden.has(tileKey(tile));
            row.indicator.icon_name = off ? 'list-add-symbolic' : 'object-select-symbolic';
            row.action.text = off ? _('Add') : _('Remove');
            row.button.accessible_name = `${tile.title}: ${off ? _('Add') : _('Remove')}`;
        }
    }

    toggleEditing() {
        if (this._editing) {
            this._pages?.back();
            return;
        }
        if (!this._pages)
            return;
        this.apply();
        this._editing = true;
        const box = new St.BoxLayout({style_class: 'w11-quick-edit-list',
            orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._rows.clear();
        box.add_child(new St.Label({text: _('Choose which controls appear in quick settings'),
            style_class: 'w11-quick-edit-description'}));
        for (const tile of this._tiles()) {
            if (!this._records.get(tile)?.nativeVisible)
                continue;
            const button = new St.Button({style_class: 'w11-quick-edit-row', x_expand: true,
                can_focus: true, track_hover: true});
            const content = new St.BoxLayout({x_expand: true});
            const indicator = new St.Icon({icon_size: 16});
            content.add_child(indicator);
            content.add_child(new St.Label({text: tile.title, x_expand: true, y_align: Clutter.ActorAlign.CENTER}));
            const action = new St.Label({y_align: Clutter.ActorAlign.CENTER});
            content.add_child(action);
            button.set_child(content);
            button.connect('clicked', () => this._toggleTile(tile));
            box.add_child(button);
            this._rows.set(tile, {button, indicator, action});
        }
        const done = new St.Button({style_class: 'w11-quick-edit-done', label: _('Done'), can_focus: true});
        done.connect('clicked', () => this._pages.back());
        box.add_child(done);
        this._pages.showContent(_('Edit quick settings'), box, () => {
            this._editing = false;
            this._rows.clear();
        });
        this.apply();
    }

    _toggleTile(tile) {
        const key = tileKey(tile);
        const hidden = this._settings.get_strv('quick-settings-hidden');
        this._settings.set_strv('quick-settings-hidden', hidden.includes(key)
            ? hidden.filter(value => value !== key) : [...hidden, key]);
    }

    reset() {
        if (this._editing)
            this._pages?.back();
        this._editing = false;
        this._rows.clear();
        for (const [tile, record] of this._records) {
            tile.disconnect(record.visibilityId);
            tile.disconnect(record.destroyId);
            tile.visible = record.nativeVisible;
        }
        this._records.clear();
    }

    refreshTheme() {
    }

    _onDestroy() {
        this.reset();
        if (this._changedId)
            this._settings.disconnect(this._changedId);
        this._changedId = 0;
    }
});

let _gettext = value => value;
export function setGettext(fn) {
    _gettext = fn;
}
function _(value) {
    return _gettext(value);
}
