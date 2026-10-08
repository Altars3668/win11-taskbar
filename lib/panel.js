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
import Meta from 'gi://Meta';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {AutoHide} from './autoHide.js';
import {taskbarSize, taskbarSizingMode, searchStyle, taskStripBudget} from './adaptiveLayout.js';
import {isVertical, towardsBar} from './barEdge.js';
import {shellShuttingDown} from './shellShutdown.js';
import {ACRYLIC, LAYOUT, PANEL, TRAY} from './spec.js';
import {TaskbarMenu} from './taskbarMenu.js';
import {Clock, SearchButton, setContextMenuTiming, ShowDesktopButton, StartButton,
    TaskViewButton} from './shellButtons.js';
import {ClipboardHistory} from './clipboardHistory.js';
import {NotificationCentre} from './notificationCentre.js';
import {InputMethodButton} from './inputMethodPanel.js';
import {InputSwitcher} from './inputSwitcher.js';
import {QuickLinksMenu} from './quickLinks.js';
import {restoreAccelerators, Shortcuts, yieldAccelerators} from './shortcuts.js';
import {AcrylicSurface, contactShadow, PopupSurface} from './acrylicSurface.js';
import {StartMenu} from './startMenu.js';
import {SearchPanel} from './searchPanel.js';
import {closeOtherLaunchers} from './launcherPanels.js';
import {SuperKeyHandler} from './superKey.js';
import {SystemFlyouts} from './systemFlyouts.js';
import {SystemIndicators} from './systemIndicators.js';
import {applyThemeClass} from './theme.js';
import {TaskList} from './taskList.js';
import {TrayArea} from './trayArea.js';
import {WindowPreview} from './windowPreview.js';

