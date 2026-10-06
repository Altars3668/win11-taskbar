/* wifiFlow.js — joining a Wi-Fi network the way Windows 11 does.
 *
 * GNOME connects the moment a network in the list is clicked, and for a
 * secured network it does not know, asks for the key in a modal dialog over
 * the whole screen — "Authentication required", with a padlock, which reads
 * as the system wanting an administrator's password. Windows opens the
 * network in place first, with "Connect automatically" and a Connect
 * button. A secured network then asks for its key right there in the list,
 * and the connection is made with the key already in it, so nothing else
 * has to ask for it.
 *
 * Who may use a new connection follows GNOME's own rule: everyone when the
 * user may change the system's connections (polkit lets local
 * administrators here), otherwise only this user — which never needs an
 * administrator, and keeps the key in the user's keyring.
 *
 * The details are a plain actor below the network's item rather than a
 * menu item: GNOME keeps the list sorted by moving its items about, and
 * counts only menu items when it does. After each move the details are put
 * back under their network.
 */
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import NM from 'gi://NM';
import Polkit from 'gi://Polkit';
import St from 'gi://St';

import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';
import {CheckBox} from 'resource:///org/gnome/shell/ui/checkBox.js';

const Sec = NM.UtilsSecurityType;

/* The key management a new connection gets, for the kinds of network this
 * joins itself. WEP, LEAP and enterprise networks go GNOME's way. */
const KEY_MGMT = new Map([
    [Sec.NONE, null],
    [Sec.OWE, 'owe'],
    [Sec.WPA_PSK, 'wpa-psk'],
    [Sec.WPA2_PSK, 'wpa-psk'],
    [Sec.SAE, 'sae'],
]);

/* What talks to NetworkManager. Tests swap in a recorder, so trying the
 * flow joins nothing. */
const defaultConnector = {
    activate: (client, connection, device) =>
        client.activate_connection_async(connection, device, null, null, null),
    addAndActivate: (client, connection, device, apPath) =>
        client.add_and_activate_connection_async(connection, device, apPath, null, null),
    deactivate: (client, active) => client.deactivate_connection_async(active, null, null),
    update: connection => connection.commit_changes_async(true, null, null),
};
let connector = defaultConnector;

/**
 * Replace what talks to NetworkManager, or put the real one back.
 *
 * @param {object|null} replacement methods as in defaultConnector
 */
export function setWifiConnector(replacement) {
    connector = replacement ?? defaultConnector;
}

function mayShareConnections() {
    try {
        return Polkit.Permission.new_sync(
            'org.freedesktop.NetworkManager.settings.modify.system', null, null)?.get_allowed() ?? false;
    } catch {
        return false;
    }
}

/**
 * A connection for a network not known yet, with its key in it;
 * NetworkManager fills in the rest from the access point.
 *
 * @param {object} options what to put in it
 * @returns {NM.SimpleConnection} the connection
 */
export function newConnection({keyMgmt, password, autoconnect, shared, user}) {
    const connection = new NM.SimpleConnection();
    const setting = new NM.SettingConnection({autoconnect});
    if (!shared)
        setting.add_permission('user', user, null);
    connection.add_setting(setting);
    if (keyMgmt) {
        const security = new NM.SettingWirelessSecurity({key_mgmt: keyMgmt});
        if (password) {
            security.psk = password;
            if (!shared)
                security.psk_flags = NM.SettingSecretFlags.AGENT_OWNED;
        }
        connection.add_setting(security);
    }
    return connection;
}

function validKey(keyMgmt, key) {
    if (keyMgmt === 'sae')
        return key.length > 0;
    return (key.length >= 8 && key.length <= 63) || /^[0-9a-fA-F]{64}$/.test(key);
}

export class WifiFlow {
    /**
     * @param {object} toggle the Wi-Fi quick toggle whose page is showing
     * @param {Function} gettext the extension's gettext
     */
    constructor(toggle, gettext = s => s) {
        this._ = gettext;
        this._sections = new Map();
        this._items = new Map();
        this._open = null;
        for (const deviceItem of toggle._items?.values() ?? [])
            this._watch(deviceItem);
    }

