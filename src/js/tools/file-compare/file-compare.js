/**
 * File Compare — Orchestrator
 * Side-by-side text file comparison with save flow matching other tools.
 * Uses the 'diff' library (diff.min.js) for line-by-line comparison.
 */

var FileCompare = (() => {
    let state = {
        file1: { path: null, content: null, filename: null },
        file2: { path: null, content: null, filename: null },
        diffResult: null,
        scrollSyncEnabled: true
    };

    /* ------------------------------------------------------------------
     * File Loading
     * ------------------------------------------------------------------ */
    async function selectFile(side) {
        try {
            const filePath = await window.TauriBridge.dialog.open({
                filters: [{
                    name: 'Text Files',
                    extensions: ['txt', 'md', 'json', 'js', 'css', 'html', 'xml', 'csv', 'log', 'yaml', 'yml', 'ts', 'tsx', 'jsx', 'py', 'rb', 'sh', 'bat', 'ini', 'conf', 'cfg', 'properties']
                }]
            });
            if (!filePath) return;

            const content = await window.TauriBridge.fs.readTextFile(filePath);
            const filename = basename(filePath);

            if (side === 1) {
                state.file1 = { path: filePath, content, filename };
            } else {
                state.file2 = { path: filePath, content, filename };
            }

            updateUI();

            if (state.file1.content && state.file2.content) {
                runComparison();
                updateUI();
            }
        } catch (err) {
            console.error('[File Compare] load error:', err);
            showToast('Failed to load file: ' + (err.message || err), 'error');
        }
    }

    async function loadDroppedFile(side, filePath) {
        if (!filePath) {
            console.warn('[File Compare] No file path in dropped file');
            return;
        }

        try {
            const content = await window.TauriBridge.fs.readTextFile(filePath);
            const filename = basename(filePath);

            if (side === 1) {
                state.file1 = { path: filePath, content, filename };
            } else {
                state.file2 = { path: filePath, content, filename };
            }

            updateUI();

            if (state.file1.content && state.file2.content) {
                runComparison();
                updateUI();
            }
        } catch (err) {
            console.error('[File Compare] drop load error:', err);
            showToast('Failed to read dropped file: ' + (err.message || err), 'error');
        }
    }

    /* ------------------------------------------------------------------
     * Comparison
     * ------------------------------------------------------------------ */
    function runComparison() {
        if (!state.file1.content || !state.file2.content) return;

        const diffResult = Diff.diffLines(state.file1.content, state.file2.content);
        state.diffResult = processDiffResult(diffResult);

        renderDiff();
        updateSummary();

        const stats = state.diffResult.stats;
        const hasChanges = stats.added > 0 || stats.removed > 0;
        showToast(hasChanges ? `Found ${stats.added + stats.removed} changes (${stats.similarity}% similar)` : 'Files are identical', 'info');
    }

    function processDiffResult(diffResult) {
        const changes = [];
        let added = 0, removed = 0, unchanged = 0;
        let leftLine = 1, rightLine = 1;

        let pendingRemoved = [];
        let pendingAdded = [];

        function alignLines(oldLines, newLines) {
            function computeLineSimilarity(a, b) {
                if (a === b) return 1.0;
                if (!a || !b) return 0;
                const aTrim = a.trim();
                const bTrim = b.trim();
                if (aTrim === bTrim) return 1.0;
                if (aTrim.length === 0 || bTrim.length === 0) return 0;
                
                const getGrams = (str) => {
                    const grams = {};
                    for (let i = 0; i < str.length - 1; i++) {
                        const g = str.substring(i, i + 2);
                        grams[g] = (grams[g] || 0) + 1;
                    }
                    return grams;
                };
                
                const aGrams = getGrams(aTrim);
                let aTotal = aTrim.length - 1;
                let bTotal = bTrim.length - 1;
                if (aTotal <= 0) aTotal = 1;
                if (bTotal <= 0) bTotal = 1;

                let common = 0;
                for (let i = 0; i < bTrim.length - 1; i++) {
                    const g = bTrim.substring(i, i + 2);
                    if (aGrams[g] > 0) {
                        common++;
                        aGrams[g]--;
                    }
                }
                
                return common / Math.max(aTotal, bTotal);
            }

            const N = oldLines.length;
            const M = newLines.length;
            const THRESHOLD = 0.35;
            
            const simMatrix = [];
            for (let i = 0; i < N; i++) {
                simMatrix[i] = [];
                for (let j = 0; j < M; j++) {
                    simMatrix[i][j] = computeLineSimilarity(oldLines[i], newLines[j]);
                }
            }
            
            const dp = Array(N + 1).fill(0).map(() => Array(M + 1).fill(0));
            
            for (let i = 1; i <= N; i++) {
                for (let j = 1; j <= M; j++) {
                    const sim = simMatrix[i - 1][j - 1];
                    const matchScore = dp[i - 1][j - 1] + (sim >= THRESHOLD ? sim : -Infinity);
                    const deleteScore = dp[i - 1][j];
                    const insertScore = dp[i][j - 1];
                    
                    dp[i][j] = Math.max(matchScore, deleteScore, insertScore);
                }
            }
            
            const aligned = [];
            let i = N, j = M;
            while (i > 0 || j > 0) {
                if (i > 0 && j > 0) {
                    const sim = simMatrix[i - 1][j - 1];
                    const matchScore = dp[i - 1][j - 1] + (sim >= THRESHOLD ? sim : -Infinity);
                    if (Math.abs(dp[i][j] - matchScore) < 1e-9) {
                        aligned.push({ left: oldLines[i - 1], right: newLines[j - 1] });
                        i--; j--;
                        continue;
                    }
                }
                if (i > 0 && Math.abs(dp[i][j] - dp[i - 1][j]) < 1e-9) {
                    aligned.push({ left: oldLines[i - 1], right: null });
                    i--;
                } else if (j > 0) {
                    aligned.push({ left: null, right: newLines[j - 1] });
                    j--;
                } else {
                    break; 
                }
            }
            return aligned.reverse();
        }

        function flushPending() {
            if (pendingRemoved.length === 0 && pendingAdded.length === 0) return;

            // Fallback for massive chunks to avoid UI freeze
            if (pendingRemoved.length > 500 || pendingAdded.length > 500) {
                for (const rem of pendingRemoved) {
                    changes.push({ type: 'removed', leftLine: leftLine++, rightLine: null, value: rem });
                    removed++;
                }
                for (const add of pendingAdded) {
                    changes.push({ type: 'added', leftLine: null, rightLine: rightLine++, value: add });
                    added++;
                }
                pendingRemoved = [];
                pendingAdded = [];
                return;
            }
            
            const aligned = alignLines(pendingRemoved, pendingAdded);

            for (const pair of aligned) {
                const rem = pair.left;
                const add = pair.right;

                if (rem !== null && add !== null) {
                    // Modified line pair: Diff at the word level
                    const wordDiff = Diff.diffWordsWithSpace(rem, add);
                    
                    let leftHtml = '';
                    let rightHtml = '';
                    
                    for (const part of wordDiff) {
                        const escapedVal = escHtml(part.value);
                        if (part.added) {
                            rightHtml += `<span class="fc-word-added">${escapedVal}</span>`;
                        } else if (part.removed) {
                            leftHtml += `<span class="fc-word-removed">${escapedVal}</span>`;
                        } else {
                            leftHtml += escapedVal;
                            rightHtml += escapedVal;
                        }
                    }

                    changes.push({
                        type: 'modified',
                        leftLine: leftLine++,
                        rightLine: rightLine++,
                        leftHtml: leftHtml,
                        rightHtml: rightHtml
                    });
                    removed++;
                    added++;
                } else if (rem !== null) {
                    changes.push({ type: 'removed', leftLine: leftLine++, rightLine: null, value: rem });
                    removed++;
                } else if (add !== null) {
                    changes.push({ type: 'added', leftLine: null, rightLine: rightLine++, value: add });
                    added++;
                }
            }
            pendingRemoved = [];
            pendingAdded = [];
        }

        for (const part of diffResult) {
            const lines = part.value.split('\n');
            // Remove last empty string if split created one (for trailing newline)
            if (lines[lines.length - 1] === '') lines.pop();

            for (const line of lines) {
                if (part.added) {
                    pendingAdded.push(line);
                } else if (part.removed) {
                    pendingRemoved.push(line);
                } else {
                    flushPending();
                    changes.push({ type: 'equal', leftLine: leftLine++, rightLine: rightLine++, value: line });
                    unchanged++;
                }
            }
        }
        flushPending();

        const total = changes.length;
        const similarity = total > 0 ? Math.round((unchanged / total) * 100) : 100;

        return { changes, stats: { added, removed, unchanged, similarity } };
    }

    /* ------------------------------------------------------------------
     * Rendering
     * ------------------------------------------------------------------ */
    function renderDiff() {
        const leftPane = document.getElementById('fc-left-content');
        const rightPane = document.getElementById('fc-right-content');
        if (!leftPane || !rightPane) return;

        if (!state.diffResult) return;

        let leftHtml = '';
        let rightHtml = '';

        for (const change of state.diffResult.changes) {
            const escapedValue = change.value !== undefined ? escHtml(change.value) : '';

            if (change.type === 'equal') {
                leftHtml += `<div class="fc-line fc-line-equal"><span class="fc-line-num">${change.leftLine}</span><span class="fc-line-content">${escapedValue}</span></div>`;
                rightHtml += `<div class="fc-line fc-line-equal"><span class="fc-line-num">${change.rightLine}</span><span class="fc-line-content">${escapedValue}</span></div>`;
            } else if (change.type === 'removed') {
                leftHtml += `<div class="fc-line fc-line-removed"><span class="fc-line-num">${change.leftLine}</span><span class="fc-line-content">${escapedValue}</span></div>`;
                rightHtml += `<div class="fc-line fc-line-empty"><span class="fc-line-num"></span><span class="fc-line-content"></span></div>`;
            } else if (change.type === 'added') {
                leftHtml += `<div class="fc-line fc-line-empty"><span class="fc-line-num"></span><span class="fc-line-content"></span></div>`;
                rightHtml += `<div class="fc-line fc-line-added"><span class="fc-line-num">${change.rightLine}</span><span class="fc-line-content">${escapedValue}</span></div>`;
            } else if (change.type === 'modified') {
                leftHtml += `<div class="fc-line fc-line-removed"><span class="fc-line-num">${change.leftLine}</span><span class="fc-line-content">${change.leftHtml}</span></div>`;
                rightHtml += `<div class="fc-line fc-line-added"><span class="fc-line-num">${change.rightLine}</span><span class="fc-line-content">${change.rightHtml}</span></div>`;
            }
        }

        leftPane.innerHTML = leftHtml;
        rightPane.innerHTML = rightHtml;

        // Hide drop zones, show content
        const leftDrop = document.getElementById('fc-left-drop');
        const rightDrop = document.getElementById('fc-right-drop');
        if (leftDrop) leftDrop.classList.add('hidden');
        if (rightDrop) rightDrop.classList.add('hidden');
        leftPane.classList.remove('hidden');
        rightPane.classList.remove('hidden');

        syncScroll();
    }

    function updateSummary() {
        const stats = state.diffResult?.stats;
        if (!stats) return;

        document.getElementById('fc-added-count').textContent = stats.added;
        document.getElementById('fc-removed-count').textContent = stats.removed;
        document.getElementById('fc-similarity').textContent = stats.similarity + '%';

        const similarityBar = document.getElementById('fc-similarity-bar');
        if (similarityBar) {
            similarityBar.style.width = stats.similarity + '%';
        }
    }

    function updateUI() {
        const file1Info = document.getElementById('fc-file1-info');
        if (file1Info) {
            if (state.file1.filename) {
                file1Info.innerHTML = `<span class="text-amber-400 font-medium">${escHtml(state.file1.filename)}</span><span class="text-zinc-500 text-xs ml-2 truncate max-w-[200px]" title="${escHtml(state.file1.path || '')}">${escHtml(truncatePath(state.file1.path || '', 50))}</span>`;
            } else {
                file1Info.innerHTML = `<span class="text-zinc-500 italic">No file selected</span>`;
            }
        }

        const file2Info = document.getElementById('fc-file2-info');
        if (file2Info) {
            if (state.file2.filename) {
                file2Info.innerHTML = `<span class="text-amber-400 font-medium">${escHtml(state.file2.filename)}</span><span class="text-zinc-500 text-xs ml-2 truncate max-w-[200px]" title="${escHtml(state.file2.path || '')}">${escHtml(truncatePath(state.file2.path || '', 50))}</span>`;
            } else {
                file2Info.innerHTML = `<span class="text-zinc-500 italic">No file selected</span>`;
            }
        }

        const swapBtn = document.getElementById('fc-swap-btn');
        if (swapBtn) swapBtn.disabled = !state.file1.content && !state.file2.content;

        const clearBtn = document.getElementById('fc-clear-btn');
        if (clearBtn) clearBtn.disabled = !state.file1.content && !state.file2.content;

        const saveBtn = document.getElementById('fc-save-btn');
        if (saveBtn) saveBtn.disabled = !state.diffResult;

        const syncBtn = document.getElementById('fc-sync-btn');
        if (syncBtn) {
            syncBtn.classList.toggle('active', state.scrollSyncEnabled);
            syncBtn.classList.toggle('text-zinc-500', !state.scrollSyncEnabled);
        }

        updateDropZones();
    }

    function updateDropZones() {
        const leftDrop = document.getElementById('fc-left-drop');
        const rightDrop = document.getElementById('fc-right-drop');
        const leftContent = document.getElementById('fc-left-content');
        const rightContent = document.getElementById('fc-right-content');
        
        if (leftDrop && leftContent) {
            if (state.file1.content) {
                leftDrop.classList.add('hidden');
                leftContent.classList.remove('hidden');
            } else {
                leftDrop.classList.remove('hidden');
                leftContent.classList.add('hidden');
            }
        }
        
        if (rightDrop && rightContent) {
            if (state.file2.content) {
                rightDrop.classList.add('hidden');
                rightContent.classList.remove('hidden');
            } else {
                rightDrop.classList.remove('hidden');
                rightContent.classList.add('hidden');
            }
        }
    }

    function truncatePath(path, maxLen) {
        if (!path || path.length <= maxLen) return path;
        const sep = path.includes('\\') ? '\\' : '/';
        const parts = path.split(sep);
        if (parts.length <= 2) return '...' + path.slice(-maxLen);
        return parts[0] + sep + '...' + sep + parts.slice(-2).join(sep);
    }

    /* ------------------------------------------------------------------
     * Swap Files
     * ------------------------------------------------------------------ */
    function swapFiles() {
        const temp = { ...state.file1 };
        state.file1 = { ...state.file2 };
        state.file2 = temp;

        if (state.file1.content && state.file2.content) {
            runComparison();
        } else {
            const leftPane = document.getElementById('fc-left-content');
            const rightPane = document.getElementById('fc-right-content');
            if (leftPane) leftPane.innerHTML = '';
            if (rightPane) rightPane.innerHTML = '';
            
            document.getElementById('fc-added-count').textContent = '0';
            document.getElementById('fc-removed-count').textContent = '0';
            document.getElementById('fc-similarity').textContent = '—';
            
            const similarityBar = document.getElementById('fc-similarity-bar');
            if (similarityBar) similarityBar.style.width = '0%';

            state.diffResult = null;
        }

        updateUI();
    }

    /* ------------------------------------------------------------------
     * Clear All
     * ------------------------------------------------------------------ */
    function clearAll() {
        state.file1 = { path: null, content: null, filename: null };
        state.file2 = { path: null, content: null, filename: null };
        state.diffResult = null;

        const leftContent = document.getElementById('fc-left-content');
        const rightContent = document.getElementById('fc-right-content');
        if (leftContent) leftContent.innerHTML = '';
        if (rightContent) rightContent.innerHTML = '';

        document.getElementById('fc-added-count').textContent = '0';
        document.getElementById('fc-removed-count').textContent = '0';
        document.getElementById('fc-similarity').textContent = '—';
        
        const similarityBar = document.getElementById('fc-similarity-bar');
        if (similarityBar) similarityBar.style.width = '0%';

        updateUI();
    }

    /* ------------------------------------------------------------------
     * Scroll Sync
     * ------------------------------------------------------------------ */
    let isScrolling = false;

    function syncScroll() {
        const leftPane = document.getElementById('fc-left-pane');
        const rightPane = document.getElementById('fc-right-pane');
        if (!leftPane || !rightPane || !state.scrollSyncEnabled) return;

        const leftScrollable = leftPane.scrollHeight - leftPane.clientHeight;
        const rightScrollable = rightPane.scrollHeight - rightPane.clientHeight;

        if (leftScrollable <= 0 || rightScrollable <= 0) return;

        const scrollRatio = leftPane.scrollTop / leftScrollable;
        rightPane.scrollTop = scrollRatio * rightScrollable;
    }

    function setupScrollSync() {
        const leftPane = document.getElementById('fc-left-pane');
        const rightPane = document.getElementById('fc-right-pane');
        if (!leftPane || !rightPane) return;

        leftPane.addEventListener('scroll', () => {
            if (isScrolling || !state.scrollSyncEnabled) return;
            isScrolling = true;
            syncScroll();
            setTimeout(() => { isScrolling = false; }, 20);
        });

        rightPane.addEventListener('scroll', () => {
            if (isScrolling || !state.scrollSyncEnabled) return;
            isScrolling = true;
            
            const rightScrollable = rightPane.scrollHeight - rightPane.clientHeight;
            const leftScrollable = leftPane.scrollHeight - leftPane.clientHeight;

            if (rightScrollable > 0 && leftScrollable > 0) {
                const scrollRatio = rightPane.scrollTop / rightScrollable;
                leftPane.scrollTop = scrollRatio * leftScrollable;
            }
            
            setTimeout(() => { isScrolling = false; }, 20);
        });
    }

    function toggleScrollSync() {
        state.scrollSyncEnabled = !state.scrollSyncEnabled;
        const toggleBtn = document.getElementById('fc-sync-btn');
        if (toggleBtn) {
            toggleBtn.classList.toggle('active', state.scrollSyncEnabled);
            toggleBtn.classList.toggle('text-zinc-500', !state.scrollSyncEnabled);
        }
    }

    /* ------------------------------------------------------------------
     * Save Flow
     * ------------------------------------------------------------------ */
    async function saveDiffFlow() {
        if (!state.diffResult) return;

        const workspace = window.WorkspaceManager?.current;

        if (!workspace) {
            await runSaveAsFlow();
        } else {
            showSaveModal();
        }
    }

    async function runSaveAsFlow() {
        try {
            const patchContent = generateUnifiedPatch();
            const defaultName = generateDefaultFilename();
            
            const savePath = await window.TauriBridge.dialog.save({
                defaultPath: defaultName,
                filters: [
                    { name: 'Unified Diff', extensions: ['diff', 'patch'] },
                    { name: 'Text Files', extensions: ['txt'] }
                ]
            });
            if (!savePath) return;

            await window.TauriBridge.fs.writeTextFile(savePath, patchContent);
            showToast('Diff saved successfully', 'success');
        } catch (err) {
            console.error('[File Compare] save error:', err);
            showToast('Save failed: ' + (err.message || err), 'error');
        }
    }

    function generateDefaultFilename() {
        const f1 = state.file1.filename || 'file1';
        const f2 = state.file2.filename || 'file2';
        // Remove extensions from individual filenames to avoid double extensions
        const cleanF1 = f1.replace(/\.[^.]+$/, '');
        const cleanF2 = f2.replace(/\.[^.]+$/, '');
        return `diff_${cleanF1}_${cleanF2}.diff`;
    }

    function showSaveModal() {
        document.getElementById('fc-save-modal')?.remove();

        const workspace = window.WorkspaceManager.current;
        const defaultName = generateDefaultFilename();
        
        const modal = document.createElement('div');
        modal.id = 'fc-save-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-files text-amber-400 text-xl"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="font-semibold text-white">Save Diff</h3>
                        <input id="fc-save-filename" type="text" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-2 py-1 mt-1 rounded" value="${escHtml(defaultName)}">
                    </div>
                    <button id="fc-save-modal-close" class="ml-2 text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <button id="fc-save-workspace" class="w-full flex items-center px-4 py-3 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/30 hover:border-amber-500/60 text-left transition-colors group">
                        <i class="ph ph-folder-workspace text-amber-400 text-xl mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Save to Workspace</div>
                            <div class="text-xs text-zinc-400 truncate max-w-[240px]">${escHtml(workspace.name)}/Files/</div>
                        </div>
                    </button>
                    <button id="fc-save-saveas" class="w-full flex items-center px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-left transition-colors group">
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
            let val = modal.querySelector('#fc-save-filename').value.trim();
            if (!val) val = 'diff.diff';
            if (!val.toLowerCase().endsWith('.diff') && !val.toLowerCase().endsWith('.patch')) {
                val += '.diff';
            }
            return val;
        };

        modal.querySelector('#fc-save-modal-close').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#fc-save-workspace').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await saveToWorkspace(filename);
        });

        modal.querySelector('#fc-save-saveas').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await runSaveAsFlowNamed(filename);
        });
    }

    async function runSaveAsFlowNamed(filename) {
        try {
            const patchContent = generateUnifiedPatch();
            const savePath = await window.TauriBridge.dialog.save({
                defaultPath: filename,
                filters: [
                    { name: 'Unified Diff', extensions: ['diff', 'patch'] },
                    { name: 'Text Files', extensions: ['txt'] }
                ]
            });
            if (!savePath) return;

            await window.TauriBridge.fs.writeTextFile(savePath, patchContent);
            showToast('Diff saved successfully', 'success');
        } catch (err) {
            console.error('[File Compare] save error:', err);
            showToast('Save failed: ' + (err.message || err), 'error');
        }
    }

    async function saveToWorkspace(filename) {
        try {
            const workspace = window.WorkspaceManager.current;
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const filesDir = `${workspace.path}${sep}Files`;
            await window.TauriBridge.fs.mkdir(filesDir, { recursive: true });
            const finalPath = `${filesDir}${sep}${filename}`;
            
            const patchContent = generateUnifiedPatch();
            await window.TauriBridge.fs.writeTextFile(finalPath, patchContent);
            
            showToast(`Saved to workspace: Files/${filename}`, 'success');
        } catch (err) {
            console.error('[File Compare] saveToWorkspace error:', err);
            showToast('Workspace save failed: ' + (err.message || err), 'error');
        }
    }

    function generateUnifiedPatch() {
        if (!state.file1.content || !state.file2.content) return '';

        // Use the diff library's createTwoFilesPatch function
        const patch = Diff.createTwoFilesPatch(
            state.file1.filename || 'file1.txt',
            state.file2.filename || 'file2.txt',
            state.file1.content,
            state.file2.content
        );

        return patch;
    }

    /* ------------------------------------------------------------------
     * Drag & Drop
     * ------------------------------------------------------------------ */
    function setupDragDrop() {
        // Setup listeners on the actual pane elements (not just the drop zones)
        const leftPane = document.getElementById('fc-left-pane');
        const rightPane = document.getElementById('fc-right-pane');

        if (leftPane) {
            leftPane.addEventListener('dragover', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-left-drop');
                if (dropZone) dropZone.classList.add('drag-over');
            });
            leftPane.addEventListener('dragleave', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-left-drop');
                if (dropZone) dropZone.classList.remove('drag-over');
            });
            leftPane.addEventListener('drop', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-left-drop');
                if (dropZone) dropZone.classList.remove('drag-over');
                handleFileDrop(e, 1);
            });
        }

        if (rightPane) {
            rightPane.addEventListener('dragover', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-right-drop');
                if (dropZone) dropZone.classList.add('drag-over');
            });
            rightPane.addEventListener('dragleave', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-right-drop');
                if (dropZone) dropZone.classList.remove('drag-over');
            });
            rightPane.addEventListener('drop', e => {
                e.preventDefault();
                e.stopPropagation();
                const dropZone = document.getElementById('fc-right-drop');
                if (dropZone) dropZone.classList.remove('drag-over');
                handleFileDrop(e, 2);
            });
        }

        // Also setup on the drop zone elements themselves
        const leftDrop = document.getElementById('fc-left-drop');
        const rightDrop = document.getElementById('fc-right-drop');

        if (leftDrop) {
            leftDrop.addEventListener('dragover', e => { e.preventDefault(); leftDrop.classList.add('drag-over'); });
            leftDrop.addEventListener('dragleave', () => leftDrop.classList.remove('drag-over'));
            leftDrop.addEventListener('drop', e => {
                e.preventDefault();
                leftDrop.classList.remove('drag-over');
                handleFileDrop(e, 1);
            });
        }

        if (rightDrop) {
            rightDrop.addEventListener('dragover', e => { e.preventDefault(); rightDrop.classList.add('drag-over'); });
            rightDrop.addEventListener('dragleave', () => rightDrop.classList.remove('drag-over'));
            rightDrop.addEventListener('drop', e => {
                e.preventDefault();
                rightDrop.classList.remove('drag-over');
                handleFileDrop(e, 2);
            });
        }
    }

    function handleFileDrop(e, side) {
        const dt = e.dataTransfer;
        if (dt.files && dt.files.length > 0) {
            const file = dt.files[0];
            // In Tauri, dropped files have a 'path' property with the full path
            if (file.path) {
                loadDroppedFile(side, file.path);
            } else {
                // Fallback: read file content directly from the File object
                loadDroppedFileFromFileObject(side, file);
            }
        }
    }

    async function loadDroppedFileFromFileObject(side, file) {
        try {
            const content = await file.text();
            const filename = file.name;

            if (side === 1) {
                state.file1 = { path: null, content, filename };
            } else {
                state.file2 = { path: null, content, filename };
            }

            updateUI();

            if (state.file1.content && state.file2.content) {
                runComparison();
                updateUI();
            }
        } catch (err) {
            console.error('[File Compare] drop load error:', err);
            showToast('Failed to read dropped file: ' + (err.message || err), 'error');
        }
    }

    /* ------------------------------------------------------------------
     * Utilities
     * ------------------------------------------------------------------ */
    function basename(path) {
        return path?.replace(/.*[\\/]/, '') || '';
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function showToast(message, type = 'info') {
        document.getElementById('fc-toast-container')?.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error: 'bg-red-700/90 border-red-600/40',
            info: 'bg-zinc-700/90 border-zinc-600/40',
        };
        const iconMap = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'fc-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-fade-enter ${colorMap[type] || colorMap.info}`;
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${escHtml(message)}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /* ------------------------------------------------------------------
     * Init
     * ------------------------------------------------------------------ */
    function init() {
        document.getElementById('fc-btn-file1')?.addEventListener('click', () => selectFile(1));
        document.getElementById('fc-btn-file2')?.addEventListener('click', () => selectFile(2));
        document.getElementById('fc-swap-btn')?.addEventListener('click', swapFiles);
        document.getElementById('fc-clear-btn')?.addEventListener('click', clearAll);
        document.getElementById('fc-save-btn')?.addEventListener('click', saveDiffFlow);
        document.getElementById('fc-sync-btn')?.addEventListener('click', toggleScrollSync);

        setupScrollSync();
        setupDragDrop();
        updateUI();

        console.log('[File Compare] Initialized');
    }

    return {
        init,
        selectFile,
        loadDroppedFile,
        swapFiles,
        clearAll,
        saveDiffFlow,
        state
    };
})();

window.FileCompare = FileCompare;