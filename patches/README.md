# Context menus, the Windows way

Not part of the extension. These change GTK, because the behaviour they fix
is GTK's, in each application's own process, and no shell extension can
reach it. The same model is applied to the shell's own menus, to Edge and
to Firefox, each by the means that layer offers; see the table below.

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

## What changes where

| Layer | How | Where |
|---|---|---|
| GTK 3 applications, the DING desktop included | a top-level menu popped up while the right button is down is shown when it is released | `gtk3-windows-context-menu.patch` |
| GTK 4 applications | a popover popped up from a right press is shown on its release; unpaired right releases never click | `gtk4-windows-context-menu.patch` |
| GNOME Shell's own menus (desktop background, app icons) | `recognize-on-press` turned off on their right-click gestures | `lib/shellMenus.js`, setting `context-menu-on-release` |
| This extension's menus | opened on release | `lib/taskButton.js`, `lib/shellButtons.js`, `lib/trayArea.js` |
| Microsoft Edge, page content | `--blink-settings=showContextMenuOnMouseUp=true` through Edge's launcher | `tools/edge-context-menu.sh` |
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

**Unchanged** in both: menus opened with the primary button, including
press-drag-release in menu bars and combo boxes (Windows has that too),
keyboard-opened menus, and touch.

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
  as Edge, one application at a time. Not done.
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
| `menubar` | left-press File, drag onto the first item, release: chosen |

`--gtk3-lib DIR --gtk4-lib DIR` tests a build tree before installing it;
`--expect-original` reports the stock behaviour instead of failing on it.

`tools/test-edge-context-menu.py` does the same for Edge, with a throwaway
profile: when the page sees `mousedown`, `mouseup` and `contextmenu`, when
the menu window appears, and whether a right-drag to the left goes back
without a menu. `--edge /usr/bin/microsoft-edge-dev` tests the installed
launcher.

## Building and installing

```bash
tools/build-gtk-debs.sh          # fetches Ubuntu's source, patches, builds
sudo apt-get install …           # the command it prints at the end
```

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
