# Windows 11 Taskbar for GNOME Shell

A GNOME Shell taskbar built against measurements taken from a real Windows 11
machine, rather than from memory of what Windows looks like.

The bar is 48px tall because `Shell_TrayWnd` is 48px tall. Task buttons are
44 × 48 with no gap because UIAutomation reports every button as exactly
44 × 48 at a 44px pitch. The running indicator is a 6px grey pill that grows
to an 18px `#0078D4` pill when the app holds focus, 3px thick, 5px above the
bottom edge, because that is what rows 40–42 of the screen grab contain.

Those measurements, how they were taken, and the two places where
measurement was impossible are written up in
[`docs/windows-spec.md`](docs/windows-spec.md). They live in code in
[`lib/spec.js`](lib/spec.js), and `tools/verify-geometry.py` reads that same
file to check the rendered result against it — 57 assertions, so the bar
cannot quietly drift away from Windows.

## What it does

**Layout.** Three independent zones, as on Windows: the app strip is centred
on the screen midpoint, not in the space between the other two. Left
alignment (Windows 10 style) is a setting. The bar reserves its space like a
real panel, or hides against the edge behind a pressure barrier.

The bar may sit on any of the four edges, which Windows 11 does not allow.
On the left or right it stands upright: the buttons run down it, centred,
the running indicators stand upright against the screen edge, the tray
and the system glyphs stack, and the clock drops the year when the date
does not fit. Everything opens on the bar's inner side — Start beside it,
centred down the screen; quick settings and the notification centre in the
corner at the bar's far end; thumbnails, jump lists, Win+X and the hidden
icons beside what opened them — and slides in from the bar. Its thickness
is a setting too (32 to 96, 48 measured): the task buttons, Start and
their icons follow it, the tray's small glyphs do not.

**Click semantics.** These are the whole point, and they live in
[`lib/clickSemantics.js`](lib/clickSemantics.js) as a pure function so they
can be read in one screen and tested without a compositor:

| Gesture | Result |
|---|---|
| Click, app not running | Launch it |
| Click, one window, not focused | Activate it |
| Click, one window, focused | **Minimise it** |
| Click, two or more windows | Open the thumbnail flyout; click again to close |
| Ctrl + click | Raise the next window of the group, wrapping |
| Shift + click, or middle click | Open another window |
| Right click | Jump list |

**Thumbnail flyout.** Appears after 400 ms of hover — the `MouseHoverTime`
value read off the Windows machine — centred over the button, with a live
clone of each window, its title and a close button. Hovering a thumbnail
fades the other windows out (Aero Peek). Clicking activates; middle click
and the X close.

**Jump list.** Recent documents, then the app's own `.desktop` actions, then
the app name (new instance), pin/unpin, and close-window items — the order
Windows uses. Recent documents are parsed out of `recently-used.xbel`
directly, because gnome-shell does not link GTK and `Gtk.RecentManager` is
not importable inside the shell process.

**Notification area.** The taskbar is its own StatusNotifierItem host — it
registers as `org.kde.StatusNotifierWatcher` rather than borrowing icons
from somewhere else, which is what makes the Windows overflow behaviour
possible. Icons render at the measured 32 x 48 with a 16 x 16 glyph, with
DBusMenu context menus, scroll and middle-click forwarded to the app. Items
listed in `tray-hidden-items` fold behind a chevron into an overflow panel
placed exactly where Windows puts it: centred on the chevron and flush
against the bar. An item that starts asking for attention is pulled back
out, as on Windows.

托盘支持“悬停程序菜单／Windows 式提示／不弹出”三种设置，默认按用户要求显示程序菜单；
未提供 DBusMenu 的程序退回提示，不在悬停时激活程序。设置页按程序名称选择折叠，
不用手写 ID；异步菜单刷新后仍保留折叠操作。右键任务栏空白处在松开后显示
“任务管理器”和“任务栏设置”，不会夺走开始按钮、应用按钮或托盘程序自己的菜单。
右侧组间留白采用实测的 4/8/4px，控制区内的图标单元也留出 4px。

GNOME's own Quick Settings — network, volume, battery — is moved into the
tray rather than reimplemented, because hiding the top bar would otherwise
take the volume slider with it. It is put back untouched on disable.

