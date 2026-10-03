/* shellMenus.js — the shell's own context menus open on release too.
 *
 * GNOME Shell 50 recognises a right click on the desktop background and on
 * app icons (the overview, the app grid, and docks built from AppIcon) with
 * a Clutter.ClickGesture that has recognize-on-press set, so those menus
 * open on press: the Linux model. Windows opens a context menu on release.
 * GTK applications get the same change from patches/; this is the shell's
 * half.
 *
 * It turns recognize-on-press off on those gestures — the ones that exist
 * now and the ones created later — and back on when destroyed. Only
 * secondary-button gestures are touched: the top bar has a press gesture
 * of its own, on any button, for dragging windows, and that has to stay.
 */

import Clutter from 'gi://Clutter';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

function pressGestures(actor) {
    return actor.get_actions().filter(action =>
        action instanceof Clutter.ClickGesture &&
        action.required_button === Clutter.BUTTON_SECONDARY &&
        action.recognize_on_press);
}

export class ShellMenus {
    constructor() {
        this._changed = new Set();

        // Everything that exists already.
        this._walk(global.stage);

        // App icons made from now on, including subclasses in docks.
        const proto = AppDisplay.AppIcon.prototype;
        const originalInit = proto._init;
        const release = actor => this._release(actor);
        proto._init = function (...args) {
            originalInit.apply(this, args);
            release(this);
        };
        this._restoreInit = () => {
            proto._init = originalInit;
        };

        // Background actors are replaced whenever the background changes.
        // Managers created from now on call this method; the ones that exist
        // already bound the original, so they get a handler of their own.
        const layout = Main.layoutManager;
        const originalAdd = layout._addBackgroundMenu;
        layout._addBackgroundMenu = manager => {
            originalAdd.call(layout, manager);
            this._release(manager.backgroundActor);
        };
        this._managerIds = (layout._bgManagers ?? []).map(manager => [manager,
            manager.connect('changed', () => this._release(manager.backgroundActor))]);
    }

    _walk(actor) {
        this._release(actor);
        for (const child of actor.get_children())
            this._walk(child);
    }

    _release(actor) {
        if (!actor)
            return;
        for (const gesture of pressGestures(actor)) {
            gesture.recognize_on_press = false;
            this._changed.add(gesture);
        }
    }

    destroy() {
        this._restoreInit();
        delete Main.layoutManager._addBackgroundMenu;
        for (const [manager, id] of this._managerIds) {
            if (manager.backgroundActor)
                manager.disconnect(id);
        }
        this._managerIds = [];

        // Gestures whose actor has gone are left alone.
        for (const gesture of this._changed) {
            if (gesture.actor)
                gesture.recognize_on_press = true;
        }
        this._changed.clear();
    }
}
