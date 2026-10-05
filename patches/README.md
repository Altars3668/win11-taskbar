# Context menus, the Windows way

Not part of the extension. These change GTK and mutter, because the
behaviour they fix is GTK's, in each application's own process, or the
compositor's, and no shell extension can reach either. The same model is
applied to the shell's own menus, to Edge and to Firefox, each by the means
that layer offers; see the table below.

## What the difference actually is

GTK follows the X11 **press-drag-release** model:

> press opens the menu → drag to an item → release chooses it

One press completes the whole selection. Windows takes **two steps**:

> press does nothing → release opens the menu → menu stays → a second,
> separate click chooses

Two things follow for someone arriving from Windows. The menu appears
before they expect it, while the button is still down. And they let go as
soon as it appears, which on GTK chooses whatever item is under the
pointer. GTK 3 has a 500 ms guard against that last part, but clears it on
purpose as soon as the pointer moves into an item; GTK 4 has none.

Holding the menu back until the release fixes both at once: there is no
release left to choose with.

The third difference is how a menu goes away. On Windows a press outside an
open context menu closes it and still lands: a right click elsewhere opens
a menu there in one click, a left click elsewhere acts there. GTK and the
shell spend that press on closing the menu, so the next right click is
needed to open one where you meant.

## What changes where

| Layer | How | Where |
|---|---|---|
| GTK 3 applications, the DING desktop included | a top-level menu popped up while the right button is down is shown when it is released; a press outside a context menu closes it and still lands | `gtk3-windows-context-menu.patch` |
| GTK 4 applications | a popover popped up from a right press is shown on its release; unpaired right releases never click; a press outside a context menu closes it and still lands | `gtk4-windows-context-menu.patch` |
| GNOME Shell's own menus (desktop background, app icons) | `recognize-on-press` turned off on their right-click gestures; a right click outside an open menu reaches what it landed on | `lib/shellMenus.js`, setting `context-menu-on-release` |
| This extension's menus | opened on release | `lib/taskButton.js`, `lib/shellButtons.js`, `lib/trayArea.js` |
| Microsoft Edge, page content | `--blink-settings=showContextMenuOnMouseUp=true` through Edge's launcher | `tools/edge-context-menu.sh` |
| The compositor, for every Wayland client | a press outside a popup closes it and still lands — where the toolkit does not do it itself, as Chromium on Linux does not, and on other windows and the shell | `mutter-windows-popup-press.patch` |
| Firefox | `ui.context_menus.after_mouseup` in the profile's `user.js` | per profile |

## How the GTK patches work

**GTK 3.** `gtk_main_do_event()` follows the secondary button in event
order: down on its press, up on its release, and corrected from the button
mask on other presses and on motion, so a release that never arrived cannot
leave it stuck. `gtk_menu_popup_internal()` holds a top-level menu back
while the button is down — the arguments, the position function and its
data — and `gtk_main_do_event()` shows it once the release has been
dispatched, so the application's own release handlers have run first.
Another press, `gtk_menu_popdown()` on that menu, or a drag starting from
the press cancels it.

Event order rather than the device's state, because the release can reach
GDK before the press has been dispatched. Not only the popup's own event,
because GtkEntry, GtkTextView and GtkLabel pop up from a clipboard callback
that can run after the press handler has returned.

**GTK 4.** `gtk_popover_popup()` called while `gtk_main_do_event()` is
dispatching a press of the secondary button holds the popover back, and it
is shown once that button's release has been dispatched. Another press,
`gtk_popover_popdown()` or `GtkDragSource` starting a drag cancels it.
GTK 4 has no asynchronous popups like GTK 3's, so the event being
dispatched is an exact test and no state needs following.

GtkModelButton also ignores unpaired releases of the secondary button.
GtkGestureClick emits `unpaired-release` before its button filter runs, so
without this the release of a right press that opened a menu some other
way would still choose the item under the pointer.

**A press outside a context menu.** In GTK 3, during a menu's grab GDK
reports such a press on the menu's own window, at coordinates outside it,
and the menu shell spends it on closing. `gtk_main_do_event()` now asks the
device which window the pointer is really over; if that is not inside the
context menu, the menu is cancelled as Escape would cancel it, and a copy
of the press is dispatched to that window.

