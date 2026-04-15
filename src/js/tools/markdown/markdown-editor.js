/**
 * Markdown Editor — Orchestrator
 * Matches the save flow and logic style of PDF Suite.
 */

var MarkdownEditor = (() => {
    let state = {
        bytes: null,
        filename: null,  // null = not saved to any file yet
        isDirty: false
    };

    let windowCloseHandlerRegistered = false;

    /* ------------------------------------------------------------------
     * Save Flow
     * ------------------------------------------------------------------ */
    async function saveResult(contentStr, isExport = false, forceSaveAsNew = false) {
        state.bytes = new TextEncoder().encode(contentStr);
        const workspace = window.WorkspaceManager?.current;

        if (!workspace) {
            // Quick Mode -> Direct Save or Export to PC
            await runSaveAsFlow(state.bytes, state.filename);
            return;
        }

        // Workspace Mode
        if (isExport) {
            // Export to PC
            await runSaveAsFlow(state.bytes, state.filename);
        } else if (forceSaveAsNew || !state.filename) {
            // Save as New (or first time save) - prompt for filename
            await promptAndSaveToWorkspace(state.bytes, state.filename, workspace);
        } else {
            // Quick Save / Overwrite existing
            // state.filename now contains the relative path (e.g. "Sub/Note.md")
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const mdDir = `${workspace.path}${sep}Markdown`;
            const finalPath = `${mdDir}${sep}${state.filename}`;
            await saveToWorkspaceWithPath(state.bytes, state.filename, workspace, finalPath);
        }
    }

    async function promptAndSaveToWorkspace(bytes, suggestedName, workspace) {
        const filename = await promptForFilename('');  // Start with empty, user must type a name
        if (!filename) return;

        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const mdDir = `${workspace.path}${sep}Markdown`;
        const finalPath = `${mdDir}${sep}${filename}`;

        // Check if file exists
        try {
            const exists = await window.TauriBridge.fs.exists(finalPath);
            if (exists) {
                const proceed = await showConfirmModal(
                    'File Exists',
                    `File "${filename}" already exists in /Markdown/. Overwrite?`,
                    'Overwrite',
                    'bg-amber-600 hover:bg-amber-500'
                );
                if (!proceed) return;
            }
        } catch (err) {
            console.error('[Markdown] check file exists error:', err);
        }

        await saveToWorkspaceWithPath(bytes, filename, workspace, finalPath);
    }

    async function promptForFilename(defaultName) {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                    <div class="flex items-center mb-4">
                        <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                            <i class="ph ph-floppy-disk text-amber-400 text-xl"></i>
                        </div>
                        <div class="flex-1">
                            <h3 class="font-semibold text-white">Save to Workspace</h3>
                            <input id="md-save-filename" type="text" 
                                class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-2 py-1.5 mt-2 rounded focus:border-amber-500 focus:outline-none" 
                                value="${escHtml(defaultName)}" placeholder="filename.md">
                        </div>
                        <button id="md-save-modal-close" class="ml-2 text-zinc-500 hover:text-white transition-colors self-start">
                            <i class="ph ph-x text-lg"></i>
                        </button>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button id="md-save-cancel" class="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button id="md-save-confirm" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">
                            Save
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = () => modal.remove();
            const input = modal.querySelector('#md-save-filename');

            modal.querySelector('#md-save-modal-close').addEventListener('click', close);
            modal.querySelector('#md-save-cancel').addEventListener('click', close);
            modal.addEventListener('click', e => { if (e.target === modal) close(); });
            
            input.addEventListener('keydown', e => {
                if (e.key === 'Enter') {
                    modal.querySelector('#md-save-confirm').click();
                }
            });
            
            modal.querySelector('#md-save-confirm').addEventListener('click', () => {
                let val = input.value.trim();
                val = sanitizeFilename(val);
                if (!val) {
                    showToast('Please enter a valid filename', 'error');
                    return;
                }
                if (!val.toLowerCase().endsWith('.md')) val += '.md';
                close();
                resolve(val);
            });

            // Focus and select existing text
            setTimeout(() => {
                input.focus();
                input.select();
            }, 10);
        });
    }

    async function saveToWorkspaceWithPath(bytes, filename, workspace, finalPath) {
        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const mdDir = `${workspace.path}${sep}Markdown`;
            await window.TauriBridge.fs.mkdir(mdDir, { recursive: true });
            await writeBinaryFile(finalPath, bytes);
            
            state.filename = filename;
            markClean();
            showToast(`Saved to workspace: Markdown${sep}${filename}`, 'success');
            if (window.MarkdownFS) window.MarkdownFS.loadFiles();
        } catch (err) {
            console.error('[Markdown Editor] saveToWorkspace error:', err);
            showToast('Workspace save failed: ' + (err.message || err), 'error');
        }
    }

    async function runSaveAsFlow(bytes, suggestedName) {
        try {
            const savePath = await window.TauriBridge.dialog.save({
                defaultPath: suggestedName,
                filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (!savePath) return; // cancelled
            
            await writeBinaryFile(savePath, bytes);
            state.filename = basename(savePath);
            markClean();
            showToast(`Saved: ${state.filename}`, 'success');
            
            // If in workspace, refresh the file tree just in case they saved it inside the workspace dir
            if (window.MarkdownFS) window.MarkdownFS.loadFiles();
        } catch (err) {
            console.error('[Markdown Editor] saveAs error:', err);
            showToast('Save failed: ' + (err.message || err), 'error');
        }
    }

    async function saveToWorkspace(bytes, suggestedName, workspace, quiet = false) {
        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const mdDir = `${workspace.path}${sep}Markdown`;
            await window.TauriBridge.fs.mkdir(mdDir, { recursive: true });
            const finalPath = `${mdDir}${sep}${suggestedName}`;
            await writeBinaryFile(finalPath, bytes);
            
            state.filename = suggestedName;
            markClean();
            
            if (!quiet) showToast(`Saved to workspace: Markdown${sep}${suggestedName}`, 'success');
            // Refresh file tree
            if (window.MarkdownFS) window.MarkdownFS.loadFiles();
        } catch (err) {
            console.error('[Markdown Editor] saveToWorkspace error:', err);
            showToast('Workspace save failed: ' + (err.message || err), 'error');
        }
    }

    async function writeBinaryFile(path, bytes) {
        if (window.TauriBridge?.fs?.writeBinaryFile) {
            await window.TauriBridge.fs.writeBinaryFile(path, bytes);
        } else {
            // fallback
            const blob = new Blob([bytes], { type: 'text/markdown' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = basename(path);
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    /* ------------------------------------------------------------------
     * Import Flow
     * ------------------------------------------------------------------ */
    async function openFileFlow() {
        if (state.isDirty) {
            const proceed = await showConfirmModal(
                'Unsaved Changes',
                'You have unsaved changes. Discard them?',
                'Discard',
                'bg-red-600 hover:bg-red-500'
            );
            if (!proceed) return;
        }

        await openFromPC();
    }

    async function openFromPC() {
        try {
            const filePath = await window.TauriBridge.dialog.open({
                filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
            });
            if (!filePath) return;
            
            await loadFile(filePath);
        } catch (err) {
            console.error('[Markdown Editor] open error:', err);
            showToast('Open failed: ' + (err.message || err), 'error');
        }
    }

    async function loadFile(filePath) {
        try {
            const content = await window.TauriBridge.fs.readTextFile(filePath);
            state.filename = getRelativePath(filePath);
            if (window.MarkdownUI) {
                window.MarkdownUI.setContent(content);
            }
            markClean();
            showToast(`Opened: ${state.filename}`, 'success');
        } catch (err) {
            console.error('[Markdown Editor] load error:', err);
            showToast('Load failed: ' + (err.message || err), 'error');
        }
    }

    async function newFile() {
        if (state.isDirty) {
            const proceed = await showConfirmModal(
                'Unsaved Changes',
                'You have unsaved changes. Discard them?',
                'Discard',
                'bg-red-600 hover:bg-red-500'
            );
            if (!proceed) return;
        }
        state.filename = null;
        if (window.MarkdownUI) window.MarkdownUI.setContent('');
        markClean();
        
        // Refresh file tree to clear selection
        if (window.MarkdownFS) window.MarkdownFS.loadFiles();
    }

    /* ------------------------------------------------------------------
     * Status Management
     * ------------------------------------------------------------------ */
    function markDirty() {
        state.isDirty = true;
        updateStatusUI();
    }
    
    function markClean() {
        state.isDirty = false;
        updateStatusUI();
    }

    function updateStatusUI() {
        const fileEl = document.getElementById('md-status-filename');
        const saveEl = document.getElementById('md-status-save');
        if (fileEl) fileEl.textContent = state.filename || 'Untitled';
        if (saveEl) {
            saveEl.textContent = state.isDirty ? 'Unsaved changes' : 'Saved';
            saveEl.className = state.isDirty ? 'text-amber-500' : 'text-emerald-500';
        }
    }

    /* ------------------------------------------------------------------
     * Utilities / Toast
     * ------------------------------------------------------------------ */
    function basename(path) {
        return path.replace(/.*[\\/]/, '');
    }

    function getRelativePath(absPath) {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return basename(absPath);
        
        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const mdDir = `${workspace.path}${sep}Markdown${sep}`;
        
        // If it starts with mdDir, strip it
        if (absPath.startsWith(mdDir)) {
            return absPath.substring(mdDir.length);
        }
        
        // Also handle the case where it IS exactly the Markdown dir? 
        // Unlikely for a file, but let's be safe.
        return basename(absPath);
    }

    function sanitizeFilename(name) {
        if (!name) return '';
        // Remove illegal OS characters: \ / : * ? " < > |
        // We allow spaces as per user preference.
        return name.replace(/[\\/:*?"<>|]/g, '').trim();
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function showToast(message, type = 'info') {
        document.getElementById('md-toast-container')?.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error:   'bg-red-700/90 border-red-600/40',
            info:    'bg-zinc-700/90 border-zinc-600/40',
        };
        const iconMap  = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'md-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-fade-enter ${colorMap[type] || colorMap.info}`;
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${escHtml(message)}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    function showConfirmModal(title, message, confirmText = 'OK', confirmClass = 'bg-amber-600 hover:bg-amber-500') {
        return new Promise(resolve => {
            document.getElementById('md-confirm-modal')?.remove();

            const modal = document.createElement('div');
            modal.id = 'md-confirm-modal';
            modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                    <div class="flex items-center mb-4">
                        <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                            <i class="ph ph-warning text-amber-400 text-xl"></i>
                        </div>
                        <div>
                            <h3 class="font-semibold text-white">${escHtml(title)}</h3>
                        </div>
                        <button id="md-confirm-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                            <i class="ph ph-x text-lg"></i>
                        </button>
                    </div>
                    <p class="text-zinc-300 text-sm mb-5">${escHtml(message)}</p>
                    <div class="flex gap-2">
                        <button id="md-confirm-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                        <button id="md-confirm-ok" class="flex-1 px-4 py-2 rounded-lg ${confirmClass} text-white text-sm font-medium transition-colors">${escHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = (result) => {
                modal.remove();
                resolve(result);
            };

            modal.querySelector('#md-confirm-close').addEventListener('click', () => close(false));
            modal.querySelector('#md-confirm-cancel').addEventListener('click', () => close(false));
            modal.addEventListener('click', e => { if (e.target === modal) close(false); });
            modal.querySelector('#md-confirm-ok').addEventListener('click', () => close(true));
        });
    }

    /* ------------------------------------------------------------------
     * Init
     * ------------------------------------------------------------------ */
    function updateSaveButtonVisibility() {
        const saveBtn = document.getElementById('md-btn-save');
        const saveNewBtn = document.getElementById('md-btn-save-new');
        if (!saveBtn) return;
        
        const isWs = !!(window.WorkspaceManager?.current);
        
        if (isWs) {
            saveBtn.classList.remove('hidden');
            saveBtn.style.display = '';
            if (saveNewBtn) {
                saveNewBtn.classList.remove('hidden');
                saveNewBtn.style.display = '';
            }
        } else {
            saveBtn.classList.add('hidden');
            saveBtn.style.display = 'none';
            if (saveNewBtn) {
                saveNewBtn.classList.add('hidden');
                saveNewBtn.style.display = 'none';
            }
        }
    }

    window.MarkdownEditor && (window.MarkdownEditor.updateSaveButtonVisibility = updateSaveButtonVisibility);

    function init() {
        // Wire up top toolbar
        document.getElementById('md-btn-new')?.addEventListener('click', newFile);
        document.getElementById('md-btn-open')?.addEventListener('click', openFileFlow);
        
        document.getElementById('md-btn-save')?.addEventListener('click', () => {
            if (window.MarkdownUI) saveResult(window.MarkdownUI.getContent(), false, false);
        });
        document.getElementById('md-btn-save-new')?.addEventListener('click', () => {
            if (window.MarkdownUI) saveResult(window.MarkdownUI.getContent(), false, true);
        });
        document.getElementById('md-btn-saveas')?.addEventListener('click', () => {
            if (window.MarkdownUI) saveResult(window.MarkdownUI.getContent(), true);
        });

        // Show/Hide Save button based on workspace mode
        updateSaveButtonVisibility();

        // Register with App for navigation check
        if (window.App) {
            window.App.onBeforePageChange = async () => {
                if (state.isDirty) {
                    const proceed = await showConfirmModal(
                        'Unsaved Changes',
                        'You have unsaved changes. Leave anyway? (Unsaved data will be lost)',
                        'Leave',
                        'bg-red-600 hover:bg-red-500'
                    );
                    if (proceed) {
                        markClean();
                    }
                    return proceed;
                }
                return true;
            };
        }

        // Register window close handler for Quick mode
        if (window.TauriBridge?.window && !windowCloseHandlerRegistered) {
            windowCloseHandlerRegistered = true;
            (async () => {
                const appWindow = await window.TauriBridge.window.getCurrent();
                if (appWindow && appWindow.onCloseRequested) {
                    appWindow.onCloseRequested(async (event) => {
                        if (state.isDirty) {
                            event.preventDefault();
                            const proceed = await showConfirmModal(
                                'Unsaved Changes',
                                'You have unsaved changes. Close anyway? (Changes will be lost)',
                                'Close',
                                'bg-red-600 hover:bg-red-500'
                            );
                            if (proceed) {
                                markClean();
                                await appWindow.close();
                            }
                        }
                    });
                }
            })();
        }

        // Initialize submodules
        if (window.MarkdownUI) window.MarkdownUI.init();
        if (window.MarkdownFS) window.MarkdownFS.init();

        markClean();
    }

    function reset() {
        state.filename = null;
        state.isDirty = false;
        state.bytes = null;
        updateSaveButtonVisibility();
        if (window.MarkdownUI) window.MarkdownUI.setContent('');
        updateStatusUI();
    }

    return {
        init,
        reset,
        markDirty,
        markClean,
        loadFile,
        showToast,
        showConfirmModal,
        updateSaveButtonVisibility,
        state
    };
})();

window.MarkdownEditor = MarkdownEditor;
