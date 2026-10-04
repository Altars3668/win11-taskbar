#!/usr/bin/gjs -m
/* 真实本机 ICU 转写：排序和字母分组必须一致，不把汉字全放在 #。 */
import GLib from 'gi://GLib';
import {ApplicationOrder} from '../lib/applicationOrder.js';

const loop = new GLib.MainLoop(null, false);
const names = ['计算器', '文件', '重庆应用', 'Éditeur', 'Εφαρμογή', 'Калькулятор', 'Alpha', '应用10', '应用2'];
let error = null;
const order = new ApplicationOrder(() => {
    try {
        const expected = {'计算器':'J', '文件':'W', '重庆应用':'C', 'Éditeur':'E', 'Εφαρμογή':'E', 'Калькулятор':'K'};
        for (const [name, heading] of Object.entries(expected)) {
            if (order.heading(name) !== heading)
                throw new Error(`${name} 的首字母应为 ${heading}，实际为 ${order.heading(name)}`);
        }
        if (order.compare('应用2', '应用10') >= 0)
            throw new Error('数字部分未按自然顺序排列');
        if (order.compare('重庆应用', '计算器') >= 0 || order.compare('计算器', '文件') >= 0)
            throw new Error('中文没有按拼音参与排序');
        print('中文拼音、多语言字母分组和自然数字排序检查通过，0 项失败');
    } catch (e) {
        error = e;
    }
    order.destroy();
    loop.quit();
});
order.prime(names);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
    error = new Error('本机转写未完成');
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
if (error)
    throw error;
