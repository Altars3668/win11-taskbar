#!/usr/bin/python3
"""GTK 应用的 Windows 11 标题栏；只在隔离 testbed 中运行（只写 testbed 的配置目录）。

打开开关：~/.config/gtk-3.0 与 gtk-4.0 的 gtk.css 里各加一段带标记的样式，标题栏图标放在
旁边自己的文件夹里，GNOME 的按钮布局加上最小化、最大化并记下原值；原有的用户样式原样保留。
GTK 3 与 GTK 4 应用启动时不报样式解析错误，打开云母后加上的那段也一样。在正常会话里停用扩展
会撤掉这些改动，重新启用会写回；关掉开关后文件恢复原样、按钮布局恢复。
"""
import importlib.util
import os
import subprocess
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

UUID = 'win11-taskbar@altarscn.com'
BEGIN = 'win11-taskbar: Windows 11 title bars — begin'
USER_CSS = '/* the user\'s own */\nlabel.mine { color: red; }\n'
WINDOWS = 'appmenu:minimize,maximize,close'

GTK3_APP = r'''
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
w = Gtk.Window(title='GTK3 title bar')
bar = Gtk.HeaderBar(show_close_button=True, title='GTK3 title bar')
w.set_titlebar(bar)
w.set_default_size(420, 260)
w.connect('destroy', Gtk.main_quit)
w.show_all()
Gtk.main()
'''


