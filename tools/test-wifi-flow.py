#!/usr/bin/python3
"""快捷面板 Wi-Fi 子页的 Windows 式加入流程；只用测试替身，不连接任何真实网络。

点网络先在原地展开（自动连接、连接），不直接连接，也不弹密钥框；加密的新网络在
列表里输入密钥，连接带着密钥建立；已保存的网络按它的设置连接；当前网络可断开；
企业网络仍交给 GNOME 自己处理。发往 NetworkManager 的请求全部由调试服务记录，
不会真的发出。
"""
import getpass
import importlib.util
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('ctx', HERE / 'test-context-menu.py')
ctx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctx)

KEY = 'correcthorse'


def main():
    shell = ctx.Shell()
    count = 0

    def dump():
        r = shell.conn.call_sync(ctx.BUS, ctx.OBJ, ctx.BUS, 'DumpGeometry', None,
                                 ctx.GLib.VariantType('(s)'), ctx.Gio.DBusCallFlags.NONE, 10000, None)
        return json.loads(r.unpack()[0])['bars'][0]

    def wifi():
        page = dump()['quickSettings']['page']
        return page and page['wifi']

    def network(name):
        return next(n for n in wifi()['networks'] if n['name'] == name)

    def control(label):
        return next(b for b in wifi()['buttons'] if b['label'] == label)

    def state():
        return json.loads(shell.trigger('state'))

    def records():
        return state()['wifiRecords']

    def check(label, predicate):
        nonlocal count
        end = time.monotonic() + 8
        while time.monotonic() < end:
            try:
                if predicate():
                    count += 1
                    print('ok ' + label, flush=True)
                    return
            except (StopIteration, TypeError, KeyError):
                pass
            time.sleep(0.08)
        raise AssertionError(f'{label}: {state()}')

    def click(rect):
        shell.pointer([{'move': [rect['x'] + rect['w'] / 2, rect['y'] + rect['h'] / 2]},
                       {'wait': 60}, {'press': 1}, {'wait': 80}, {'release': 1}, {'wait': 350}])

    def type_text(text):
        steps = []
        for char in text:
            steps += [{'press': ord(char)}, {'wait': 20}, {'release': ord(char)}, {'wait': 20}]
        shell.trigger('keys:' + json.dumps(steps))
        time.sleep(len(text) * 0.05 + 0.3)

    shell.trigger('windows')
    shell.pointer([{'move': [960, 500]}, {'wait': 300}])
    shell.pointer([{'move': [960, 520]}, {'wait': 300}])
    try:
        shell.trigger('wifi-record')
        shell.trigger('quick-settings')
        time.sleep(0.8)
        shell.trigger('test-wireless-toggle')
        time.sleep(0.4)
        shell.trigger('test-wireless-open')
        check('Wi-Fi 子页列出测试网络', lambda: {n['name'] for n in wifi()['networks']} ==
              {'Current', 'Home-5G', 'Cafe', 'Office', 'Corp'})

        click(network('Home-5G'))
        check('点加密的新网络只在原地展开：不连接、不弹密钥框',
              lambda: wifi()['open'] == 'Home-5G' and wifi()['detailsBelowItem'] and
              not records() and network('Home-5G')['gnomeActivations'] == 0)
        check('展开处是“已加密”、默认勾选的“自动连接”和“连接”',
              lambda: wifi()['status'] == 'Secured' and control('Connect automatically')['checked']
              and control('Connect')['visible'])
        click(control('Connect'))
        check('点“连接”后在列表里要密钥，仍未发起连接', lambda: wifi()['entry'] and not records())
        type_text('short')
        check('密钥不足 8 位时“下一步”不可用', lambda: not control('Next')['reactive'])
        type_text('horse')
        check('密钥够长后“下一步”可用', lambda: control('Next')['reactive'])
        click(control('Next'))
        user = getpass.getuser()
        check('带着密钥建立连接，权限与密钥存放方式一致', lambda: records() and
              records()[-1]['method'] == 'addAndActivate' and records()[-1]['apPath'] == '/test/ap/Home-5G' and
              records()[-1]['keyMgmt'] == 'wpa-psk' and records()[-1]['psk'] == 'short' + 'horse' and
              records()[-1]['autoconnect'] is True and
              (records()[-1]['permissions'], records()[-1]['pskFlags']) in (([], 0), ([f'user:{user}'], 1)))
        check('提交后收起', lambda: wifi()['open'] is None)

        click(network('Cafe'))
        check('开放网络展开为“开放”', lambda: wifi()['open'] == 'Cafe' and wifi()['status'] == 'Open')
        click(control('Connect automatically'))
        check('可以取消“自动连接”', lambda: not control('Connect automatically')['checked'])
        before = len(records())
        click(control('Connect'))
        check('开放网络直接连接，不要密钥、不自动连接', lambda: len(records()) == before + 1 and
              records()[-1]['method'] == 'addAndActivate' and records()[-1]['keyMgmt'] is None and
              records()[-1]['psk'] is None and records()[-1]['autoconnect'] is False)

        click(network('Office'))
        check('已保存网络的勾选反映它自己的设置', lambda: wifi()['open'] == 'Office' and
              not control('Connect automatically')['checked'])
        click(control('Connect automatically'))
        before = len(records())
        click(control('Connect'))
        check('已保存网络先更新“自动连接”再按原连接接入', lambda: records()[before:] == [
            {'method': 'update', 'id': 'Office', 'autoconnect': True},
            {'method': 'activate', 'id': 'Office'}])

        click(network('Current'))
        check('当前网络展开为“已连接，已加密”和“断开连接”', lambda: wifi()['open'] == 'Current' and
              wifi()['status'] == 'Connected, secured' and control('Disconnect')['visible'])
        before = len(records())
        click(control('Disconnect'))
        check('断开连接', lambda: records()[before:] == [{'method': 'deactivate', 'id': 'Current'}])

        click(network('Home-5G'))
        click(network('Cafe'))
        check('展开另一个网络会收起前一个', lambda: wifi()['open'] == 'Cafe' and wifi()['detailsBelowItem'])
        click(network('Cafe'))
        check('再点同一个网络收起', lambda: wifi()['open'] is None)

        click(network('Corp'))
        before = len(records())
        click(control('Connect'))
        # GNOME's own handler connects through Settings and closes the menu.
        check('企业网络仍交给 GNOME 自己的处理', lambda: state()['wifiGnome'] == ['Corp'] and
              len(records()) == before)
    finally:
        shell.trigger('wifi-record-stop')
        shell.trigger('quick-page-back')
        shell.trigger('test-wireless-remove')
        shell.trigger('quick-settings-close')
    print(f'{count} 项 Wi-Fi 加入流程检查通过，0 项失败')


if __name__ == '__main__':
    main()
