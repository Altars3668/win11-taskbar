/* startMenu.js — the Windows 11 Start menu.
 *
 * A floating rounded panel above the Start button, holding, top to bottom:
 * a search box, the pinned grid with an "All apps" toggle, a recommended
 * list, and a footer with the account and a power button.
 *
 * Note the geometry here comes from START_MENU in spec.js, which — unlike
 * the rest of the spec — is NOT measured: the measurement machine locked
 * its session before the menu could be walked. See docs/windows-spec.md.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {START_MENU, TIMING} from './spec.js';

function scaleFactor() {
    return St.ThemeContext.get_for_stage(global.stage).scale_factor;
}

/** One tile in the pinned grid: a 32px icon over a wrapped label. */
const AppTile = GObject.registerClass(
class AppTile extends St.Button {
    _init(app, onActivate) {
        super._init({
            style_class: 'w11-start-tile',
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });

        this._app = app;
        this._onActivate = onActivate;

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.set_child(box);

        box.add_child(new St.Icon({
            gicon: app.get_icon(),
            icon_size: START_MENU.tileIconSize,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: 'w11-start-tile-icon',
        }));

        const label = new St.Label({
            text: app.get_name(),
            style_class: 'w11-start-tile-label',
            x_align: Clutter.ActorAlign.CENTER,
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        box.add_child(label);

        const s = scaleFactor();
        this.set_size(START_MENU.tileWidth * s, START_MENU.tileHeight * s);
        this.accessible_name = app.get_name();
    }

    get app() {
        return this._app;
    }

    vfunc_clicked(button) {
        this._onActivate(this._app, button);
    }
});

/** A row in the "All apps" list or the recommended list. */
const AppRow = GObject.registerClass(
class AppRow extends St.Button {
    _init(icon, title, subtitle, onActivate) {
        super._init({
            style_class: 'w11-start-row',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });

        this._onActivate = onActivate;

        const box = new St.BoxLayout({
            style_class: 'w11-start-row-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        this.set_child(box);

        box.add_child(new St.Icon({
            gicon: icon,
            icon_size: START_MENU.listIconSize,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        const titleLabel = new St.Label({
            text: title, style_class: 'w11-start-row-title',
        });
        titleLabel.clutter_text.ellipsize = 3;
        text.add_child(titleLabel);
        if (subtitle) {
            const sub = new St.Label({
                text: subtitle, style_class: 'w11-start-row-subtitle',
            });
            sub.clutter_text.ellipsize = 3;
            text.add_child(sub);
        }
        box.add_child(text);

        this.set_height(START_MENU.listRowHeight * scaleFactor());
        this.accessible_name = title;
    }

    vfunc_clicked(button) {
        this._onActivate(button);
    }
});

export const StartMenu = GObject.registerClass(
class StartMenu extends St.Widget {
    _init(taskbar) {
        super._init({
            style_class: 'w11-start-menu',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            visible: false,
            opacity: 0,
        });

        this._taskbar = taskbar;
        this._showingAllApps = false;
        this._modal = null;

        this._panel = new St.BoxLayout({
            style_class: 'w11-start-panel',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this.add_child(this._panel);

        this._buildSearch();
        this._buildPinned();
        this._buildRecommended();
        this._buildFooter();

        Main.layoutManager.addChrome(this);
        this.connect('destroy', () => this._onDestroy());
    }

    /* -------------------------------------------------------------- build */

    _buildSearch() {
        this._search = new St.Entry({
            style_class: 'w11-start-search',
            hint_text: _('Search for apps'),
            can_focus: true,
            x_expand: true,
        });
        this._search.set_primary_icon(new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 16,
            style_class: 'w11-start-search-icon',
        }));
        this._search.clutter_text.connect('text-changed',
            () => this._onSearchChanged());
        this._search.clutter_text.connect('activate',
            () => this._activateFirstResult());
        this._panel.add_child(this._search);
    }

    _buildPinned() {
        const header = new St.BoxLayout({style_class: 'w11-start-header'});
        this._pinnedLabel = new St.Label({
            text: _('Pinned'),
            style_class: 'w11-start-header-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._pinnedLabel);

        this._allAppsButton = new St.Button({
            style_class: 'w11-start-allapps',
            label: _('All apps  >'),
            can_focus: true,
        });
        this._allAppsButton.connect('clicked', () => this._toggleAllApps());
        header.add_child(this._allAppsButton);
        this._panel.add_child(header);

        // Windows gives the pinned area a fixed three-row height and lets
        // the recommended list take whatever is left, rather than letting
        // the grid stretch and leave a gap in the middle.
        this._pinnedScroll = new St.ScrollView({
            style_class: 'w11-start-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
        });
        this._pinnedScroll.set_height(
            START_MENU.pinnedRows * START_MENU.tileHeight * scaleFactor());
        // St.ScrollView only accepts a child implementing StScrollable;
        // a plain St.Widget is rejected at runtime. St.Viewport is the
        // scrollable container that still takes an arbitrary layout manager.
        this._pinnedGrid = new St.Viewport({
            style_class: 'w11-start-grid',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
            }),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._pinnedScroll.set_child(this._pinnedGrid);
        this._panel.add_child(this._pinnedScroll);

        this._listScroll = new St.ScrollView({
            style_class: 'w11-start-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            y_expand: true,
            visible: false,
        });
        this._listBox = new St.BoxLayout({
            style_class: 'w11-start-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        this._listScroll.set_child(this._listBox);
        this._panel.add_child(this._listScroll);
    }

    _buildRecommended() {
        this._recommendedHeader = new St.BoxLayout({
            style_class: 'w11-start-header',
        });
        this._recommendedHeader.add_child(new St.Label({
            text: _('Recommended'),
            style_class: 'w11-start-header-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._panel.add_child(this._recommendedHeader);

        this._recommendedScroll = new St.ScrollView({
            style_class: 'w11-start-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
        });
        this._recommendedBox = new St.BoxLayout({
            style_class: 'w11-start-recommended',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        this._recommendedScroll.set_child(this._recommendedBox);
        this._panel.add_child(this._recommendedScroll);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({style_class: 'w11-start-footer'});

        const account = new St.Button({
            style_class: 'w11-start-account',
            can_focus: true,
            x_expand: true,
        });
        const accountBox = new St.BoxLayout({
            style_class: 'w11-start-row-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        accountBox.add_child(new St.Icon({
            icon_name: 'avatar-default-symbolic',
            icon_size: 24,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        accountBox.add_child(new St.Label({
            text: GLib.get_real_name() !== 'Unknown'
                ? GLib.get_real_name() : GLib.get_user_name(),
            y_align: Clutter.ActorAlign.CENTER,
        }));
        account.set_child(accountBox);
        account.connect('clicked', () => {
            this.close();
            Gio.Subprocess.new(
                ['gnome-control-center', 'system', 'users'],
                Gio.SubprocessFlags.NONE);
        });
        footer.add_child(account);

        this._powerButton = new St.Button({
            style_class: 'w11-start-power',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'system-shutdown-symbolic',
                icon_size: 20,
            }),
        });
        this._powerButton.accessible_name = _('Power');
        this._powerButton.connect('clicked', () => this._openPowerMenu());
        footer.add_child(this._powerButton);

        this._panel.add_child(footer);
    }

    /* ------------------------------------------------------------ content */

    _allApps() {
        return Shell.AppSystem.get_default().get_installed()
            .filter(info => info.should_show())
            .map(info => Shell.AppSystem.get_default().lookup_app(info.get_id()))
            .filter(app => app)
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
    }

    _refreshPinned() {
        const layout = this._pinnedGrid.layout_manager;
        this._pinnedGrid.destroy_all_children();

        const favorites = AppFavorites.getAppFavorites().getFavorites();
        const columns = START_MENU.pinnedColumns;
        favorites.forEach((app, i) => {
            const tile = new AppTile(app, (a, button) =>
                this._activateApp(a, button));
            layout.attach(tile, i % columns, Math.floor(i / columns), 1, 1);
        });

        if (favorites.length === 0) {
            const empty = new St.Label({
                text: _('Pin an app to see it here'),
                style_class: 'w11-start-empty',
            });
            layout.attach(empty, 0, 0, columns, 1);
        }
    }

    _refreshRecommended() {
        this._recommendedBox.destroy_all_children();

        const recent = this._recentFiles().slice(0, 5);
        if (recent.length === 0) {
            this._recommendedHeader.visible = false;
            this._recommendedScroll.visible = false;
            return;
        }
        this._recommendedHeader.visible = true;
        this._recommendedScroll.visible = true;

        for (const entry of recent) {
            const file = Gio.File.new_for_uri(entry.uri);
            const row = new AppRow(
                Gio.content_type_get_icon(entry.mime || 'text/plain'),
                file.get_basename(), entry.dir,
                () => {
                    this.close();
                    Gio.AppInfo.launch_default_for_uri(entry.uri, null);
                });
            this._recommendedBox.add_child(row);
        }
    }

    /** Recent documents, newest first, read straight from the XBEL store. */
    _recentFiles() {
        const path = GLib.build_filenamev(
            [GLib.get_user_data_dir(), 'recently-used.xbel']);
        let text;
        try {
            const [ok, bytes] = GLib.file_get_contents(path);
            if (!ok)
                return [];
            text = new TextDecoder().decode(bytes);
        } catch {
            return [];
        }

        const out = [];
        for (const chunk of text.split('<bookmark ').slice(1)) {
            const href = /href="([^"]+)"/.exec(chunk)?.[1];
            if (!href?.startsWith('file://'))
                continue;
            const uri = href.replace(/&amp;/g, '&');
            const file = Gio.File.new_for_uri(uri);
            if (!file.query_exists(null))
                continue;
            out.push({
                uri,
                mime: /mime:mime-type type="([^"]+)"/.exec(chunk)?.[1] ?? '',
                dir: file.get_parent()?.get_basename() ?? '',
                modified: Date.parse(/modified="([^"]+)"/.exec(chunk)?.[1] ?? '') || 0,
            });
        }
        return out.sort((a, b) => b.modified - a.modified);
    }

    _fillList(apps) {
        this._listBox.destroy_all_children();
        for (const app of apps) {
            const row = new AppRow(app.get_icon(), app.get_name(),
                app.get_description(), button => this._activateApp(app, button));
            this._listBox.add_child(row);
        }
        if (apps.length === 0) {
            this._listBox.add_child(new St.Label({
                text: _('No results'),
                style_class: 'w11-start-empty',
            }));
        }
    }

    /* ------------------------------------------------------------- search */

    _onSearchChanged() {
        const query = this._search.get_text().trim().toLowerCase();

        if (query === '') {
            this._showPinned();
            return;
        }

        const matches = this._allApps().filter(app => {
            const info = app.get_app_info();
            const haystack = [
                app.get_name(),
                info?.get_description() ?? '',
                info?.get_executable() ?? '',
                ...(info?.get_keywords?.() ?? []),
            ].join(' ').toLowerCase();
            return haystack.includes(query);
        });

        this._fillList(matches);
        this._showList(_('Search results'));
    }

    _activateFirstResult() {
        const first = this._listBox.get_children()
            .find(c => c instanceof AppRow);
        first?.emit('clicked', 1);
    }

    _toggleAllApps() {
        if (this._showingAllApps) {
            this._showPinned();
        } else {
            this._fillList(this._allApps());
            this._showList(_('All apps'));
        }
    }

    _showPinned() {
        this._showingAllApps = false;
        this._pinnedScroll.visible = true;
        this._listScroll.visible = false;
        this._pinnedLabel.text = _('Pinned');
        this._allAppsButton.label = _('All apps  >');
        this._recommendedHeader.visible = this._recommendedBox.get_n_children() > 0;
        this._recommendedScroll.visible = this._recommendedHeader.visible;
    }

    _showList(title) {
        this._showingAllApps = true;
        this._pinnedScroll.visible = false;
        this._listScroll.visible = true;
        this._listScroll.y_expand = true;
        this._pinnedLabel.text = title;
        this._allAppsButton.label = _('<  Back');
        this._recommendedHeader.visible = false;
        this._recommendedScroll.visible = false;
    }

    /* ------------------------------------------------------------ actions */

    _activateApp(app, button) {
        if (button === Clutter.BUTTON_SECONDARY) {
            this._openAppMenu(app);
            return;
        }
        this.close();
        app.activate_full(-1, global.get_current_time());
    }

    _openAppMenu(app) {
        this._appMenu?.destroy();
        const favorites = AppFavorites.getAppFavorites();
        const id = app.get_id();
        const pinned = favorites.isFavorite(id);

        this._appMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._appMenu.actor);
        this._appMenu.actor.hide();

        const pin = new PopupMenu.PopupMenuItem(
            pinned ? _('Unpin from Start') : _('Pin to Start'));
        pin.connect('activate', () => {
            if (pinned)
                favorites.removeFavorite(id);
            else
                favorites.addFavorite(id);
            this._refreshPinned();
        });
        this._appMenu.addMenuItem(pin);
        this._appMenu.open(true);
    }

    _openPowerMenu() {
        this._powerMenu?.destroy();
        this._powerMenu = new PopupMenu.PopupMenu(
            this._powerButton, 0.5, St.Side.BOTTOM);
        this._powerMenu.actor.add_style_class_name('w11-start-power-menu');
        Main.uiGroup.add_child(this._powerMenu.actor);
        this._powerMenu.actor.hide();

        const actions = SystemActions.getDefault();
        const entries = [
            ['lock-screen', _('Lock'), actions.canLockScreen],
            ['logout', _('Sign out'), actions.canLogout],
            ['suspend', _('Sleep'), actions.canSuspend],
            ['restart', _('Restart'), actions.canRestart],
            ['power-off', _('Shut down'), actions.canPowerOff],
        ];
        for (const [id, label, available] of entries) {
            if (!available)
                continue;
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                this.close();
                actions.activateAction(id);
            });
            this._powerMenu.addMenuItem(item);
        }
        this._powerMenu.open(true);
    }

    /* --------------------------------------------------------- open/close */

    get isOpen() {
        return this.visible;
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.visible)
            return;

        // Windows has no Overview; having both open at once makes no sense.
        if (Main.overview.visible)
            Main.overview.hide();

        this._refreshPinned();
        this._refreshRecommended();
        this._search.set_text('');
        this._showPinned();

        this.visible = true;
        this._reposition();
        this._taskbar.holdVisible(true);

        this.remove_all_transitions();
        this.ease({
            opacity: 255,
            duration: TIMING.popupFadeMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Grab so Escape closes and clicks outside dismiss, the way the
        // real Start menu behaves.
        this._modal = Main.pushModal(this, {
            actionMode: Shell.ActionMode.POPUP,
        });
        if (!this._modal) {
            // Something else holds the grab; stay open but ungrabbed rather
            // than refusing to show at all.
            this._modal = null;
        }
        global.stage.set_key_focus(this._search.clutter_text);
    }

    close() {
        if (!this.visible)
            return;

        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        this._appMenu?.destroy();
        this._appMenu = null;
        this._powerMenu?.destroy();
        this._powerMenu = null;

        this._taskbar.holdVisible(false);
        this.remove_all_transitions();
        this.ease({
            opacity: 0,
            duration: TIMING.popupFadeMs,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.visible = false;
            },
        });
    }

    _reposition() {
        const s = scaleFactor();
        const monitor = Main.layoutManager.monitors[this._taskbar.monitorIndex] ??
            Main.layoutManager.primaryMonitor;

        const width = START_MENU.width * s;
        // Never taller than the space above the taskbar.
        const available = monitor.height - this._taskbar.height -
            START_MENU.gapFromPanel * 2 * s;
        const height = Math.min(START_MENU.height * s, available);
        this.set_size(width, height);

        // Windows centres the menu on the screen when the taskbar is centred,
        // and aligns it to the Start button when the taskbar is left-aligned.
        let x;
        if (this._taskbar.settings.get_string('alignment') === 'left')
            x = monitor.x + START_MENU.gapFromPanel * s;
        else
            x = monitor.x + (monitor.width - width) / 2;

        const gap = START_MENU.gapFromPanel * s;
        const y = this._taskbar.isBottom
            ? monitor.y + monitor.height - this._taskbar.height - height - gap
            : monitor.y + this._taskbar.height + gap;

        this.set_position(Math.round(x), Math.round(y));
    }

    vfunc_key_press_event(event) {
        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_press_event(event) {
        // A click on the backdrop (we cover nothing but the panel, but the
        // modal grab routes stray clicks here) closes the menu.
        const target = event.get_source();
        if (!this._panel.contains(target) && target !== this._panel)
            this.close();
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
        this._appMenu?.destroy();
        this._powerMenu?.destroy();
        Main.layoutManager.removeChrome(this);
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