**Start menu.** A floating panel above the Start button with a search box,
the pinned grid, recent documents under "Recommended", and a footer with
the real account avatar, selectable folder/app shortcuts and a power menu
— the row Windows calls Start folders. Files and Settings are selected by
default; Resources (Task Manager) is optional here and always remains in Win+X. "All apps" lists GNOME's app folders
as expandable groups first, the way the classic Start menu grouped
programs, then every app under a letter heading. The Super key opens it
instead of the Overview. Right-clicking a tile pins or unpins it.
The account avatar opens account information, lock, sign-out and the system's
available user-switching actions. Escape and a click outside dismiss Start.

默认使用 640×720 的六列紧凑布局；设置中可选历史实测的 832×864 Insider 八列布局，或自定义宽高：每 96px 宽多一列固定项，每 84px 高多一行。
两种布局均限制在显示器可用区域内。Insider 布局距任务栏 13px，固定项间距为 96×84，图标为 32px。 Note that is the
*new* Start menu — the measurement machine runs Insider build 29671, where
it is 832 wide with 8 columns rather than the 640 and 6 of the shipping
build. `docs/windows-spec.md` explains, including why `TogglePattern` is
the only way to open it from a script.

**The two system flyouts.** Windows 11 keeps these separate, which is worth
saying because Windows 10 did not: quick settings opens from the
network/volume/battery glyphs, the notification centre from the clock.

*Quick settings* is GNOME's own panel, restyled and re-placed: the latest
main-page capture is approximately 360 x 386, with three columns of 96 x 48
cards and their labels below. Extra Linux controls can make it taller.
It is anchored to the bottom-right corner rather than centred under
its button, no pointer arrow, acrylic, Windows' accent on active tiles and
their chevrons, and a track-and-knob slider instead of GNOME's hairline.
Its contents stay GNOME's deliberately — the Wi-Fi list, Bluetooth, volume
and brightness are NetworkManager, UPower and the mixer, and a
Windows-shaped reimplementation of those would be worse at the part that
matters. Tiles with a sub-page open it the way Windows opens its Wi-Fi
list.

Power choices are not in quick settings, as they are not on Windows: they
are in Start and Win+X. When another extension lists systems to restart
into (Custom Reboot's "Reboot into…" tile), its tile is hidden and its
entries appear after Restart in both menus, each still run by that
extension.

**Window animations.** Windows open, close, minimise and restore the way
Windows 11 animates them, measured frame by frame on the reference machine:
a window grows out of its centre from 0.9 of its size while fading in
(200ms, quick at first), shrinks back to 0.9 and fades as it closes (150ms,
slow at first), and shrinks into its taskbar button as it minimises and
comes back out of it as it is restored (220ms each). GNOME still runs and
completes the effects; only their start, end, length and curve change. A
window launched from the taskbar still comes out of its button. A setting
puts GNOME's own animations back.

**Window corners and shadow.** Windows that draw no shadow of their own —
Electron and Chromium with their own title bars, Qt, undecorated windows —
get Windows 11's 8px corners, its edge (the outermost pixel, a translucent
grey over whatever is behind) and its shadow, all measured on a Settings
window: light at the sides and top, darker and longer below. The corners
and edge are a shader on the window; the shadow is the measured profile
drawn into an image (`tools/make-window-shadow.py`) and stretched round the
window by its nine slices, below it. GTK windows draw their own corners and
shadow and are left alone; maximised, tiled and full-screen windows keep
square corners and no shadow, as on Windows.

**Title bars of GTK apps.** GTK apps draw their own title bars, so on
request (off by default, as it writes outside the extension) a marked block
goes into `~/.config/gtk-3.0/gtk.css` and `~/.config/gtk-4.0/gtk.css`:
Windows' caption buttons — 46px wide, flush with the window's corner, a
faint grey under the pointer and #C42B1C under it on Close, with Windows'
thin 10px glyphs — and 8px corners; GNOME's button layout gains Minimise
and Maximise. Anything else in those files is left alone. Turning it off, or
turning the extension off in a session, takes it all back out and restores
the button layout; locking the screen, which also turns extensions off,
touches nothing. Apps pick it up when they next start. GTK 3 draws the
glyphs a little bolder than GTK 4 does.

