#!/usr/bin/gjs -m
/* 在隔离桌面构造真正的 Adw 偏好窗口，检查可选入口和按程序名折叠。 */
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio.resources_register(Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource'));
const root = Gio.File.new_for_path(ARGV[0]);
const {default: Preferences} = await import(root.get_child('prefs.js').get_uri());
const {ExtensionPreferences} = await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
const source = Gio.SettingsSchemaSource.new_from_directory(root.get_child('schemas').get_path(),
    Gio.SettingsSchemaSource.get_default(), false);
const settings = new Gio.Settings({settings_schema: source.lookup('org.gnome.shell.extensions.win11-taskbar', false)});
const app = new Adw.Application({application_id: 'org.example.W11PreferencesTest'});
let failure = null;
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, default_width: 740, default_height: 800});
    const prefs = new Preferences({uuid: 'win11-taskbar@altarscn.com', path: root.get_path(), dir: root,
        'gettext-domain': 'win11-taskbar'});
    // 独立测试进程没有 ExtensionService 的加载上下文，只补上当前实例的解析。
    ExtensionPreferences.lookupByUUID = uuid => uuid === prefs.uuid ? prefs : null;
    prefs.getSettings = () => settings;
    const busCall = prefs._busCall.bind(prefs);
    prefs._busCall = (...params) => busCall(...params).catch(error => {
        printerr(`偏好总线调用 ${params[3]} 失败：${error.message}`);
        throw error;
    });
    const madeSwitches = [];
    const arraySwitch = prefs._arraySwitch.bind(prefs);
    prefs._arraySwitch = (...params) => {
        const row = arraySwitch(...params);
        madeSwitches.push(row);
        return row;
    };
    const pages = [];
    for (const method of ['_startPage', '_trayPage']) {
        const original = prefs[method].bind(prefs);
        prefs[method] = value => {
            const page = original(value);
            pages.push(page);
            return page;
        };
    }
    prefs.fillPreferencesWindow(window);
    window.present();
    const switches = [];
    const spins = [];
    const walk = widget => {
        if (widget instanceof Adw.SwitchRow)
            switches.push(widget);
        if (widget instanceof Adw.SpinRow)
            spins.push(widget);
        for (let child = widget.get_first_child(); child; child = child.get_next_sibling())
            walk(child);
    };
    let attempts = 0;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        switches.length = 0;
        spins.length = 0;
        pages.forEach(walk);
        switches.push(...madeSwitches);
        const tray = switches.find(row => row.title === 'Test item (tray-alpha)');
        if (!tray && attempts++ < 60)
            return GLib.SOURCE_CONTINUE;
        try {
            if (!tray)
                printerr(`已创建的数组开关：${JSON.stringify(madeSwitches.map(row => row.title))}`);
            if (!tray)
                throw new Error('没有从 StatusNotifierWatcher 取得按程序名列出的托盘开关');
            const resources = switches.find(row => row.title === 'Task Manager');
            const downloads = switches.find(row => row.title === 'Downloads');
            if (!resources || !downloads)
                throw new Error('开始菜单可选入口未创建');
            resources.active = true;
            downloads.active = true;
            tray.active = true;
            if (!settings.get_strv('start-folders').includes('resources') ||
                !settings.get_strv('start-folders').includes('downloads') ||
                !settings.get_strv('tray-hidden-items').includes('tray-alpha'))
                throw new Error('设置开关没有写入相应的数组值');
            resources.active = false;
            if (settings.get_strv('start-folders').includes('resources'))
                throw new Error('关闭入口开关后没有取消选择');
            // 开始菜单自定义大小：只在选了“自定义大小”时出现，数值直接写入设置。
            const width = spins.find(row => row.title === 'Width');
            const height = spins.find(row => row.title === 'Height');
            if (!width || !height)
                throw new Error('没有开始菜单的宽、高数字框');
            settings.set_string('start-layout', 'compact');
            if (width.visible || height.visible)
                throw new Error('非自定义大小时仍显示宽、高');
            settings.set_string('start-layout', 'custom');
            if (!width.visible || !height.visible)
                throw new Error('选自定义大小后没有显示宽、高');
            width.value = 1000;
            height.value = 900;
            if (settings.get_int('start-width') !== 1000 || settings.get_int('start-height') !== 900)
                throw new Error('宽、高没有写入设置');
            settings.reset('start-layout');
            settings.reset('start-width');
            settings.reset('start-height');
            window.close();
            if (prefs._cleanup.length !== 0)
                throw new Error('关闭偏好窗口后仍保留设置/总线监听');
            print('偏好窗口、按程序名折叠、入口选择、开始菜单自定义大小与关闭清理检查通过，0 项失败');
        } catch (error) {
            failure = error;
            printerr(error.stack);
        }
        app.quit();
        return GLib.SOURCE_REMOVE;
    });
});
await app.runAsync([]);
if (failure)
    throw failure;
