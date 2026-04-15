/**
 * Markdown Editor — File System Extension
 * Manages the left sidebar file tree when in Workspace mode.
 * Features: Recursive folders, Drag & Drop move, Context Menus, Inline Rename.
 */

var MarkdownFS = (() => {
    let sidebarEl;
    let treeEl;
    let contextMenu;
    let contextTarget = null; // { path: string, isDir: boolean, el: HTMLElement }

    function init() {
        sidebarEl = document.getElementById('md-sidebar');
        treeEl = document.getElementById('md-file-tree');
        contextMenu = document.getElementById('md-context-menu');

        const workspace = window.WorkspaceManager?.current;
        if (workspace) {
            sidebarEl.classList.add('active');
            loadFiles(workspace);
        } else {
            sidebarEl.classList.remove('active');
        }

        bindContextEvents();
    }

    async function loadFiles(workspace = window.WorkspaceManager?.current) {
        if (!workspace || !treeEl) return;

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const mdDir = `${workspace.path}${sep}Markdown`;
            await window.TauriBridge.fs.mkdir(mdDir, { recursive: true });
            
            treeEl.innerHTML = ''; // reset
            treeEl.dataset.path = mdDir;
            
            // Set up root dropzone
            setupDropZone(treeEl, mdDir);

            await renderRecursive(mdDir, treeEl, 0);
        } catch (err) {
            console.error('[Markdown FS] loadFiles error:', err);
            treeEl.innerHTML = `<div class="text-xs text-red-500 px-2">Failed to load folder tree</div>`;
        }
    }

    async function renderRecursive(dirPath, containerEl, depth) {
        const entries = await window.TauriBridge.fs.readDir(dirPath);
        
        let folders = [];
        let files = [];

        entries.forEach(e => {
            if (!e || !e.name || e.name.startsWith('.')) return; // ignore hidden
            const isDir = e.isDirectory || e.children !== undefined;
            if (isDir) {
                folders.push(e);
            } else {
                const n = e.name.toLowerCase();
                if (n.endsWith('.md') || n.endsWith('.markdown') || n.endsWith('.txt')) {
                    files.push(e);
                }
            }
        });

        folders.sort((a,b) => a.name.localeCompare(b.name));
        files.sort((a,b) => a.name.localeCompare(b.name));

        const sep = dirPath.includes('\\') ? '\\' : '/';

        for (const folder of folders) {
            const fullPath = `${dirPath}${sep}${folder.name}`;
            const div = document.createElement('div');
            
            div.className = `flex flex-col select-none`;
            
            // The clickable header
            const header = document.createElement('div');
            header.className = `flex items-center gap-1.5 py-1 px-2 text-[0.75rem] text-zinc-300 hover:bg-zinc-800/80 cursor-pointer group`;
            header.style.paddingLeft = `${depth * 0.75 + 0.5}rem`;
            header.dataset.path = fullPath;
            header.dataset.isDir = "true";
            header.draggable = true;

            header.innerHTML = `
                <i class="ph ph-caret-down text-zinc-500 text-[0.65rem] transition-transform pointer-events-none"></i>
                <i class="ph ph-folder-simple text-amber-500 group-hover:text-amber-400 pointer-events-none"></i>
                <span class="truncate flex-1 pointer-events-none">${escHtml(folder.name)}</span>
            `;

            // Children container
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'flex flex-col';
            childrenContainer.dataset.path = fullPath; // for dropping
            
            setupDragSource(header, fullPath, true);
            setupDropZone(header, fullPath); // dropping on header drops INTO the folder
            setupDropZone(childrenContainer, fullPath); // dropping on children wrapper drops into folder
            
            setupContextMenu(header, fullPath, true);

            let expanded = true;
            header.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return; // ignore if editing
                
                // Only toggle expand if dragging is not happening
                if (draggedPath) return;

                expanded = !expanded;
                childrenContainer.style.display = expanded ? 'flex' : 'none';
                header.querySelector('.ph-caret-down').style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
                header.querySelector('.ph-folder-simple').className = expanded ? 'ph ph-folder-simple-open text-amber-500' : 'ph ph-folder-simple text-amber-600';
            });

            div.appendChild(header);
            div.appendChild(childrenContainer);
            containerEl.appendChild(div);

            await renderRecursive(fullPath, childrenContainer, depth + 1);
        }

        const currentLoadedFile = window.MarkdownEditor?.state.filename;

        for (const file of files) {
            const fullPath = `${dirPath}${sep}${file.name}`;
            const isActive = currentLoadedFile === getRelativePath(fullPath);

            const div = document.createElement('div');
            div.className = `flex items-center gap-1.5 py-1 px-2 text-[0.75rem] ${isActive ? 'bg-amber-900/40 text-amber-300' : 'text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200'} cursor-pointer group transition-colors`;
            div.style.paddingLeft = `${depth * 0.75 + 1.25}rem`;
            div.dataset.path = fullPath;
            div.dataset.isDir = "false";
            div.draggable = true;

            div.innerHTML = `
                <i class="ph ph-file-text ${isActive ? 'text-amber-400' : 'text-zinc-500 group-hover:text-zinc-400'} pointer-events-none"></i>
                <span class="truncate flex-1 pointer-events-none">${escHtml(file.name)}</span>
            `;

            setupDragSource(div, fullPath, false);
            setupContextMenu(div, fullPath, false);

            div.addEventListener('click', async (e) => {
                if (e.target.tagName === 'INPUT') return;
                if (window.MarkdownEditor) {
                    if (window.MarkdownEditor.state.isDirty && window.MarkdownEditor.state.filename !== getRelativePath(fullPath)) {
                        const ok = await window.MarkdownEditor.showConfirmModal(
                            'Unsaved Changes',
                            'You have unsaved changes. Discard them to open this file?',
                            'Discard',
                            'bg-red-600 hover:bg-red-500'
                        );
                        if (!ok) return;
                    }
                    await window.MarkdownEditor.loadFile(fullPath);
                    // Force refresh visuals
                    loadFiles();
                }
            });

            containerEl.appendChild(div);
        }
    }

    /* ------------------------------------------------------------------
     * Drag & Drop (Move logic)
     * ------------------------------------------------------------------ */
    let draggedPath = null;

    function setupDragSource(el, path, isDir) {
        el.addEventListener('dragstart', e => {
            if (e.target.tagName === 'INPUT') { e.preventDefault(); return; } // prevent drag while renaming
            draggedPath = path;
            e.dataTransfer.setData('text/plain', path);
            el.style.opacity = '0.4';
        });
        el.addEventListener('dragend', () => {
            el.style.opacity = '1';
            draggedPath = null;
            document.querySelectorAll('.md-drop-target').forEach(e => e.classList.remove('md-drop-target', 'bg-amber-500/20'));
        });
    }

    function setupDropZone(el, targetDirPath) {
        if (el.dataset.dropBound) return;
        el.dataset.dropBound = 'true';

        el.addEventListener('dragenter', e => {
            if (!draggedPath) return;
            e.preventDefault();
            e.stopPropagation();
            el.classList.add('md-drop-target', 'bg-amber-500/20');
        });
        el.addEventListener('dragover', e => {
            if (!draggedPath) return; // ignore external drops (like real images)
            e.preventDefault();
            e.stopPropagation();
            el.classList.add('md-drop-target', 'bg-amber-500/20');
        });
        el.addEventListener('dragleave', e => {
            if (!draggedPath) return;
            e.stopPropagation();
            el.classList.remove('md-drop-target', 'bg-amber-500/20');
        });
        el.addEventListener('drop', async e => {
            let sourcePath = draggedPath || e.dataTransfer.getData('text/plain');
            if (!sourcePath) return;

            e.preventDefault();
            e.stopPropagation();
            el.classList.remove('md-drop-target', 'bg-amber-500/20');
            
            if (sourcePath === targetDirPath) return; // ignore drop on self

            const sep = sourcePath.includes('\\') ? '\\' : '/';
            const filename = sourcePath.replace(/.*[\\/]/, '');
            const finalPath = `${targetDirPath}${sep}${filename}`;

            if (sourcePath === finalPath) return; // same dir

            try {
                // If it's tauri we can just rename. If it throws, fallback
                await window.TauriBridge.fs.rename(sourcePath, finalPath);
                loadFiles();
            } catch (err) {
                console.error("Move failed:", err);
                showToast("Move failed: " + err, "error");
            }
        });
    }

    /* ------------------------------------------------------------------
     * Context Menu & Inline Operations
     * ------------------------------------------------------------------ */
    function bindContextEvents() {
        document.addEventListener('click', e => {
            if (!contextMenu.contains(e.target)) {
                contextMenu.classList.add('hidden');
            }
        });
        
        // Hide on scroll
        sidebarEl.addEventListener('scroll', () => {
            contextMenu.classList.add('hidden');
        });

        // Ensure tree root can be right-clicked if empty
        sidebarEl.addEventListener('contextmenu', e => {
            if (e.target === sidebarEl || e.target === treeEl || e.target.closest('.md-sidebar-section')) {
                const existingTarget = e.target.closest('[data-path]');
                if (existingTarget && existingTarget !== treeEl) return;
                
                e.preventDefault();
                showContextMenu(e, treeEl.dataset.path, true, treeEl);
            }
        });

        // Context menu actions
        document.getElementById('md-ctx-newfile').addEventListener('click', () => {
            contextMenu.classList.add('hidden');
            if (contextTarget) spawnInlineEditor('file', contextTarget);
        });
        document.getElementById('md-ctx-newfolder').addEventListener('click', () => {
            contextMenu.classList.add('hidden');
            if (contextTarget) spawnInlineEditor('folder', contextTarget);
        });
        document.getElementById('md-ctx-rename').addEventListener('click', () => {
            contextMenu.classList.add('hidden');
            if (contextTarget && contextTarget.path !== treeEl.dataset.path) {
                spawnInlineEditor('rename', contextTarget);
            }
        });
        document.getElementById('md-ctx-delete').addEventListener('click', async () => {
            contextMenu.classList.add('hidden');
            if (!contextTarget || contextTarget.path === treeEl.dataset.path) return;
            
            const confirmed = await window.TauriBridge.dialog.ask(`Are you sure you want to delete ${contextTarget.path.replace(/.*[\\/]/, '')}?`);
            if (confirmed) {
                try {
                    if (contextTarget.isDir) {
                        await window.TauriBridge.fs.remove(contextTarget.path, { recursive: true });
                    } else {
                        await window.TauriBridge.fs.remove(contextTarget.path);
                    }
                    loadFiles();
                } catch(e) {
                    showToast("Delete failed: " + e, 'error');
                }
            }
        });
    }

    function setupContextMenu(el, path, isDir) {
        el.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            showContextMenu(e, path, isDir, el);
        });
    }

    function showContextMenu(e, path, isDir, el) {
        contextTarget = { path, isDir, el };

        // Position
        contextMenu.style.left = `${e.clientX}px`;
        contextMenu.style.top = `${e.clientY}px`;
        contextMenu.classList.remove('hidden');

        // Logic toggles
        const renameBtn = document.getElementById('md-ctx-rename');
        const deleteBtn = document.getElementById('md-ctx-delete');
        const newFileBtn = document.getElementById('md-ctx-newfile');
        const newFolderBtn = document.getElementById('md-ctx-newfolder');

        // If clicking on a file, "New..." should probably go into its parent dir.
        // For simplicity, allowed everywhere, handled in spawnInlineEditor.
        
        // Hide rename/delete if it's the root Markdown folder
        if (path === treeEl.dataset.path) {
            renameBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
        } else {
            renameBtn.style.display = 'flex';
            deleteBtn.style.display = 'flex';
        }
    }

    /* ------------------------------------------------------------------
     * Inline Editing
     * ------------------------------------------------------------------ */
    async function spawnInlineEditor(mode, target) {
        // mode: 'file', 'folder', 'rename'
        
        const sep = target.path.includes('\\') ? '\\' : '/';
        let parentDir = target.isDir ? target.path : target.path.substring(0, target.path.lastIndexOf(sep));
        
        if (mode === 'rename') {
            parentDir = target.path.substring(0, target.path.lastIndexOf(sep));
        }

        const currentName = mode === 'rename' ? target.path.replace(/.*[\\/]/, '') : '';
        
        const inputContainer = document.createElement('div');
        inputContainer.className = 'flex items-center gap-1 py-1 px-2';
        // Padding matching depth logic conceptually (rough approx)
        let pl = target.el.style.paddingLeft || '1rem';
        if (mode !== 'rename' && target.isDir) {
            // New items inside this dir indent further
            pl = (parseFloat(pl) + 0.75) + 'rem';
        }
        inputContainer.style.paddingLeft = pl;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'flex-1 bg-zinc-900 border border-amber-600 text-zinc-200 text-[0.75rem] px-1 focus:outline-none';
        
        inputContainer.appendChild(input);

        // Insertion DOM logic
        if (mode === 'rename') {
            target.el.style.display = 'none';
            target.el.parentNode.insertBefore(inputContainer, target.el);
        } else {
            // Append as child of the directory container
            let container = target.el;
            if (target.el.classList.contains('group')) {
                // it's the header, the next sibling is the children wrapper
                container = target.el.nextElementSibling;
            }
            if (!container) container = treeEl; // fallback
            
            // force expand folder if it was collapsed
            if (container.style.display === 'none') {
                target.el.click(); // toggle it open
            }
            container.insertBefore(inputContainer, container.firstChild);
        }

        input.focus();
        if (mode === 'rename') {
            // Select text w/o extension
            const dotIdx = currentName.lastIndexOf('.');
            if (dotIdx > 0 && !target.isDir) {
                input.setSelectionRange(0, dotIdx);
            } else {
                input.select();
            }
        }

        let isDone = false;

        const cleanup = async (cancel) => {
            if (isDone) return;
            isDone = true;
            inputContainer.remove();
            if (mode === 'rename') target.el.style.display = 'flex';
            
            if (cancel) return;

            let newVal = input.value.trim();
            // Remove illegal OS characters but allow spaces
            newVal = newVal.replace(/[\\/:*?"<>|]/g, '');
            
            if (!newVal || newVal === currentName) return;

            try {
                const newPath = `${parentDir}${sep}${newVal}`;

                if (mode === 'rename') {
                    await window.TauriBridge.fs.rename(target.path, newPath);
                } else if (mode === 'folder') {
                    await window.TauriBridge.fs.mkdir(newPath);
                } else if (mode === 'file') {
                    const finalPath = newVal.endsWith('.md') ? newPath : `${newPath}.md`;
                    await window.TauriBridge.fs.writeTextFile(finalPath, '');
                }
                loadFiles(); // refresh
            } catch(e) {
                showToast("Operation failed: " + e, 'error');
            }
        };

        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') cleanup(false);
            if (e.key === 'Escape') cleanup(true);
        });
        input.addEventListener('blur', () => cleanup(false));
    }

    /* ------------------------------------------------------------------
     * Utils
     * ------------------------------------------------------------------ */
    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function getRelativePath(absPath) {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return absPath.replace(/.*[\\/]/, ''); // fallback to basename
        
        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const mdDir = `${workspace.path}${sep}Markdown${sep}`;
        
        if (absPath.startsWith(mdDir)) {
            return absPath.substring(mdDir.length);
        }
        return absPath.replace(/.*[\\/]/, '');
    }

    function showToast(message, type = 'info') {
        if (window.MarkdownEditor?.showToast) {
            window.MarkdownEditor.showToast(message, type);
        } else {
            console.log(`[Toast] ${type}: ${message}`);
        }
    }

    return {
        init,
        loadFiles
    };
})();

window.MarkdownFS = MarkdownFS;