**Mica.** With those title bars on, a second setting (off by default too)
gives GTK apps Windows 11's Mica. As Windows makes it, the desktop
wallpaper, blurred far past recognition, takes the luminosity of the
theme's tint — #F3F3F3 in the light style, #202020 in the dark — keeping
only its hue, so a window is as light or as dark as its theme on any
wallpaper, just faintly of the wallpaper's tone; the window's own colour
goes over that at half strength in the light style and 0.8 in the dark.
The shell draws the first part below the window, GTK the second — light or
dark as each app itself is, and solid while the window is not the active
one, as Windows shows it. What shows through is always the wallpaper,
never the windows behind. The style sheet makes the background of every
window GTK 3 or 4 draws see-through, so every one of them gets Mica below
it: an app's dialogs as well, and the windows of apps that are no
GtkApplication, such as Firefox, known by the GTK library their process has
loaded. GTK 3's style sheets cannot tell a dark theme, so GTK 3 apps always
get the light strength. Lists, text and sidebars stay opaque on top, as in
many Windows apps. The taskbar's thumbnails and snap assist show a window
with its Mica, as Windows does; GNOME's own overview shows it without.
Apps pick it up when they next start.

**Snap layouts.** Win+Z opens Windows 11's snap layouts at the focused
window's top right, below its title bar: six layouts in 98×64 tiles, numbered
— a number picks a layout, the next a zone — or a click on a zone. Dragging a
window up against the top of the screen opens them as a bar there instead,
with the target zone previewed on screen, and letting go over a zone puts the
window in it. Snap assist then offers the other windows for the zone still
empty, one zone after another, until they are filled or it is waved away
with Escape or a click elsewhere. Sizes and placement were measured on
Windows; the suggested snap groups Windows adds above the layouts are not
reproduced. A setting turns it all off and gives Super+Z back to GNOME.

**Switching input.** Win+Space opens the input flyout with the next input
method marked; Space moves on, Shift+Space back, and letting go of the
Windows key chooses — a quick tap switches at once. Fcitx 5's groups and
GNOME's input sources both work.

*The notification centre* is ours: notifications above, calendar below, in
a 338-wide column down the right edge, which is Windows' arrangement.
GNOME's date menu puts the two side by side and lives in the top bar we
hide, and a menu cannot open from a hidden actor — so this one builds its
own panel out of the same widgets the date menu uses.

**Appearance.** Light or dark, either following the desktop or pinned
independently. One type scale (14/12/11, three levels and no more), one set
of icon sizes, 4px spacing steps, and one surface definition shared by every
flyout — which is what keeps them looking like one thing. The surface is acrylic: a translucent fill over a real blur.
The opacity is derived rather than guessed — sampling one row of the real
taskbar gave a spread of about 30 per channel, which against a wallpaper
varying by ~100 puts the fill at **alpha 0.70**. An 0.85 fill, which is what
it looks like at a glance, reads as flat grey.

Icons are the stock Adwaita symbolic set at their native 16px. They were
briefly drawn by hand to match Windows' own shapes, and that was a mistake:
Adwaita's strokes are drawn for a 16px grid, so anything larger thickens
them, and hand-drawn shapes next to stock ones never quite match. App icons
stay at the measured 24px, tray glyphs at 16px.
Acrylic is a shadow-free, clipped material leaf; the parent renders the
gradient shadow separately. 材质仅采样壁纸和实际应用窗口，以 ACTOR 模式离屏模糊，
不从含自身 UI 的当前 framebuffer 回采。圆角遮罩、较淡的扩散阴影和贴边阴影分别处理；
隐藏材质释放克隆并停止逐帧监听，不为了消除残影而永久禁用整台桌面的局部重绘。 Blurring the shadow's expanded paint volume
would turn its halo into a solid translucent rectangle.
Task icons use short, interruptible feedback. Minimize/restore geometry
and new-window animation origins use the actual clicked icon rather than
the top-left fallback or the centre of the window.

**Keyboard.** Super+X opens the Quick Link menu — Windows' Win+X, the
flat list of administrative destinations, also reached by right-clicking
Start. Entries whose target is not installed are left out rather than
offered and then failing. Super+V opens clipboard history at the pointer,
with pinned entries kept across restarts.

