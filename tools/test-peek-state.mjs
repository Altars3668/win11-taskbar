/* 不依赖合成器的 Peek 所有权回归；过渡的完成由测试显式推进。 */
import assert from 'node:assert/strict';
import {PeekState} from '../lib/peekState.js';

let checks = 0;
function check(label, fn) {
    fn();
    checks++;
    console.log(`ok ${label}`);
}
function rig(opacity = 255) {
    const actor = {opacity, active: null, alive: true, busy: false, fades: 0, scale: [1, 1]};
    const state = new PeekState({
        alive: a => a.alive,
        busy: a => a.busy,
        transition: a => a.active,
        fade: (a, value, done, immediate) => {
            a.fades++;
            const transition = {value, done};
            a.active = immediate ? null : transition;
            if (immediate) {
                a.opacity = value;
                done();
            }
            return a.active;
        },
    });
    const finish = () => {
        const t = actor.active;
        actor.active = null;
        actor.opacity = t.value;
        t.done();
    };
    return {actor, state, finish};
}
const preview = {}, desktop = {};
check('两个来源只记录一次原始值，最后释放才还原', () => {
    const {actor, state, finish} = rig();
    state.set(preview, [actor]); finish();
    state.set(desktop, [actor]);
    assert.equal(state.records.get(actor).base, 255);
    state.clear(preview);
    assert.equal(actor.opacity, 0);
    state.clear(desktop); finish();
    assert.equal(actor.opacity, 255);
    assert.equal(state.records.size, 0);
});
check('还原过渡被新 Peek 打断时仍使用首次原始值', () => {
    const {actor, state, finish} = rig();
    state.set(preview, [actor]); finish();
    state.clear(preview);
    actor.opacity = 80;
    state.set(desktop, [actor]); finish();
    state.clear(desktop); finish();
    assert.equal(actor.opacity, 255);
});
check('保留原来静态设置的 160 透明度', () => {
    const {actor, state, finish} = rig(160);
    state.set(preview, [actor]); finish();
    state.clear(preview); finish();
    assert.equal(actor.opacity, 160);
});
check('原生动画中的值不能成为基线', () => {
    const {actor, state} = rig(50);
    actor.busy = true;
    state.set(desktop, [actor]);
    state.clear(desktop);
    assert.equal(actor.fades, 0);
    assert.equal(actor.opacity, 50);
});
check('外部透明度过渡接管后不覆盖它', () => {
    const {actor, state, finish} = rig();
    state.set(preview, [actor]); finish();
    const native = {value: 255};
    actor.active = native;
    state.clear(preview);
    assert.equal(actor.active, native);
    assert.equal(state.records.size, 0);
});
check('过时的退场回调不能删除新请求', () => {
    const {actor, state, finish} = rig();
    state.set(preview, [actor]); finish();
    state.clear(preview);
    const old = actor.active;
    state.set(desktop, [actor]);
    old.done();
    assert.equal(state.records.get(actor).requests.size, 1);
});
check('停用立即还原全部来源且不改变缩放', () => {
    const {actor, state, finish} = rig();
    actor.scale = [0.9, 0.9];
    state.set(preview, [actor]); finish();
    state.set(desktop, [actor]);
    state.clearAll();
    assert.equal(actor.opacity, 255);
    assert.deepEqual(actor.scale, [0.9, 0.9]);
    assert.equal(state.owners.size, 0);
    assert.equal(state.records.size, 0);
});
check('销毁演员立即释放引用', () => {
    const {actor, state} = rig();
    state.set(preview, [actor]);
    actor.alive = false;
    state.drop(actor);
    assert.equal(state.records.size, 0);
    assert.equal(state.owners.size, 0);
});
console.log(`${checks} 项 Peek 状态机检查通过，0 项失败`);
