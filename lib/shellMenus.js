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
 *
 * It also passes on a right click made outside an open menu. On Windows
 * that click closes the menu and still lands, so whatever is under the
 * pointer opens its own menu in the same click. The shell closes the menu
 * and stops: the press went to the menu's grab, not to what it landed on.
 * Left clicks keep the shell's behaviour.
 */

import Clutter from 'gi://Clutter';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/* Hand a right press that closed a menu on to what it landed on. The
 * button is still down, and Clutter sends a held button's events where its
 * press went — the menu — so a copy put back now would go there too. Wait
 * for the release and put back press and release together: the menu has
 * gone by then, and both reach what is under the pointer. A Windows context
 * menu opens on the release anyway. */
function replayOnRelease(press) {
    const held = press.copy();
    // An event filter, because nothing on the stage sees that release: it
    // goes down the menu's grab, and filters run before grabs.
    const id = Clutter.Event.add_filter(global.stage, event => {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS) {
            // Another button went down first; leave that one alone.
            Clutter.Event.remove_filter(id);
            return Clutter.EVENT_PROPAGATE;
        }
        if (type !== Clutter.EventType.BUTTON_RELEASE ||
            event.get_button() !== Clutter.BUTTON_SECONDARY)
            return Clutter.EVENT_PROPAGATE;
        Clutter.Event.remove_filter(id);
        held.put();
        event.put();
        return Clutter.EVENT_STOP;
    });
}

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

        // A right click outside an open menu: the shell closes the menu,
        // then the click goes on to what it landed on. Menu managers bind
        // this method when a menu is added, so this covers the menus made
        // from now on.
        const managerProto = PopupMenu.PopupMenuManager.prototype;
        const originalCaptured = managerProto._onCapturedEvent;
        managerProto._onCapturedEvent = function (actor, event) {
            const outside = event.type() === Clutter.EventType.BUTTON_PRESS &&
                event.get_button() === Clutter.BUTTON_SECONDARY &&
                !actor.contains(global.stage.get_event_actor(event));
            const result = originalCaptured.call(this, actor, event);
            if (!outside)
                return result;
            replayOnRelease(event);
            return Clutter.EVENT_STOP;
        };
        this._restoreCaptured = () => {
            managerProto._onCapturedEvent = originalCaptured;
        };
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
        this._restoreCaptured();
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