Also bound: Super+A quick settings, Super+N notifications, Super+D show
desktop, Super+E files, Super+I settings, Super+R run, Super+T steps
through the taskbar, and Super+1…9 reach taskbar buttons. That last one
takes over GNOME's `switch-to-application-N`, which walks the favourites
list where Windows walks the taskbar — they agree until something
unpinned is running. The shell's binding is put back when the setting is
turned off or the extension is disabled.

**Context menus open on release**, as they do on Windows, and a press
that travels more than a few pixels is treated as a gesture and opens
nothing. Opening on press is what stops a right-drag ever reaching the
thing underneath. The same setting switches GNOME Shell's own right-click
menus — the desktop background, app icons — to release, and `patches/`
carries the model into GTK 3 and GTK 4 applications, Edge and Firefox.
With a menu open, a right click somewhere else closes it and opens the
menu there in the same click, as Windows does, instead of only closing it;
with the mutter patch in `patches/` that holds for every application's
popups, Edge's included, so a right-drag started with its menu open is
still a mouse gesture, and a click on the taskbar lands even while a menu
is open. There is a setting if you prefer press.

**Also:** a two-line clock, the 12px show-desktop sliver with Windows'
minimise/restore toggle and Aero Peek, per-workspace window filtering
(the Windows virtual-desktop default), multi-monitor support, and an
option to stop reserving space so windows run under the bar.

## What it does not do

Being straight about the gaps:

* **开始菜单不是每个 Windows 版本的逐像素复制。** 默认紧凑布局采用常见的六列比例；
  八列选项保留 Insider 29671 的历史实测。最近一次自动化未成功打开 Windows 开始菜单，
  不把未打开的截图当作新测量。Linux 材质也不宣称与 Windows 的 HDR/亮度混合逐像素等价。
* **The flyouts' contents are GNOME's.** Their frames, sizes, margins,
  elevation and accent are measured from Windows; the controls inside are
  GNOME's, because they are NetworkManager, UPower and the mixer. The
  three-column layout keeps those original controls, puts labels below
  their cards, and restores the original layout when disabled.
* **No drag-to-reorder.** Windows lets you drag task buttons around.
  Pinned order follows GNOME's favourites, which you can reorder from the
  app grid; quick settings tiles are added and removed from the panel's
  own edit mode rather than dragged.
* **No search box or widgets panel.** They have no GNOME equivalent worth
  faking, so the zones they would occupy are empty.
* **Hover and pressed fills are not measured.** Pointer injection on the
  measurement machine was blocked by UIPI, so those two colours come from
  the published Fluent palette. Everything else — including the elevation
  border alphas — is measured.
* **Multi-window stacking is approximate.** Every app on the measurement
  machine had one window, so the visual for a group of two or more was
  never captured.
* **Conflicts with AppIndicator Support.** Only one process can own
  `org.kde.StatusNotifierWatcher`. If that extension is enabled it wins
  and this taskbar shows no tray icons — the log says so plainly. You do
  not need both: this is a full host, not a client of that one.
* **Release-timed context menus need a GTK patch to go system-wide.**
  Every menu this extension owns waits for the release, and with the
  setting on so do GNOME Shell's. But a menu inside a GTK application
  belongs to GTK, in that application's process. `patches/` has the
  changes that give GTK 3 and GTK 4 the Windows model, a script that
  builds them into packages (`tools/build-gtk-debs.sh`), and what differs
  in detail. Edge takes a Blink switch through its launcher
  (`tools/edge-context-menu.sh`), which is also what lets its mouse
  gestures start; Edge's own tab and toolbar menus cannot be changed.
  A press outside a popup is the compositor's to deliver, so making it land
  takes a mutter patch, also in `patches/`.
* **Clipboard history is polled**, because GNOME has no
  clipboard-changed signal. It does paste for you: the shell is the
  compositor, so Clutter will hand out a virtual input device — the same
  one the on-screen keyboard uses — and the keystroke goes out after the
  grab is released, into the window that had focus. Terminals get
  Ctrl+Shift+V.
* **The acrylic needs something behind it.** Blurring a flat colour gives
  the same flat colour, so over a plain desktop background the bar looks
  solid however correct the material is. It earns its keep over a
  wallpaper or a window.

## Install

```bash
git clone https://git.altarscn.com/Geoffrey/win11-taskbar.git
cd win11-taskbar
make install      # or: ln -s "$PWD" ~/.local/share/gnome-shell/extensions/win11-taskbar@altarscn.com
gnome-extensions enable win11-taskbar@altarscn.com
```

