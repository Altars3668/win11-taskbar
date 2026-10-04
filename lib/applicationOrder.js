/* 本机 ICU 转写用于排序和首字母分组，显示名称始终保持原文。 */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const collator = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});

export class ApplicationOrder {
    constructor(onReady) {
        this._keys = new Map();
        this._pending = new Set();
        this._onReady = onReady;
        this._cancellable = new Gio.Cancellable();
        this._destroyed = false;
    }

    key(name) {
        return this._keys.get(name) ?? name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
    }

    heading(name) {
        const first = this.key(name).trim().charAt(0).toUpperCase();
        return /^[A-Z]$/.test(first) ? first : '#';
    }

    compare(a, b) {
        return collator.compare(this.key(a), this.key(b)) || collator.compare(a, b);
    }

    prime(names) {
        const missing = [...new Set(names)].filter(name => !this._keys.has(name) && !this._pending.has(name));
        if (!missing.length || this._destroyed)
            return;
        const executable = GLib.find_program_in_path('uconv');
        if (!executable)
            return;
        missing.forEach(name => this._pending.add(name));
        const process = Gio.Subprocess.new([executable, '-x', 'Any-Latin; Latin-ASCII; Lower'],
            Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        const input = missing.map(name => name.replace(/[\r\n]/g, ' ')).join('\n') + '\n';
        process.communicate_utf8_async(input, this._cancellable, (_process, result) => {
            missing.forEach(name => this._pending.delete(name));
            if (this._destroyed)
                return;
            try {
                const [, stdout] = process.communicate_utf8_finish(result);
                if (!process.get_successful())
                    return;
                const keys = stdout.trimEnd().split('\n');
                if (keys.length !== missing.length)
                    return;
                missing.forEach((name, index) => this._keys.set(name, keys[index].trim()));
                this._onReady?.();
            } catch {
                // 本机 ICU 不可用时保留原文排序，不能阻塞 Shell 的输入线程。
            }
        });
    }

    destroy() {
        this._destroyed = true;
        this._onReady = null;
        this._cancellable.cancel();
        this._pending.clear();
    }
}
