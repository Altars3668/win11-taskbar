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

**Also:** Start and Task View buttons, a two-line clock, the 12px
show-desktop sliver with Windows' minimise/restore toggle, per-workspace
window filtering (the Windows virtual-desktop default), multi-monitor
support, light/dark following the desktop preference, and an acrylic blur
behind the bar.

## What it does not do

Being straight about the gaps:

* **No system tray icons.** GNOME has no XEmbed tray; status icons come from
  the AppIndicator protocol. Install
  [AppIndicator Support](https://extensions.gnome.org/extension/615/appindicator-support/)
  for those — this extension does not try to host them.
* **No drag-to-reorder.** Windows lets you drag task buttons around. Pinned
  order currently follows GNOME's favourites list, which you can reorder from
  the app grid.
* **No search box or widgets panel.** They have no GNOME equivalent worth
  faking, so the zones they would occupy are simply empty.
* **Hover and pressed fills are not measured.** Pointer injection on the
  measurement machine was blocked by UIPI, so these two colours come from the
  published Fluent palette instead. Everything else is measured.
* **Multi-window stacking is approximate.** Every app on the measurement
  machine had one window, so the visual for a group of two or more was never
  captured.

## Install

```bash
git clone https://git.altarscn.com/Geoffrey/win11-taskbar.git
cd win11-taskbar
make install      # or: ln -s "$PWD" ~/.local/share/gnome-shell/extensions/win11-taskbar@altarscn.com
gnome-extensions enable win11-taskbar@altarscn.com
```

On Wayland you have to log out and back in for the shell to pick up a new
extension; on X11, `Alt+F2` then `r` is enough.

Requires GNOME Shell 48, 49 or 50.

## Settings

`gnome-extensions prefs win11-taskbar@altarscn.com`, or the Extensions app.
Screen edge, centre/left alignment, auto-hide, which elements to show,
per-monitor and per-workspace filtering, clock format, Aero Peek, and
whether to hide GNOME's own top bar (on by default — Windows has one bar).

## Testing

```bash
tools/test.sh
```

Runs, in order: a syntax check of every module; the click-semantics unit
tests; a schema compile; and then the real thing — it starts a headless
GNOME Shell on a 1920 × 1080 virtual monitor, the same size as the Windows
machine, with its own D-Bus and its own config so your session is untouched,
launches a couple of apps, checks the log for JS errors, and diffs the
rendered geometry against the Windows measurements.

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
| `lib/panel.js` | The surface, the three zones, struts, theming. |
| `lib/autoHide.js` | Sliding out of the way behind a pressure barrier. |
| `lib/debugService.js` | Read-only geometry for the tests. Off by default. |

Two places lay out children by hand rather than with `Clutter.BinLayout`:
the panel's three zones and the inside of a task button. This is not
stylistic — `BinLayout` ignored the children's `x_align`/`y_align` here, and
both the zone placement and the indicator's 5px offset from the bottom edge
came out wrong until they were allocated explicitly.

## Licence

GPL-3.0-or-later, matching GNOME Shell.
