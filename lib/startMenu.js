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
import AccountsService from 'gi://AccountsService';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';

import {DURATION, SLIDE, slideIn, slideOut} from './motion.js';
import {START_MENU, TIMING} from './spec.js';
import {applyThemeClass} from './theme.js';
import {noteLaunch} from './windowMotion.js';

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
        this.x_align = Clutter.ActorAlign.START;
    }

    get app() {
        return this._app;
    }

    vfunc_clicked(button) {
        if (button === Clutter.BUTTON_PRIMARY)
            noteLaunch(this._app, this.get_child().get_first_child());
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
            style_class: 'w11-start-row-icon',
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

/**
 * A folder's display name.
 *
 * GNOME stores it as a .directory file name when `translate` is set, which
 * is why an untranslated id like "X-GNOME-Shell-Utilities.directory" shows
 * up if you just read the key.
 *
 * @param {Gio.Settings} folder the folder's settings
 * @param {string} id the folder id, used as a last resort
 * @returns {string} something worth showing a person
 */
function folderName(folder, id) {
    const name = folder.get_string('name');
    if (!name)
        return id;
    if (!folder.get_boolean('translate'))
        return name;

    for (const dir of GLib.get_system_data_dirs()) {
        const path = GLib.build_filenamev([dir, 'desktop-directories', name]);
        if (!GLib.file_test(path, GLib.FileTest.EXISTS))
            continue;
        try {
            const keyFile = new GLib.KeyFile();
            keyFile.load_from_file(path, GLib.KeyFileFlags.NONE);
            const localised = keyFile.get_locale_string(
                'Desktop Entry', 'Name', null);
            if (localised)
                return localised;
        } catch {
            // Fall through to the raw name.
        }
    }
    return name.replace(/\.directory$/, '');
}

/** An expandable folder in the app list, the way the classic Windows Start
 *  menu grouped programs. The members come from GNOME's app folders, which
 *  is the same idea the app grid already uses. */
const FolderRow = GObject.registerClass(
class FolderRow extends St.BoxLayout {
    _init(name, apps, onActivate) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._expanded = false;

        this._header = new St.Button({
            style_class: 'w11-start-folder-row',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        const box = new St.BoxLayout({
            style_class: 'w11-start-row-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        box.add_child(new St.Icon({
            icon_name: 'folder-symbolic',
            style_class: 'w11-start-row-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: name,
            style_class: 'w11-start-row-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._chevron = new St.Icon({
            icon_name: 'pan-end-symbolic',
            style_class: 'w11-shell-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._chevron);
        this._header.set_child(box);
        this._header.set_height(START_MENU.listRowHeight * scaleFactor());
        this._header.connect('clicked', () => this.toggle());
        this.add_child(this._header);

        this._children = new St.BoxLayout({
            style_class: 'w11-start-folder-children',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });
        for (const app of apps) {
            this._children.add_child(new AppRow(
                app.get_icon(), app.get_name(), null,
                button => onActivate(app, button)));
        }
        this.add_child(this._children);
    }

    toggle() {
        this._expanded = !this._expanded;
        this._chevron.icon_name = this._expanded
            ? 'pan-down-symbolic' : 'pan-end-symbolic';
        this._children.visible = this._expanded;
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
        this._isOpen = false;
        this._dismissIdleId = 0;
        this._popupManager = new PopupMenu.PopupMenuManager(this);

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
        applyThemeClass(this);
        this.connect('captured-event', (_actor, event) => this._onCapturedEvent(event));
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
        // Windows centres the *grid* (8 columns wide) in the panel and
        // then fills it from the top left, so a half-empty grid is
        // left-aligned inside a centred block — not centred itself.
        this._pinnedGrid = new St.Viewport({
            style_class: 'w11-start-grid',
            layout_manager: new Clutter.GridLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
            }),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._pinnedGrid.set_width(
            START_MENU.pinnedColumns * START_MENU.tileWidth * scaleFactor());
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
            x_align: Clutter.ActorAlign.START,
        });
        const accountBox = new St.BoxLayout({
            style_class: 'w11-start-account-box',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });

        // The shell's own avatar widget, so this is the real profile
        // picture rather than a generic person glyph.
        const user = AccountsService.UserManager.get_default()
            .get_user(GLib.get_user_name());
        this._avatar = new UserWidget.Avatar(user, {iconSize: 28});
        this._avatar.style_class = 'w11-start-avatar';
        this._avatar.update();
        accountBox.add_child(this._avatar);

        accountBox.add_child(new St.Label({
            text: user.get_real_name() || GLib.get_user_name(),
            style_class: 'w11-start-account-name',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        account.set_child(accountBox);
        this._accountButton = account;
        account.connect('clicked', () => this._openAccountMenu());
        footer.add_child(account);

        // Windows' Start has a row of folder shortcuts beside the power
        // button (Settings > Personalisation > Start > Folders). These are
        // the ones with an obvious GNOME equivalent.
        const folders = new St.BoxLayout({style_class: 'w11-start-folders'});
        this._folderButtons = new Map();
        for (const [icon, label, action] of [
            ['folder-symbolic', _('File Explorer'),
                () => this._launchDesktop('org.gnome.Nautilus.desktop')],
            ['emblem-system-symbolic', _('Settings'),
                () => this._launchDesktop('org.gnome.Settings.desktop')],
            ['utilities-system-monitor-symbolic', _('Task Manager'),
                source => this._launchDesktop('net.nokyan.Resources.desktop', null, source)],
        ]) {
            const button = new St.Button({
                style_class: 'w11-start-folder',
                can_focus: true,
                child: new St.Icon({
                    icon_name: icon,
                    style_class: 'w11-shell-icon',
                }),
            });
            button.accessible_name = label;
            button.connect('clicked', () => {
                this.close();
                action(button.get_child());
            });
            folders.add_child(button);
            this._folderButtons.set(label, button);
        }
        footer.add_child(folders);

        this._powerButton = new St.Button({
            style_class: 'w11-start-folder w11-start-power',
            can_focus: true,
            child: new St.Icon({
                icon_name: 'system-shutdown-symbolic',
                style_class: 'w11-shell-icon',
            }),
        });
        this._powerButton.accessible_name = _('Power');
        this._powerButton.connect('clicked', () => this._openPowerMenu());
        footer.add_child(this._powerButton);

        this._panel.add_child(footer);
    }

    /**
     * Launch a desktop file, optionally as a command with arguments.
     *
     * @param {string} id the .desktop id
     * @param {string[]} [args] arguments, for apps that take a page name
     */
    _launchDesktop(id, args = null, source = null) {
        const app = Shell.AppSystem.get_default().lookup_app(id);
        if (app && !args) {
            noteLaunch(app, source ?? this._taskbar._startButton);
            app.activate_full(-1, global.get_current_time());
            return;
        }
        const info = app?.get_app_info();
        const exec = info?.get_executable();
        if (!exec)
            return;
        try {
            Gio.Subprocess.new([exec, ...(args ?? [])], Gio.SubprocessFlags.NONE);
        } catch (e) {
            logError(e, `win11-taskbar: cannot launch ${id}`);
        }
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
            this._fillAllApps();
            this._showList(_('All apps'));
        }
    }

    /** GNOME's app folders, as {name, apps} — the counterpart to the
     *  program folders the classic Windows Start menu had. */
    _appFolders() {
        let ids;
        let settings;
        try {
            settings = new Gio.Settings({
                schema_id: 'org.gnome.desktop.app-folders',
            });
            ids = settings.get_strv('folder-children');
        } catch {
            return [];
        }

        const system = Shell.AppSystem.get_default();
        const out = [];
        for (const id of ids) {
            let folder;
            try {
                folder = new Gio.Settings({
                    schema_id: 'org.gnome.desktop.app-folders.folder',
                    path: `/org/gnome/desktop/app-folders/folders/${id}/`,
                });
            } catch {
                continue;
            }

            const name = folderName(folder, id);
            const members = new Set(folder.get_strv('apps'));
            const categories = folder.get_strv('categories');

            const apps = this._allApps().filter(app => {
                if (members.has(app.get_id()))
                    return true;
                if (categories.length === 0)
                    return false;
                const appCategories =
                    app.get_app_info()?.get_categories()?.split(';') ?? [];
                return categories.some(c => appCategories.includes(c));
            });

            if (apps.length > 0)
                out.push({name, apps});
        }
        return out;
    }

    /** Windows' All apps: folders, then every app under a letter heading. */
    _fillAllApps() {
        this._listBox.destroy_all_children();

        const folders = this._appFolders();
        const foldered = new Set(
            folders.flatMap(f => f.apps.map(a => a.get_id())));

        for (const {name, apps} of folders) {
            this._listBox.add_child(new FolderRow(name, apps,
                (app, button) => this._activateApp(app, button)));
        }

        let letter = null;
        for (const app of this._allApps()) {
            if (foldered.has(app.get_id()))
                continue;

            // Group by first character, with everything non-alphabetic
            // under one heading, as Windows does with "&".
            const first = (app.get_name()[0] ?? '').toUpperCase();
            const heading = /[A-Z]/.test(first) ? first : '&';
            if (heading !== letter) {
                letter = heading;
                this._listBox.add_child(new St.Label({
                    text: heading,
                    style_class: 'w11-start-section',
                }));
            }

            this._listBox.add_child(new AppRow(
                app.get_icon(), app.get_name(), null,
                button => this._activateApp(app, button)));
        }

        if (this._listBox.get_n_children() === 0) {
            this._listBox.add_child(new St.Label({
                text: _('No apps'),
                style_class: 'w11-start-empty',
            }));
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
        this._appMenu.actor.add_style_class_name('w11-jumplist');
        applyThemeClass(this._appMenu.actor);
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

    _openAccountMenu() {
        if (this._accountMenu?.isOpen) {
            this._accountMenu.close();
            return;
        }
        this._accountMenu?.destroy();
        this._accountMenu = new PopupMenu.PopupMenu(
            this._accountButton, 0.0, St.Side.BOTTOM);
        this._accountMenu.actor.add_style_class_name('w11-start-power-menu');
        applyThemeClass(this._accountMenu.actor);
        Main.uiGroup.add_child(this._accountMenu.actor);
        this._accountMenu.actor.hide();
        this._popupManager.addMenu(this._accountMenu);

        const info = new PopupMenu.PopupImageMenuItem(
            _('Account information'), 'avatar-default-symbolic');
        info.connect('activate', () => {
            this.close();
            this._launchDesktop('org.gnome.Settings.desktop', ['system', 'users']);
        });
        this._accountMenu.addMenuItem(info);
        this._accountMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const actions = SystemActions.getDefault();
        for (const [id, label, available] of [
            ['lock-screen', _('Lock'), actions.canLockScreen],
            ['switch-user', _('Switch user'), actions.canSwitchUser],
            ['logout', _('Sign out'), actions.canLogout],
        ]) {
            if (!available)
                continue;
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => {
                this.close();
                actions.activateAction(id);
            });
            this._accountMenu.addMenuItem(item);
        }
        this._accountMenu.open(true);
    }

    _openPowerMenu() {
        this._powerMenu?.destroy();
        this._powerMenu = new PopupMenu.PopupMenu(
            this._powerButton, 0.5, St.Side.BOTTOM);
        this._powerMenu.actor.add_style_class_name('w11-start-power-menu');
        applyThemeClass(this._powerMenu.actor);
        Main.uiGroup.add_child(this._powerMenu.actor);
        this._powerMenu.actor.hide();
        this._popupManager.addMenu(this._powerMenu);

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
        return this._isOpen;
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this._isOpen)
            return;
        const reversing = this.visible;
        this._isOpen = true;
        this.reactive = true;

        // Windows has no Overview; having both open at once makes no sense.
        if (Main.overview.visible)
            Main.overview.hide();

        this._refreshPinned();
        this._refreshRecommended();
        this._search.set_text('');
        this._showPinned();

        applyThemeClass(this);
        this.visible = true;
        this._reposition();
        this._taskbar.holdVisible(true);

        // Windows slides the Start menu up out of the taskbar.
        slideIn(this, {
            from: this._taskbar.isBottom ? SLIDE : -SLIDE,
            ms: DURATION.emphasized,
            fromCurrent: reversing,
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

        // Ignore the press still in flight from the click that opened us.
        this._acceptsDismiss = false;
        this._dismissIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._dismissIdleId = 0;
            this._acceptsDismiss = this._isOpen;
            return GLib.SOURCE_REMOVE;
        });
    }

    close() {
        if (!this._isOpen)
            return;
        this._isOpen = false;
        this._acceptsDismiss = false;
        if (this._dismissIdleId) {
            GLib.source_remove(this._dismissIdleId);
            this._dismissIdleId = 0;
        }
        this._appMenu?.destroy();
        this._appMenu = null;
        this._accountMenu?.destroy();
        this._accountMenu = null;
        this._powerMenu?.destroy();
        this._powerMenu = null;
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }

        this._taskbar.holdVisible(false);
        slideOut(this, {
            to: this._taskbar.isBottom ? SLIDE / 2 : -SLIDE / 2,
            onComplete: () => {
                if (!this._isOpen)
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

    _onCapturedEvent(event) {
        if (!this._isOpen)
            return Clutter.EVENT_STOP;
        if (event.type() === Clutter.EventType.KEY_PRESS &&
            event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (event.type() !== Clutter.EventType.BUTTON_PRESS || !this._acceptsDismiss)
            return Clutter.EVENT_PROPAGATE;
        const target = global.stage.get_event_actor(event);
        const inside = target && (target === this._panel || this._panel.contains(target) ||
            this._accountMenu?.actor.contains(target) ||
            this._powerMenu?.actor.contains(target) || this._appMenu?.actor.contains(target));
        if (inside)
            return Clutter.EVENT_PROPAGATE;
        this.close();
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        if (this._dismissIdleId)
            GLib.source_remove(this._dismissIdleId);
        this._dismissIdleId = 0;
        this._appMenu?.destroy();
        this._accountMenu?.destroy();
        this._powerMenu?.destroy();
        if (this._modal) {
            Main.popModal(this._modal);
            this._modal = null;
        }
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