    _watch(deviceItem) {
        const section = deviceItem.section;
        if (!section || this._sections.has(section))
            return;
        const flow = this;
        const record = {
            add: section.addMenuItem, ownAdd: Object.hasOwn(section, 'addMenuItem'),
            move: section.moveMenuItem, ownMove: Object.hasOwn(section, 'moveMenuItem'),
        };
        record.wrappedAdd = function (item, position) {
            const result = record.add.call(this, item, position);
            flow._patch(item);
            return result;
        };
        record.wrappedMove = function (item, position) {
            // Positions count menu items only, as the details are not one.
            record.move.call(this, item, position);
            flow._anchor();
        };
        section.addMenuItem = record.wrappedAdd;
        section.moveMenuItem = record.wrappedMove;
        this._sections.set(section, record);
        for (const item of deviceItem._networkItems?.values() ?? [])
            this._patch(item);
    }

    _patch(item) {
        if (!item?.network || this._items.has(item))
            return;
        // Clicking, or Enter, opens the network in place instead.
        item.activate = () => this._toggleItem(item);
        this._items.set(item, item.connect('destroy', () => {
            this._items.delete(item);
            if (this._open?.item === item)
                this._collapse();
        }));
    }

    get openNetwork() {
        return this._open?.network.name ?? null;
    }

    _toggleItem(item) {
        const same = this._open?.item === item;
        this._collapse();
        if (!same)
            this._expand(item);
    }

