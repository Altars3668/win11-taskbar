#!/usr/bin/gjs -m
/* 隔离总线上的输入法模型；不连接或修改真实 Fcitx。 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
let current = 'keyboard-us';
const xml = `<node><interface name="org.fcitx.Fcitx.Controller1">
<method name="CurrentInputMethodGroup"><arg type="s" direction="out"/></method>
<method name="InputMethodGroupInfo"><arg type="s" direction="in"/><arg type="s" direction="out"/><arg type="a(ss)" direction="out"/></method>
<method name="AvailableInputMethods"><arg type="a(ssssssb)" direction="out"/></method>
<method name="CurrentInputMethod"><arg type="s" direction="out"/></method>
<method name="SetCurrentIM"><arg type="s" direction="in"/></method>
<method name="Configure"/>
</interface></node>`;
const controller = {
    CurrentInputMethodGroup() { return 'Test'; },
    InputMethodGroupInfo() { return ['us', [['keyboard-us', ''], ['rime', '']]]; },
    AvailableInputMethods() { return [['keyboard-us','English (US)','English (US)','input-keyboard','en','keyboard',false],
        ['rime','Rime','中州韵','rime','zh_CN','rime',true]]; },
    CurrentInputMethod() { return current; },
    SetCurrentIM(id) { current = id; },
    Configure() {},
};
Gio.bus_own_name(Gio.BusType.SESSION, 'org.fcitx.Fcitx5', Gio.BusNameOwnerFlags.NONE,
    connection => Gio.DBusExportedObject.wrapJSObject(xml, controller).export(connection, '/controller'),
    () => print('READY'), () => {});
new GLib.MainLoop(null, false).run();