def main():
    shell = ctx.Shell()
    config = Path(ctx.RUN, 'config')
    env = dict(os.environ, XDG_CONFIG_HOME=str(config), DBUS_SESSION_BUS_ADDRESS=shell.address)
    schema = 'org.gnome.shell.extensions.win11-taskbar'
    ours = ['gsettings', '--schemadir', str(HERE.parent / 'schemas')]
    count = 0
    processes = []
    css3, css4 = config / 'gtk-3.0' / 'gtk.css', config / 'gtk-4.0' / 'gtk.css'
    saved = {path: path.read_text() if path.exists() else None for path in (css3, css4)}

    def gsettings(*args, schema_dir=False):
        command = (ours if schema_dir else ['gsettings']) + list(args)
        return subprocess.run(command, env=env, check=True, capture_output=True, text=True).stdout.strip()

    def layout():
        return gsettings('get', 'org.gnome.desktop.wm.preferences', 'button-layout').strip("'")

    def check(label, predicate, timeout=6):
        nonlocal count
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (OSError, subprocess.CalledProcessError):
                pass
            time.sleep(0.1)
        raise AssertionError(label)

    def has_block(path):
        return path.exists() and BEGIN in path.read_text()

    def run_app(args, title):
        app_env = dict(os.environ, WAYLAND_DISPLAY='w11test', GDK_BACKEND='wayland',
                       XDG_CONFIG_HOME=str(config), NO_AT_BRIDGE='1')
        app_env.pop('DISPLAY', None)
        process = subprocess.Popen(args, env=app_env, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE, text=True)
        processes.append(process)
        time.sleep(2.5)
        shell.trigger('window-close:' + title)
        try:
            _, err = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.terminate()
            _, err = process.communicate(timeout=5)
        return err

    try:
        gsettings('set', schema, 'gtk-window-style', 'false', schema_dir=True)
        gsettings('set', 'org.gnome.desktop.wm.preferences', 'button-layout', "'appmenu:close'")
        css4.parent.mkdir(parents=True, exist_ok=True)
        css4.write_text(USER_CSS)
        css3.unlink(missing_ok=True)

        gsettings('set', schema, 'gtk-window-style', 'true', schema_dir=True)
        check('打开：GTK 3 与 GTK 4 的 gtk.css 都有带标记的一段', lambda: has_block(css3) and has_block(css4))
        check('用户原有的样式原样保留在前面', lambda: css4.read_text().startswith(USER_CSS))
        check('标题栏图标在各自的文件夹里', lambda: all(
            (config / d / 'win11-taskbar' / f'{n}-symbolic.svg').exists()
            for d in ('gtk-3.0', 'gtk-4.0') for n in ('minimize', 'maximize', 'restore', 'close')))
        check('按钮布局变成最小化、最大化、关闭，并记下原值', lambda: layout() == WINDOWS and
              gsettings('get', schema, 'gtk-window-style-layout', schema_dir=True) == "'appmenu:close'")

        err4 = run_app(['gjs', '-m', str(HERE / 'anim-window.js'), 'GTK4 title bar'], 'GTK4 title bar')
        assert 'Theme parser' not in err4 and 'gtk.css' not in err4, err4
        count += 1
        print('ok GTK 4 应用读样式表不报错', flush=True)
        err3 = run_app(['/usr/bin/python3', '-c', GTK3_APP], 'GTK3 title bar')
        assert 'Theme parser' not in err3 and 'gtk.css' not in err3, err3
        count += 1
        print('ok GTK 3 应用读样式表不报错', flush=True)

        # 云母那一段（GTK 4 里有深色的媒体查询）也不能让两边报错。
        gsettings('set', schema, 'gtk-mica', 'true', schema_dir=True)
        check('打开云母：两份 gtk.css 都加上半透明的窗口底色',
              lambda: 'alpha(@theme_bg_color' in css3.read_text() and 'prefers-color-scheme' in css4.read_text()
              and 'prefers-color-scheme' not in css3.read_text())
        err4 = run_app(['gjs', '-m', str(HERE / 'anim-window.js'), 'GTK4 title bar'], 'GTK4 title bar')
        err3 = run_app(['/usr/bin/python3', '-c', GTK3_APP], 'GTK3 title bar')
        for err in (err4, err3):
            assert 'Theme parser' not in err and 'gtk.css' not in err, err
        count += 1
        print('ok 带云母的样式表 GTK 3 与 GTK 4 读来都不报错', flush=True)
        gsettings('set', schema, 'gtk-mica', 'false', schema_dir=True)
        check('关掉云母：那一段撤掉', lambda: 'alpha(@theme_bg_color' not in css4.read_text() and
              'alpha(@theme_bg_color' not in css3.read_text())

        # 正常会话里停用扩展：改动随之撤掉；启用后写回。
        subprocess.run(['gnome-extensions', 'disable', UUID], env=env, check=True)
        check('停用扩展：样式与图标撤掉，按钮布局恢复', lambda: not has_block(css3) and not has_block(css4) and
              css4.read_text() == USER_CSS and not css3.exists() and layout() == 'appmenu:close')
        subprocess.run(['gnome-extensions', 'enable', UUID], env=env, check=True)
        check('再启用：又写回', lambda: has_block(css3) and has_block(css4) and layout() == WINDOWS, timeout=12)

        gsettings('set', schema, 'gtk-window-style', 'false', schema_dir=True)
        check('关掉开关：gtk.css 恢复原样，没有残留文件夹', lambda: css4.read_text() == USER_CSS and
              not css3.exists() and not (config / 'gtk-4.0' / 'win11-taskbar').exists() and
              not (config / 'gtk-3.0' / 'win11-taskbar').exists())
        check('按钮布局恢复', lambda: layout() == 'appmenu:close' and
              gsettings('get', schema, 'gtk-window-style-layout', schema_dir=True) == "''")
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        gsettings('reset', schema, 'gtk-mica', schema_dir=True)
        gsettings('reset', schema, 'gtk-window-style', schema_dir=True)
        time.sleep(0.5)
        for path, text in saved.items():
            if text is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(text)
        gsettings('reset', 'org.gnome.desktop.wm.preferences', 'button-layout')
    text = Path(ctx.RUN, 'shell.log').read_text(errors='replace')
    for marker in ('JS ERROR', 'Exception in callback', 'Clutter-CRITICAL', 'St-CRITICAL', 'Gjs-CRITICAL'):
        assert marker not in text, marker
    print(f'{count} 项 GTK 标题栏检查通过，0 项失败', flush=True)


if __name__ == '__main__':
    main()
