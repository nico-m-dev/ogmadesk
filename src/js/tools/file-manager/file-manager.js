/**
 * File Manager — Orchestrator
 * Handles file system operations within the workspace.
 */

var FileManager = (() => {
    let state = {
        currentFolder: 'Assets', // Assets, Files, PDFs
        files: [],
        selectedFile: null,      // Full file object
        isQuickMode: true
    };

    const folderMap = {
        'Assets': 'Assets',
        'Files': 'Files',
        'PDFs': 'PDFs'
    };

    const iconMap = {
        'pdf': 'ph-file-pdf',
        'png': 'ph-image',
        'jpg': 'ph-image',
        'jpeg': 'ph-image',
        'svg': 'ph-image',
        'txt': 'ph-file-text',
        'md': 'ph-markdown-logo',
        'json': 'ph-file-code',
        'csv': 'ph-file-csv',
        'zip': 'ph-file-zip',
        'default': 'ph-file'
    };

    function init() {
        console.log("[File Manager] Initializing");
        bindEvents();
        switchFolder(state.currentFolder);
    }

    function bindEvents() {
        // Folder navigation
        document.querySelectorAll('.fm-nav-item').forEach(item => {
            item.addEventListener('click', () => {
                const folder = item.dataset.folder;
                if (folder && folderMap[folder]) {
                    switchFolder(folder);
                }
            });
        });

        // Toolbar
        document.getElementById('fm-btn-refresh')?.addEventListener('click', () => refresh());
        document.getElementById('fm-btn-rename')?.addEventListener('click', () => handleRename());
        document.getElementById('fm-btn-delete')?.addEventListener('click', () => handleDelete());
        document.getElementById('fm-btn-explorer')?.addEventListener('click', () => openExplorer());
    }

    async function switchFolder(folderName) {
        state.currentFolder = folderName;
        state.selectedFile = null;

        document.querySelectorAll('.fm-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.folder === folderName);
        });

        document.getElementById('fm-current-folder-label').textContent = folderName;
        updateToolbar();
        await refresh();
    }

    async function refresh() {
        if (!window.WorkspaceManager?.current) return;

        const workspace = window.WorkspaceManager.current;
        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const folderPath = `${workspace.path}${sep}${state.currentFolder}`;

        try {
            const entries = await window.TauriBridge.fs.readDir(folderPath);
            
            // Filter out directories and build initial list
            const initialFiles = entries
                .filter(entry => entry.children === undefined)
                .map(entry => ({
                    name: entry.name,
                    path: `${folderPath}${sep}${entry.name}`,
                    isDirectory: false,
                    size: 0,
                    lastModified: null
                }));

            // Fetch metadata for all files in parallel to get size and dates
            state.files = await Promise.all(initialFiles.map(async (file) => {
                try {
                    const metadata = await window.TauriBridge.fs.stat(file.path);
                    console.log(`[File Manager] Stat result for ${file.name}:`, metadata);
                    return {
                        ...file,
                        size: metadata.size || 0,
                        lastModified: metadata.modifiedAt || metadata.mtime || null
                    };
                } catch (e) {
                    console.warn(`[File Manager] Could not stat file: ${file.path}`, e);
                    return file;
                }
            }));

            // Sort by name A-Z
            state.files.sort((a, b) => a.name.localeCompare(b.name));

            render();
        } catch (err) {
            console.error("[File Manager] Refresh error:", err);
            showToast("Failed to load folder", "error");
        }
    }

    function render() {
        const listEl = document.getElementById('fm-file-list');
        const emptyEl = document.getElementById('fm-empty');
        if (!listEl) return;

        listEl.innerHTML = '';
        state.selectedFile = null;
        updateToolbar();

        if (state.files.length === 0) {
            emptyEl?.classList.remove('hidden');
            return;
        }

        emptyEl?.classList.add('hidden');

        state.files.forEach(file => {
            const row = document.createElement('tr');
            // Base classes for the row
            row.className = 'fm-file-row border-b border-zinc-700/30 cursor-pointer transition-colors hover:bg-zinc-800/60 last:border-none';
            // Custom attr so we can toggle selection state
            row.dataset.path = file.path;
            
            const ext = file.name.split('.').pop().toLowerCase();
            const iconClass = iconMap[ext] || iconMap.default;

            row.innerHTML = `
                <td class="py-3 px-4 text-zinc-300 align-middle">
                    <div class="fm-file-info flex items-center gap-3">
                        <i class="ph ${iconClass} fm-file-icon text-[1.25rem] text-zinc-500 transition-colors"></i>
                        <span class="fm-file-name font-medium max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap" title="${escHtml(file.name)}">${escHtml(file.name)}</span>
                    </div>
                </td>
                <td class="py-3 px-4 text-zinc-300 align-middle"><span class="fm-file-meta text-zinc-500 text-[0.75rem]">${formatSize(file.size)}</span></td>
                <td class="py-3 px-4 text-zinc-300 align-middle"><span class="fm-file-meta text-zinc-500 text-[0.75rem]">${formatDate(file.lastModified)}</span></td>
            `;

            row.addEventListener('click', () => selectFile(file, row));
            listEl.appendChild(row);
        });
    }

    function selectFile(file, rowEl) {
        state.selectedFile = file;
        
        // Remove selection classes from all rows
        document.querySelectorAll('.fm-file-row').forEach(row => {
            row.classList.remove('selected', 'bg-amber-500/10');
            const icon = row.querySelector('.fm-file-icon');
            if (icon) {
                icon.classList.remove('text-amber-500');
                icon.classList.add('text-zinc-500');
            }
        });
        
        // Add selection classes to clicked row
        rowEl.classList.add('selected', 'bg-amber-500/10');
        const activeIcon = rowEl.querySelector('.fm-file-icon');
        if (activeIcon) {
            activeIcon.classList.remove('text-zinc-500');
            activeIcon.classList.add('text-amber-500');
        }

        updateToolbar();
    }

    function updateToolbar() {
        const canAct = !!state.selectedFile;
        const renameBtn = document.getElementById('fm-btn-rename');
        const deleteBtn = document.getElementById('fm-btn-delete');

        if (renameBtn) renameBtn.disabled = !canAct;
        if (deleteBtn) deleteBtn.disabled = !canAct;
    }

    async function handleRename() {
        if (!state.selectedFile) return;

        const oldName = state.selectedFile.name;
        const newName = await showPromptModal("Rename File", "Enter new name for the file:", oldName);

        if (newName && newName !== oldName) {
            const workspace = window.WorkspaceManager.current;
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const folderPath = `${workspace.path}${sep}${state.currentFolder}`;
            const oldPath = state.selectedFile.path;
            const newPath = `${folderPath}${sep}${newName}`;

            try {
                await window.TauriBridge.fs.rename(oldPath, newPath);
                showToast("File renamed", "success");
                refresh();
            } catch (err) {
                console.error("[File Manager] Rename error:", err);
                showToast("Rename failed", "error");
            }
        }
    }

    async function handleDelete() {
        if (!state.selectedFile) return;

        const proceed = await showConfirmModal(
            "Delete File",
            `Are you sure you want to delete "${state.selectedFile.name}"? This cannot be undone.`,
            "Delete",
            "bg-red-600 hover:bg-red-500"
        );

        if (proceed) {
            try {
                await window.TauriBridge.fs.remove(state.selectedFile.path);
                showToast("File deleted", "success");
                refresh();
            } catch (err) {
                console.error("[File Manager] Delete error:", err);
                showToast("Delete failed", "error");
            }
        }
    }

    async function openExplorer() {
        if (!window.WorkspaceManager?.current) return;
        const workspace = window.WorkspaceManager.current;
        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const folderPath = `${workspace.path}${sep}${state.currentFolder}`;
        
        try {
            await window.TauriBridge.opener.open(folderPath);
        } catch (err) {
            console.error("[File Manager] Open explorer error:", err);
            showToast("Failed to open explorer", "error");
        }
    }

    /* ── Utilities ─────────────────────────────────────────────────────── */

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatDate(ms) {
        if (!ms) return '—';
        const date = new Date(ms);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function showToast(message, type = 'info') {
        // Reuse toast logic if available or create simple one
        const colorMap = { success: 'bg-emerald-600', error: 'bg-red-600', info: 'bg-zinc-700' };
        const el = document.createElement('div');
        el.className = `fixed bottom-6 right-6 z-50 px-4 py-2 rounded-lg text-white text-sm shadow-xl animate-fade-enter ${colorMap[type]}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    async function showConfirmModal(title, text, confirmLabel, confirmClass) {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
            modal.innerHTML = `
                <div class="glass-panel w-full max-w-sm p-6 shadow-2xl animate-fade-enter">
                    <h3 class="text-lg font-semibold text-white mb-2">${escHtml(title)}</h3>
                    <p class="text-zinc-400 text-sm mb-6">${escHtml(text)}</p>
                    <div class="flex gap-3">
                        <button id="modal-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                        <button id="modal-confirm" class="flex-1 px-4 py-2 rounded-lg ${confirmClass} text-white text-sm font-medium transition-colors">${escHtml(confirmLabel)}</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            modal.querySelector('#modal-cancel').onclick = () => { modal.remove(); resolve(false); };
            modal.querySelector('#modal-confirm').onclick = () => { modal.remove(); resolve(true); };
        });
    }

    async function showPromptModal(title, text, defaultValue = '') {
        return new Promise(resolve => {
            const modal = document.createElement('div');
            modal.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4';
            modal.innerHTML = `
                <div class="glass-panel w-full max-w-sm p-6 shadow-2xl animate-fade-enter">
                    <h3 class="text-lg font-semibold text-white mb-2">${escHtml(title)}</h3>
                    <p class="text-zinc-400 text-sm mb-4">${escHtml(text)}</p>
                    <input type="text" id="modal-input" class="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm mb-6 focus:outline-none focus:border-amber-500" value="${escHtml(defaultValue)}">
                    <div class="flex gap-3">
                        <button id="modal-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                        <button id="modal-confirm" class="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">Save</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);

            const input = modal.querySelector('#modal-input');
            input.focus();
            input.select();

            modal.querySelector('#modal-cancel').onclick = () => { modal.remove(); resolve(null); };
            modal.querySelector('#modal-confirm').onclick = () => { 
                const val = input.value.trim();
                modal.remove(); 
                resolve(val); 
            };
            
            input.onkeydown = (e) => {
                if (e.key === 'Enter') modal.querySelector('#modal-confirm').click();
                if (e.key === 'Escape') modal.querySelector('#modal-cancel').click();
            };
        });
    }

    return { init };
})();

window.FileManager = FileManager;