On X11, `Alt+F2` then `r` reloads the shell and that is enough. On Wayland
the shell cannot be restarted — it *is* the compositor, so restarting it
takes every window with it — but you still do not have to log out:

```bash
tools/load-live.sh
```

The shell scans the extension directories once, at startup, so anything
installed afterwards is simply unknown to it. (This is why
`gnome-extensions enable` reports that the extension does not exist, and
why `ReloadExtension` over D-Bus does not help: it only reloads extensions
the manager already holds.) Handing the manager the extension directly
fixes that, and needs JS running inside the shell — GNOME 50 removed the
Eval D-Bus method, but Looking Glass, the shell's own console, still
works. The script prints the single line to paste there, puts it on your
clipboard, and tells you what to run afterwards.

Then switch over. Several stock extensions draw their own taskbar or claim
the tray, and only one of each can win, so there is a script that sorts it
out and records what it turned off (run `tools/load-live.sh` first if the
shell has not scanned the extension yet — it will say so):

```bash
tools/enable.sh           # show what would change
tools/enable.sh --apply   # do it
tools/disable.sh          # undo, restoring whatever was disabled
```

It looks for Dash to Panel, Ubuntu Dock, Dash to Dock and both AppIndicator
extensions. The AppIndicator ones matter most: only one process can own
`org.kde.StatusNotifierWatcher`, and if one of them holds it this taskbar
shows no tray icons.

Requires GNOME Shell 48, 49 or 50.

## Settings

`gnome-extensions prefs win11-taskbar@altarscn.com`, or the Extensions app.
Screen edge, centre/left alignment, auto-hide, which elements to show,
per-monitor and per-workspace filtering, clock format, Aero Peek, and
whether to hide GNOME's own top bar (on by default — Windows has one bar).

## Seeing it before you commit to it

Wayland only scans for extensions at login, so there is no way to load this
into a running session — `ReloadExtension` over D-Bus only knows about
extensions the shell already scanned, and GNOME 50 removed `Eval`. Short of
logging out, the way to look at it is to render every state headlessly:

```bash
tools/screenshots.sh ~/w11-shots
```

That starts a throwaway shell on a 1920x1080 virtual monitor, launches some
apps and tray items in it, and saves thirteen states: idle, the thumbnail
flyout, a jump list, the Start menu, All apps, the tray overflow, quick
settings, a flyout sub-page, the notification centre, the same again in
dark, and left-aligned. Your session is never touched.

Two things the headless shell cannot show you, so do not read them as
faults: it renders no wallpaper, so the acrylic has nothing to blur; and it
has no network device, so the Wi-Fi tile has no list to open (the sub-page
mechanism is still exercised, by whichever tile does have one).

## Testing

```bash
tools/test.sh
```

Runs, in order: a syntax check of every module; the click-semantics unit
tests; a schema compile; and then the real thing — it starts a headless
GNOME Shell on a 1920 × 1080 virtual monitor, the same size as the Windows
machine, with its own D-Bus and its own config so your session is untouched,
launches a couple of apps and two synthetic tray items, checks the log for
JS errors, and diffs the rendered geometry against the Windows
measurements — 65 assertions as of now.

The geometry check talks to a small read-only D-Bus service the extension
exposes when `debug-service` is on. It exists because GNOME 50 removed
`Eval` and locks down screenshots, so there is otherwise no way to assert
from outside that a button really is 44 × 48.

Individual pieces:

```bash
tools/testbed.sh start      # bring the test shell up and leave it running
tools/testbed.sh apps       # launch some apps in it
tools/testbed.sh verify     # geometry checks
tools/testbed.sh shot x.png # screenshot it
tools/testbed.sh errors     # JS errors from its log
tools/testbed.sh stop
```

The test shell can be varied through the environment of `start` (and of
`tools/test-ui.sh`, which starts it):

```bash
TESTBED_MODE=ubuntu tools/test-ui.sh            # Ubuntu's session mode and Yaru, as on the desktop
TESTBED_MONITOR=3840x2160 TESTBED_SCALE=2 tools/testbed.sh start  # a HiDPI screen
TESTBED_MONITOR=3840x2160 TESTBED_SCALE=2 TESTBED_LOGICAL=1 tools/testbed.sh start  # the same, laid out in logical pixels, as Ubuntu does
TESTBED_ANIMATIONS=1 tools/testbed.sh start     # force animations where mutter renders in software
```