    _expand(item) {
        const box = item.get_parent();
        if (!box)
            return;
        const details = new St.BoxLayout({style_class: 'w11-wifi-details',
            orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        box.insert_child_above(details, item);
        item.add_style_class_name('w11-wifi-open');
        this._open = {item, details, network: item.network};
        // A network low in the list opens below the fold; Windows scrolls
        // what it opened into view, and again when it grows for the key.
        // Scrolling by hand moves the list, not the details' allocation.
        details.connect('notify::allocation', () => this._reveal(details));
        this._fill();
    }

    _reveal(details) {
        let view = details.get_parent();
        while (view && !(view instanceof St.ScrollView))
            view = view.get_parent();
        if (!view)
            return;
        try {
            ensureActorVisibleInScrollView(view, details);
        } catch {
            // Taken out of the list meanwhile.
        }
    }

    _collapse() {
        const open = this._open;
        if (!open)
            return;
        this._open = null;
        open.item.remove_style_class_name('w11-wifi-open');
        open.details.destroy();
    }

    _anchor() {
        const open = this._open;
        if (open && open.details.get_previous_sibling() !== open.item)
            open.item.get_parent()?.set_child_above_sibling(open.details, open.item);
    }

    _status(network) {
        if (network.is_active)
            return network.secure ? this._('Connected, secured') : this._('Connected');
        return network.secure ? this._('Secured') : this._('Open');
    }

    _button(label, accent, callback) {
        const button = new St.Button({label, can_focus: true,
            style_class: accent ? 'w11-wifi-button w11-wifi-accent' : 'w11-wifi-button'});
        button.connect('clicked', callback);
        return button;
    }

    /* The first step: whether to join automatically, and Connect — or, for
     * the network in use, Disconnect. */
    _fill() {
        const {details, network} = this._open;
        details.destroy_all_children();
        details.add_child(new St.Label({text: this._status(network), style_class: 'w11-wifi-status'}));
        const row = new St.BoxLayout({style_class: 'w11-wifi-actions', x_expand: true});
        if (network.is_active) {
            row.add_child(new St.Widget({x_expand: true}));
            row.add_child(this._button(this._('Disconnect'), false, () => this._disconnect()));
        } else {
            // The box on a line of its own, Connect under it to the right.
            const automatic = new CheckBox(this._('Connect automatically'));
            const [known] = network._connections ?? [];
            automatic.checked = known?.get_setting_connection()?.autoconnect ?? true;
            automatic.x_align = Clutter.ActorAlign.START;
            details.add_child(automatic);
            row.add_child(new St.Widget({x_expand: true}));
            row.add_child(this._button(this._('Connect'), true, () => this._connect(automatic.checked)));
            this._open.automatic = automatic;
        }
        details.add_child(row);
    }

    /* The second step for a secured network not known yet: its key. */
    _askKey(keyMgmt, autoconnect) {
        const {details} = this._open;
        details.destroy_all_children();
        details.add_child(new St.Label({text: this._('Enter the network security key'),
            style_class: 'w11-wifi-status'}));
        const entry = new St.PasswordEntry({style_class: 'w11-wifi-key', can_focus: true,
            x_expand: true, show_peek_icon: true});
        details.add_child(entry);
        // Next and Cancel share the width, as on Windows.
        const row = new St.BoxLayout({style_class: 'w11-wifi-actions', x_expand: true});
        const submit = () => {
            if (validKey(keyMgmt, entry.text))
                this._join({keyMgmt, password: entry.text, autoconnect});
        };
        const next = this._button(this._('Next'), true, submit);
        const cancel = this._button(this._('Cancel'), false, () => this._fill());
        next.x_expand = cancel.x_expand = true;
        row.add_child(next);
        row.add_child(cancel);
        details.add_child(row);
        const sync = () => {
            const valid = validKey(keyMgmt, entry.text);
            next.reactive = valid;
            next.can_focus = valid;
            if (valid)
                next.remove_style_pseudo_class('insensitive');
            else
                next.add_style_pseudo_class('insensitive');
        };
        entry.clutter_text.connect('text-changed', sync);
        entry.clutter_text.connect('activate', submit);
        sync();
        this._open.entry = entry;
        entry.grab_key_focus();
    }

    _connect(autoconnect) {
        const {item, network} = this._open;
        const device = network._device;
        const [known] = network._connections ?? [];
        if (known) {
            // The box is the saved connection's own setting, as on Windows.
            const setting = known.get_setting_connection();
            if (setting && setting.autoconnect !== autoconnect) {
                setting.autoconnect = autoconnect;
                connector.update(known);
            }
            connector.activate(device.client, known, device);
            this._collapse();
            return;
        }
        const keyMgmt = KEY_MGMT.get(network._securityType);
        if (keyMgmt === undefined) {
            // Not a kind this joins itself: let GNOME's own handler have it.
            this._collapse();
            Object.getPrototypeOf(item).activate.call(item, null);
            return;
        }
        if (keyMgmt === 'wpa-psk' || keyMgmt === 'sae')
            this._askKey(keyMgmt, autoconnect);
        else
            this._join({keyMgmt, password: null, autoconnect});
    }

    _join({keyMgmt, password, autoconnect}) {
        const {network} = this._open;
        const device = network._device;
        const ap = network._bestAp ?? [...network._accessPoints ?? []][0];
        if (!ap) {
            this._collapse();
            return;
        }
        const connection = newConnection({keyMgmt, password, autoconnect,
            shared: mayShareConnections(), user: GLib.get_user_name()});
        connector.addAndActivate(device.client, connection, device, ap.get_path());
        this._collapse();
    }

    _disconnect() {
        const device = this._open.network._device;
        if (device?.active_connection)
            connector.deactivate(device.client, device.active_connection);
        this._collapse();
    }

    destroy() {
        this._collapse();
        for (const [item, id] of this._items) {
            item.disconnect(id);
            delete item.activate;
        }
        this._items.clear();
        for (const [section, record] of this._sections) {
            for (const [name, wrapper, original, own] of [
                ['addMenuItem', record.wrappedAdd, record.add, record.ownAdd],
                ['moveMenuItem', record.wrappedMove, record.move, record.ownMove],
            ]) {
                if (section[name] !== wrapper)
                    continue;
                if (own)
                    section[name] = original;
                else
                    delete section[name];
            }
        }
        this._sections.clear();
    }
}