In GTK 4 the press is spent earlier, in GDK: `check_autohide()` hides the
autohide popups and consumes the event. It now lets a button press on
another of the application's surfaces through, and `gtk_main_do_event()`
pops the popover down synchronously before routing the press — GDK hides
the surface from an idle, so the popover's grab would still be in place.

Only context menus pass the press on: menus shown on a secondary-button
release. A menu dropped down from a button keeps it, as before, so a click
on that button closes its menu instead of opening it again.

**Unchanged** in both: menus opened with the primary button, including
press-drag-release in menu bars and combo boxes (Windows has that too),
keyboard-opened menus, and touch.

## The shell's menus

`lib/shellMenus.js` does the shell's half while `context-menu-on-release`
is on. GNOME Shell 50 recognises right clicks on the desktop background and
on app icons with a `ClickGesture` that has `recognize-on-press` set; it is
turned off on those gestures, existing and new.

A right click outside an open `PopupMenu` closes the menu and stops there.
Putting a copy of the press back on Clutter's queue does not help while the
button is down: Clutter sends a held button's events where its press went,
which is the menu. So an event filter — filters run before grabs — waits
for the release and then puts press and release back together; the menu
has gone by then, and both reach what is under the pointer. Menu managers
bind the shell's handler when a menu is added, so the extension wraps it
before it builds its taskbars. Left clicks keep the shell's behaviour.

## The compositor

A press outside a popup is the compositor's to deliver, and mutter spends
it. Under a popup grab it only ends the grab: a press on the client's own
window still reaches the client while the client believes its menu is
open, and a press on another window or on the shell is lost. Chromium's
context menus take no grab at all, so a press on the page goes to the page,
where its menu controller closes the menu and drops the press — on Windows
the same controller reposts it. A right click elsewhere still seems to work,
because the page opens a new menu on the release, but the page never saw
the press: a mouse gesture started with the menu open does not start, and a
left click on a link only closes the menu. (`--use-wayland-explicit-grab`
makes Chromium take grabs, but mutter then gives the popup keyboard focus,
which Chromium reads as its window going inactive, and the menu closes as
soon as it opens.)

`mutter-windows-popup-press.patch` holds such a press, takes the popups
down with `popup_done`, and once the client has destroyed them, or after
200 ms, puts the press back with anything that arrived meanwhile, so it
reaches what is under the pointer — the page, another window, the taskbar.
A menu dropped down from a button still takes a press on that button as
closing it. Of the popups that take no grab, only those hung from a single
point under a toplevel are covered: Chromium's and Electron's context
menus, not tooltips, completion lists or dropdowns, which must survive a
press elsewhere. The client takes its menu down itself, submenus first;
unmapping the parent first would be a protocol error.

A press that arrives while the stage is grabbed — a popup grab is a stage
grab — has already been counted by Clutter as the start of an implicit grab
on the grab's actor. Put back as it is, it would be counted twice, and after
the release Clutter would still believe a button is down and stop
delivering pointer events to the shell. No client notices that, so it is
easy to miss. The patch drops the stale grab first with
`clutter_stage_maybe_lost_implicit_grab`, which it exports from
libmutter-clutter.

It is patch 08 of this machine's mutter package, applied with quilt to
Ubuntu's source like the others there; the copy here is for reference.
`TESTBED_LD_LIBRARY_PATH=DIR tools/testbed.sh start` runs the test shell
on a libmutter and libmutter-clutter built from the patched tree, without
installing them.

## What is not covered

- **Edge's own chrome** — tabs, the toolbar, bookmarks. Those are views
  menus, and `kContextMenuOnMousePress` in `ui/views/view.cc` is a
  `constexpr`, true everywhere but Windows, with no switch. Their menu
  controller ignores a release only within 200 ms and 4 DIP of the press.
  Page content, where nearly all right clicks and every mouse gesture
  happen, is covered.
- **Qt applications.** Qt 5 has no switch; Qt 6.8 has
  `QStyleHints::contextMenuTrigger`, set by the platform theme. The only Qt
  program running here is the Nextcloud client, and its tray menu is drawn
  by this extension.
- **Electron applications** would take the same `--blink-settings` switch
  as Edge, one application at a time, to open menus on release. Not done.
  A press outside their context menus lands, through the compositor.
- Applications that build menus from something other than GtkMenu or
  GtkPopover.

## Testing

