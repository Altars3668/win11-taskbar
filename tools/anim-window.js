#!/usr/bin/gjs -m
/* A plain GTK 4 window with the title given, for the window animation
 * test; it stays until it is closed or killed. */
import Gtk from 'gi://Gtk?version=4.0';
import GLib from 'gi://GLib';

Gtk.init();
const loop = new GLib.MainLoop(null, false);
const window = new Gtk.Window({title: ARGV[0] ?? 'Animation probe', default_width: 400,
    default_height: 300});
window.connect('close-request', () => {
    loop.quit();
    return false;
});
window.present();
loop.run();
