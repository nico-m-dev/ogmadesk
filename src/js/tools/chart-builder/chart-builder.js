/**
 * Chart Builder — Orchestrator
 * Multi-chart support with auto-save. Handles UI, live preview, and save flow.
 */

var ChartBuilder = (() => {
    let state = {
        charts: [],
        currentChartId: null,
        chartInstance: null,
        isRendering: false,
        pendingOptions: [],
        pendingData: null,
        saveTimeout: null,
        nameSaveTimeout: null
    };

    function isQuickMode() {
        return !window.WorkspaceManager?.current;
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    function getCurrentChart() {
        return state.charts.find(c => c.id === state.currentChartId);
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function showToast(message, type = 'info') {
        document.getElementById('cb-toast-container')?.remove();

        const colorMap = {
            success: 'bg-emerald-600/90 border-emerald-500/40',
            error: 'bg-red-700/90 border-red-600/40',
            info: 'bg-zinc-700/90 border-zinc-600/40'
        };
        const iconMap = { success: 'ph-check-circle', error: 'ph-x-circle', info: 'ph-info' };

        const el = document.createElement('div');
        el.id = 'cb-toast-container';
        el.className = `fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl backdrop-blur-sm text-white text-sm font-medium animate-fade-enter ${colorMap[type] || colorMap.info}`;
        el.innerHTML = `<i class="ph ${iconMap[type] || iconMap.info} text-lg"></i><span>${escHtml(message)}</span>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 4000);
    }

    /* ------------------------------------------------------------------
     * Multi-Chart Storage
     * ------------------------------------------------------------------ */
    async function saveCharts() {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return;

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const chartsDir = `${workspace.path}${sep}Charts`;
            await window.TauriBridge.fs.mkdir(chartsDir, { recursive: true });
            const filePath = `${chartsDir}${sep}charts.json`;
            const data = {
                charts: state.charts,
                currentChartId: state.currentChartId
            };
            await window.TauriBridge.fs.writeTextFile(filePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.error('[Chart Builder] save error:', err);
        }
    }

    function debouncedSave() {
        if (state.saveTimeout) clearTimeout(state.saveTimeout);
        state.saveTimeout = setTimeout(() => {
            saveCharts();
        }, 300);
    }

    async function loadCharts() {
        const workspace = window.WorkspaceManager?.current;
        if (!workspace) return;

        try {
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const filePath = `${workspace.path}${sep}Charts${sep}charts.json`;
            const exists = await window.TauriBridge.fs.exists(filePath);
            if (exists) {
                const content = await window.TauriBridge.fs.readTextFile(filePath);
                const data = JSON.parse(content);
                state.charts = data.charts || [];
                state.currentChartId = data.currentChartId || null;
            }
        } catch (err) {
            console.log('[Chart Builder] No saved charts found');
        }

        if (!state.currentChartId || !state.charts.find(c => c.id === state.currentChartId)) {
            if (state.charts.length > 0) {
                state.currentChartId = state.charts[0].id;
            }
        }
    }

    function createNewChart(name, type) {
        const typeConfig = ChartTypes.getType(type);
        if (!typeConfig) return null;

        return {
            id: generateId(),
            name: name,
            type: type,
            data: JSON.parse(JSON.stringify(typeConfig.defaultData)),
            options: JSON.parse(JSON.stringify(typeConfig.defaultOptions))
        };
    }

    async function createChart(name, type) {
        const newChart = createNewChart(name, type);
        if (!newChart) {
            showToast('Invalid chart type', 'error');
            return;
        }

        if (isQuickMode() && state.currentChartId) {
            const proceed = await showConfirmModal(
                'Replace Chart',
                'Creating a new chart will remove the current one. Continue?',
                'Replace',
                'bg-amber-600 hover:bg-amber-500'
            );
            if (!proceed) return;

            if (state.chartInstance) {
                state.chartInstance.destroy();
                state.chartInstance = null;
            }
            state.charts = [];
            state.currentChartId = null;
        }

        state.charts.push(newChart);
        state.currentChartId = newChart.id;

        if (!isQuickMode()) {
            await saveCharts();
            renderChartSelector();
        }

        loadChart(newChart);
        showToast('Chart created', 'success');
    }

    async function deleteChart(chartId) {
        if (state.charts.length <= 1) {
            showToast('Cannot delete the last chart', 'error');
            return;
        }

        const index = state.charts.findIndex(c => c.id === chartId);
        if (index === -1) return;

        state.charts.splice(index, 1);

        if (state.currentChartId === chartId) {
            state.currentChartId = state.charts[0].id;
        }

        await saveCharts();
        renderChartSelector();

        const current = getCurrentChart();
        if (current) {
            loadChart(current);
        } else {
            clearChartDisplay();
        }

        showToast('Chart deleted', 'success');
    }

    async function switchChart(chartId) {
        state.currentChartId = chartId;
        await saveCharts();

        const chart = state.charts.find(c => c.id === chartId);
        if (chart) {
            loadChart(chart);
        }
    }

    async function updateChartName(newName) {
        const chart = getCurrentChart();
        if (!chart || !newName.trim()) return;

        chart.name = newName.trim();
        await saveCharts();
        renderChartSelector();
        showToast('Chart name saved', 'success');
    }

    function loadChart(chart) {
        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }

        state.isRendering = false;
        state.pendingOptions = [];
        state.pendingData = null;

        document.getElementById('cb-chart-name').value = chart.name;
        
        hideEmptyState();

        // Apply background color to wrapper
        const wrapper = document.querySelector('.cb-chart-wrapper');
        if (wrapper) {
            wrapper.style.backgroundColor = chart.options.backgroundColor || '#f5f5f5';
        }

        renderChartFromData(chart.type, chart.data, chart.options);

        ChartOptions.generateOptionsPanel(chart.type, chart.options, handleOptionChange);
        ChartDataEditor.setChartType(chart.type);
        ChartDataEditor.generateDataPanel(chart.type, chart.data, handleDataChange);
    }

    function renderChartSelector() {
        const select = document.getElementById('cb-chart-select');
        const currentId = state.currentChartId;

        select.innerHTML = state.charts.map(chart =>
            `<option value="${chart.id}" ${chart.id === currentId ? 'selected' : ''}>${escHtml(chart.name)}</option>`
        ).join('');
    }

    /* ------------------------------------------------------------------
     * Chart Data & Options Change Handlers
     * ------------------------------------------------------------------ */
    function handleDataChange(newData) {
        const chart = getCurrentChart();
        if (!chart || !newData) return;

        chart.data = newData;

        if (state.isRendering || !state.chartInstance) {
            state.pendingData = newData;
            return;
        }

        const container = document.getElementById('cb-chart-container');
        if (!container) {
            state.pendingData = newData;
            return;
        }

        const updateObj = {
            series: JSON.parse(JSON.stringify(newData.series))
        };
        if (newData.xaxis) updateObj.xaxis = JSON.parse(JSON.stringify(newData.xaxis));
        if (newData.labels) updateObj.labels = JSON.parse(JSON.stringify(newData.labels));
        if (newData.colors) updateObj.colors = JSON.parse(JSON.stringify(newData.colors));
        try {
            state.chartInstance.updateOptions(updateObj, true, false, false);
        } catch (err) {
            console.error('[Chart Builder] updateOptions error:', err);
        }

        debouncedSave();
    }

    function handleOptionChange(key, value) {
        const chart = getCurrentChart();
        if (!chart) return;

        const newOptions = { [key]: value };

        if (key === 'title') {
            newOptions.title = value;
        } else if (key === 'legend') {
            newOptions.legend = { ...chart.options.legend, ...value };
        } else if (key === 'stroke') {
            newOptions.stroke = { ...chart.options.stroke, ...value };
        } else if (key === 'dataLabels') {
            newOptions.dataLabels = { ...chart.options.dataLabels, ...value };
        } else if (key === 'plotOptions') {
            newOptions.plotOptions = { ...chart.options.plotOptions, ...value };
        } else if (key === 'colors') {
            chart.data.colors = value;
        } else if (key === 'backgroundColor') {
            newOptions.backgroundColor = value;
        } else if (key === 'textTheme') {
            newOptions.textTheme = value;
        } else if (key === 'insideTextTheme') {
            newOptions.insideTextTheme = value;
        } else {
            newOptions[key] = value;
        }

        chart.options = { ...chart.options, ...newOptions };

        if (state.isRendering || !state.chartInstance) {
            state.pendingOptions.push(newOptions);
            return;
        }

        const container = document.getElementById('cb-chart-container');
        if (!container) {
            state.pendingOptions.push(newOptions);
            return;
        }

        const updateObj = {};
        if (key === 'backgroundColor') {
            // Apply to wrapper instead of chart redraw for performance and clipping
            const wrapper = document.querySelector('.cb-chart-wrapper');
            if (wrapper) {
                wrapper.style.backgroundColor = value;
            }
            // No need to call updateOptions for background since we handled it in DOM
            debouncedSave();
            return;
        } else if (key === 'textColor') {
            updateObj.chart = { foreColor: value };
            updateObj.title = { style: { color: value } };
            updateObj.legend = { labels: { style: { colors: value } } };
            updateObj.xaxis = { labels: { style: { colors: value } } };
            updateObj.yaxis = { labels: { style: { colors: value } } };
        } else if (key === 'gridColor') {
            updateObj.grid = { 
                borderColor: value,
                xaxis: { lines: { show: true, strokeColor: value } },
                yaxis: { lines: { show: true, strokeColor: value } }
            };
            updateObj.xaxis = { 
                axisBorder: { show: true, color: value },
                axisTicks: { show: true, color: value }
            };
        } else {
            Object.assign(updateObj, newOptions);
        }

        try {
            const shouldRedraw = (key === 'textColor' || key === 'gridColor' || key === 'backgroundColor');
            state.chartInstance.updateOptions(updateObj, shouldRedraw, true, false);
        } catch (err) {
            console.error('[Chart Builder] updateOptions error:', err);
        }

        debouncedSave();
    }

    /* ------------------------------------------------------------------
     * Chart Rendering
     * ------------------------------------------------------------------ */
    function renderChartFromData(type, data, options) {
        const container = document.getElementById('cb-chart-container');
        if (!container) return;

        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }

        container.innerHTML = '';
        state.isRendering = true;
        state.pendingOptions = [];
        state.pendingData = null;

        const chartOptions = buildChartOptions(type, data, options);
        state.chartInstance = new ApexCharts(container, chartOptions);
        state.chartInstance.render().then(() => {
            state.isRendering = false;
            processPendingOptions();
            processPendingData();
        }).catch(err => {
            console.error('[Chart Builder] render error:', err);
            state.isRendering = false;
            showToast('Failed to render chart', 'error');
        });
    }

    function buildChartOptions(type, data, options) {
        const opt = JSON.parse(JSON.stringify(options));

        opt.chart = opt.chart || {};
        opt.chart.type = type;
        opt.chart.id = 'cb-main-chart';
        opt.chart.animations = { enabled: true };
        opt.chart.background = 'transparent'; // Use wrapper background for better clipping/aesthetics

        // Set explicit text color (title, legend, axis labels)
        const textColor = options.textColor || '#373d3f';
        opt.chart.foreColor = textColor;
        
        opt.title = opt.title || {};
        opt.title.style = { color: textColor };
        opt.title.align = 'center';
        
        opt.legend = opt.legend || {};
        opt.legend.labels = opt.legend.labels || {};
        opt.legend.labels.style = { colors: textColor };

        // Set explicit grid colors (only for line and bar charts)
        if (type === 'line' || type === 'bar') {
            const gridColor = options.gridColor || '#e2e8f0';
            opt.grid = opt.grid || {};
            opt.grid.borderColor = gridColor;
            opt.grid.xaxis = { lines: { show: true, strokeColor: gridColor } };
            opt.grid.yaxis = { lines: { show: true, strokeColor: gridColor } };

            // Set axis border colors to match grid (not text) to avoid conflicts
            opt.xaxis = opt.xaxis || {};
            opt.xaxis.axisBorder = { show: true, color: gridColor };
            opt.xaxis.axisTicks = { show: true, color: gridColor };
            opt.xaxis.labels = opt.xaxis.labels || {};
            opt.xaxis.labels.style = { colors: textColor };
            
            opt.yaxis = opt.yaxis || {};
            opt.yaxis.labels = opt.yaxis.labels || {};
            opt.yaxis.labels.style = { colors: textColor };
        } else {
            opt.grid = { show: false };
            
            opt.xaxis = opt.xaxis || {};
            opt.xaxis.labels = opt.xaxis.labels || {};
            opt.xaxis.labels.style = { colors: textColor };
            
            opt.yaxis = opt.yaxis || {};
            opt.yaxis.labels = opt.yaxis.labels || {};
            opt.yaxis.labels.style = { colors: textColor };
        }

        // Merge data.xaxis (preserves categories)
        if (data.xaxis) {
            opt.xaxis = { ...opt.xaxis, ...data.xaxis };
        }
        
        if (data.labels) {
            opt.labels = data.labels;
        }

        if (data.colors && data.colors.length > 0) {
            opt.colors = data.colors;
        }

        opt.series = data.series;

        if (type === 'pie' || type === 'donut') {
            opt.dataLabels = opt.dataLabels || {};
            opt.dataLabels.formatter = function(val, opts) {
                return opts.w.config.series[opts.seriesIndex];
            };
        }

        return opt;
    }

    function processPendingOptions() {
        if (!state.chartInstance || state.pendingOptions.length === 0) return;

        const container = document.getElementById('cb-chart-container');
        if (!container) return;

        const updates = state.pendingOptions.splice(0);
        updates.forEach(newOptions => {
            if (state.chartInstance) {
                try {
                    state.chartInstance.updateOptions(newOptions, false, true, false);
                } catch (err) {
                    console.error('[Chart Builder] updateOptions error:', err);
                }
            }
        });
    }

    function processPendingData() {
        if (!state.chartInstance || !state.pendingData) return;

        const container = document.getElementById('cb-chart-container');
        if (!container) return;

        const newData = state.pendingData;
        state.pendingData = null;

        const updateObj = {
            series: JSON.parse(JSON.stringify(newData.series))
        };
        if (newData.xaxis) updateObj.xaxis = JSON.parse(JSON.stringify(newData.xaxis));
        if (newData.labels) updateObj.labels = JSON.parse(JSON.stringify(newData.labels));
        if (newData.colors) updateObj.colors = JSON.parse(JSON.stringify(newData.colors));
        try {
            state.chartInstance.updateOptions(updateObj, true, false, false);
        } catch (err) {
            console.error('[Chart Builder] updateOptions error:', err);
        }
    }

    function clearChartDisplay() {
        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }
        const container = document.getElementById('cb-chart-container');
        if (container) {
            container.innerHTML = '';
        }
        document.getElementById('cb-chart-name').value = '';
        document.getElementById('cb-options-content').innerHTML = '';
        document.getElementById('cb-data-content').innerHTML = '';
        
        showEmptyState();
    }

    function showEmptyState() {
        const emptyState = document.getElementById('cb-empty-state');
        
        if (emptyState) emptyState.classList.remove('hidden');
        updateQuickModeUI();
    }

    function hideEmptyState() {
        const emptyState = document.getElementById('cb-empty-state');
        
        if (emptyState) emptyState.classList.add('hidden');
        updateQuickModeUI();
    }

    /* ------------------------------------------------------------------
     * Export PNG
     * ------------------------------------------------------------------ */
    async function exportPNG() {
        const chart = getCurrentChart();
        if (!chart || !state.chartInstance) {
            showToast('No chart to export', 'error');
            return;
        }

        const workspace = window.WorkspaceManager?.current;
        if (workspace) {
            await showExportModal();
        } else {
            await exportPNGToPCWithName(`chart-${Date.now()}.png`);
        }
    }

    async function exportPNGToPCWithName(filename) {
        if (!state.chartInstance) return;
        try {
            const result = await state.chartInstance.dataURI({ scale: 2 });
            let blob = result.blob;

            if (!blob) {
                const { imgURI } = result;
                const base64Data = imgURI.replace(/^data:image\/png;base64,/, '');
                const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                blob = new Blob([binaryData], { type: 'image/png' });
            }

            const savePath = await window.TauriBridge.dialog.save({
                defaultPath: filename,
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            });
            if (!savePath) return;

            const arrayBuffer = await blob.arrayBuffer();
            await window.TauriBridge.fs.writeBinaryFile(savePath, new Uint8Array(arrayBuffer));
            showToast('Chart exported as PNG', 'success');
        } catch (err) {
            console.error('[Chart Builder] export PNG error:', err);
            showToast('Export failed: ' + (err.message || err), 'error');
        }
    }

    async function exportPNGToWorkspaceWithName(filename) {
        try {
            const workspace = window.WorkspaceManager.current;
            const sep = workspace.path.includes('\\') ? '\\' : '/';
            const assetsDir = `${workspace.path}${sep}Assets`;
            await window.TauriBridge.fs.mkdir(assetsDir, { recursive: true });

            const imgPath = `${assetsDir}${sep}${filename}`;

            const result = await state.chartInstance.dataURI({ scale: 2 });
            let blob = result.blob;

            if (!blob) {
                const { imgURI } = result;
                const base64Data = imgURI.replace(/^data:image\/png;base64,/, '');
                const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
                blob = new Blob([binaryData], { type: 'image/png' });
            }

            const arrayBuffer = await blob.arrayBuffer();
            await window.TauriBridge.fs.writeBinaryFile(imgPath, new Uint8Array(arrayBuffer));
            showToast(`Saved to workspace: Assets/${filename}`, 'success');
        } catch (err) {
            console.error('[Chart Builder] PNG workspace save error:', err);
            showToast('Workspace save failed: ' + (err.message || err), 'error');
        }
    }

    function showExportModal() {
        document.getElementById('cb-export-modal')?.remove();

        const workspace = window.WorkspaceManager.current;
        const defaultName = `chart-${Date.now()}.png`;

        const modal = document.createElement('div');
        modal.id = 'cb-export-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-export text-amber-400 text-xl"></i>
                    </div>
                    <div class="flex-1">
                        <h3 class="font-semibold text-white">Export PNG</h3>
                        <input id="cb-export-filename" type="text" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-2 py-1 mt-1 rounded" value="${defaultName}">
                    </div>
                    <button id="cb-export-modal-close" class="ml-2 text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    <button id="cb-export-workspace" class="w-full flex items-center px-4 py-3 rounded-lg bg-amber-600/20 hover:bg-amber-600/40 border border-amber-600/30 hover:border-amber-500/60 text-left transition-colors group">
                        <i class="ph ph-folder-workspace text-amber-400 text-xl mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Save to Workspace</div>
                            <div class="text-xs text-zinc-400 truncate max-w-[240px]">${escHtml(workspace.name)}/Assets/</div>
                        </div>
                    </button>
                    <button id="cb-export-pc" class="w-full flex items-center px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-left transition-colors group">
                        <i class="ph ph-hard-drive text-zinc-400 text-xl mr-3 group-hover:scale-110 transition-transform"></i>
                        <div>
                            <div class="text-sm font-medium text-white">Save to PC</div>
                            <div class="text-xs text-zinc-400">Choose any location on your PC</div>
                        </div>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        const getInputName = () => {
            let val = modal.querySelector('#cb-export-filename').value.trim();
            if (!val) val = 'chart.png';
            if (!val.toLowerCase().endsWith('.png')) val += '.png';
            return val;
        };

        modal.querySelector('#cb-export-modal-close').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#cb-export-workspace').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await exportPNGToWorkspaceWithName(filename);
        });

        modal.querySelector('#cb-export-pc').addEventListener('click', async () => {
            const filename = getInputName();
            close();
            await exportPNGToPCWithName(filename);
        });
    }

    /* ------------------------------------------------------------------
     * Modals
     * ------------------------------------------------------------------ */
    function showNewChartModal() {
        document.getElementById('cb-modal')?.remove();

        const enabledTypes = ChartTypes.getEnabledTypes();
        const isQM = isQuickMode();

        const nameFieldHTML = isQM ? '' : `
            <div>
                <label class="block text-xs text-zinc-400 mb-1">Chart Name *</label>
                <input id="cb-input-name" type="text" autocomplete="off" class="w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-sm px-3 py-2 rounded-lg focus:outline-none focus:border-amber-500" placeholder="Enter chart name...">
            </div>
        `;

        const modal = document.createElement('div');
        modal.id = 'cb-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-96 p-6 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-amber-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-plus text-amber-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">New Chart</h3>
                    </div>
                    <button id="cb-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <div class="space-y-3">
                    ${nameFieldHTML}
                    <div>
                        <label class="block text-xs text-zinc-400 mb-1">Chart Type</label>
                        <div class="grid grid-cols-2 gap-2">
                            ${enabledTypes.map(t => `
                                <button type="button" class="cb-type-select-btn flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-700 hover:border-amber-500 hover:bg-zinc-800 transition-colors text-zinc-300 text-sm" data-type="${t.id}">
                                    <i class="ph ${t.icon}"></i> ${t.name}
                                </button>
                            `).join('')}
                        </div>
                        <input id="cb-input-type" type="hidden" value="${enabledTypes[0]?.id || 'line'}">
                    </div>
                </div>
                <div class="flex gap-2 mt-5">
                    <button id="cb-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="cb-btn-create" class="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium transition-colors">Create Chart</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#cb-modal-close').addEventListener('click', close);
        modal.querySelector('#cb-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelectorAll('.cb-type-select-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.cb-type-select-btn').forEach(b => {
                    b.classList.remove('border-amber-500', 'bg-zinc-800', 'text-amber-400');
                    b.classList.add('border-zinc-700', 'text-zinc-300');
                });
                btn.classList.remove('border-zinc-700', 'text-zinc-300');
                btn.classList.add('border-amber-500', 'bg-zinc-800', 'text-amber-400');
                modal.querySelector('#cb-input-type').value = btn.dataset.type;
            });
        });

        modal.querySelectorAll('.cb-type-select-btn')[0]?.click();

        modal.querySelector('#cb-btn-create').addEventListener('click', () => {
            const nameInput = document.getElementById('cb-input-name');
            const type = modal.querySelector('#cb-input-type').value;

            if (!isQM && nameInput) {
                const name = nameInput.value.trim();
                if (!name) {
                    nameInput.classList.add('border-red-500');
                    return;
                }
                close();
                createChart(name, type);
            } else {
                close();
                createChart('', type);
            }
        });

        if (!isQM) {
            setTimeout(() => document.getElementById('cb-input-name')?.focus(), 100);
        }
    }

    function showDeleteChartConfirm() {
        const chart = getCurrentChart();
        if (!chart) return;

        if (state.charts.length <= 1) {
            showToast('Cannot delete the last chart', 'error');
            return;
        }

        document.getElementById('cb-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'cb-modal';
        modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
        modal.innerHTML = `
            <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                <div class="flex items-center mb-4">
                    <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                        <i class="ph ph-trash text-red-400 text-xl"></i>
                    </div>
                    <div>
                        <h3 class="font-semibold text-white">Delete Chart</h3>
                    </div>
                    <button id="cb-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>
                <p class="text-zinc-300 text-sm mb-5">Are you sure you want to delete "<span class="text-amber-400">${escHtml(chart.name)}</span>"? This action cannot be undone.</p>
                <div class="flex gap-2">
                    <button id="cb-btn-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                    <button id="cb-btn-delete" class="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">Delete Chart</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const close = () => modal.remove();
        modal.querySelector('#cb-modal-close').addEventListener('click', close);
        modal.querySelector('#cb-btn-cancel').addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal) close(); });

        modal.querySelector('#cb-btn-delete').addEventListener('click', () => {
            deleteChart(state.currentChartId);
            close();
        });
    }

    /* ------------------------------------------------------------------
     * Event Bindings
     * ------------------------------------------------------------------ */
    function bindEvents() {
        document.getElementById('cb-btn-new')?.addEventListener('click', showNewChartModal);
        
        document.getElementById('cb-btn-empty-new')?.addEventListener('click', showNewChartModal);

        document.getElementById('cb-btn-delete')?.addEventListener('click', showDeleteChartConfirm);

        document.getElementById('cb-chart-select')?.addEventListener('change', (e) => {
            switchChart(e.target.value);
        });

        document.getElementById('cb-chart-name')?.addEventListener('input', (e) => {
            if (state.nameSaveTimeout) clearTimeout(state.nameSaveTimeout);
            state.nameSaveTimeout = setTimeout(() => {
                updateChartName(e.target.value);
            }, 500);
        });

        document.getElementById('cb-chart-name')?.addEventListener('blur', (e) => {
            const chart = getCurrentChart();
            if (chart && e.target.value.trim() !== chart.name) {
                updateChartName(e.target.value);
            }
        });

        document.getElementById('cb-btn-export-png')?.addEventListener('click', exportPNG);
    }

    /* ------------------------------------------------------------------
     * Quick Mode UI & Warnings
     * ------------------------------------------------------------------ */
    function updateQuickModeUI() {
        const isQM = isQuickMode();
        const chartNameInput = document.getElementById('cb-chart-name');
        const chartSelect = document.getElementById('cb-chart-select');
        const deleteBtn = document.getElementById('cb-btn-delete');

        if (isQM) {
            chartNameInput?.parentElement?.classList.add('hidden');
            chartSelect?.parentElement?.classList.add('hidden');
            deleteBtn?.parentElement?.classList.add('hidden');
        } else {
            chartNameInput?.parentElement?.classList.remove('hidden');
            chartSelect?.parentElement?.classList.remove('hidden');
            deleteBtn?.parentElement?.classList.remove('hidden');
        }
    }

    function setupNavigationWarnings() {
        if (window.App) {
            window.App.onBeforePageChange = async () => {
                if (isQuickMode() && state.currentChartId) {
                    const proceed = await showConfirmModal(
                        'Unsaved Chart',
                        'You have an unsaved chart. Leave anyway? (Chart will be lost)',
                        'Leave',
                        'bg-red-600 hover:bg-red-500'
                    );
                    if (proceed) {
                        discardChart();
                    }
                    return proceed;
                }
                return true;
            };
        }

        window.addEventListener('beforeunload', (e) => {
            if (isQuickMode() && state.currentChartId) {
                e.preventDefault();
                e.returnValue = 'You have an unsaved chart. Leave anyway?';
                return e.returnValue;
            }
        });

        let windowCloseHandlerRegistered = false;

        if (window.TauriBridge?.window && !windowCloseHandlerRegistered) {
            windowCloseHandlerRegistered = true;
            (async () => {
                const appWindow = await window.TauriBridge.window.getCurrent();
                if (appWindow && appWindow.onCloseRequested) {
                    appWindow.onCloseRequested(async (event) => {
                        if (isQuickMode() && state.currentChartId) {
                            event.preventDefault();
                            const proceed = await showConfirmModal(
                                'Unsaved Chart',
                                'You have an unsaved chart. Close anyway? (Chart will be lost)',
                                'Close',
                                'bg-red-600 hover:bg-red-500'
                            );
                            if (proceed) {
                                discardChart();
                                await appWindow.close();
                            }
                        }
                    });
                }
            })();
        }
    }

    function showConfirmModal(title, message, confirmText = 'OK', confirmClass = 'bg-amber-600 hover:bg-amber-500') {
        return new Promise((resolve) => {
            document.getElementById('cb-confirm-modal')?.remove();

            const modal = document.createElement('div');
            modal.id = 'cb-confirm-modal';
            modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm';
            modal.innerHTML = `
                <div class="glass-panel w-90 p-5 shadow-2xl animate-fade-enter">
                    <div class="flex items-center mb-4">
                        <div class="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center mr-3">
                            <i class="ph ph-warning text-red-400 text-xl"></i>
                        </div>
                        <div>
                            <h3 class="font-semibold text-white">${escHtml(title)}</h3>
                        </div>
                        <button id="cb-confirm-modal-close" class="ml-auto text-zinc-500 hover:text-white transition-colors self-start">
                            <i class="ph ph-x text-lg"></i>
                        </button>
                    </div>
                    <p class="text-zinc-300 text-sm mb-5">${escHtml(message)}</p>
                    <div class="flex gap-2">
                        <button id="cb-confirm-cancel" class="flex-1 px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium transition-colors">Cancel</button>
                        <button id="cb-confirm-ok" class="flex-1 px-4 py-2 rounded-lg ${confirmClass} text-white text-sm font-medium transition-colors">${escHtml(confirmText)}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const close = (result) => {
                modal.remove();
                resolve(result);
            };

            modal.querySelector('#cb-confirm-modal-close').addEventListener('click', () => close(false));
            modal.querySelector('#cb-confirm-cancel').addEventListener('click', () => close(false));
            modal.querySelector('#cb-confirm-ok').addEventListener('click', () => close(true));
            modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });
        });
    }

    /* ------------------------------------------------------------------
     * Init
     * ------------------------------------------------------------------ */
    function discardChart() {
        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }
        state.charts = [];
        state.currentChartId = null;
        state.isRendering = false;
        state.pendingOptions = [];
        state.pendingData = null;
    }

    async function init() {
        if (!isQuickMode()) {
            await loadCharts();
            renderChartSelector();
        }

        updateQuickModeUI();
        setupNavigationWarnings();

        const currentChart = getCurrentChart();
        if (currentChart) {
            loadChart(currentChart);
        } else {
            showEmptyState();
        }

        bindEvents();
        console.log('[Chart Builder] Initialized');
    }

    function reset() {
        if (state.chartInstance) {
            state.chartInstance.destroy();
            state.chartInstance = null;
        }
        state.charts = [];
        state.currentChartId = null;
        state.isRendering = false;
        state.pendingOptions = [];
        state.pendingData = null;
    }

    return { init, selectChartType: () => {}, state, reset };
})();

window.ChartBuilder = ChartBuilder;
