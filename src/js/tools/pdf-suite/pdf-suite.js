/**
 * PDF Suite — Main Orchestrator
 * Handles tab routing, shared PDF state, and the unified save flow.
 * Dependencies (loaded via CDN in the page fragment):
 *   - pdf-lib  (PDFDocument, etc.)  → window.PDFLib
 *   - pdf.js   (pdfjsLib)           → window.pdfjsLib
 */

var PdfSuite = (() => {
    /* ------------------------------------------------------------------
     * Shared state
     * ------------------------------------------------------------------ */
    const state = {
        activeTab: 'merge',  // 'merge' | 'split' | 'edit'
    };

    /* ------------------------------------------------------------------
     * Tab routing
     * ------------------------------------------------------------------ */
    function switchTab(tab) {
        state.activeTab = tab;

        // Update tab buttons
        document.querySelectorAll('.pdf-tab-btn').forEach(btn => {
            const active = btn.dataset.tab === tab;
            btn.classList.toggle('pdf-tab-active', active);
            btn.classList.toggle('pdf-tab-inactive', !active);
        });

        // Show/hide panels — use display style directly to avoid
        // Tailwind's 'hidden' (display:none !important) fighting with 'flex'
        document.querySelectorAll('.pdf-tab-panel').forEach(panel => {
            const isActive = panel.dataset.tabPanel === tab;
            panel.style.display = isActive ? 'flex' : 'none';
        });

        // Delegate to sub-modules
        if (tab === 'merge'  && window.PdfMerge)  window.PdfMerge.onActivate();
        if (tab === 'split'  && window.PdfSplit)  window.PdfSplit.onActivate();
        if (tab === 'edit'   && window.PdfEdit)   window.PdfEdit.onActivate();
    }

    /* ------------------------------------------------------------------
     * Save flow  (shared by all tabs)
     * resultBytes  — Uint8Array of the finished PDF
     * suggestedName — e.g. "merged_20260401.pdf"
     * ------------------------------------------------------------------ */
    async function saveResult(resultBytes, suggestedName) {
        const workspace = window.WorkspaceManager?.current;

        if (!workspace) {
            // Quick Mode → straight to save-as dialog
            await saveAs(resultBytes, suggestedName);
            return;
        }

        // Workspace Mode → show choice modal
        showSaveModal(resultBytes, suggestedName, workspace);
    }

    async function saveAs(bytes, suggestedName) {
        try {
            const savePath = await window.TauriBridge.dialog.save({
                defaultPath: suggestedName,
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
            });
            if (!savePath) return;
            await writeBinaryFile(savePath, bytes);
            showToast(`Saved: ${basename(savePath)}`, 'success');
        } catch (err) {
            console.error('[PDF Suite] saveAs error:', err);
            showToast('Save failed: ' + (err.message || err), 'error');
        }
    }

    async function saveToWorkspace(bytes, suggestedName, workspace) {
        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const pdfDir = `${workspace.path}${sep}PDFs`;
            // Ensure dir exists
            await window.TauriBridge.fs.mkdir(pdfDir, { recursive: true });
            const finalPath = `${pdfDir}${sep}${suggestedName}`;
            await writeBinaryFile(finalPath, bytes);
            showToast(`Saved to workspace: PDFs/${suggestedName}`, 'success');
        } catch (err) {
            console.error('[PDF Suite] saveToWorkspace error:', err);
            showToast('Workspace save failed: ' + (err.message || err), 'error');
        }
    }

    /** Write a Uint8Array to disk via TauriBridge (falls back to browser download in dev) */
    async function writeBinaryFile(path, bytes) {
        if (window.TauriBridge?.fs?.writeBinaryFile) {
            await window.TauriBridge.fs.writeBinaryFile(path, bytes);
        } else {
            // Dev browser fallback — trigger a download
            const blob = new Blob([bytes], { type: 'application/pdf' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = basename(path);
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    /* ------------------------------------------------------------------
     * Save-choice modal (workspace mode)
     * ------------------------------------------------------------------ */
    function showSaveModal(bytes, suggestedName, workspace) {
        // Remove any previous modal
        document.getElementById('pdf-save-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'pdf-save-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-file-pdf text-amber-400 text-xl"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="font-semibold text-white">Save PDF</h3>
                        <input id="pdf-save-filename" type="text" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-2 py-1 mt-1 rounded" value="${escHtml(suggestedName)}">
                    </div>
                    <button id="pdf-save-modal-close" class="ml-2 text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <button id="pdf-save-workspace" class="w-full flex items-center px-4 py-3 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/30 hover:border-amber-500/60 text-left transition-colors group">
                        <i class="ph ph-folder-open text-amber-400 text-xl mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Save to Workspace</div>
                            <div class="text-xs text-zinc-400">${escHtml(workspace.name)}/PDFs/</div>
                        </div>
                    </button>
                    <button id="pdf-save-saveas" class="w-full flex items-center px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-left transition-colors group">
                        <i class="ph ph-hard-drive text-zinc-400 text-xl mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Save As…</div>
                            <div class="text-xs text-zinc-400">Choose any location on your PC</div>
                        </div>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        const getInputName = () => {
            let val = modal.querySelector('#pdf-save-filename').value.trim();
            if (!val.toLowerCase().endsWith('.pdf')) val += '.pdf';
            return val;
        };

        modal.querySelector('#pdf-save-modal-close').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#pdf-save-workspace').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await saveToWorkspace(bytes, filename, workspace);
        });
        modal.querySelector('#pdf-save-saveas').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await saveAs(bytes, filename);
        });
    }

    /* ------------------------------------------------------------------
     * Toast notification
     * ------------------------------------------------------------------ */
    function showToast(message, type = 'info') {
        document.getElementById('pdf-toast-container')?.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error:   'bg-red-700/90 border-red-600/40',
            info:    'bg-zinc-700/90 border-zinc-600/40',
        };
        const iconMap  = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'pdf-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-fade-enter ${colorMap[type] || colorMap.info}`;
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${escHtml(message)}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /* ------------------------------------------------------------------
     * Helpers
     * ------------------------------------------------------------------ */
    function basename(path) {
        return path.replace(/.*[\\/]/, '');
    }
    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }
    function todayStamp() {
        return new Date().toISOString().slice(0, 10).replace(/-/g, '');
    }

    /* ------------------------------------------------------------------
     * Init
     * ------------------------------------------------------------------ */
    function init() {
        // Wire tab buttons
        document.querySelectorAll('.pdf-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // Activate default tab
        switchTab('merge');

        // Init sub-modules
        if (window.PdfMerge) window.PdfMerge.init();
        if (window.PdfSplit) window.PdfSplit.init();
        if (window.PdfEdit)  window.PdfEdit.init();
    }

    /* ------------------------------------------------------------------
     * Public API
     * ------------------------------------------------------------------ */
    return {
        init,
        switchTab,
        saveResult,
        writeBinaryFile,
        showToast,
        todayStamp,
        escHtml,
        basename,
    };
})();

window.PdfSuite = PdfSuite;
