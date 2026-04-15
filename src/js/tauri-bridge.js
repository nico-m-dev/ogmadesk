// Tauri Bridge
// This module provides a safe wrapper around Tauri APIs, 
// with fallbacks for browser testing during development.

(function() {
    const isTauri = () => window.__TAURI__ !== undefined;

    const TauriBridge = {
        isDesktop: isTauri,

        // File System wrappers (requires tauri-plugin-fs)
        fs: {
            async readTextFile(path) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { readTextFile } = window.__TAURI__.fs;
                    return await readTextFile(path);
                }
                console.warn(`[Tauri] readTextFile fallback for: ${path}`);
                return "{}";
            },
            async writeTextFile(path, contents) {
                if (isTauri() && window.__TAURI__.fs) {
                    try {
                        const { writeTextFile } = window.__TAURI__.fs;
                        return await writeTextFile(path, contents);
                    } catch (e) {
                        console.error(`[Tauri] writeTextFile error:`, e);
                        throw e;
                    }
                }
                console.warn(`[Tauri] writeTextFile fallback for: ${path}`, contents);
            },
            async exists(path) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { exists } = window.__TAURI__.fs;
                    return await exists(path);
                }
                return false;
            },
            async readDir(path) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { readDir } = window.__TAURI__.fs;
                    return await readDir(path);
                }
                console.warn(`[Tauri] readDir fallback for: ${path}`);
                return [];
            },
            async stat(path) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { stat } = window.__TAURI__.fs;
                    return await stat(path);
                }
                console.warn(`[Tauri] stat fallback for: ${path}`);
                return { size: 0, mtime: null };
            },
            async mkdir(path, options = {}) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { mkdir } = window.__TAURI__.fs;
                    return await mkdir(path, options);
                }
                console.warn(`[Tauri] mkdir fallback for: ${path}`);
            },
            async readFile(path) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { readFile } = window.__TAURI__.fs;
                    return await readFile(path);
                }
                console.warn(`[Tauri] readFile fallback for: ${path}`);
                return new Uint8Array();
            },
            async writeBinaryFile(path, contents) {
                if (isTauri() && window.__TAURI__.fs) {
                    try {
                        const { writeBinaryFile, writeFile } = window.__TAURI__.fs;
                        const fn = writeBinaryFile || writeFile;
                        if (fn) return await fn(path, contents);
                        throw new Error("Neither writeBinaryFile nor writeFile found in fs plugin");
                    } catch (e) {
                        console.error(`[Tauri] writeBinaryFile error:`, e);
                        throw e;
                    }
                }
                console.warn(`[Tauri] writeBinaryFile fallback for: ${path}`);
            },
            async rename(oldPath, newPath) {
                if (isTauri() && window.__TAURI__.fs) {
                    // tauri v2 fs: rename isn't always direct, sometimes it's rename or move
                    // Using rename
                    const { rename } = window.__TAURI__.fs;
                    return await rename(oldPath, newPath);
                }
                console.warn(`[Tauri] rename fallback for: ${oldPath} -> ${newPath}`);
            },
            async remove(path, options = {}) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { remove } = window.__TAURI__.fs;
                    return await remove(path, options);
                }
                console.warn(`[Tauri] remove fallback for: ${path}`);
            },
            async copyFile(source, destination) {
                if (isTauri() && window.__TAURI__.fs) {
                    const { copyFile } = window.__TAURI__.fs;
                    return await copyFile(source, destination);
                }
                console.warn(`[Tauri] copyFile fallback for: ${source} -> ${destination}`);
            }
        },

        // Store wrappers (requires tauri-plugin-store)
        store: {
            async get(key, storePath = 'settings.json') {
                if (isTauri() && window.__TAURI__.store) {
                    const { load } = window.__TAURI__.store;
                    const store = await load(storePath);
                    return await store.get(key);
                }
                return localStorage.getItem(`${storePath}:${key}`);
            },
            async set(key, value, storePath = 'settings.json') {
                if (isTauri() && window.__TAURI__.store) {
                    const { load } = window.__TAURI__.store;
                    const store = await load(storePath);
                    await store.set(key, value);
                    await store.save();
                    return;
                }
                localStorage.setItem(`${storePath}:${key}`, value);
            }
        },

        // Dialog wrappers (requires tauri-plugin-dialog)
        dialog: {
            async open(options = {}) {
                if (isTauri() && window.__TAURI__.dialog) {
                    const { open } = window.__TAURI__.dialog;
                    return await open(options);
                }
                console.warn(`[Tauri] dialog.open fallback`);
                return null; // Return mocked path or null in browser
            },
            async save(options = {}) {
                if (isTauri() && window.__TAURI__.dialog) {
                    const { save } = window.__TAURI__.dialog;
                    return await save(options);
                }
                console.warn(`[Tauri] dialog.save fallback`);
                return null;
            },
            async ask(message, options = {}) {
                if (isTauri() && window.__TAURI__.dialog) {
                    const { ask } = window.__TAURI__.dialog;
                    return await ask(message, options);
                }
                console.warn(`[Tauri] dialog.ask fallback: ${message}`);
                return window.confirm(message);
            }
        },
        
        // Core APIs
        core: {
             async invoke(cmd, args = {}) {
                if (isTauri() && window.__TAURI__.core) {
                    const { invoke } = window.__TAURI__.core;
                    return await invoke(cmd, args);
                }
                console.warn(`[Tauri] invoke fallback for command: ${cmd}`);
                return null;
             },
             convertFileSrc(filePath) {
                if (isTauri()) {
                    if (window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) {
                        return window.__TAURI__.core.convertFileSrc(filePath);
                    }
                    if (window.__TAURI__.tauri && window.__TAURI__.tauri.convertFileSrc) {
                        return window.__TAURI__.tauri.convertFileSrc(filePath);
                    }
                }
                return 'asset://localhost/' + filePath.replace(/\\/g, '/');
             }
        },

        // Event APIs (requires tauri-plugin-event)
        event: {
            async listen(eventName, handler) {
                if (isTauri() && window.__TAURI__.event) {
                    const { listen } = window.__TAURI__.event;
                    return await listen(eventName, handler);
                }
                console.warn(`[Tauri] event.listen fallback for: ${eventName}`);
                return () => {}; // return unlisten dummy
            }
        },

        // Window APIs (requires @tauri-apps/api/window)
        window: {
            async getCurrent() {
                if (isTauri() && window.__TAURI__.window) {
                    return window.__TAURI__.window.getCurrentWindow();
                }
                return null;
            },
            async getSize() {
                try {
                    const win = await this.getCurrent();
                    if (win?.innerSize) {
                        const size = await win.innerSize();
                        return { width: size.width, height: size.height };
                    }
                } catch (e) {
                    console.warn('[Tauri] getSize error:', e.message);
                }
                return { width: window.innerWidth, height: window.innerHeight };
            },
            async setSize(width, height) {
                try {
                    const win = await this.getCurrent();
                    if (win?.setSize) {
                        const LogicalSize = window.__TAURI__.dpi?.LogicalSize || window.__TAURI__.window?.LogicalSize;
                        if (LogicalSize) {
                            await win.setSize(new LogicalSize(width, height));
                            return true;
                        }
                    }
                } catch (e) {
                    console.warn('[Tauri] setSize error:', e.message);
                }
                window.resizeTo(width, height);
            },
            async center() {
                try {
                    const win = await this.getCurrent();
                    if (win?.center) {
                        await win.center();
                    }
                } catch (e) {
                    console.warn('[Tauri] center error:', e.message);
                }
            }
        },

        // Opener wrappers (tauri-plugin-opener)
        opener: {
            async open(path) {
                if (isTauri() && window.__TAURI__.opener) {
                    const { openPath } = window.__TAURI__.opener;
                    return await openPath(path);
                }
                console.warn(`[Tauri] opener.openPath fallback for: ${path}`);
            },
            async reveal(path) {
                if (isTauri() && window.__TAURI__.opener) {
                    const { revealItemInDir } = window.__TAURI__.opener;
                    return await revealItemInDir(path);
                }
                console.warn(`[Tauri] opener.revealItemInDir fallback for: ${path}`);
            }
        }
    };

    // Expose globally
    window.TauriBridge = TauriBridge;
})();
