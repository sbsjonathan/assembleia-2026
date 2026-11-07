/* Load before every application script, including the Bible workers.
 * GitHub Pages projects share an origin: their browser data must not share keys.
 * This is application isolation, not a security boundary against same-origin code.
 */
(function installAssemblyScope(global) {
    'use strict';
    if (global.AssemblyScope) {
        // document.open() keeps the facades but removes Window event listeners.
        // Downloaded articles run this bootstrap again after replacing the page.
        global.AssemblyScope.refresh?.();
        return;
    }

    const prefix = 'ass26:';
    const previousPrefix = 'assembleia-2026:';
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
        migrateStorage(native, name);
        const scoped = storageProxy(native);
        installGlobal(name, () => scoped);
        storageAreas.push({ native, scoped });
    }

    function migrateStorage(native, area) {
        // Keep this receipt outside the public namespace. Clearing this app's
        // notes must not make the next launch restore an intentionally deleted note.
        const receipt = 'ass26-migration:' + area + ':v1';
        if (native.getItem(receipt) === 'complete') return;
        const source = [];
        for (let i = 0; i < native.length; i++) {
            const key = native.key(i);
            if (key?.startsWith(previousPrefix)) source.push(key);
        }
        for (const key of source) {
            const logical = key.slice(previousPrefix.length);
            const congress = /^\d{4}-(sex|sab|dom)-/.test(logical) || /^asmb_recovery_\d{4}_/.test(logical);
            const destination = prefix + (congress ? 'legacy-congresso:' : '') + logical;
            if (native.getItem(destination) === null) native.setItem(destination, native.getItem(key));
        }
        native.setItem(receipt, 'complete');
    }

    function onStorageChange(event) {
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
    }

    function refresh() {
        if (!isPage) return;
        // addEventListener deduplicates this function/capture pair. Keeping its
        // position also preserves filtering before listeners already on the page.
        global.addEventListener('storage', onStorageChange, true);
    }

    function scopeDatabases() {
        const native = global.indexedDB;
        if (!native) return;
        const open = native.open.bind(native);
        const remove = native.deleteDatabase.bind(native);
        const migrations = new Map();
        const completed = new Set();
        let receiptDatabase;

        function receiptStore() {
            if (!receiptDatabase) receiptDatabase = new Promise((resolve, reject) => {
                const request = open('ass26-migration-v1', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('databases');
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    request.result.onversionchange = () => { request.result.close(); receiptDatabase = null; };
                    resolve(request.result);
                };
            }).catch(error => { receiptDatabase = null; throw error; });
            return receiptDatabase;
        }

        async function receipt(name, write = false) {
            const db = await receiptStore();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('databases', write ? 'readwrite' : 'readonly');
                const request = write ? tx.objectStore('databases').put(true, name) : tx.objectStore('databases').get(name);
                tx.oncomplete = () => resolve(write || request.result === true);
                tx.onabort = tx.onerror = () => reject(tx.error);
            });
        }

        function existing(name) {
            return new Promise((resolve, reject) => {
                const request = open(name);
                let absent = false;
                request.onupgradeneeded = event => {
                    if (event.oldVersion === 0) { absent = true; request.transaction.abort(); }
                };
                request.onerror = event => {
                    if (absent) { event.preventDefault(); resolve(null); }
                    else reject(request.error);
                };
                request.onsuccess = () => resolve(request.result);
            });
        }

        function snapshot(db) {
            const names = Array.from(db.objectStoreNames);
            if (!names.length) return Promise.resolve({ version: db.version, stores: [] });
            return new Promise((resolve, reject) => {
                const tx = db.transaction(names, 'readonly');
                const stores = names.map(name => {
                    const store = tx.objectStore(name);
                    return {
                        name, keyPath: store.keyPath, autoIncrement: store.autoIncrement,
                        indexes: Array.from(store.indexNames, indexName => {
                            const index = store.index(indexName);
                            return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
                        }),
                        keys: store.getAllKeys(), values: store.getAll()
                    };
                });
                tx.oncomplete = () => resolve({ version: db.version, stores: stores.map(store => ({ ...store, keys: store.keys.result, values: store.values.result })) });
                tx.onerror = tx.onabort = () => reject(tx.error);
            });
        }

        function installSnapshot(name, data) {
            return new Promise((resolve, reject) => {
                const request = open(prefix + name, data.version);
                request.onupgradeneeded = event => {
                    // Database creation and every copied record commit together.
                    // If another tab already created the destination, leave it alone.
                    if (event.oldVersion !== 0) return;
                    for (const item of data.stores) {
                        const store = request.result.createObjectStore(item.name, { keyPath: item.keyPath, autoIncrement: item.autoIncrement });
                        item.indexes.forEach(index => store.createIndex(index.name, index.keyPath, { unique: index.unique, multiEntry: index.multiEntry }));
                        item.values.forEach((value, index) => item.keyPath === null ? store.put(value, item.keys[index]) : store.put(value));
                    }
                };
                request.onerror = () => reject(request.error);
                request.onsuccess = () => { request.result.close(); resolve(); };
            });
        }

        async function migrateDatabase(name) {
            if (await receipt(name)) return;
            const target = await existing(prefix + name);
            if (target) { target.close(); await receipt(name, true); return; }
            const old = await existing(previousPrefix + name);
            if (old) {
                try { await installSnapshot(name, await snapshot(old)); }
                finally { old.close(); }
            }
            await receipt(name, true);
        }

        function prepare(name) {
            if (!migrations.has(name)) {
                const work = () => migrateDatabase(name);
                // Workers and tabs share this lock; old source databases stay intact.
                const task = global.navigator?.locks?.request
                    ? global.navigator.locks.request('ass26-database-migration:' + name, work) : work();
                migrations.set(name, task.then(() => { completed.add(name); }).catch(error => { migrations.delete(name); throw error; }));
            }
            return migrations.get(name);
        }

        function delayedRequest(task) {
            // Preserve the synchronous open()->request API while migration runs.
            const target = new EventTarget();
            const add = target.addEventListener.bind(target), discard = target.removeEventListener.bind(target), dispatch = target.dispatchEvent.bind(target);
            Object.setPrototypeOf(target, global.IDBOpenDBRequest.prototype);
            let active = null, failure = null, failed = false;
            Object.defineProperties(target, {
                addEventListener: { value: add }, removeEventListener: { value: discard }, dispatchEvent: { value: dispatch },
                result: { get: () => active ? active.result : undefined },
                error: { get: () => active ? active.error : failure },
                readyState: { get: () => active ? active.readyState : failed ? 'done' : 'pending' },
                source: { get: () => null }, transaction: { get: () => active?.transaction || null }
            });
            for (const type of ['success', 'error', 'upgradeneeded', 'blocked']) {
                let handler = null;
                Object.defineProperty(target, 'on' + type, {
                    get: () => handler,
                    set(value) { if (handler) discard(type, handler); handler = typeof value === 'function' ? value : null; if (handler) add(type, handler); }
                });
            }
            Promise.resolve().then(task).then(request => {
                active = request;
                for (const type of ['success', 'error', 'upgradeneeded', 'blocked']) request.addEventListener(type, event => {
                    const forwarded = type === 'upgradeneeded' || type === 'blocked'
                        ? new IDBVersionChangeEvent(type, { oldVersion: event.oldVersion, newVersion: event.newVersion })
                        : new Event(type, { cancelable: event.cancelable });
                    if (!dispatch(forwarded)) event.preventDefault();
                });
            }).catch(error => { failure = error; failed = true; dispatch(new Event('error', { cancelable: true })); });
            return target;
        }

        const methods = {
            open(name, ...args) {
                if (!arguments.length) return open();
                name = String(name);
                return completed.has(name) ? open(prefix + name, ...args)
                    : delayedRequest(async () => { await prepare(name); return open(prefix + name, ...args); });
            },
            deleteDatabase(name) {
                if (!arguments.length) return remove();
                name = String(name);
                return delayedRequest(async () => { await prepare(name); return remove(prefix + name); });
            }
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
            refresh();
        }
        scopeDatabases();
        Object.defineProperty(global, 'AssemblyScope', {
            value: Object.freeze({ version: 2, prefix, previousPrefix, refresh }), configurable: false
        });
    } catch (error) { failClosed(error); }
})(globalThis);