`tools/test-context-menu.py` runs the probes in `tools/ctxprobe/` inside
the headless test shell (`tools/testbed.sh start`) and drives them with a
virtual pointer through the debug service, so GTK sees real press, motion
and release events. For each of GTK 3 and GTK 4:

| case | what the Windows model requires |
|---|---|
| `drag` | right-press, drag to where the first item will be, release: no menu until the release, nothing chosen, menu stays; a left click then chooses |
| `quick` | right click in place: menu on release; a left click on the item chooses it |
| `hold` | right-press held 800 ms: no menu until the release, then it stays |
| `dismiss` | right click, then a left click far away: the menu closes and chooses nothing — so a menu shown after the release still holds its popup grab |
| `reopen` | right click, then a right click somewhere else: the menu closes and a new one opens there, in that one click |
| `passthrough` | right click, then a left click somewhere else: the menu closes and the click still reaches what is under it |
| `shell` | right click, then a left click on the Start button: the menu closes and Start opens, in that one click (the compositor patch) |
| `dropdown` | click a menu button, then click it again: its menu opens once and closes, and does not reopen |
| `menubar` | left-press File, drag onto the first item, release: chosen |

After the cases, a click on the Start button with nothing open must still
open Start, which is how a stale implicit grab in the shell shows up.

`--gtk3-lib DIR --gtk4-lib DIR` tests a build tree before installing it;
`--expect-original` reports the stock behaviour instead of failing on it;
`--taskbar` checks the shell's half on the taskbar instead: right-click one
task button, then another, and the second jump list opens in that click
(after `tools/testbed.sh apps`).

`tools/test-edge-context-menu.py` does the same for Edge, with a throwaway
profile: when the page sees `mousedown`, `mouseup` and `contextmenu`, when
the menu window appears, whether a right-drag to the left goes back
without a menu. With a menu open first, `--case reopen` checks that a
right click elsewhere reaches the page and opens a new menu there,
`gesture-after-menu` that a right-drag elsewhere is still a gesture,
`left-after-menu` that a left click elsewhere reaches the page,
`menu-item` that a click on an item still chooses it, and
`start-after-menu` that a click on the Start button opens Start. The cases
after a menu need the compositor patch. `--edge
/usr/bin/microsoft-edge-dev` tests the installed launcher.

## Building and installing

```bash
tools/build-gtk-debs.sh          # fetches Ubuntu's source, patches, builds
JOBS=12 tools/build-gtk-debs.sh  # faster, when the machine is otherwise idle
sudo apt-get install …           # the command it prints at the end
```

It runs at idle priority with 4 jobs by default, which also caps each LTO
link at 4 processes: at full width the LTO links fan out to one process
per CPU each, and the machine runs out of memory.

It versions the packages `<ubuntu version>+altarscnN` and builds every
package of both sources for amd64, plus `libgtk-3-0t64` for i386 in an
i386 chroot when that is installed: Multi-Arch: same requires the i386 copy
to carry exactly the amd64 version, shared files included.

`/etc/apt/preferences.d/altarscn-gtk.pref` pins `+altarscn` versions of
these packages at 1001, so an Ubuntu update does not silently replace them.
The trade-off is the one `altarscn.pref` already makes for mutter: a GTK
update from Ubuntu, security fixes included, arrives only by running
`tools/build-gtk-debs.sh` again. Running applications keep the old library
until they restart.

To go back to Ubuntu's GTK:

```bash
sudo rm /etc/apt/preferences.d/altarscn-gtk.pref
sudo apt-get install --allow-downgrades \
    libgtk-3-0t64=3.24.52-0ubuntu1 libgtk-3-0t64:i386=3.24.52-0ubuntu1 \
    libgtk-3-bin=3.24.52-0ubuntu1 libgtk-3-common=3.24.52-0ubuntu1 \
    libgtk-3-dev=3.24.52-0ubuntu1 gir1.2-gtk-3.0=3.24.52-0ubuntu1 \
    libgtk-4-1=4.22.4+ds-0ubuntu0.1 libgtk-4-bin=4.22.4+ds-0ubuntu0.1 \
    libgtk-4-common=4.22.4+ds-0ubuntu0.1 libgtk-4-dev=4.22.4+ds-0ubuntu0.1 \
    gir1.2-gtk-4.0=4.22.4+ds-0ubuntu0.1 gtk-update-icon-cache=4.22.4+ds-0ubuntu0.1
tools/edge-context-menu.sh uninstall
```
