/**
 * PDF Suite — Split Tab
 * Load one PDF, show all pages as thumbnails, support:
 *  - Delete pages
 *  - Reorder pages via drag-and-drop
 *  - Split by ranges
 *  - Save as single reordered PDF or multiple range-PDFs
 */

var PdfSplit = (() => {
    /* ------------------------------------------------------------------
     * State
     * ------------------------------------------------------------------ */
    const state = {
        sourceName:  null,
        sourceBytes: null,
        pages:       [],  // [{ index: original0based, thumb: dataURL, selected: bool }]
    };

    let dragSrcIdx = null;
    let isInit     = false;

    /* ------------------------------------------------------------------
     * DOM refs
     * ------------------------------------------------------------------ */
    const el = () => ({
        loadBtn:    document.getElementById('split-load-btn'),
        grid:       document.getElementById('split-page-grid'),
        empty:      document.getElementById('split-empty'),
        panel:      document.getElementById('split-panel'),
        pageCount:  document.getElementById('split-page-count'),
        selCount:   document.getElementById('split-sel-count'),
        deleteSelBtn:  document.getElementById('split-delete-sel'),
        saveOrderBtn:  document.getElementById('split-save-order'),
        saveSelectedBtn: document.getElementById('split-save-selected'),
        filename:      document.getElementById('split-filename'),
        clearBtn:      document.getElementById('split-clear-btn'),
        loading:        document.getElementById('split-loading'),
        loadingText:    document.getElementById('split-loading-text'),
    });

    /* ------------------------------------------------------------------
     * Init / Activate
     * ------------------------------------------------------------------ */
    function init() {
        if (isInit) return;
        const e = el();
        if (!e.loadBtn) return;
        isInit = true;
        bindButtons();

        // Native Tauri file drop (for Split)
        if (window.TauriBridge?.isDesktop()) {
            // Clean up any existing listener to prevent duplicate entries (ghost listeners)
            if (typeof window._pdfSplitUnlisten === 'function') {
                window._pdfSplitUnlisten();
                window._pdfSplitUnlisten = null;
            }

            window.TauriBridge.event.listen('tauri://drag-drop', async (ev) => {
                const paths = ev.payload.paths;
                if (!paths || paths.length === 0) return;
                
                // Only process if the Split tab is actually visible
                const panel = document.querySelector('[data-tab-panel="split"]');
                if (panel && panel.style.display !== 'none') {
                    const pdfPath = paths.find(p => p.toLowerCase().endsWith('.pdf'));
                    if (pdfPath) {
                        showLoading(`Loading ${window.PdfSuite.basename(pdfPath)}...`);
                        const bytes = await readBinaryFile(pdfPath);
                        await loadPdf(pdfPath, window.PdfSuite.basename(pdfPath), bytes);
                        hideLoading();
                    }
                }
            }).then(unlistenFn => {
                window._pdfSplitUnlisten = unlistenFn;
            });
        }
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
        if (e.loadBtn) e.loadBtn.disabled = true;
    }

    function hideLoading() {
        const e = el();
        if (e.loading) e.loading.setAttribute('style', 'display: none !important');
        if (e.loadBtn) e.loadBtn.disabled = false;
    }

    function updateLoadingProgress(current, total, name) {
        const e = el();
        if (e.loadingText) {
            e.loadingText.textContent = `Loading ${name}: page ${current} of ${total}...`;
        }
    }

    function bindButtons() {
        const e = el();
        if (!e.loadBtn) return;

        e.loadBtn.addEventListener('click', openFile);
        e.deleteSelBtn?.addEventListener('click', deleteSelected);
        e.saveOrderBtn?.addEventListener('click', saveReordered);
        e.saveSelectedBtn?.addEventListener('click', saveSelected);
        e.clearBtn?.addEventListener('click', clearAll);
    }

    /* ------------------------------------------------------------------
     * Load PDF
     * ------------------------------------------------------------------ */
    async function openFile() {
        const workspace = window.WorkspaceManager?.current;
        
        if (workspace) {
            await showWorkspaceFilePicker();
        } else {
            try {
                const path = await window.TauriBridge.dialog.open({
                    multiple: false,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
                });
                if (!path) return;
                showLoading(`Loading ${window.PdfSuite.basename(path)}...`);
                const bytes = await readBinaryFile(path);
                await loadPdf(path, window.PdfSuite.basename(path), bytes);
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
            console.error('[PdfSplit] Error reading PDFs folder:', err);
        }
        
        const modal = document.createElement('div');
        modal.id = 'pdf-workspace-picker';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        
        modal.innerHTML = `
            <div class="glass-panel w-[500px] max-h-[80vh] flex flex-col shadow-2xl animate-fade-enter">
                <div class="flex items-center p-4 border-b border-zinc-700">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-file-pdf text-red-400 text-xl"></i>
                    </div>
                    <h2 class="text-lg font-semibold text-white flex-1">Select PDF File</h2>
                    <button id="ws-close" class="text-zinc-400 hover:text-white transition-colors">
                        <i class="ph ph-x text-xl"></i>
                    </button>
                </div>
                
                <div id="ws-file-list" class="flex-1 overflow-y-auto p-3 space-y-1 max-h-[400px]">
                    ${pdfFiles.length === 0 ? '<p class="text-zinc-500 text-sm text-center py-4">No PDF files in Workspace/PDFs/</p>' : ''}
                </div>
                
                <div class="p-4 border-t border-zinc-700 flex gap-2">
                    <button id="ws-from-pc" class="flex-1 flex items-center px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-left transition-colors group">
                        <i class="ph ph-hard-drive text-zinc-400 text-lg mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Select from Computer</div>
                            <div class="text-xs text-zinc-400">Choose a PDF file from your PC</div>
                        </div>
                    </button>
                    <button id="ws-cancel" class="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const listEl = modal.querySelector('#ws-file-list');
        
        pdfFiles.forEach(f => {
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 p-2 rounded cursor-pointer hover:bg-zinc-800 border border-transparent transition-colors';
            
            item.innerHTML = `
                <i class="ph ph-file-pdf text-xl text-red-400"></i>
                <span class="text-sm text-zinc-300 truncate flex-1">${window.PdfSuite.escHtml(f.name)}</span>
            `;
            
            item.addEventListener('click', async () => {
                const fullPath = `${pdfsDir}${sep}${f.name}`;
                modal.remove();
                showLoading(`Loading ${f.name}...`);
                const bytes = await readBinaryFile(fullPath);
                await loadPdf(fullPath, f.name, bytes);
                hideLoading();
            });
            
            listEl.appendChild(item);
        });
        
        modal.querySelector('#ws-close').addEventListener('click', () => modal.remove());
        modal.querySelector('#ws-cancel').addEventListener('click', () => modal.remove());
        
        modal.querySelector('#ws-from-pc').addEventListener('click', async () => {
            modal.remove();
            try {
                const path = await window.TauriBridge.dialog.open({
                    multiple: false,
                    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
                });
                if (!path) return;
                showLoading(`Loading ${window.PdfSuite.basename(path)}...`);
                const bytes = await readBinaryFile(path);
                await loadPdf(path, window.PdfSuite.basename(path), bytes);
                hideLoading();
            } catch (err) {
                window.PdfSuite.showToast('Could not open file: ' + (err.message || err), 'error');
            }
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    async function loadPdf(path, name, bytes) {
        state.sourceName  = name;
        state.sourceBytes = bytes;
        state.pages       = [];

        try {
            const { PDFDocument } = window.PDFLib;
            const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const count = doc.getPageCount();

            // Generate thumbnails (in batches to not freeze UI)
            for (let i = 0; i < count; i++) {
                updateLoadingProgress(i + 1, count, name);
                const thumb = await renderPage(bytes, i + 1);
                state.pages.push({ index: i, thumb, selected: false });
            }
            refresh();
            window.PdfSuite.showToast(`Loaded ${name} (${count} pages)`, 'success');
        } catch (err) {
            window.PdfSuite.showToast('Failed to parse PDF: ' + (err.message || err), 'error');
        }
    }

    /* ------------------------------------------------------------------
     * Render
     * ------------------------------------------------------------------ */
    function refresh() {
        const e = el();
        const hasDoc = state.pages.length > 0;

        // Show/hide inner panel — use display directly (Tailwind 'hidden' = display:none !important)
        if (e.empty) e.empty.style.display  = hasDoc ? 'none' : 'flex';
        if (e.panel) e.panel.style.display  = hasDoc ? 'flex' : 'none';
        if (e.clearBtn) e.clearBtn.style.display = hasDoc ? '' : 'none';

        if (!hasDoc) return;

        const selCount = state.pages.filter(p => p.selected).length;
        if (e.pageCount) e.pageCount.textContent = `${state.pages.length} pages`;
        if (e.selCount)  e.selCount.textContent  = `${selCount} selected`;
        if (e.filename)  e.filename.textContent  = state.sourceName;

        // Action button states
        if (e.deleteSelBtn) e.deleteSelBtn.disabled = selCount === 0;
        if (e.saveOrderBtn) e.saveOrderBtn.disabled = state.pages.length === 0;
        if (e.saveSelectedBtn) e.saveSelectedBtn.disabled = selCount === 0;

        renderGrid();
    }

    function renderGrid() {
        const e = el();
        if (!e.grid) return;
        e.grid.innerHTML = '';

        state.pages.forEach((p, idx) => {
            const card = document.createElement('div');
            card.className = `pdf-page-card ${p.selected ? 'selected' : ''}`;
            card.dataset.idx = idx;
            card.draggable = true;
            
            card.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });

            card.innerHTML = `
                <div class="pdf-page-thumb group relative" tabindex="0" role="checkbox" aria-checked="${p.selected}" title="Click to select page" data-idx="${idx}">
                    ${p.thumb ? `<img src="${p.thumb}" alt="Page ${idx + 1}" class="w-full h-full object-contain">` : `<i class="ph ph-file-pdf text-3xl text-zinc-500"></i>`}
                    <div class="absolute top-[5px] right-[5px] transition-opacity pointer-events-none ${p.selected ? '' : 'opacity-0'}">
                        <i class="ph ${p.selected ? 'ph-check-circle-fill text-amber-400' : ''} text-xl"></i>
                    </div>
                </div>
                <p class="text-[10px] text-zinc-400 text-center mt-1 w-full truncate px-1">Page ${idx + 1}</p>
            `;

            e.grid.appendChild(card);
        });

        // Event delegation for page selection (more reliable than individual listeners)
        e.grid.onclick = function(ev) {
            const thumb = ev.target.closest('.pdf-page-thumb');
            if (!thumb) return;
            
            const idx = parseInt(thumb.dataset.idx, 10);
            if (isNaN(idx)) return;
            
            const p = state.pages[idx];
            if (!p) return;
            
            // Toggle: if already selected, deselect; otherwise select this one only
            if (p.selected) {
                p.selected = false;
            } else {
                state.pages.forEach(pg => pg.selected = false);
                p.selected = true;
            }
            
            refresh();
        };

        // Initialize SortableJS
        if (window.Sortable && e.grid) {
            if (e.grid._sortable) {
                e.grid._sortable.destroy();
            }
            e.grid._sortable = new window.Sortable(e.grid, {
                animation: 150,
                ghostClass: 'sortable-ghost',
                dragClass: 'sortable-drag',
                forceFallback: true,
                fallbackClass: 'sortable-drag',
                fallbackOnBody: true,
                onEnd: function (evt) {
                    if (evt.oldIndex === evt.newIndex) return;
                    const movedItem = state.pages.splice(evt.oldIndex, 1)[0];
                    state.pages.splice(evt.newIndex, 0, movedItem);
                    refresh();
                }
            });
        }
    }

    /* ------------------------------------------------------------------
     * Page manipulation
     * ------------------------------------------------------------------ */
    function deleteSelected() {
        const before = state.pages.length;
        state.pages = state.pages.filter(p => !p.selected);
        const removed = before - state.pages.length;
        if (removed > 0) {
            window.PdfSuite.showToast(`Removed ${removed} page${removed !== 1 ? 's' : ''}`, 'info');
        }
        refresh();
    }

    function reorderPage(fromIdx, toIdx) {
        const [moved] = state.pages.splice(fromIdx, 1);
        state.pages.splice(toIdx, 0, moved);
        refresh();
    }

    function clearAll() {
        state.sourceName  = null;
        state.sourceBytes = null;
        state.pages       = [];
        refresh();
    }

    /* ------------------------------------------------------------------
     * Save: reordered single PDF
     * ------------------------------------------------------------------ */
    async function saveReordered() {
        if (state.pages.length === 0) return;
        const btn = el().saveOrderBtn;
        btn.disabled  = true;
        btn.innerHTML = `<i class="ph ph-spinner-gap animate-spin mr-2"></i>Building…`;

        try {
            const resultBytes  = await buildPdfFromPages(state.pages.map(p => p.index));
            const base         = (state.sourceName || 'document').replace(/\.pdf$/i, '');
            const suggestedName = `${base}_edited_${window.PdfSuite.todayStamp()}.pdf`;
            await window.PdfSuite.saveResult(resultBytes, suggestedName);
        } catch (err) {
            window.PdfSuite.showToast('Save failed: ' + (err.message || err), 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = `<i class="ph ph-floppy-disk mr-2"></i>Save Reordered`;
        }
    }

    /* ------------------------------------------------------------------
     * Save: selected pages only
     * ------------------------------------------------------------------ */
    async function saveSelected() {
        const selected = state.pages.filter(p => p.selected);
        if (selected.length === 0) {
            window.PdfSuite.showToast('Select a page first', 'info');
            return;
        }
        
        const btn = el().saveSelectedBtn;
        btn.disabled  = true;
        btn.innerHTML = `<i class="ph ph-spinner-gap animate-spin mr-2"></i>Building…`;

        try {
            const resultBytes  = await buildPdfFromPages(selected.map(p => p.index));
            const base         = (state.sourceName || 'document').replace(/\.pdf$/i, '');
            
            // Get the 1-based page number for the filename
            const pageNum = selected[0].index + 1;
            const suggestedName = `${base}_Page${pageNum}_${window.PdfSuite.todayStamp()}.pdf`;
            
            await window.PdfSuite.saveResult(resultBytes, suggestedName);
        } catch (err) {
            window.PdfSuite.showToast('Save failed: ' + (err.message || err), 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = `<i class="ph ph-file-pdf mr-2"></i>Save Selected`;
        }
    }

    /* ------------------------------------------------------------------
     * Build a new PDF from an ordered list of original page indices
     * ------------------------------------------------------------------ */
    async function buildPdfFromPages(originalIndices) {
        const { PDFDocument } = window.PDFLib;
        const srcDoc  = await PDFDocument.load(state.sourceBytes, { ignoreEncryption: true });
        const newDoc  = await PDFDocument.create();
        const copied  = await newDoc.copyPages(srcDoc, originalIndices);
        copied.forEach(p => newDoc.addPage(p));
        return await newDoc.save();
    }

    /* ------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------ */
    async function renderPage(bytes, pageNum) {
        try {
            const pdfjsLib = window.pdfjsLib;
            if (!pdfjsLib) return null;
            const doc  = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.4 });
            const canvas = document.createElement('canvas');
            canvas.width  = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
            return canvas.toDataURL('image/webp', 0.7);
        } catch (_) { return null; }
    }

    async function readBinaryFile(path) {
        if (window.TauriBridge?.fs?.readFile) return await window.TauriBridge.fs.readFile(path);
        const res = await fetch(path);
        return new Uint8Array(await res.arrayBuffer());
    }

    function reset() {
        clearAll();
    }

    /* ------------------------------------------------------------------
     * Public
     * ------------------------------------------------------------------ */
    return { init, onActivate, reset };
})();

window.PdfSplit = PdfSplit;