The debug service also has a `Trigger` method for the parts that normally
need a click, since the test shell has no pointer:

```bash
gdbus call --session --dest org.gnome.Shell.Extensions.Win11Taskbar \
  --object-path /org/gnome/Shell/Extensions/Win11Taskbar \
  --method org.gnome.Shell.Extensions.Win11Taskbar.Trigger start-menu
```

Where only real input will do, `Trigger` also takes `pointer:<steps>` and
plays them through a Clutter virtual pointer — `{"move": [x, y]}`,
`{"by": [dx, dy]}` (relative, for pushing against a pressure barrier),
`{"press": 3}`, `{"release": 3}`, `{"wait": ms}`. That is what the
context-menu tests use, because GTK's menus react to events, not to API
calls:

```bash
tools/test-context-menu.py      # GTK 3 and GTK 4, nine cases each, then the shell
tools/test-edge-context-menu.py # Edge, with a throwaway profile, one --case at a time
/usr/bin/python3 tools/test-menu-input.py # Start, calendar, account, cards, Resources, motion
/usr/bin/python3 tools/test-task-input.py # actual left clicks and preview dismissal
/usr/bin/python3 tools/test-preview-travel.py # the flyout moving between buttons
/usr/bin/python3 tools/test-shell-menu-passthrough.py # a right click outside a shell menu still lands
/usr/bin/python3 tools/test-notification-centre.py # dismissing, opening, Clear all, notifications kept
/usr/bin/python3 tools/test-wifi-flow.py  # joining a network in place, against a recorder
/usr/bin/python3 tools/test-quick-edit.py # quick settings edited in place: unpin, drag, Add, Done
/usr/bin/python3 tools/test-slider-thumb.py # the sliders' Windows thumb, on a slider that moves nothing
/usr/bin/python3 tools/test-tray-overflow.py # a blinking tray icon, and the overflow's light dismiss
/usr/bin/python3 tools/test-attention.py  # a window asking for attention flashes its button
/usr/bin/python3 tools/test-input-switch.py # Win+Space: the list, Space onward, release to choose
/usr/bin/python3 tools/test-edges.py      # the bar on each edge, at 64 and 32px, and what opens from it
/usr/bin/python3 tools/test-window-animations.py # open, minimise, restore, close a window of its own
/usr/bin/python3 tools/test-snap-layouts.py # Win+Z by keys and pointer, snap assist, dragging to the top
/usr/bin/python3 tools/test-window-frames.py # corners, edge and shadow, measured against the pixels
/usr/bin/python3 tools/test-gtk-window-style.py # the GTK title bar block: written, parsed, taken back
/usr/bin/python3 tools/test-window-mica.py # Mica: over a white window, for dialogs, not for non-GTK windows
/usr/bin/python3 tools/test-shortcuts.py  # key ownership and recovery after logout
node tools/test-ui-lifecycle.mjs          # lifecycle models, not rendering tests
```

## Layout of the source

