#!/usr/bin/python3
"""An undecorated X11 window, white all over, for the window tests: as
WeChat's main window is — no title bar of mutter's, no shadow of its own,
so mutter draws one round it. Run with GDK_BACKEND=x11 and the test shell's
DISPLAY; --size=WxH in X pixels (400x300). It stays until closed or killed."""
import sys

import gi
gi.require_version('Gtk', '3.0')
gi.require_version('Gdk', '3.0')
from gi.repository import Gdk, Gtk  # noqa: E402

args = [arg for arg in sys.argv[1:] if not arg.startswith('--size=')]
size = next((arg[7:] for arg in sys.argv[1:] if arg.startswith('--size=')), '400x300')
window = Gtk.Window(title=args[0] if args else 'X11 probe')
window.set_decorated(False)
window.set_default_size(*map(int, size.split('x')))
fill = Gtk.EventBox()
fill.override_background_color(Gtk.StateFlags.NORMAL, Gdk.RGBA(1, 1, 1, 1))
window.add(fill)
window.connect('destroy', Gtk.main_quit)
window.show_all()
Gtk.main()
