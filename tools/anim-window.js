#!/usr/bin/gjs -m
/* A plain GTK 4 window with the title given, for the window tests; it
 * stays until it is closed or killed. --undecorated leaves out GTK's title
 * bar, corners and shadow, as Electron's frameless windows do;
 * --app-id=ID makes it an application's window, which the shell then knows
 * as a GTK app's; --size=WxH sizes it; --fill=COLOUR covers it with that
 * colour below its title bar; --dialog=TITLE opens a modal dialog of that
 * title over it, which is no application's window. */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

const title = ARGV.find(arg => !arg.startsWith('--')) ?? 'Animation probe';
const decorated = !ARGV.includes('--undecorated');
const option = name => ARGV.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const appId = option('app-id');
const [width, height] = (option('size') ?? '400x300').split('x').map(Number);
const fill = option('fill');
const dialogTitle = option('dialog');

function makeWindow(application = null) {
    const window = new Gtk.Window({title, default_width: width, default_height: height, decorated});
    if (application)
        window.application = application;
    if (fill) {
        const provider = new Gtk.CssProvider();
        provider.load_from_string(`.probe-fill { background-color: ${fill}; }`);
        Gtk.StyleContext.add_provider_for_display(window.get_display(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        window.child = new Gtk.Box({css_classes: ['probe-fill'], hexpand: true, vexpand: true});
    }
    window.present();
    if (dialogTitle) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            new Gtk.Window({title: dialogTitle, default_width: 300, default_height: 200,
                transient_for: window, modal: true}).present();
            return GLib.SOURCE_REMOVE;
        });
    }
    return window;
}

if (appId) {
    const app = new Gtk.Application({application_id: appId,
        flags: Gio.ApplicationFlags.NON_UNIQUE});
    app.connect('activate', () => makeWindow(app));
    app.run([]);
} else {
    Gtk.init();
    const loop = new GLib.MainLoop(null, false);
    const window = makeWindow();
    window.connect('close-request', () => {
        loop.quit();
        return false;
    });
    loop.run();
}
