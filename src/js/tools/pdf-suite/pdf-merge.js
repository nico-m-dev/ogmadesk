/**
 * PDF Suite — Merge Tab
 * Select multiple PDFs, reorder via drag-and-drop thumbnails, merge them.
 */

var PdfMerge = (() => {
    /* ------------------------------------------------------------------
     * State
     * ------------------------------------------------------------------ */
    let files = []; // Array of { id, name, path, bytes: Uint8Array, pageCount, thumbnail: dataURL }

    let isInit = false; // Prevent multiple listener bindings
    let dragSrcId = null;
    let nextId    = 0;

    /* ------------------------------------------------------------------
     * DOM refs (resolved after the fragment is in the DOM)
     * ------------------------------------------------------------------ */
    const el = () => ({
        dropzone:    document.getElementById('merge-dropzone'),
        list:        document.getElementById('merge-file-list'),
        empty:       document.getElementById('merge-empty'),
        mergeBtn:    document.getElementById('merge-btn'),
        addBtn:      document.getElementById('merge-add-btn'),
        clearBtn:    document.getElementById('merge-clear-btn'),
        fileCount:   document.getElementById('merge-file-count'),
        pageCount:   document.getElementById('merge-page-count'),
        loading:     document.getElementById('merge-loading'),
        loadingText: document.getElementById('merge-loading-text'),
    });

    /* ------------------------------------------------------------------
     * Init
     * ------------------------------------------------------------------ */
    function init() {
        if (isInit) return;
        
        const e = el();
        if (!e.addBtn) return; // not in DOM yet
        
        isInit = true;

        e.addBtn.addEventListener('click', openFilePicker);
        e.clearBtn?.addEventListener('click', clearAll);
        e.mergeBtn?.addEventListener('click', mergePdfs);

        // Native Tauri file drop (much more robust than browser's native drop in WebView)
        if (window.TauriBridge?.isDesktop()) {
            // Clean up any existing listener to prevent duplicate entries (ghost listeners)
            if (typeof window._pdfMergeUnlisten === 'function') {
                window._pdfMergeUnlisten();
                window._pdfMergeUnlisten = null;
            }

            window.TauriBridge.event.listen('tauri://drag-drop', async (ev) => {
                const paths = ev.payload.paths; // This is an array of paths dropped
                if (!paths || paths.length === 0) return;
                
                // Only process if the Merge tab is actually visible
                const panel = document.querySelector('[data-tab-panel="merge"]');
                if (panel && panel.style.display !== 'none') {
                    const dropped = paths.filter(p => p.toLowerCase().endsWith('.pdf'));
                    if (dropped.length > 0) {
                        showLoading(`Loading ${dropped.length} file(s)...`);
                        for (const p of dropped) await loadFilePath(p);
                        hideLoading();
                    }
                }
            }).then(unlistenFn => {
                window._pdfMergeUnlisten = unlistenFn;
            });
        }

        // Fallback or browser-only drops (e.g. dragging internally)
        window.addEventListener('dragover', ev => ev.preventDefault(), false);
        window.addEventListener('drop',     ev => ev.preventDefault(), false);

        // Drag-over on the whole dropzone (browser-native fallback/internal)
        e.dropzone?.addEventListener('dragenter', ev => {
            ev.preventDefault();
            const types = ev.dataTransfer.types;
            if (types.includes('Files') || types.includes('text/uri-list')) {
                e.dropzone.classList.add('drag-over');
            }
        });

        e.dropzone?.addEventListener('dragover', ev => {
            ev.preventDefault();
            const types = ev.dataTransfer.types;
            if (types.includes('Files') || types.includes('text/uri-list')) {
                ev.dataTransfer.dropEffect = 'copy';
                e.dropzone.classList.add('drag-over');
            }
        });

        e.dropzone?.addEventListener('dragleave', ev => {
            if (ev.relatedTarget && e.dropzone.contains(ev.relatedTarget)) return;
            e.dropzone.classList.remove('drag-over');
        });

        e.dropzone?.addEventListener('drop', async ev => {
            ev.preventDefault();
            e.dropzone.classList.remove('drag-over');
            
            const dt = ev.dataTransfer;
            if (dt.files && dt.files.length > 0) {
                const dropped = Array.from(dt.files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
                if (dropped.length > 0) {
                    showLoading(`Loading ${dropped.length} file(s)...`);
                    for (const f of dropped) await loadFileObject(f);
                    hideLoading();
                }
            }
        });
    }

    function onActivate() {
        init();
        refresh();
    }

    /* ------------------------------------------------------------------
     * Loading UI
     * ------------------------------------------------------------------ */
    function showLoading(msg) {
        const e = el();
        if (e.loading) {
            if (e.loadingText) e.loadingText.textContent = msg || 'Loading...';
            e.loading.setAttribute('style', 'display: flex !important');
        }
        if (e.addBtn) e.addBtn.disabled = true;
        if (e.mergeBtn) e.mergeBtn.disabled = true;
    }

    function hideLoading() {
        const e = el();
        if (e.loading) e.loading.setAttribute('style', 'display: none !important');
        if (e.addBtn) e.addBtn.disabled = false;
        if (files.length >= 2 && e.mergeBtn) e.mergeBtn.disabled = false;
    }

    /* ------------------------------------------------------------------
     * File loading
     * ------------------------------------------------------------------ */
    async function openFilePicker() {
        const workspace = window.WorkspaceManager?.current;
        
        if (workspace) {
            await showWorkspaceFilePicker();
        } else {
            try {
                const paths = await window.TauriBridge.dialog.open({
                    multiple: true,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
                });
                if (!paths) return;
                const arr = Array.isArray(paths) ? paths : [paths];
                showLoading(`Loading ${arr.length} file(s)...`);
                for (const p of arr) await loadFilePath(p);
                hideLoading();
            } catch (err) {
                window.PdfSuite.showToast('Could not open file: ' + (err.message || err), 'error');
            }
        }
    }

    async function showWorkspaceFilePicker() {
        const workspace = window.WorkspaceManager.current;
        const sep = workspace.path.includes('\\') ? '\\' : '/';
        const pdfsDir = `${workspace.path}${sep}PDFs`;
        
        let pdfFiles = [];
        try {
            const exists = await window.TauriBridge.fs.exists(pdfsDir);
            if (exists) {
                const entries = await window.TauriBridge.fs.readDir(pdfsDir);
                pdfFiles = entries.filter(e => e && !e.isDirectory && e.name.toLowerCase().endsWith('.pdf'));
            }
        } catch (err) {
            console.error('[PdfMerge] Error reading PDFs folder:', err);
        }
        
        const existingIds = new Set(files.map(f => f.path));
        
        const modal = document.createElement('div');
        modal.id = 'pdf-workspace-picker';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        
        const selectedFiles = new Set();
        
        const updateSelectedCount = () => {
            const countEl = modal.querySelector('#ws-selected-count');
            if (countEl) countEl.textContent = `${selectedFiles.size} selected`;
        };
        
        const renderFileList = () => {
            const listEl = modal.querySelector('#ws-file-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            
            if (pdfFiles.length === 0) {
                listEl.innerHTML = '<p class="text-zinc-500 text-sm text-center py-4">No PDF files in Workspace/PDFs/</p>';
                return;
            }
            
            pdfFiles.forEach(f => {
                const item = document.createElement('div');
                const isSelected = selectedFiles.has(f.name);
                const isLoaded = existingIds.has(`${pdfsDir}${sep}${f.name}`);
                
                item.className = `flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${isSelected ? 'bg-amber-900/40 border border-amber-500/50' : 'hover:bg-zinc-800 border border-transparent'} ${isLoaded ? 'opacity-50' : ''}`;
                
                item.innerHTML = `
                    <input type="checkbox" class="w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-amber-500 focus:ring-amber-500 focus:ring-offset-0" ${isSelected ? 'checked' : ''} ${isLoaded ? 'disabled' : ''}>
                    <i class="ph ph-file-pdf text-xl text-red-400"></i>
                    <span class="text-sm text-zinc-300 truncate flex-1">${window.PdfSuite.escHtml(f.name)}</span>
                    ${isLoaded ? '<span class="text-xs text-zinc-500">(already added)</span>' : ''}
                `;
                
                if (!isLoaded) {
                    const checkbox = item.querySelector('input[type="checkbox"]');
                    checkbox.addEventListener('change', (e) => {
                        if (e.target.checked) {
                            selectedFiles.add(f.name);
                        } else {
                            selectedFiles.delete(f.name);
                        }
                        updateSelectedCount();
                    });
                }
                
                listEl.appendChild(item);
            });
        };
        
        renderFileList();
        
        modal.innerHTML = `
            <div class="glass-panel w-[500px] max-h-[80vh] flex flex-col shadow-2xl animate-fade-enter">
                <div class="flex items-center p-4 border-b border-zinc-700">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-file-pdf text-red-400 text-xl"></i>
                    </div>
                    <h2 class="text-lg font-semibold text-white flex-1">Select PDF Files</h2>
                    <button id="ws-close" class="text-zinc-400 hover:text-white transition-colors">
                        <i class="ph ph-x text-xl"></i>
                    </button>
                </div>
                
                <div id="ws-file-list" class="flex-1 overflow-y-auto p-3 space-y-1 max-h-[400px]">
                </div>
                
                <div class="p-4 border-t border-zinc-700 flex flex-col gap-3">
                    <div class="flex items-center justify-between text-sm">
                        <span class="text-zinc-400"><span id="ws-selected-count">0 selected</span></span>
                    </div>
                    
                    <div class="flex gap-2">
                        <button id="ws-from-pc" class="flex-1 flex items-center px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-left transition-colors group">
                            <i class="ph ph-hard-drive text-zinc-400 text-lg mr-3 group-hover:scale-110 transition-transform"></i>
                            <div>
                                <div class="text-sm font-medium text-white">Select from Computer</div>
                                <div class="text-xs text-zinc-400">Choose PDF files from your PC</div>
                            </div>
                        </button>
                        <button id="ws-cancel" class="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                            Cancel
                        </button>
                        <button id="ws-add" class="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">
                            Add Selected
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        renderFileList();
        
        modal.querySelector('#ws-close').addEventListener('click', () => modal.remove());
        modal.querySelector('#ws-cancel').addEventListener('click', () => modal.remove());
        
        modal.querySelector('#ws-from-pc').addEventListener('click', async () => {
            modal.remove();
            try {
                const paths = await window.TauriBridge.dialog.open({
                    multiple: true,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
                });
                if (!paths) return;
                const arr = Array.isArray(paths) ? paths : [paths];
                showLoading(`Loading ${arr.length} file(s)...`);
                for (const p of arr) await loadFilePath(p);
                hideLoading();
            } catch (err) {
                window.PdfSuite.showToast('Could not open file: ' + (err.message || err), 'error');
            }
        });
        
        modal.querySelector('#ws-add').addEventListener('click', async () => {
            if (selectedFiles.size === 0) {
                window.PdfSuite.showToast('Please select at least one file', 'info');
                return;
            }
            
            modal.remove();
            showLoading(`Loading ${selectedFiles.size} file(s)...`);
            for (const fname of selectedFiles) {
                const fullPath = `${pdfsDir}${sep}${fname}`;
                await loadFilePath(fullPath);
            }
            hideLoading();
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    async function loadFilePath(path) {
        try {
            const bytes = await readBinaryFile(path);
            const name  = window.PdfSuite.basename(path);
            await addEntry(name, path, bytes);
        } catch (err) {
            window.PdfSuite.showToast(`Failed to load ${window.PdfSuite.basename(path)}: ${err.message || err}`, 'error');
        }
    }

    async function loadFileObject(file) {
        try {
            const ab    = await file.arrayBuffer();
            const bytes = new Uint8Array(ab);
            await addEntry(file.name, null, bytes);
        } catch (err) {
            window.PdfSuite.showToast(`Failed to load ${file.name}: ${err.message || err}`, 'error');
        }
    }

    /* ------------------------------------------------------------------
     * Add an entry (PDF bytes) to the list
     * ------------------------------------------------------------------ */
    async function addEntry(name, path, bytes) {
        const id     = nextId++;
        const thumb  = await renderFirstPage(bytes);
        let pageCount = 0;
        try {
            const { PDFDocument } = window.PDFLib;
            const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
            pageCount = doc.getPageCount();
        } catch (_) {}

        files.push({ id, name, path, bytes, pageCount, thumb });
        renderList();
    }

    /* ------------------------------------------------------------------
     * Render the file list
     * ------------------------------------------------------------------ */
    function renderList() {
        const e = el();
        const hasFiles = files.length > 0;
        
        // UI Visibility
        if (e.empty) e.empty.style.display = hasFiles ? 'none' : 'flex';
        if (e.list)  e.list.style.display  = hasFiles ? 'flex' : 'none';

        e.mergeBtn?.classList.toggle('opacity-50', files.length < 2);
        e.mergeBtn?.toggleAttribute('disabled', files.length < 2);
        e.clearBtn?.classList.toggle('hidden', !hasFiles);

        const totalPages  = files.reduce((s, f) => s + f.pageCount, 0);
        if (e.fileCount)  e.fileCount.textContent  = `${files.length} file${files.length !== 1 ? 's' : ''}`;
        if (e.pageCount)  e.pageCount.textContent  = `${totalPages} page${totalPages !== 1 ? 's' : ''}`;

        if (!e.list || !hasFiles) return;
        e.list.innerHTML = '';

        files.forEach((f, idx) => {
            const card = document.createElement('div');
            card.className = 'pdf-merge-card group relative';
            card.dataset.id = f.id;
            // Removed card.draggable = true; Sortable handles it

            card.innerHTML = `
                <div class="pdf-merge-thumb pointer-events-none select-none">
                    ${f.thumb ? `<img src="${f.thumb}" alt="Page 1" class="w-full h-full object-contain pointer-events-none" draggable="false">` : `<i class="ph ph-file-pdf text-4xl text-zinc-500 pointer-events-none"></i>`}
                </div>
                <div class="p-[0.45rem_0.4rem_0.5rem] flex flex-col items-center gap-0.5 pointer-events-none select-none">
                    <div class="absolute top-[6px] left-[6px] w-[22px] h-[22px] bg-amber-500/90 text-white text-[0.65rem] font-bold rounded-full flex items-center justify-center pointer-events-none shadow-sm">${idx + 1}</div>
                    <p class="text-xs text-center text-zinc-300 truncate w-full px-1 pointer-events-none" title="${window.PdfSuite.escHtml(f.name)}">${window.PdfSuite.escHtml(f.name)}</p>
                    <p class="text-[10px] text-zinc-500 text-center pointer-events-none">${f.pageCount} page${f.pageCount !== 1 ? 's' : ''}</p>
                </div>
                <button class="absolute top-[5px] right-[5px] w-[22px] h-[22px] bg-red-500/75 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer border-none hover:bg-red-500 shadow-sm pdf-merge-remove" data-id="${f.id}" title="Remove">
                    <i class="ph ph-x text-xs"></i>
                </button>
                <div class="absolute bottom-[38px] right-[5px] text-zinc-500 text-[0.9rem] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab hover:text-zinc-300" title="Drag to reorder">
                    <i class="ph ph-dots-six-vertical pointer-events-none"></i>
                </div>
            `;

            // Remove button
            card.querySelector('.pdf-merge-remove').addEventListener('click', e => {
                e.stopPropagation();
                removeFile(f.id);
            });

            e.list.appendChild(card);
        });

        // Initialize SortableJS
        if (window.Sortable && e.list) {
            if (e.list._sortable) {
                e.list._sortable.destroy();
            }
            e.list._sortable = new window.Sortable(e.list, {
                animation: 150,
                swapThreshold: 0.65,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                forceFallback: true,
                fallbackClass: 'sortable-drag',
                fallbackOnBody: true,
                onEnd: function (evt) {
                    if (evt.oldIndex === evt.newIndex) return;
                    
                    // The DOM changed, now sync the array
                    const movedItem = files.splice(evt.oldIndex, 1)[0];
                    files.splice(evt.newIndex, 0, movedItem);
                    
                    // Re-render to update the number badges
                    renderList();
                }
            });
        }
    }

    function refresh() { renderList(); }

    /* ------------------------------------------------------------------
     * List manipulation
     * ------------------------------------------------------------------ */
    function removeFile(id) {
        const idx = files.findIndex(f => f.id === id);
        if (idx !== -1) files.splice(idx, 1);
        renderList();
    }

    function clearAll() {
        files.length = 0;
        renderList();
    }

    function reorderFiles(srcId, targetId) {
        const si = files.findIndex(f => f.id === srcId);
        const ti = files.findIndex(f => f.id === targetId);
        if (si === -1 || ti === -1) return;
        const [moved] = files.splice(si, 1);
        files.splice(ti, 0, moved);
        renderList();
    }

    /* ------------------------------------------------------------------
     * Merge
     * ------------------------------------------------------------------ */
    async function mergePdfs() {
        if (files.length < 2) return;

        const btn = el().mergeBtn;
        btn.disabled   = true;
        btn.innerHTML  = `<i class="ph ph-spinner-gap animate-spin mr-2"></i>Merging…`;

        try {
            const { PDFDocument } = window.PDFLib;
            const merged = await PDFDocument.create();

            for (const f of files) {
                const src   = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
                const pages = await merged.copyPages(src, src.getPageIndices());
                pages.forEach(p => merged.addPage(p));
            }

            const resultBytes  = await merged.save();
            const suggestedName = `merged_${window.PdfSuite.todayStamp()}.pdf`;
            await window.PdfSuite.saveResult(resultBytes, suggestedName);

        } catch (err) {
            console.error('[PdfMerge] merge error:', err);
            window.PdfSuite.showToast('Merge failed: ' + (err.message || err), 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = `<i class="ph ph-git-merge mr-2"></i>Merge PDFs`;
        }
    }

    /* ------------------------------------------------------------------
     * PDF.js thumbnail renderer
     * ------------------------------------------------------------------ */
    async function renderFirstPage(bytes) {
        try {
            const pdfjsLib = window.pdfjsLib;
            if (!pdfjsLib) return null;
            const doc  = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
            const page = await doc.getPage(1);
            const viewport = page.getViewport({ scale: 0.5 });

            const canvas  = document.createElement('canvas');
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            return canvas.toDataURL('image/webp', 0.7);
        } catch (_) {
            return null;
        }
    }

    /* ------------------------------------------------------------------
     * Binary file reader (Tauri or browser ArrayBuffer)
     * ------------------------------------------------------------------ */
    async function readBinaryFile(path) {
        if (window.TauriBridge?.fs?.readFile) return await window.TauriBridge.fs.readFile(path);
        const res = await fetch(path);
        const ab  = await res.arrayBuffer();
        return new Uint8Array(ab);
    }

    function reset() {
        files.length = 0;
        renderList();
    }

    /* ------------------------------------------------------------------
     * Public
     * ------------------------------------------------------------------ */
    return { init, onActivate, reset };
})();

window.PdfMerge = PdfMerge;
