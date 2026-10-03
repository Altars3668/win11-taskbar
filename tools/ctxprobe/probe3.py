#!/usr/bin/python3
"""GTK3 context-menu probe for tools/test-context-menu.sh.

A maximized window: right-pressing the canvas pops up a GtkMenu at the
pointer, the way GtkEntry and most GTK3 applications do; the File menu bar
above it is the primary-button press-drag-release case that must keep
working. Everything the test asserts on is a line on stdout.
"""
import os

import gi
gi.require_version('Gtk', '3.0')
from gi.repository import GLib, Gtk

ITEMS = ('first', 'second', 'third')

# Items far larger than Adwaita's, so 'move into the first item' does not
# depend on padding, shadows or where exactly the menu lands.
CSS = b'menu menuitem { min-height: 120px; min-width: 300px; }'


def log(*args):
    print(*args, flush=True)


def loaded_gtk():
    with open('/proc/self/maps') as maps:
        for line in maps:
            if 'libgtk-3.so' in line:
                return line.split()[-1]
    return '?'


def build_menu():
    menu = Gtk.Menu()
    for name in ITEMS:
        item = Gtk.MenuItem(label=name.capitalize())
        item.connect('activate', lambda _i, n=name: log('ACTIVATED', n))
        item.connect('select', lambda _i, n=name: log('HOVER', n.capitalize()))
        menu.append(item)
    menu.show_all()
    return menu


# PROBE_RAW=1 logs every button event GDK delivers, before GTK routes it.
if os.environ.get('PROBE_RAW'):
    from gi.repository import Gdk

    def raw(event, _data=None):
        if event.type in (Gdk.EventType.BUTTON_PRESS, Gdk.EventType.BUTTON_RELEASE):
            owner = event.window.get_toplevel() if event.window else None
            pointer = event.get_device()
            under, ux, uy = pointer.get_window_at_position() if pointer else (None, 0, 0)
            log('RAW', event.type.value_nick, event.button.button,
                'toplevel', 'menu' if owner and owner.get_type_hint() in (
                    Gdk.WindowTypeHint.POPUP_MENU, Gdk.WindowTypeHint.DROPDOWN_MENU) else 'app',
                f'at {event.x:.0f},{event.y:.0f} root {event.x_root:.0f},{event.y_root:.0f}',
                f'window-size {event.window.get_width()}x{event.window.get_height()}',
                'under:', under.get_toplevel().get_type_hint().value_nick if under else None,
                f'{ux:.0f},{uy:.0f}')
        Gtk.main_do_event(event)
    Gdk.event_handler_set(raw)

win = Gtk.Window(title='ctxprobe3')
win.connect('destroy', Gtk.main_quit)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
bar = Gtk.MenuBar()
file_item = Gtk.MenuItem(label='File')
file_item.set_submenu(build_menu())
bar.append(file_item)
header = Gtk.Box()
header.pack_start(bar, False, False, 0)
# A drop-down button: its menu must keep the press that closes it, or a
# second click on the button would open the menu again.
drop = Gtk.MenuButton(label='Drop')
drop_menu = build_menu()
drop_menu.connect('map', lambda *_: log('DROP SHOWN'))
drop_menu.connect('deactivate', lambda *_: log('DROP CLOSED'))
drop.set_popup(drop_menu)
header.pack_start(drop, False, False, 0)
box.pack_start(header, False, False, 0)

canvas = Gtk.EventBox()
box.pack_start(canvas, True, True, 0)
win.add(box)

context = build_menu()
context.connect('deactivate', lambda *_: log('CLOSED'))
context.connect('map', lambda *_: log('SHOWN'))


def pressed(_widget, event):
    log('PRESS', event.button)
    if event.button == 3:
        context.popup_at_pointer(event)
        log('POPUP')
        return True
    return False


canvas.connect('button-press-event', pressed)
css = Gtk.CssProvider()
css.load_from_data(CSS)
Gtk.StyleContext.add_provider_for_screen(
    win.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)


def ready():
    x, y = file_item.translate_coordinates(win, 0, 0)
    a = file_item.get_allocation()
    log('GEOM file', x, y, a.width, a.height)
    x, y = drop.translate_coordinates(win, 0, 0)
    a = drop.get_allocation()
    log('GEOM drop', x, y, a.width, a.height)
    log('READY', loaded_gtk())
    return False


win.maximize()
win.show_all()
GLib.timeout_add(800, ready)
Gtk.main()
