# Behavior and measurement notes

[English README](../README.md) · [简体中文说明](../README.zh-CN.md) · [Development](development.md)

The extension reproduces selected Windows 11 interactions while preserving GNOME's application and service model. The reference machine ran Windows 11 Insider build 29671 at 1920×1080 and 100% scale. Exact measurements and collection limits are in [windows-spec.md](windows-spec.md).

## Layout and task buttons

The application strip is centered on the screen midpoint, not the remaining space between widgets and the tray. A setting changes it to left alignment. The default bar is 48 logical pixels thick; application buttons are 44×48, their icons 24×24.

A running but unfocused application has a 6px gray indicator. The focused application's indicator grows to 18px, uses the accent color, and sits 5px above the bar's lower edge. These metrics are collected in [`lib/spec.js`](../lib/spec.js) and checked against real rendered actors.

The bar can occupy any screen edge, including upright left/right layouts not offered by Windows 11. Flyouts open on the inward side of the bar. Taskbar thickness can be changed from 32 to 96 logical pixels. Per-workspace and per-monitor filtering, auto-hide and reservation of screen space are configurable.

## Previews and jump lists

Resting the pointer on a task button opens live window thumbnails after 400ms, the reference machine's `MouseHoverTime`. Hovering a thumbnail dims other windows for Aero Peek. Clicking activates the window; the close button and middle-click close it.

Right-click opens the application's jump list: recent documents, desktop-file actions, a new-instance entry, pin/unpin and close actions. Recent documents come from the user's `recently-used.xbel` rather than importing GTK into the Shell process.

The extension's context menus normally open on button release. A right-drag is treated as a gesture instead of opening a menu. Application-owned menus cannot be changed by an extension alone; the optional [GTK/Mutter patches](../patches/README.md) address those separately.

## Tray and shared system button

The extension implements a StatusNotifierItem host and owns `org.kde.StatusNotifierWatcher`. A second host, such as AppIndicator Support, conflicts with it.

Tray glyphs are 16×16 inside 32×48 cells. DBusMenu context menus, scrolling and middle-click are forwarded to the originating application. Individual icons can be placed in an overflow panel. Its chevron turns half a turn as the panel opens and back when it closes, in approximately 210ms.

Network, volume and battery share **one** hover and pressed surface. Every glyph opens the same quick-settings panel. The native indicators retain their original event behavior; they are not converted into separate hover buttons. When there is no battery, GNOME's substitute power-off icon is hidden. Power actions remain in Start and Quick Link.

The show-desktop control keeps a 12px-wide end region. Its separator is drawn by an independent, non-reactive actor rather than relying on a single CSS border on `St.Button`. The 1px line is inset by 8px at both ends and turns horizontal for upright bars. Clicking toggles minimizing/restoring windows; resting the pointer offers desktop peek.

## Start and search

Start contains its own pinned applications, recent documents, All Apps, account actions, selectable folder shortcuts and power actions. Its pin list is distinct from the taskbar's favorites.

The default compact layout uses six columns within a 640×720 panel, bounded by the monitor's work area. An eight-column option preserves the earlier 832×864 Insider measurement. A custom size changes the number of columns and rows. These layouts are not claimed to match every released Windows Start menu.

The taskbar search control has four styles:

| Style | Default-size geometry |
| --- | --- |
| Hidden | No search cell |
| Icon only | 44×48 cell, 24px glyph |
| Icon and label | 106×48 cell, centered 98×32 pill |
| Search box | 224×48 cell, 216×32 pill |

The box does not include Windows' daily search-highlight picture. A click opens Start with keyboard focus in its search field. If the extension's Start menu is off, it opens GNOME search. Upright taskbars display only the icon, unless search is hidden.

## Quick settings and notifications

GNOME's real quick settings is reused, styled and positioned near the taskbar's end. Cards are arranged in three columns; each has a 96×48 surface and labels below. Linux-specific controls can change the panel's total height.

