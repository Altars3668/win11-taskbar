#!/usr/bin/env python3
"""GTK3 context-menu probe for tools/test-context-menu.sh.

A maximized window: right-pressing the canvas pops up a GtkMenu at the
pointer, the way GtkEntry and most GTK3 applications do; the File menu bar
above it is the primary-button press-drag-release case that must keep
working. Everything the test asserts on is a line on stdout.
"""
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


win = Gtk.Window(title='ctxprobe3')
win.connect('destroy', Gtk.main_quit)
box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
bar = Gtk.MenuBar()
file_item = Gtk.MenuItem(label='File')
file_item.set_submenu(build_menu())
bar.append(file_item)
box.pack_start(bar, False, False, 0)

canvas = Gtk.EventBox()
box.pack_start(canvas, True, True, 0)
win.add(box)

context = build_menu()
context.connect('deactivate', lambda *_: log('CLOSED'))
context.connect('map', lambda *_: log('SHOWN'))


def pressed(_widget, event):
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
    log('READY', loaded_gtk())
    return False


win.maximize()
win.show_all()
GLib.timeout_add(800, ready)
Gtk.main()
