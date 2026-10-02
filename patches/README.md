# Context menus, the Windows way

These are not part of the extension. They change GTK, because the
behaviour they fix is GTK's and no shell extension can reach it.

## What the difference actually is

GTK follows the X11 **press-drag-release** model:

> press opens the menu → drag to an item → release chooses it

One press completes the whole selection. Windows uses **two steps**:

> press does nothing → release opens the menu → menu stays → a second
> click chooses

So someone arriving from Windows lets go of the right button as soon as
the menu appears — and on GTK that release selects whatever item is
under the pointer.

GTK3 knows this surprises people: `gtk_menu_shell_button_release`
already ignores a release within `MENU_SHELL_TIMEOUT` (500 ms) of the
menu opening. The patch raises that guard past any plausible press.

GTK4 dropped `GtkMenuShell` entirely, and with it that guard.
`GtkModelButton` connects to `unpaired-release` — a release with no
matching press, which is precisely the release that opened the menu —
and treats it as a click, unconditionally. The patch ignores it.

Both are small on purpose: one constant, one function body. Neither
touches ordinary clicks (which have a matching press) or keyboard
activation.

## What they do not cover

**Chromium and Firefox draw their own menus.** Edge, Chrome and Firefox
are unaffected by either patch, because neither uses GTK's menu widgets
for their context menus. If a right-drag gesture misbehaves there, it is
that application's own handling.

**GNOME Shell is already fine.** `popupMenu.js` has no button-release
handling at all, so the shell's own menus — and this extension's — have
always used the Windows model.

## Applying them

They are written against the versions this was tested on:

| patch | version |
|---|---|
| `gtk3-windows-context-menu.patch` | gtk+3.0 3.24.52 |
| `gtk4-windows-context-menu.patch` | gtk4 4.22.4 |

```bash
apt-get source gtk4
cd gtk4-*/
patch -p1 < .../patches/gtk4-windows-context-menu.patch
# then build and install however you build your own packages
```

Rebuilding GTK replaces a library every graphical application on the
machine loads. It wants a package you can roll back, not `make install`
over the top of the distribution's copy.
