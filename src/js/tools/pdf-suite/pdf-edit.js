/**
 * PDF Suite — Basic Edit Tab
 * Load one PDF, show all pages as thumbnails.
 * Actions: Delete pages, Rotate pages (90/180/270°), Extract selected pages.
 */

var PdfEdit = (() => {
    /* ------------------------------------------------------------------
     * State
     * ------------------------------------------------------------------ */
    const state = {
        sourceName:  null,
        sourceBytes: null,
        pages:       [], // [{ index: orig0based, thumb, rotation: 0|90|180|270, selected }]
    };

    let dragSrcIdx = null;
    let isInit     = false;

    /* ------------------------------------------------------------------
     * DOM refs
     * ------------------------------------------------------------------ */
    const el = () => ({
        loadBtn:       document.getElementById('edit-load-btn'),
        grid:          document.getElementById('edit-page-grid'),
        empty:         document.getElementById('edit-empty'),
        panel:         document.getElementById('edit-panel'),
        pageCount:     document.getElementById('edit-page-count'),
        selCount:      document.getElementById('edit-sel-count'),
        filename:      document.getElementById('edit-filename'),
        clearBtn:      document.getElementById('edit-clear-btn'),
        deleteSelBtn:  document.getElementById('edit-delete-sel'),
        rotateCwBtn:   document.getElementById('edit-rotate-cw'),
        rotateCcwBtn:  document.getElementById('edit-rotate-ccw'),
        rot180Btn:     document.getElementById('edit-rotate-180'),
        extractBtn:    document.getElementById('edit-extract'),
        saveBtn:       document.getElementById('edit-save'),
        selectAllBtn:  document.getElementById('edit-select-all'),
        deselectBtn:   document.getElementById('edit-deselect'),
        loading:       document.getElementById('edit-loading'),
        loadingText:   document.getElementById('edit-loading-text'),
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

        // Native Tauri file drop (for Edit)
        if (window.TauriBridge?.isDesktop()) {
            // Clean up any existing listener to prevent duplicate entries (ghost listeners)
            if (typeof window._pdfEditUnlisten === 'function') {
                window._pdfEditUnlisten();
                window._pdfEditUnlisten = null;
            }

            window.TauriBridge.event.listen('tauri://drag-drop', async (ev) => {
                const paths = ev.payload.paths;
                if (!paths || paths.length === 0) return;
                
                // Only process if the Edit tab is actually visible
                const panel = document.querySelector('[data-tab-panel="edit"]');
                if (panel && panel.style.display !== 'none') {
                    const pdfPath = paths.find(p => p.toLowerCase().endsWith('.pdf'));
                    if (pdfPath) {
                        showLoading(`Loading ${window.PdfSuite.basename(pdfPath)}...`);
                        const bytes = await readBinaryFile(pdfPath);
                        await loadPdf(window.PdfSuite.basename(pdfPath), bytes);
                        hideLoading();
                    }
                }
            }).then(unlistenFn => {
                window._pdfEditUnlisten = unlistenFn;
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
        e.clearBtn?.addEventListener('click',      clearAll);
        e.deleteSelBtn?.addEventListener('click',  deleteSelected);
        e.rotateCwBtn?.addEventListener('click',   () => rotateSelected(90));
        e.rotateCcwBtn?.addEventListener('click',  () => rotateSelected(-90));
        e.rot180Btn?.addEventListener('click',     () => rotateSelected(180));
        e.extractBtn?.addEventListener('click',    extractSelected);
        e.saveBtn?.addEventListener('click',       saveEdited);
        e.selectAllBtn?.addEventListener('click',  selectAll);
        e.deselectBtn?.addEventListener('click',   deselectAll);
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
                await loadPdf(window.PdfSuite.basename(path), bytes);
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
            console.error('[PdfEdit] Error reading PDFs folder:', err);
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
                await loadPdf(f.name, bytes);
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
                await loadPdf(window.PdfSuite.basename(path), bytes);
                hideLoading();
            } catch (err) {
                window.PdfSuite.showToast('Could not open file: ' + (err.message || err), 'error');
            }
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    async function loadPdf(name, bytes) {
        state.sourceName  = name;
        state.sourceBytes = bytes;
        state.pages       = [];

        try {
            const { PDFDocument } = window.PDFLib;
            const doc   = await PDFDocument.load(bytes, { ignoreEncryption: true });
            const count = doc.getPageCount();

            for (let i = 0; i < count; i++) {
                updateLoadingProgress(i + 1, count, name);
                const thumb = await renderPageThumb(bytes, i + 1);
                state.pages.push({ index: i, thumb, rotation: 0, selected: false });
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

        const hasSelection = selCount > 0;
        if (e.deleteSelBtn) e.deleteSelBtn.disabled = !hasSelection;
        if (e.rotateCwBtn)  e.rotateCwBtn.disabled  = !hasSelection;
        if (e.rotateCcwBtn) e.rotateCcwBtn.disabled = !hasSelection;
        if (e.rot180Btn)    e.rot180Btn.disabled     = !hasSelection;
        if (e.extractBtn)   e.extractBtn.disabled    = !hasSelection;
        if (e.saveBtn)      e.saveBtn.disabled       = state.pages.length === 0;

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

            const rotStyle = p.rotation ? `style="transform: rotate(${p.rotation}deg)"` : '';
            const rotBadge = p.rotation ? `<span class="absolute bottom-[4px] left-[4px] bg-purple-400/85 text-white text-[0.58rem] font-bold py-[1px] px-[5px] rounded-full z-10 shadow-sm">${p.rotation}°</span>` : '';

            card.innerHTML = `
                <div class="pdf-page-thumb group relative" tabindex="0" role="checkbox" aria-checked="${p.selected}">
                    <div class="w-full h-full flex items-center justify-center overflow-hidden">
                        ${p.thumb
                            ? `<img src="${p.thumb}" alt="Page ${idx + 1}" class="max-w-full max-h-full object-contain transition-transform duration-300" ${rotStyle}>`
                            : `<i class="ph ph-file-pdf text-3xl text-zinc-500" ${rotStyle}></i>`
                        }
                    </div>
                    ${rotBadge}
                    <div class="absolute top-[5px] right-[5px] transition-opacity pointer-events-none ${p.selected ? '' : 'opacity-0'}">
                        <i class="ph ${p.selected ? 'ph-check-circle-fill text-amber-400' : ''} text-xl"></i>
                    </div>
                </div>
                <p class="text-[10px] text-zinc-400 text-center mt-1 w-full truncate px-1">Page ${idx + 1}</p>
            `;

            card.querySelector('.pdf-page-thumb').addEventListener('click', () => {
                p.selected = !p.selected;
                refresh();
            });

            e.grid.appendChild(card);
        });

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
     * Actions
     * ------------------------------------------------------------------ */
    function selectAll() {
        state.pages.forEach(p => p.selected = true);
        refresh();
    }

    function deselectAll() {
        state.pages.forEach(p => p.selected = false);
        refresh();
    }

    function deleteSelected() {
        const before = state.pages.length;
        state.pages = state.pages.filter(p => !p.selected);
        const removed = before - state.pages.length;
        if (removed) window.PdfSuite.showToast(`Deleted ${removed} page${removed !== 1 ? 's' : ''}`, 'info');
        refresh();
    }

    function rotateSelected(degrees) {
        state.pages.filter(p => p.selected).forEach(p => {
            p.rotation = ((p.rotation + degrees) % 360 + 360) % 360;
        });
        refresh();
    }

    async function extractSelected() {
        const selected = state.pages.filter(p => p.selected);
        if (selected.length === 0) return;

        const btn = el().extractBtn;
        btn.disabled  = true;
        btn.innerHTML = `<i class="ph ph-spinner-gap animate-spin mr-2"></i>Extracting…`;

        try {
            const bytes = await buildPdf(selected);
            const base  = (state.sourceName || 'document').replace(/\.pdf$/i, '');
            await window.PdfSuite.saveResult(bytes, `${base}_extract_${window.PdfSuite.todayStamp()}.pdf`);
        } catch (err) {
            window.PdfSuite.showToast('Extract failed: ' + (err.message || err), 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = `<i class="ph ph-export mr-2"></i>Extract Selected`;
        }
    }

    async function saveEdited() {
        if (state.pages.length === 0) return;

        const btn = el().saveBtn;
        btn.disabled  = true;
        btn.innerHTML = `<i class="ph ph-spinner-gap animate-spin mr-2"></i>Saving…`;

        try {
            const bytes = await buildPdf(state.pages);
            const base  = (state.sourceName || 'document').replace(/\.pdf$/i, '');
            await window.PdfSuite.saveResult(bytes, `${base}_edited_${window.PdfSuite.todayStamp()}.pdf`);
        } catch (err) {
            window.PdfSuite.showToast('Save failed: ' + (err.message || err), 'error');
        } finally {
            btn.disabled  = false;
            btn.innerHTML = `<i class="ph ph-floppy-disk mr-2"></i>Save Edited PDF`;
        }
    }

    /* ------------------------------------------------------------------
     * Build PDF from page entries (applying rotations)
     * ------------------------------------------------------------------ */
    async function buildPdf(pageEntries) {
        const { PDFDocument, degrees } = window.PDFLib;
        const srcDoc = await PDFDocument.load(state.sourceBytes, { ignoreEncryption: true });
        const newDoc = await PDFDocument.create();

        const origIndices = pageEntries.map(p => p.index);
        const copied      = await newDoc.copyPages(srcDoc, origIndices);

        copied.forEach((page, i) => {
            const entry = pageEntries[i];
            if (entry.rotation !== 0) {
                page.setRotation(degrees(entry.rotation));
            }
            newDoc.addPage(page);
        });

        return await newDoc.save();
    }

    /* ------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------ */
    async function renderPageThumb(bytes, pageNum) {
        try {
            const pdfjsLib = window.pdfjsLib;
            if (!pdfjsLib) return null;
            const doc  = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 0.4 });
            const canvas  = document.createElement('canvas');
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

    function clearAll() {
        state.sourceName  = null;
        state.sourceBytes = null;
        state.pages       = [];
        refresh();
    }

    function reset() {
        clearAll();
    }

    /* ------------------------------------------------------------------
     * Public
     * ------------------------------------------------------------------ */
    return { init, onActivate, reset };
})();

window.PdfEdit = PdfEdit;