export const Taskbar = GObject.registerClass(
class Taskbar extends St.Widget {
    _init(monitorIndex, settings, statusHost, openPreferences, gettext, recentDocuments) {
        super._init({
            name: 'w11Taskbar',
            style_class: 'w11-taskbar',
            reactive: true,
            track_hover: true,
        });

        this._monitorIndex = monitorIndex;
        this._settings = settings;
        this.recentDocuments = recentDocuments;
        this._statusHost = statusHost;
        this._settingsIds = [];

        setContextMenuTiming(() =>
            settings.get_boolean('context-menu-on-release'));

        this._buildZones();

        this._addToChrome();

        this._applyAcrylic();
        this._watchColorScheme();

        this.preview = new WindowPreview(this);
        this.applyAcrylicTo(this.preview);

        this._taskList = new TaskList(this);
        this._taskScroll = new St.ScrollView({
            style_class: 'w11-task-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.NEVER,
        });
        this._taskScroll.set_child(this._taskList);
        this._centerZone.add_child(this._taskScroll);
        this._taskScroll.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.SCROLL || !this._stripOverflow) return Clutter.EVENT_PROPAGATE;
            const direction = event.get_scroll_direction();
            const step = direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT ? -1 :
                direction === Clutter.ScrollDirection.SMOOTH ? event.get_scroll_delta().reduce((a, b) => a + b, 0) : 1;
            const adjustment = this.vertical ? this._taskScroll.vadjustment : this._taskScroll.hadjustment;
            adjustment.value += step * this.size * 2;
            return Clutter.EVENT_STOP;
        });

        // Only borrow the shell's own indicators once, onto the primary bar.
        if (this._settings.get_boolean('show-system-indicators') &&
            monitorIndex === Main.layoutManager.primaryIndex) {
            this._systemIndicators = new SystemIndicators(this._systemBox, this);
            this._systemFlyouts = new SystemFlyouts(this);
        }

        this.searchPanel = new SearchPanel(this, gettext);
        this.applyAcrylicTo(this.searchPanel);
        this._searchButton.connect('clicked', () => this.searchPanel.toggle());
        if (this._settings.get_boolean('start-menu')) {
            this.startMenu = new StartMenu(this);
            this.applyAcrylicTo(this.startMenu);
            this._startButton.connect('clicked', () => this.startMenu.toggle());
            if (monitorIndex === Main.layoutManager.primaryIndex &&
                this._settings.get_boolean('super-opens-start')) {
                this._superKey = new SuperKeyHandler(() => this.startMenu.toggle());
            }
        } else {
            this._startButton.connect('clicked', () => {
                closeOtherLaunchers(null);
                if (Main.overview.visible) Main.overview.hide();
                else Main.overview.show(2);
            });
        }

        // Win+X, and a right-click of Start — the two ways Windows opens
        // the Quick Link menu.
        this._quickLinks = new QuickLinksMenu(this._startButton, this);
        this._startButton.connect('context-menu',
            () => this._quickLinks.toggle());
        this._contextMenu = new TaskbarMenu(this, openPreferences, gettext);

        if (monitorIndex === Main.layoutManager.primaryIndex) {
            if (this._settings.get_boolean('clipboard-history')) {
                this.clipboard = new ClipboardHistory(this);
                this.applyAcrylicTo(this.clipboard);
            }
            this._addKeybindings();
            this._settingsIds.push(settings.connect('changed::search-key', () => {
                this._removeKeybindings();
                this._addKeybindings();
            }));
        }

        this._autoHide = new AutoHide(this);
        this._autoHide.setEnabled(this._settings.get_boolean('auto-hide'));

        this._monitorsId = Main.layoutManager.connect('monitors-changed',
            () => this.relayout());
        this._scaleId = St.ThemeContext.get_for_stage(global.stage).connect(
            'notify::scale-factor', () => this._onScaleChanged());

        for (const key of ['taskbar-size', 'taskbar-size-mode', 'alignment', 'auto-hide', 'show-start-button',
            'search-style', 'show-task-view-button', 'show-clock', 'show-desktop-button', 'acrylic',
            'show-tray', 'show-input-method', 'hide-overview-dash', 'reserve-space',
            'icon-size']) {
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
            // 隐藏的 Dash 图标没有实例化 St.Icon，收藏夹一变化 GNOME 仍会重算尺寸并抛
            // TypeError；隐藏期间跳过，恢复显示时再重排一次。
            if (!Object.hasOwn(dash, '_adjustIconSize')) {
                const original = dash._adjustIconSize;
                this._dashAdjust = function (...args) {
                    return this.visible ? original.apply(this, args) : undefined;
                };
                dash._adjustIconSize = this._dashAdjust;
            }
            this._dashHidden = true;
        } else if (!hide && this._dashHidden) {
            this._restoreOverviewDash();
        }
    }

    _restoreOverviewDash() {
        if (!this._dashHidden)
            return;
        const dash = Main.overview.dash;
        if (dash && this._dashAdjust && dash._adjustIconSize === this._dashAdjust)
            delete dash._adjustIconSize;
        this._dashAdjust = null;
        if (dash && this._dashWasVisible) {
            dash.show();
            dash._queueRedisplay?.();
        }
        this._dashHidden = false;
    }

    /** The two shortcuts that own a panel here; the rest live in
     *  lib/shortcuts.js. */
    _addKeybindings() {
        const mode = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        this._keybindings = [];

        // GNOME's own bindings give up our accelerators first; see
        // lib/shortcuts.js for why both on one key is not good enough.
        yieldAccelerators(this._settings, ['quick-links-key',
            ...this.clipboard ? ['clipboard-key'] : [],
            ...Shortcuts.keyNames(this._settings)]);

        Main.wm.addKeybinding('quick-links-key', this._settings,
            Meta.KeyBindingFlags.NONE, mode,
            () => this._quickLinks.toggle());
        this._keybindings.push('quick-links-key');

        if (this.clipboard) {
            Main.wm.addKeybinding('clipboard-key', this._settings,
                Meta.KeyBindingFlags.NONE, mode,
                () => this.clipboard.toggle());
            this._keybindings.push('clipboard-key');
        }

        this._shortcuts = new Shortcuts(this);
        this._inputSwitcher = new InputSwitcher(() => this._inputMethod);
    }

    _removeKeybindings() {
        this._inputSwitcher?.destroy();
        this._inputSwitcher = null;
        this._shortcuts?.destroy();
        this._shortcuts = null;
        for (const name of this._keybindings ?? [])
            Main.wm.removeKeybinding(name);
        this._keybindings = [];
        restoreAccelerators(this._settings);
    }

    /** The task strip's buttons, left to right — what Super+1..9 and
     *  Super+T walk. */
    get taskButtons() {
        return this._taskList
            ? this._taskList.get_children().filter(c => c.visible)
            : [];
    }

    ensureTaskVisible(button) {
        if (!this._stripOverflow || !button) return;
        const box = button.get_allocation_box();
        const adjustment = this.vertical ? this._taskScroll.vadjustment : this._taskScroll.hadjustment;
        const first = this.vertical ? box.y1 : box.x1;
        const last = this.vertical ? box.y2 : box.x2;
        if (first < adjustment.value) adjustment.value = first;
        else if (last > adjustment.value + adjustment.page_size) adjustment.value = last - adjustment.page_size;
    }

    _emptyTarget(event) {
        let target = global.stage.get_event_actor(event);
        while (target && target !== this) {
            if (target.reactive)
                return false;
            target = target.get_parent();
        }
        return target === this;
    }

    vfunc_button_press_event(event) {
        this._rightPressAt = null;
        if (event.get_button() !== Clutter.BUTTON_SECONDARY || !this._emptyTarget(event))
            return Clutter.EVENT_PROPAGATE;
        if (!this._settings.get_boolean('context-menu-on-release')) {
            this._openContextMenu(...event.get_coords());
        } else {
            this._rightPressAt = event.get_coords();
        }
        return Clutter.EVENT_STOP;
    }

    vfunc_button_release_event(event) {
        if (event.get_button() !== Clutter.BUTTON_SECONDARY || !this._rightPressAt)
            return Clutter.EVENT_PROPAGATE;
        const [px, py] = this._rightPressAt;
        this._rightPressAt = null;
        const [x, y] = event.get_coords();
        if (Math.hypot(x - px, y - py) <= 8 && this._emptyTarget(event))
            this._openContextMenu(x, y);
        return Clutter.EVENT_STOP;
    }

    _openContextMenu(x, y) {
        this.startMenu?.close();
        this.searchPanel?.close();
        this.preview?.dismiss();
        this._quickLinks?.close();
        this._contextMenu.openAt(x, y);
    }

    /* -------------------------------------------------------------- chrome */

    /** Register with the layout manager. Only trackFullscreen and
     *  affectsStruts are accepted here; the input region follows the actor
     *  automatically. */
    _addToChrome() {
        // Auto-hide implies not reserving space; reserve-space lets the bar
        // float over maximised windows without hiding, which is also how
        // you can see the acrylic doing anything.
        const reserve = this._settings.get_boolean('reserve-space') &&
            !this._settings.get_boolean('auto-hide');
        Main.layoutManager.addChrome(this, {
            affectsStruts: reserve,
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
        const enabled = this._settings.get_boolean('acrylic');
        if (!this._barSurface) {
            this._barSurface = new AcrylicSurface(ACRYLIC.blurRadiusPanel,
                enabled, 'w11-taskbar-material');
            this.add_child(this._barSurface);
            this.set_child_below_sibling(this._barSurface, this._leftZone);
            this.add_style_class_name('w11-taskbar-scene');
        }
        this._barSurface.setEnabled(enabled);
        for (const actor of [this.startMenu, this.searchPanel, this.preview, this.notificationCentre,
            this.clipboard, this._trayArea?._overflow])
            actor?._acrylicSurface?.setEnabled(enabled);
    }

    /** Give a flyout the same acrylic treatment as the bar. */
    applyAcrylicTo(actor) {
        if (!actor)
            return;
        if (!actor._acrylicSurface) {
            const content = actor.get_first_child();
            const surface = new AcrylicSurface(ACRYLIC.blurRadiusFlyout,
                this._settings.get_boolean('acrylic'));
            const contact = contactShadow();
            actor.add_child(contact);
            actor.add_child(surface);
            if (content) {
                actor.set_child_below_sibling(surface, content);
                actor.set_child_below_sibling(contact, surface);
            }
            actor._acrylicSurface = surface;
            actor.add_style_class_name('w11-shadow-host');
        }
        // 背景和窗口在 AcrylicSurface 自己的离屏纹理中模糊，避免捕获自身重绘。
    }

    applyAcrylicToPopup(menu) {
        if (!menu._w11Surface)
            menu._w11Surface = new PopupSurface(menu, this._settings, ACRYLIC.blurRadiusFlyout);
    }

    /** Follow the desktop's light/dark preference, as the taskbar does. */
    _watchColorScheme() {
        this._interfaceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });
        this._colorSchemeId = this._interfaceSettings.connect(
            'changed::color-scheme', () => this._applyColorScheme());
        this._themeId = this._settings.connect(
            'changed::theme', () => this._applyColorScheme());
        this._applyColorScheme();
    }

    _applyColorScheme() {
        // Menus and flyouts live under Main.uiGroup, not under us, so each
        // one has to be tagged separately.
        for (const actor of [this, this.preview, this.startMenu, this.searchPanel,
            this.notificationCentre, this.clipboard,
            this._trayArea?._overflow, this._quickLinks?.actor, this._contextMenu?.actor])
            applyThemeClass(actor);
        this._trayArea?.refreshTheme();
        this._inputMethod?.refreshTheme();
        this._systemFlyouts?.refreshTheme();
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

    /** The screen edge the bar is on: bottom, top, left or right. */
    get edge() {
        return this._settings.get_string('position');
    }

    /** Whether the bar stands upright, on the left or right edge. */
    get vertical() {
        return isVertical(this.edge);
    }

    /** The bar's thickness in logical pixels: its height, or its width on
     *  a side. */
    get size() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ?? Main.layoutManager.primaryMonitor;
        // 升级前明确保存的粗细是手动选择；新 auto 设置不会默默覆盖它。
        return taskbarSize(taskbarSizingMode(this._settings),
            monitor?.width ?? 1920, monitor?.height ?? 1080,
            St.ThemeContext.get_for_stage(global.stage).scale_factor, this._settings.get_int('taskbar-size'));
    }

    /** The bar's thickness on screen. */
    get thickness() {
        return this.size * St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    /**
     * The size on screen of something as thick as the bar and `along`
     * logical pixels long along it.
     *
     * @param {number} along its length along the bar, as measured on
     *   Windows' 48px bar
     * @param {boolean} [follows] whether that length grows and shrinks with
     *   the bar, as the task buttons and Start do: their cells are nearly
     *   square
     * @returns {number[]} [width, height]
     */
    cellSize(along, follows = false) {
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const length = (follows ? along + this.size - PANEL.height : along) * s;
        return this.vertical ? [this.thickness, length] : [length, this.thickness];
    }

    /**
     * A glyph's size on this bar: what it is on Windows' 48px bar, scaled
     * with the bar's thickness.
     *
     * @param {number} size its size on a 48px bar
     * @returns {number} its size here, in logical pixels
     */
    glyphSize(size) {
        return Math.round(size * this.size / PANEL.height);
    }

    /**
     * A displacement towards the bar: what flyouts slide in from.
     *
     * @param {number} distance how far
     * @returns {number[]} [dx, dy]
     */
    towardsBar(distance) {
        return towardsBar(this.edge, distance);
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

        this._startButton = new StartButton(this);
        this._searchButton = new SearchButton(this);
        this._taskViewButton = new TaskViewButton(this);
        this._centerZone.add_child(this._startButton);
        this._centerZone.add_child(this._searchButton);
        this._centerZone.add_child(this._taskViewButton);

        // Right to left on Windows: show-desktop, clock, system glyphs,
        // app tray icons, overflow chevron.
        this._trayArea = new TrayArea(this);
        this._rightZone.add_child(this._trayArea);
        this._inputMethod = new InputMethodButton(this);
        this._rightZone.add_child(this._inputMethod);

        this._systemBox = new St.BoxLayout({
            style_class: 'w11-system-area',
            y_expand: true,
        });
        this._trayGap = new St.Widget({y_expand: true});
        this._rightZone.add_child(this._trayGap);
        this._rightZone.add_child(this._systemBox);

        this.notificationCentre = new NotificationCentre(this);
        this.applyAcrylicTo(this.notificationCentre);

        this._clock = new Clock(this, () =>
            this.notificationCentre.toggle());
        this._showDesktop = new ShowDesktopButton(this);
        this._clockGap = new St.Widget({y_expand: true});
        this._desktopGap = new St.Widget({y_expand: true});
        this._rightZone.add_child(this._clockGap);
        this._rightZone.add_child(this._clock);
        this._rightZone.add_child(this._desktopGap);
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
        const inset = LAYOUT.edgePadding * s;
        const vertical = this.vertical;
        this._barSurface?.allocate(new Clutter.ActorBox({x1: 0, y1: 0, x2: width, y2: height}));

        // Along the bar: x on the top or bottom, y on a side. Across, every
        // zone takes the bar's full thickness.
        const [length, across] = vertical ? [height, width] : [width, height];
        const place = (actor, start, size) => {
            const child = new Clutter.ActorBox();
            if (vertical) {
                child.set_origin(0, Math.round(start));
                child.set_size(across, Math.round(size));
            } else {
                child.set_origin(Math.round(start), 0);
                child.set_size(Math.round(size), across);
            }
            actor.allocate(child);
        };
        const extent = actor => vertical
            ? actor.get_preferred_height(across)[1]
            : actor.get_preferred_width(across)[1];

        const leftW = extent(this._leftZone);
        const rightW = extent(this._rightZone);
        const natural = this._taskList ? extent(this._taskList) : 0;
        const controls = [this._startButton, this._taskViewButton].reduce((sum, actor) =>
            sum + (actor.visible ? extent(actor) : 0), 0);
        const mode = this._settings.get_string('search-style');
        this._searchButton.setStyle(mode, searchStyle(mode,
            (length - inset - leftW - rightW - controls - natural) / s, vertical, this.size));
        const search = this._searchButton.visible ? extent(this._searchButton) : 0;
        const budget = taskStripBudget(length, inset + leftW + rightW, controls, natural, search);
        const budgetKey = `${vertical}:${budget}`;
        if (this._taskScroll && this._taskBudget !== budgetKey) {
            this._taskBudget = budgetKey;
            this._taskScroll.set_size(...(vertical ? [-1, budget] : [budget, -1]));
        }
        this._stripOverflow = natural > budget;
        const centerW = Math.min(length - inset - leftW - rightW, controls + search + budget);

        place(this._leftZone, inset, leftW);
        place(this._rightZone, length - rightW, rightW);

        let centerX;
        if (this._settings.get_string('alignment') === 'left') {
            centerX = inset + leftW;
        } else {
            centerX = (length - centerW) / 2;
            // Never let the strip run under the side zones.
            centerX = Math.max(inset + leftW, Math.min(centerX, length - rightW - centerW));
        }
        place(this._centerZone, centerX, centerW);

        // The line runs along the bar's inner edge.
        const line = new Clutter.ActorBox();
        const lineW = PANEL.borderWidth * s;
        switch (this.edge) {
        case 'top':
            line.set_origin(0, height - lineW);
            line.set_size(width, lineW);
            break;
        case 'left':
            line.set_origin(width - lineW, 0);
            line.set_size(lineW, height);
            break;
        case 'right':
            line.set_origin(0, 0);
            line.set_size(lineW, height);
            break;
        default:
            line.set_origin(0, 0);
            line.set_size(width, lineW);
        }
        this._separator.allocate(line);
    }

    /** Alignment is handled in vfunc_allocate; this just asks for a redo. */
    _applyAlignment() {
        this.queue_relayout();
    }

    _applyVisibility() {
        this._startButton.visible = this._settings.get_boolean('show-start-button');
        this._searchButton.setStyle(this._settings.get_string('search-style'));
        this._taskViewButton.visible = this._settings.get_boolean('show-task-view-button');
        this._clock.visible = this._settings.get_boolean('show-clock');
        this._showDesktop.visible = this._settings.get_boolean('show-desktop-button');
        this._trayArea.visible = this._settings.get_boolean('show-tray');
        this._inputMethod.visible = this._settings.get_boolean('show-input-method');
        const s = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const systemVisible = this._systemBox.get_n_children() > 0;
        // The gaps run along the bar.
        const gap = (actor, size) => this.vertical
            ? actor.set_size(-1, size) : actor.set_size(size, -1);
        gap(this._trayGap, (this._trayArea.visible || this._inputMethod.visible) && systemVisible ? TRAY.trayToSystemGap * s : 0);
        gap(this._clockGap, this._clock.visible && systemVisible ? TRAY.systemToClockGap * s : 0);
        gap(this._desktopGap, this._clock.visible && this._showDesktop.visible ? TRAY.clockToDesktopGap * s : 0);
    }

    /* Lay everything along the bar: across the screen on the top or the
     * bottom, down it on a side. */
    _applyOrientation() {
        const orientation = this.vertical
            ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL;
        for (const box of [this._leftZone, this._centerZone, this._rightZone,
            this._systemBox, this._taskList])
            box.orientation = orientation;
        this._trayArea.setOrientation(orientation);
        this._systemIndicators?.setOrientation(orientation);
    }

    /** Re-apply the measured sizes: the scale, the bar's edge or its
     *  thickness changed. */
    _updateMetrics() {
        this._startButton.updateMetrics();
        this._searchButton.updateMetrics();
        this._taskViewButton.updateMetrics();
        this._clock.updateMetrics();
        this._showDesktop.updateMetrics();
        this._taskList.updateMetrics();
        this._trayArea.updateMetrics();
        this._inputMethod.updateMetrics();
        this._applyVisibility();
    }

    /** Place the bar on its monitor and reserve the strut. */
    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex];
        if (!monitor) {
            this.hide();
            return;
        }
        this.show();

        this._applyOrientation();
        this._updateMetrics();

        const thickness = this.thickness;
        if (this.vertical) {
            this.set_size(thickness, monitor.height);
            this.set_y(monitor.y);
        } else {
            this.set_size(monitor.width, thickness);
            this.set_x(monitor.x);
        }
        // When auto-hide owns the position across the bar, let it decide;
        // otherwise park the bar against its edge.
        if (this._autoHide && this._settings.get_boolean('auto-hide')) {
            this._autoHide.relayout();
        } else {
            switch (this.edge) {
            case 'top':
                this.set_y(monitor.y);
                break;
            case 'left':
                this.set_x(monitor.x);
                break;
            case 'right':
                this.set_x(monitor.x + monitor.width - thickness);
                break;
            default:
                this.set_y(monitor.y + monitor.height - thickness);
            }
        }

        for (const edge of ['top', 'bottom', 'left', 'right'])
            this.remove_style_class_name(`w11-taskbar-${edge}`);
        this.add_style_class_name(`w11-taskbar-${this.edge}`);
        if (this.vertical)
            this.add_style_class_name('w11-taskbar-vertical');
        else
            this.remove_style_class_name('w11-taskbar-vertical');

        this._applyAlignment();
    }

    _onScaleChanged() {
        this.relayout();
        this.startMenu?._reposition();
        this.startMenu?._refreshPinned();
        this.searchPanel?.reposition();
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
        // Start keeps to the room beside the bar.
        this.startMenu?._reposition();
        this.startMenu?._refreshPinned();
        this.searchPanel?.reposition();
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
        if (this._themeId) {
            this._settings.disconnect(this._themeId);
            this._themeId = 0;
        }
        this._interfaceSettings = null;

        // The shell is exiting and tearing down its UI and ours together:
        // hand nothing back and destroy nothing that lives elsewhere. A
        // session that ends without disable keeps its shortcut record.
        if (shellShuttingDown())
            return;

        this._autoHide?.destroy();
        this._autoHide = null;

        // Hand the shell's indicators back before anything else is torn down.
        this._systemFlyouts?.destroy();
        this._systemFlyouts = null;
        this._systemIndicators?.destroy();
        this._systemIndicators = null;

        this._restoreOverviewDash();

        this._superKey?.destroy();
        this._superKey = null;
        this._removeKeybindings();
        this._quickLinks?.destroy();
        this._quickLinks = null;
        this._contextMenu?.destroy();
        this._contextMenu = null;
        this.clipboard?.destroy();
        this.clipboard = null;
        this.notificationCentre?.destroy();
        this.notificationCentre = null;
        this.startMenu?.destroy();
        this.startMenu = null;
        this.searchPanel?.destroy();
        this.searchPanel = null;

        this.preview?.destroy();
        this.preview = null;

        this._removeFromChrome();
    }
});