A card with a submenu is a **connected split control**. The toggle and arrow share the outer border, fill, hover and keyboard-focus surface. A short internal separator identifies the two actions without cutting the outer frame into two buttons. The toggle changes the native state; the arrow opens the native feature's subpage. The original controls and layout are restored when the extension is disabled.

Cards can be removed, added and reordered in the panel's edit mode. This is separate from taskbar application-button reordering, which is not implemented.

Quick settings contains no generic shutdown row. A Custom Reboot extension's reboot targets, when available, appear in Start and Quick Link after Restart and still execute through that extension.

The notification center opens from the clock, separately from quick settings. It presents notification cards above the calendar and supports dismissal and clearing without discarding an application's notifications when that application exits.

## Window effects and GTK integration

Window animations adjust GNOME's own effects rather than replacing window management. The reference measurements suggested roughly 200ms for opening, 150ms for closing and 220ms for minimizing/restoring. Animation duration respects the desktop's reduced-motion setting.

Normal windows and dialogs receive rounded corners, an edge and a measured shadow profile. GTK, Chromium/Electron and undecorated X11 windows lose their own out-of-frame shadows where the frame effect clips them. Fullscreen/maximized windows do not get the floating-window effect.

GTK title-bar styling is **off by default**. Turning it on writes a marked, removable block to GTK 3/4 user CSS and saves the GNOME window-button layout. Existing applications usually need restarting. Unrelated CSS is preserved. Lock-screen extension suspension does not rewrite the user's files.

Mica is a second, separately enabled option requiring the GTK title-bar style. It shows a heavily blurred and tinted wallpaper, not the windows underneath. Application content overlays remain opaque where appropriate. GTK 3 does not expose the per-application dark-theme distinction to these styles; its tint strength uses the light setting. See [`lib/windowMica.js`](../lib/windowMica.js) for the implementation and [`lib/gtkWindowStyle.js`](../lib/gtkWindowStyle.js) for the CSS.

## Snap layouts and assist

`Super+Z` opens six layouts over the focused window. A number chooses a layout, the next a zone; the mouse can select a zone directly.

Resting the pointer on a recognized maximize button opens layouts under it after approximately 900ms. Leaving both the button and the panel closes it after 200ms. Because applications draw their own buttons, this depends on toolkit-specific geometry. [`captionButtons.js`](../lib/captionButtons.js) recognizes styled GTK 3/4, Chromium and Electron windows using measurements from the isolated testbed.

Dragging near the top of the monitor, below the layout strip's width, reveals the strip. Dragging to a side chooses that half; corners choose quarters; the rest of the top chooses maximization. Entry/exit hysteresis follows the measured pointer thresholds in [`snapGeometry.js`](../lib/snapGeometry.js).

All of these drag targets use one preview style: a blurred backdrop, tint, thin edge, rounded corners and a shadow below the dragged window. The preview grows out of the window, pauses briefly before switching targets, and shrinks back when no target is selected. It leaves 8px at work-area boundaries but does not create gaps between adjacent snap zones. Escape cancels dragging instead of snapping.

Once a zone is filled, snap assist offers windows for remaining zones. Escape or an outside click dismisses the assist.

GNOME's own edge tiling is temporarily disabled while this extension owns the edges and restored on teardown. If Ubuntu's Tiling Assistant is active, edges stay with it instead. The extension never silently disables that other extension.

Windows' suggested snap groups, top-edge peek strip and shrinking of the dragged window while over the strip are not implemented. Dark-mode preview tint is an approximation rather than a fresh Windows measurement.

## Materials and input

Acrylic is implemented as a clipped material layer sampling background/window clones, with tint and noise above it and shadows outside the material. It does not sample a framebuffer already containing itself. Hidden materials release clones and stop per-frame subscriptions.

`Super+Space` advances input sources and marks the next choice. Pressing Space repeatedly moves the highlight; Shift moves backward; releasing Super accepts. Both GNOME input sources and Fcitx 5 groups are supported. A Fcitx D-Bus query does not auto-start the service.

Clipboard history is polled because Shell exposes no clipboard-changed signal. Choosing an entry releases the grab before synthesizing paste into the previously focused application. Terminals use `Ctrl+Shift+V`.
