#!/usr/bin/python3
"""GTK4 context-menu probe for tools/test-context-menu.sh.

A maximized window: right-pressing the canvas pops up a PopoverMenu at the
pointer, the way GtkText and Nautilus do; the File menu bar above it is the
primary-button press-drag-release case that must keep working. Everything
the test asserts on is a line on stdout.
"""
import gi
gi.require_version('Gtk', '4.0')
gi.require_version('Gdk', '4.0')
from gi.repository import Gdk, Gio, GLib, Gtk

ITEMS = ('first', 'second', 'third')

# Items far larger than Adwaita's, so 'move into the first item' does not
# depend on padding, shadows or where exactly the popover lands.
CSS = b'popover.menu modelbutton { min-height: 120px; min-width: 300px; }'


def log(*args):
    print(*args, flush=True)


def loaded_gtk():
    with open('/proc/self/maps') as maps:
        for line in maps:
            if 'libgtk-4.so' in line:
                return line.split()[-1]
    return '?'


def watch_hover(widget, label):
    """Log when a menu item becomes the one under the pointer."""
    def changed(w, _old):
        if w.get_state_flags() & Gtk.StateFlags.PRELIGHT:
            log('HOVER', label)
    widget.connect('state-flags-changed', changed)


def model_buttons(root):
    child = root.get_first_child()
    while child:
        if child.__gtype__.name == 'GtkModelButton':
            yield child
        yield from model_buttons(child)
        child = child.get_next_sibling()


class Probe(Gtk.Application):
    def __init__(self):
        super().__init__(application_id='org.w11.CtxProbe4',
                         flags=Gio.ApplicationFlags.NON_UNIQUE)

    def do_activate(self):
        menu = Gio.Menu()
        for name in ITEMS:
            action = Gio.SimpleAction.new(name, None)
            action.connect('activate', lambda *_a, n=name: log('ACTIVATED', n))
            self.add_action(action)
            menu.append(name.capitalize(), f'app.{name}')
        bar_menu = Gio.Menu()
        bar_menu.append_submenu('File', menu)

        win = Gtk.ApplicationWindow(application=self, title='ctxprobe4')
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        header = Gtk.Box()
        header.append(Gtk.PopoverMenuBar.new_from_model(bar_menu))
        # A drop-down button: its menu must keep the press that closes it,
        # or a second click on the button would open the menu again.
        drop = Gtk.MenuButton(label='Drop', menu_model=menu)
        header.append(drop)
        box.append(header)
        canvas = Gtk.Box(hexpand=True, vexpand=True)
        box.append(canvas)
        win.set_child(box)

        # Raw input as GTK sees it, for when a case goes wrong.
        raw = Gtk.EventControllerLegacy()
        raw.set_propagation_phase(Gtk.PropagationPhase.CAPTURE)
        def on_event(_c, event):
            kind = event.get_event_type()
            if kind in (Gdk.EventType.BUTTON_PRESS, Gdk.EventType.BUTTON_RELEASE):
                log('EV', kind.value_nick, event.get_button())
            return False
        raw.connect('event', on_event)
        win.add_controller(raw)

        popover = Gtk.PopoverMenu.new_from_model(menu)
        popover.set_parent(canvas)
        popover.set_has_arrow(False)
        popover.connect('closed', lambda *_: log('CLOSED'))
        popover.connect('map', lambda *_: log('SHOWN'))

        def pressed(_gesture, _n, x, y):
            rect = Gdk.Rectangle()
            rect.x, rect.y, rect.width, rect.height = int(x), int(y), 1, 1
            popover.set_pointing_to(rect)
            popover.popup()
            log('POPUP')
            for button in model_buttons(popover):
                watch_hover(button, button.get_property('text'))

        any_button = Gtk.GestureClick(button=0)
        any_button.connect('pressed', lambda g, *_: log('PRESS', g.get_current_button()))
        canvas.add_controller(any_button)

        gesture = Gtk.GestureClick(button=Gdk.BUTTON_SECONDARY)
        gesture.connect('pressed', pressed)
        canvas.add_controller(gesture)

        css = Gtk.CssProvider()
        css.load_from_data(CSS, -1)
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), css,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)

        def ready():
            item = box.get_first_child().get_first_child().get_first_child()
            while item and 'Item' not in item.__gtype__.name:
                item = item.get_first_child()
            ok, b = item.compute_bounds(win)
            sx, sy = win.get_surface_transform()
            log('GEOM file', int(b.origin.x + sx), int(b.origin.y + sy),
                int(b.size.width), int(b.size.height))
            # The menu bar builds its menus up front, so its items can be
            # watched now; the context menu's are watched as it pops up.
            for button in model_buttons(header):
                watch_hover(button, button.get_property('text'))
            ok, b = drop.compute_bounds(win)
            log('GEOM drop', int(b.origin.x + sx), int(b.origin.y + sy),
                int(b.size.width), int(b.size.height))
            drop.get_popover().connect('map', lambda *_: log('DROP SHOWN'))
            drop.get_popover().connect('closed', lambda *_: log('DROP CLOSED'))
            log('READY', loaded_gtk())
            return False

        win.maximize()
        win.present()
        GLib.timeout_add(800, ready)


Probe().run([])
