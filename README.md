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

GNOME's own Quick Settings — network, volume, battery — is moved into the
tray rather than reimplemented, because hiding the top bar would otherwise
take the volume slider with it. It is put back untouched on disable.

**Start menu.** A floating panel above the Start button with a search box,
the pinned grid, recent documents under "Recommended", and a footer with
the real account avatar, shortcuts to Files and Settings, and a power menu
— the row Windows calls Start folders. "All apps" lists GNOME's app folders
as expandable groups first, the way the classic Start menu grouped
programs, then every app under a letter heading. The Super key opens it
instead of the Overview. Right-clicking a tile pins or unpins it.

Measured like everything else: 832 x 864, 13px above the taskbar, an
8-column pinned grid at a 96 x 84 pitch with 32px icons. Note that is the
*new* Start menu — the measurement machine runs Insider build 29671, where
it is 832 wide with 8 columns rather than the 640 and 6 of the shipping
build. `docs/windows-spec.md` explains, including why `TogglePattern` is
the only way to open it from a script.

**The two system flyouts.** Windows 11 keeps these separate, which is worth
saying because Windows 10 did not: quick settings opens from the
network/volume/battery glyphs, the notification centre from the clock.

*Quick settings* is GNOME's own panel, restyled and re-placed: measured at
361 x 408, anchored to the bottom-right corner rather than centred under
its button, no pointer arrow, acrylic, Windows' accent on active tiles and
their chevrons, and a track-and-knob slider instead of GNOME's hairline.
Its contents stay GNOME's deliberately — the Wi-Fi list, Bluetooth, volume
and brightness are NetworkManager, UPower and the mixer, and a
Windows-shaped reimplementation of those would be worse at the part that
matters. Tiles with a sub-page open it the way Windows opens its Wi-Fi
list.

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
thing underneath. There is a setting if you prefer press.

**Also:** a two-line clock, the 12px show-desktop sliver with Windows'
minimise/restore toggle and Aero Peek, per-workspace window filtering
(the Windows virtual-desktop default), multi-monitor support, and an
option to stop reserving space so windows run under the bar.

## What it does not do

Being straight about the gaps:

* **The Start menu matches an Insider build.** The machine measured runs
  build 29671, whose Start menu is the new 832-wide, 8-column design
  rather than the shipping 640/6. If you want the familiar proportions,
  change `START_MENU` in `lib/spec.js` — the layout reads from it.
* **The flyouts' contents are GNOME's.** Their frames, sizes, margins,
  elevation and accent are measured from Windows; the controls inside are
  GNOME's, because they are NetworkManager, UPower and the mixer. The
  tile grid also keeps GNOME's two columns: at 361px, three leave no room
  for a label.
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
  Every menu this extension owns already waits for the release, and so
  do GNOME Shell's own. But a menu inside a GTK application belongs to
  GTK, in that application's process. `patches/` has the two small
  changes that give GTK3 and GTK4 the Windows model, with an
  explanation of exactly what differs; they have to be built and
  installed separately. Chromium and Firefox draw their own menus and
  are unaffected by either.
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

The debug service also has a `Trigger` method for the parts that normally
need a click, since the test shell has no pointer:

```bash
gdbus call --session --dest org.gnome.Shell.Extensions.Win11Taskbar \
  --object-path /org/gnome/Shell/Extensions/Win11Taskbar \
  --method org.gnome.Shell.Extensions.Win11Taskbar.Trigger start-menu
```

## Layout of the source

| File | What lives there |
|---|---|
| `lib/spec.js` | Every measured Windows number. The single source of truth. |
| `lib/clickSemantics.js` | What a gesture means. Pure, no actors, unit-tested. |
| `lib/windows.js` | Which windows a button represents, and in what order. |
| `lib/taskButton.js` | One button: icon, indicator, input. |
| `lib/taskList.js` | The strip, kept in sync with pinned and running apps. |
| `lib/windowPreview.js` | The thumbnail flyout and Aero Peek. |
| `lib/jumpList.js` | The right-click menu. |
| `lib/shellButtons.js` | Start, Task View, clock, show-desktop. |
| `lib/glyphs.js` | The Windows-shaped icons, drawn with cairo. |
| `lib/systemFlyouts.js` | Quick settings and the notification centre. |
| `lib/theme.js` | Light/dark, followed or pinned. |
| `lib/motion.js` | Durations and curves, and reduce-motion. |
| `lib/quickLinks.js` | The Win+X menu. |
| `lib/clipboardHistory.js` | Win+V, at the pointer. |
| `lib/shortcuts.js` | The rest of the Windows key bindings. |
| `lib/notificationCentre.js` | Notifications and the calendar. |
| `lib/startMenu.js` | The Start menu. |
| `lib/superKey.js` | Making Super open it instead of the Overview. |
| `lib/statusNotifier.js` | The StatusNotifierItem watcher and host. |
| `lib/dbusMenu.js` | Tray icons' context menus. |
| `lib/trayArea.js` | The notification area and its overflow. |
| `lib/systemIndicators.js` | Borrowing GNOME's Quick Settings in. |
| `lib/panel.js` | The surface, the three zones, struts, theming. |
| `lib/autoHide.js` | Sliding out of the way behind a pressure barrier. |
| `lib/debugService.js` | Geometry for the tests, plus a trigger for UI that needs a click. Off by default. |

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
