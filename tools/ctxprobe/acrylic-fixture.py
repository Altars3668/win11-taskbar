#!/usr/bin/python3
"""只画合成背景，不打开真实文件；SIGUSR1 切换颜色供材质采样测试。"""
import signal
import gi

gi.require_version('Gtk', '4.0')
from gi.repository import Gtk, GLib

phase = 0
area = None


def draw(_area, cr, width, height):
    for y in range(0, height, 48):
        for x in range(0, width, 48):
            if phase:
                color = (0.03, 0.65, 0.12) if (x // 48 + y // 48) % 2 else (0.10, 0.22, 0.10)
            else:
                color = (0.92, 0.08, 0.04) if (x // 48 + y // 48) % 2 else (0.02, 0.15, 0.92)
            cr.set_source_rgb(*color)
            cr.rectangle(x, y, 48, 48)
            cr.fill()


def change():
    global phase
    phase = 1 - phase
    area.queue_draw()
    return GLib.SOURCE_CONTINUE


def activate(app):
    global area
    window = Gtk.ApplicationWindow(application=app, title='W11 Acrylic Fixture',
                                   default_width=1600, default_height=900)
    area = Gtk.DrawingArea(hexpand=True, vexpand=True)
    area.set_draw_func(draw)
    window.set_child(area)
    window.maximize()
    window.present()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGUSR1, change)
    print('READY', flush=True)


app = Gtk.Application(application_id='org.example.W11AcrylicFixture')
app.connect('activate', activate)
app.run([])
