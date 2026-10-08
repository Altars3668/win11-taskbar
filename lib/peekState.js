/* Peek 的透明度所有权；纯状态机，不依赖 Shell，方便验证交错与中断。 */
export class PeekState {
    constructor({fade, busy = () => false, alive = () => true, transition = () => null,
        track = () => () => {}}) {
        this._fade = fade;
        this._busy = busy;
        this._alive = alive;
        this._transition = transition;
        this._track = track;
        this.records = new Map();
        this.owners = new Map();
    }

    set(owner, actors, opacity = 0) {
        const wanted = new Set(actors);
        for (const actor of [...this.owners.get(owner) ?? []]) {
            if (!wanted.has(actor))
                this._release(owner, actor);
        }
        for (const actor of wanted) {
            let record = this.records.get(actor);
            if (!this._alive(actor) || this._busy(actor) || record && this._lost(actor, record)) {
                this.drop(actor);
                continue;
            }
            if (!record) {
                // 不记录原生映射／还原动画或其他模块透明度动画的中间值。
                if (this._transition(actor))
                    continue;
                record = {base: actor.opacity, target: actor.opacity, requests: new Map(),
                    transition: null, generation: 0, cleanup: null};
                this.records.set(actor, record);
                record.cleanup = this._track(actor, () => this.drop(actor));
            }
            record.requests.set(owner, Math.max(0, Math.min(255, opacity)));
            if (!this.owners.has(owner))
                this.owners.set(owner, new Set());
            this.owners.get(owner).add(actor);
            this._apply(actor, record);
        }
    }

    clear(owner, immediate = false) {
        for (const actor of [...this.owners.get(owner) ?? []])
            this._release(owner, actor, immediate);
    }

    clearAll() {
        for (const owner of [...this.owners.keys()])
            this.clear(owner, true);
        // 已经没有 owner、仍在退场的记录也立即归还。
        for (const [actor, record] of [...this.records])
            this._apply(actor, record, true);
    }

    _release(owner, actor, immediate = false) {
        const owned = this.owners.get(owner);
        owned?.delete(actor);
        if (owned?.size === 0)
            this.owners.delete(owner);
        const record = this.records.get(actor);
        if (!record)
            return;
        record.requests.delete(owner);
        this._apply(actor, record, immediate);
    }

    _lost(actor, record) {
        const active = this._transition(actor);
        if (active && active !== record.transition)
            return true;
        // 外部静态更新取得所有权时也不覆盖它；我们自己的中间值有过渡标记。
        return !active && actor.opacity !== record.target;
    }

    _apply(actor, record, immediate = false) {
        if (!this._alive(actor) || this._busy(actor) || this._lost(actor, record)) {
            this.drop(actor);
            return;
        }
        const target = Math.min(record.base, ...record.requests.values());
        if (target === record.target && !immediate) {
            if (!record.requests.size && !this._transition(actor) && actor.opacity === record.base)
                this.drop(actor);
            return;
        }
        record.target = target;
        const generation = ++record.generation;
        record.transition = this._fade(actor, target, () => {
            if (this.records.get(actor) !== record || record.generation !== generation)
                return;
            if (!record.requests.size)
                this.drop(actor);
        }, immediate);
    }

    drop(actor) {
        const record = this.records.get(actor);
        if (!record)
            return;
        this.records.delete(actor);
        for (const owner of record.requests.keys()) {
            const actors = this.owners.get(owner);
            actors?.delete(actor);
            if (actors?.size === 0)
                this.owners.delete(owner);
        }
        record.cleanup?.();
    }
}