| File | What lives there |
|---|---|
| `lib/spec.js` | Every measured Windows number. The single source of truth. |
| `lib/clickSemantics.js` | What a gesture means. Pure, no actors, unit-tested. |
| `lib/windows.js` | Which windows a button represents, and in what order; a window GNOME cannot place goes to the app whose process started it. |
| `lib/taskButton.js` | One button: icon, indicator, input, and the flashing of an app that asks for attention. |
| `lib/attentionToasts.js` | GNOME's "is ready" notification, unhooked: Windows flashes the button instead. |
| `lib/taskList.js` | The strip, kept in sync with pinned and running apps. |
| `lib/windowPreview.js` | The thumbnail flyout and Aero Peek. |
| `lib/windowAnimations.js` | Windows 11's window open, close, minimise and restore animations, over GNOME's. |
| `lib/gtkWindowStyle.js` | Windows' title bar buttons and corners for GTK apps, through their user style sheets. |
| `lib/windowMica.js` | Windows 11's Mica below GTK windows: the wallpaper, blurred and tinted. |
| `lib/windowFrames.js` | Windows 11's window corners, edge and shadow, for windows that draw none. |
| `tools/make-window-shadow.py` | Draws `assets/window-shadow.png` from the measured shadow profile. |
| `lib/snapGeometry.js` | Snap layouts as numbers: the layouts, their zones, the tiles and snap assist's grid. Unit-tested. |
| `lib/snapLayouts.js` | Snap layouts: Win+Z, the bar while dragging a window to the top, and snap assist. |
| `lib/jumpList.js` | The right-click menu. |
| `lib/shellButtons.js` | Start, Task View, clock, show-desktop. |
| `lib/glyphs.js` | The Windows-shaped icons, drawn with cairo. |
| `lib/systemFlyouts.js` | Quick settings and the notification centre. |
| `lib/quickSettingsEditor.js` | Editing quick settings in place: Unpin, drag to reorder, Add, Done. |
| `lib/quickTileLayout.js` | Quick settings tiles in Windows' shape. |
| `lib/sliderThumb.js` | The sliders' thumb, as Windows draws it. |
| `lib/theme.js` | Light/dark, followed or pinned. |
| `lib/motion.js` | Durations and curves, and reduce-motion. |
| `lib/quickLinks.js` | The Win+X menu. |
| `lib/clipboardHistory.js` | Win+V, at the pointer. |
| `lib/shortcuts.js` | The rest of the Windows key bindings. |
| `lib/notificationCentre.js` | Notifications and the calendar. |
| `lib/startMenu.js` | The Start menu. |
| `lib/startPins.js` | Start's pinned apps, kept apart from the taskbar's, as on Windows. |
| `lib/inputMethodPanel.js` | The input indicator and its flyout, Fcitx 5 or GNOME's input sources. |
| `lib/inputSwitcher.js` | Win+Space and Shift+Win+Space, taken from GNOME and handed to the input flyout. |
| `lib/rebootTargets.js` | Another extension's "Reboot into…" entries, offered after Restart in Start and Win+X. |
| `lib/notificationList.js` | One flat card per notification, newest first; Clear all, and cards that slide out. |
| `lib/notificationPersistence.js` | Keeping an app's notifications after it quits, as Windows does. |
| `lib/wifiFlow.js` | Joining a Wi-Fi network in place: Connect, then the key in the list. |
| `lib/superKey.js` | Making Super open it instead of the Overview. |
| `lib/statusNotifier.js` | The StatusNotifierItem watcher and host. |
| `lib/dbusMenu.js` | Tray icons' context menus. |
| `lib/trayArea.js` | The notification area and its overflow. |
| `lib/systemIndicators.js` | Borrowing GNOME's Quick Settings in. |
| `lib/panel.js` | The surface, the three zones, struts, theming. |
| `lib/barEdge.js` | Which side things open on, wherever the bar is. Pure geometry, unit-tested. |
| `lib/autoHide.js` | Sliding out of the way behind a pressure barrier. |
| `lib/shellMenus.js` | GNOME Shell's own right-click menus, switched to open on release. |
| `lib/shellShutdown.js` | Knowing the shell is exiting, so teardown leaves GNOME's objects alone. |
| `lib/debugService.js` | Geometry for the tests, a trigger for UI that needs a click, a virtual pointer. Off by default. |
| `patches/` | GTK 3, GTK 4 and mutter patches for the Windows context-menu model, and why. |
| `tools/test-context-menu.py`, `tools/ctxprobe/` | End-to-end test of the GTK menu model with real pointer events. |
| `tools/build-gtk-debs.sh` | Builds the patched GTK packages, amd64 and i386. |
| `tools/edge-context-menu.sh` | Puts Edge's page menus on mouse-up, through its launcher. |
| `tools/testbed-dlopen.c` | Lets the test shell run a locally built libmutter-clutter (`TESTBED_LD_LIBRARY_PATH`). |

Two places lay out children by hand rather than with `Clutter.BinLayout`:
the panel's three zones and the inside of a task button. This is not
stylistic — `BinLayout` ignored the children's `x_align`/`y_align` here, and
both the zone placement and the indicator's 5px offset from the bottom edge
came out wrong until they were allocated explicitly.

`lib/superKey.js` blocks the shell's own `overlay-key` handlers rather than
disconnecting them, because they belong to `overviewControls.js` and we
want them back exactly as they were when the extension is disabled.

## Licence

GPL-3.0-or-later, matching GNOME Shell.
