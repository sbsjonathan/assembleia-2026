/* Load before every application script, including the Bible workers.
 * GitHub Pages projects share an origin: their browser data must not share keys.
 * This is application isolation, not a security boundary against same-origin code.
 */
(function installAssemblyScope(global) {
    'use strict';
    if (global.AssemblyScope?.version === 1) return;

    const prefix = 'assembleia-2026:';
    const storageAreas = [];
    const isPage = typeof document !== 'undefined';

    function installGlobal(name, get) {
        Object.defineProperty(global, name, { configurable: false, enumerable: true, get });
    }

    function storageProxy(native) {
        // Keep a reference to the real methods before exposing the scoped object.
        const get = native.getItem.bind(native);
        const set = native.setItem.bind(native);
        const remove = native.removeItem.bind(native);
        const keyAt = native.key.bind(native);
        const keys = () => {
            const result = [];
            for (let i = 0; i < native.length; i++) {
                const key = keyAt(i);
                if (key?.startsWith(prefix)) result.push(key.slice(prefix.length));
            }
            return result;
        };
        const methods = {
            getItem(key) { return get(prefix + String(key)); },
            setItem(key, value) { set(prefix + String(key), String(value)); },
            removeItem(key) { remove(prefix + String(key)); },
            key(index) { return keys()[Number(index) >>> 0] ?? null; },
            clear() { keys().forEach(key => remove(prefix + key)); }
        };
        const target = Object.create(global.Storage.prototype);
        return new Proxy(target, {
            get(_, name) {
                if (name === 'length') return keys().length;
                if (Object.hasOwn(methods, name)) return methods[name];
                if (name === Symbol.toStringTag) return 'Storage';
                if (typeof name === 'symbol') return Reflect.get(target, name);
                const value = get(prefix + name);
                return value === null ? Reflect.get(target, name) : value;
            },
            set(_, name, value) {
                if (typeof name !== 'string' || name === 'length') return false;
                set(prefix + name, String(value));
                return true;
            },
            deleteProperty(_, name) {
                if (typeof name === 'string') remove(prefix + name);
                return true;
            },
            ownKeys() { return keys(); },
            has(_, name) {
                return typeof name === 'string' && get(prefix + name) !== null || name in target;
            },
            getOwnPropertyDescriptor(_, name) {
                if (typeof name !== 'string') return undefined;
                const value = get(prefix + name);
                return value === null ? undefined : {
                    configurable: true, enumerable: true, writable: true, value
                };
            },
            defineProperty(_, name, descriptor) {
                // Accessor/nonconfigurable properties are not persistent storage entries.
                if (typeof name !== 'string' || !Object.hasOwn(descriptor, 'value') || descriptor.configurable === false) return false;
                set(prefix + name, String(descriptor.value));
                return true;
            },
            preventExtensions() { return false; }
        });
    }

    function scopeStorage(name) {
        let native;
        try { native = global[name]; }
        catch (error) {
            // Preserve the browser's unavailable-storage error; never use shared data.
            installGlobal(name, () => { throw error; });
            return;
        }
        const scoped = storageProxy(native);
        installGlobal(name, () => scoped);
        storageAreas.push({ native, scoped });
    }

    function scopeDatabases() {
        const native = global.indexedDB;
        if (!native) return;
        const open = native.open.bind(native);
        const remove = native.deleteDatabase.bind(native);
        const methods = {
            open(name, ...args) { return arguments.length ? open(prefix + String(name), ...args) : open(); },
            deleteDatabase(name) { return arguments.length ? remove(prefix + String(name)) : remove(); }
        };
        if (typeof native.databases === 'function') {
            const list = native.databases.bind(native);
            methods.databases = async () => (await list())
                .filter(entry => entry.name?.startsWith(prefix))
                .map(entry => ({ ...entry, name: entry.name.slice(prefix.length) }));
        }
        const scoped = new Proxy(native, {
            get(target, name) {
                if (Object.hasOwn(methods, name)) return methods[name];
                const value = Reflect.get(target, name, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
        installGlobal('indexedDB', () => scoped);
    }

    function failClosed(error) {
        // A browser that cannot install the facades must not fall back to the
        // other app's storage. Deny persistence in this realm and stop loading.
        const deny = () => { throw new DOMException('Não foi possível separar os dados da Assembleia.', 'SecurityError'); };
        for (const [prototype, names] of [
            [global.Storage?.prototype, ['getItem', 'setItem', 'removeItem', 'clear', 'key']],
            [global.IDBFactory?.prototype, ['open', 'deleteDatabase', 'databases']]
        ]) {
            if (!prototype) continue;
            for (const name of names) {
                try { Object.defineProperty(prototype, name, { configurable: true, value: deny }); } catch (_) {}
            }
        }
        if (isPage) {
            global.stop();
            const show = () => {
                document.body?.replaceChildren(Object.assign(document.createElement('p'), {
                    textContent: 'Não foi possível abrir o armazenamento deste aplicativo. Abra novamente em um navegador atualizado.'
                }));
            };
            if (document.body) show(); else document.addEventListener('DOMContentLoaded', show, { once: true });
        }
        throw error;
    }

    try {
        if (isPage) {
            scopeStorage('localStorage');
            scopeStorage('sessionStorage');
            // Installed first, this capture listener rewrites the native event
            // before existing app listeners inspect its key or storageArea.
            global.addEventListener('storage', event => {
                const area = storageAreas.find(item => item.native === event.storageArea);
                if (!area) return;
                if (event.key !== null && !event.key.startsWith(prefix)) {
                    event.stopImmediatePropagation();
                    return;
                }
                Object.defineProperties(event, {
                    key: { value: event.key === null ? null : event.key.slice(prefix.length) },
                    storageArea: { value: area.scoped }
                });
            }, true);
        }
        scopeDatabases();
        Object.defineProperty(global, 'AssemblyScope', {
            value: Object.freeze({ version: 1, prefix }), configurable: false
        });
    } catch (error) { failClosed(error); }
})(globalThis);
