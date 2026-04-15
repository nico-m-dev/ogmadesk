/**
 * Chart Data Editor Panel
 * Generates a bottom panel for editing chart data.
 */

var ChartDataEditor = (() => {
    let chartType = 'line';

    const defaultColors = ['#2E93fA', '#66DA26', '#546E7A', '#E91E63', '#FF9800', '#7C3AED', '#06B6D4', '#EF4444', '#F59E0B', '#10B981'];

    function getChartData() {
        const state = window.ChartBuilder.state;
        const currentChart = state.charts.find(c => c.id === state.currentChartId);
        return currentChart ? currentChart.data : null;
    }

    function generateDataPanel(type, data, onChange) {
        chartType = type;

        const container = document.getElementById('cb-data-content');
        if (!container) return;

        container.innerHTML = '';

        if (type === 'pie' || type === 'donut') {
            container.innerHTML = generatePieDataEditor(data);
        } else {
            container.innerHTML = generateCategoryDataEditor(data);
        }

        attachDataEditorListeners(onChange);
    }

    function generatePieDataEditor(data) {
        const labels = data.labels || [];
        const series = data.series || [];
        const colors = data.colors || [];

        let html = `
            <div class="cb-data-section">
                <div class="cb-data-section-title">Slices</div>
                <div class="cb-data-list">
        `;

        labels.forEach((label, i) => {
            const value = series[i] || 0;
            const color = colors[i] || defaultColors[i % defaultColors.length];
            html += `
                <div class="cb-data-row">
                    <input type="color" class="cb-slice-color" data-index="${i}" value="${color}" title="Slice color">
                    <input type="text" class="cb-data-label" data-index="${i}" value="${escHtml(label)}" placeholder="Label">
                    <input type="number" class="cb-data-value" data-index="${i}" value="${value}" placeholder="Value">
                    <button class="cb-data-delete" data-index="${i}" title="Delete"><i class="ph ph-trash"></i></button>
                </div>
            `;
        });

        html += `
                </div>
                <button class="cb-btn-small" id="cb-add-data-row">
                    <i class="ph ph-plus"></i> Add Slice
                </button>
            </div>
        `;

        return html;
    }

    function generateCategoryDataEditor(data) {
        const categories = data.xaxis?.categories || [];
        const series = data.series || [];

        let html = `
            <div class="cb-data-section">
                <div class="cb-data-section-title">Datasets</div>
                <div class="cb-series-list" id="cb-series-list">
        `;

        series.forEach((s, seriesIndex) => {
            const seriesColor = data.colors?.[seriesIndex] || defaultColors[seriesIndex % defaultColors.length];
            html += `
                <div class="cb-series-item" data-series-index="${seriesIndex}">
                    <div class="cb-series-header">
                        <input type="color" class="cb-series-color-input" data-series-index="${seriesIndex}" value="${seriesColor}" title="Pick color">
                        <input type="text" class="cb-series-name" data-series-index="${seriesIndex}" 
                               value="${escHtml(s.name || 'Series ' + (seriesIndex + 1))}" placeholder="Series name">
                        <button class="cb-series-delete" data-series-index="${seriesIndex}" title="Delete Series">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                    <div class="cb-series-data">
                        <div class="cb-data-points-grid">
            `;

            const seriesData = Array.isArray(s.data) ? s.data : [];
            categories.forEach((cat, catIndex) => {
                const value = seriesData[catIndex] ?? '';
                html += `
                    <div class="cb-data-point-item">
                        <input type="text" class="cb-data-category" data-point-index="${catIndex}" value="${escHtml(cat)}" placeholder="Label">
                        <input type="number" class="cb-data-value" data-series-index="${seriesIndex}" data-point-index="${catIndex}" value="${value}" placeholder="Value">
                        <button class="cb-data-point-delete" data-point-index="${catIndex}" title="Delete point"><i class="ph ph-x"></i></button>
                    </div>
                `;
            });

            html += `
                        </div>
                    </div>
                </div>
            `;
        });

        html += `
                </div>
                <div class="cb-data-actions">
                    <button class="cb-btn-small" id="cb-add-series">
                        <i class="ph ph-plus"></i> Add Dataset
                    </button>
                    <button class="cb-btn-small" id="cb-add-data-point">
                        <i class="ph ph-plus"></i> Add Data Point
                    </button>
                </div>
            </div>
        `;

        return html;
    }

    function attachDataEditorListeners(onChange) {
        document.querySelectorAll('.cb-data-value').forEach(input => {
            input.addEventListener('change', () => {
                handleValueChange();
                onChange(getChartData());
            });
        });

        document.querySelectorAll('.cb-data-label, .cb-data-category').forEach(input => {
            input.addEventListener('change', () => {
                handleLabelChange();
                onChange(getChartData());
                regeneratePanel(onChange);
            });
        });

        document.querySelectorAll('.cb-data-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                handleDeleteRow(index);
                onChange(getChartData());
                regeneratePanel(onChange);
            });
        });

        document.querySelectorAll('.cb-data-point-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.pointIndex);
                handleDeleteDataPoint(index);
                onChange(getChartData());
                regeneratePanel(onChange);
            });
        });

        document.getElementById('cb-add-data-row')?.addEventListener('click', () => {
            handleAddRow();
            onChange(getChartData());
            regeneratePanel(onChange);
        });

        document.getElementById('cb-add-data-point')?.addEventListener('click', () => {
            handleAddDataPoint();
            onChange(getChartData());
            regeneratePanel(onChange);
        });

        document.getElementById('cb-add-series')?.addEventListener('click', () => {
            handleAddSeries();
            onChange(getChartData());
            regeneratePanel(onChange);
        });

        document.querySelectorAll('.cb-series-delete').forEach(btn => {
            btn.addEventListener('click', () => {
                const seriesIndex = parseInt(btn.dataset.seriesIndex);
                handleDeleteSeries(seriesIndex);
                onChange(getChartData());
                regeneratePanel(onChange);
            });
        });

        document.querySelectorAll('.cb-series-name').forEach(input => {
            input.addEventListener('change', () => {
                handleSeriesNameChange(input);
                onChange(getChartData());
            });
        });

        document.querySelectorAll('.cb-series-color-input').forEach(input => {
            input.addEventListener('input', () => {
                handleColorChange(input);
                onChange(getChartData());
            });
        });

        document.querySelectorAll('.cb-slice-color').forEach(input => {
            input.addEventListener('input', () => {
                handleSliceColorChange(input);
                onChange(getChartData());
            });
        });
    }

    function handleValueChange() {
        const data = getChartData();
        document.querySelectorAll('.cb-data-value').forEach(input => {
            const seriesIndex = parseInt(input.dataset.seriesIndex);
            const pointIndex = parseInt(input.dataset.pointIndex);
            const index = parseInt(input.dataset.index);
            const value = parseFloat(input.value) || 0;

            if (!isNaN(seriesIndex) && !isNaN(pointIndex)) {
                if (data.series[seriesIndex] && Array.isArray(data.series[seriesIndex].data)) {
                    data.series[seriesIndex].data[pointIndex] = value;
                }
            } else if (!isNaN(index)) {
                if (chartType === 'pie' || chartType === 'donut') {
                    data.series[index] = value;
                }
            }
        });
    }

    function handleLabelChange() {
        const data = getChartData();
        if (chartType === 'pie' || chartType === 'donut') {
            document.querySelectorAll('.cb-data-label').forEach((input, index) => {
                if (data.labels) {
                    data.labels[index] = input.value;
                }
            });
        } else {
            document.querySelectorAll('.cb-data-category').forEach((input, index) => {
                if (data.xaxis?.categories) {
                    data.xaxis.categories[index] = input.value;
                }
            });
        }
    }

    function handleDeleteRow(index) {
        const data = getChartData();
        if (chartType === 'pie' || chartType === 'donut') {
            data.labels.splice(index, 1);
            data.series.splice(index, 1);
            if (data.colors) {
                data.colors.splice(index, 1);
            }
        } else {
            data.xaxis?.categories?.splice(index, 1);
            data.series.forEach(s => {
                if (Array.isArray(s.data)) {
                    s.data.splice(index, 1);
                }
            });
        }
    }

    function handleDeleteDataPoint(index) {
        const data = getChartData();
        data.xaxis?.categories?.splice(index, 1);
        data.series.forEach(s => {
            if (Array.isArray(s.data)) {
                s.data.splice(index, 1);
            }
        });
    }

    function handleAddRow() {
        const data = getChartData();
        if (chartType === 'pie' || chartType === 'donut') {
            data.labels.push('New');
            data.series.push(0);
            if (!data.colors) data.colors = [];
            data.colors.push(defaultColors[data.colors.length % defaultColors.length]);
        } else {
            if (!data.xaxis) data.xaxis = { categories: [] };
            data.xaxis.categories.push('New');
            data.series.forEach(s => {
                if (!Array.isArray(s.data)) s.data = [];
                s.data.push(0);
            });
        }
    }

    function handleAddDataPoint() {
        const data = getChartData();
        if (!data.xaxis) data.xaxis = { categories: [] };
        data.xaxis.categories.push('New');
        data.series.forEach(s => {
            if (!Array.isArray(s.data)) s.data = [];
            s.data.push(0);
        });
    }

    function handleAddSeries() {
        const data = getChartData();
        const newIndex = data.series.length;
        const defaultColor = defaultColors[newIndex % defaultColors.length];

        if (!data.colors) data.colors = [];
        if (!data.xaxis) data.xaxis = { categories: [] };

        const categoryCount = data.xaxis.categories?.length || 0;

        data.series.push({
            name: 'Series ' + (newIndex + 1),
            data: new Array(categoryCount).fill(0)
        });

        data.colors.push(defaultColor);
    }

    function handleDeleteSeries(seriesIndex) {
        const data = getChartData();
        if (isNaN(seriesIndex)) return;

        data.series.splice(seriesIndex, 1);
        data.colors?.splice(seriesIndex, 1);

        if (data.series.length === 0) {
            const categoryCount = data.xaxis?.categories?.length || 0;
            data.series.push({
                name: 'Series 1',
                data: new Array(categoryCount).fill(0)
            });
            data.colors = [defaultColors[0]];
        }
    }

    function handleSeriesNameChange(input) {
        const data = getChartData();
        const index = parseInt(input.dataset.seriesIndex);
        if (data.series[index]) {
            data.series[index].name = input.value;
        }
    }

    function handleColorChange(input) {
        const data = getChartData();
        if (!data.colors) data.colors = [];
        const index = parseInt(input.dataset.seriesIndex);
        data.colors[index] = input.value;
    }

    function handleSliceColorChange(input) {
        const data = getChartData();
        if (!data.colors) data.colors = [];
        const index = parseInt(input.dataset.index);
        data.colors[index] = input.value;
    }

    function regeneratePanel(onChange) {
        generateDataPanel(chartType, getChartData(), onChange);
    }

    function setChartType(type) {
        chartType = type;
    }

    function escHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    return { generateDataPanel, setChartType };
})();

window.ChartDataEditor = ChartDataEditor;