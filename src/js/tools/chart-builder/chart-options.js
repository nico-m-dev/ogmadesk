/**
 * Chart Options Panel Generator
 * Dynamically generates the right panel options based on chart type.
 */

var ChartOptions = (() => {
    const legendPositions = [
        { value: 'bottom', label: 'Bottom' },
        { value: 'top', label: 'Top' },
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' }
    ];

    const curveTypes = [
        { value: 'smooth', label: 'Smooth' },
        { value: 'straight', label: 'Straight' },
        { value: 'stepline', label: 'Stepline' }
    ];

    const lineWidthOptions = [
        { value: 1, label: '1px' },
        { value: 3, label: '3px' },
        { value: 5, label: '5px' }
    ];

    const donutHoleSizeOptions = [];
    for (let i = 20; i <= 80; i += 5) {
        donutHoleSizeOptions.push({ value: i, label: i + '%' });
    }

    const chartColors = [
        { value: '#2E93fA', label: 'Blue' },
        { value: '#66DA26', label: 'Green' },
        { value: '#546E7A', label: 'Gray' },
        { value: '#E91E63', label: 'Pink' },
        { value: '#FF9800', label: 'Orange' },
        { value: '#7C3AED', label: 'Purple' },
        { value: '#06B6D4', label: 'Cyan' },
        { value: '#EF4444', label: 'Red' },
        { value: '#F59E0B', label: 'Amber' },
        { value: '#10B981', label: 'Emerald' }
    ];

    function generateOptionsPanel(chartType, currentOptions, onChange) {
        const container = document.getElementById('cb-options-content');
        if (!container) return;

        let html = '';

        html += `
            <div class="cb-option-group">
                <label class="cb-option-label">Chart Title</label>
                <input type="text" id="cb-title" class="cb-option-input" 
                       value="${currentOptions?.title?.text || ''}" 
                       placeholder="Enter chart title...">
            </div>
        `;

        html += `
            <div class="cb-option-group">
                <label class="cb-option-label">Legend Position</label>
                <select id="cb-legend-position" class="cb-option-select">
                    ${legendPositions.map(p => `
                        <option value="${p.value}" ${(currentOptions?.legend?.position || 'bottom') === p.value ? 'selected' : ''}>
                            ${p.label}
                        </option>
                    `).join('')}
                </select>
            </div>
        `;

        if (chartType === 'line') {
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-label">Line Style</label>
                    <select id="cb-curve" class="cb-option-select">
                        ${curveTypes.map(c => `
                            <option value="${c.value}" ${(currentOptions?.stroke?.curve || 'smooth') === c.value ? 'selected' : ''}>
                                ${c.label}
                            </option>
                        `).join('')}
                    </select>
                </div>
            `;
        }

        // Line width selector for line charts (dropdown) - placed before Show Grid
        if (chartType === 'line') {
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-label">Line Width</label>
                    <select id="cb-line-width" class="cb-option-select">
                        ${lineWidthOptions.map(o => `
                            <option value="${o.value}" ${(currentOptions?.stroke?.width || 2) === o.value ? 'selected' : ''}>
                                ${o.label}
                            </option>
                        `).join('')}
                    </select>
                </div>
            `;
        }

        // Grid toggle for line and bar charts
        if (chartType === 'line' || chartType === 'bar') {
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-checkbox">
                        <input type="checkbox" id="cb-grid-show" ${currentOptions?.grid?.show ? 'checked' : ''}>
                        <span>Show Grid</span>
                    </label>
                </div>
            `;
        }

        // Donut specific options
        if (chartType === 'donut') {
            // Get current hole size (default 65)
            const currentHoleSize = currentOptions?.plotOptions?.pie?.donut?.size 
                ? parseInt(currentOptions.plotOptions.pie.donut.size.replace('%', '')) 
                : 65;
            
            // Hole size slider first (dropdown)
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-label">Hole Size</label>
                    <select id="cb-donut-hole-size" class="cb-option-select">
                        ${donutHoleSizeOptions.map(o => `
                            <option value="${o.value}" ${currentHoleSize === o.value ? 'selected' : ''}>
                                ${o.label}
                            </option>
                        `).join('')}
                    </select>
                </div>
            `;
            
            // Total toggle (checkbox)
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-checkbox">
                        <input type="checkbox" id="cb-donut-total-show" ${currentOptions?.plotOptions?.pie?.donut?.labels?.total?.show ? 'checked' : ''}>
                        <span>Show Total in Center</span>
                    </label>
                </div>
            `;
        }

        html += `
            <div class="cb-option-group">
                <label class="cb-option-checkbox">
                    <input type="checkbox" id="cb-data-labels" ${currentOptions?.dataLabels?.enabled ? 'checked' : ''}>
                    <span>Show Data Labels</span>
                </label>
            </div>
        `;

        if (chartType === 'bar') {
            html += `
                <div class="cb-option-group">
                    <label class="cb-option-checkbox">
                        <input type="checkbox" id="cb-horizontal" ${currentOptions?.plotOptions?.bar?.horizontal ? 'checked' : ''}>
                        <span>Horizontal Bars</span>
                    </label>
                </div>
            `;
        }

        // Chart Appearance Section - stand out at bottom
        html += `
            <div class="cb-options-divider"></div>
            <div class="cb-option-group cb-appearance-group">
                <label class="cb-option-label cb-appearance-label">Chart Appearance</label>
                
                <div class="cb-appearance-row">
                    <label class="cb-option-label cb-appearance-sublabel">Background Color</label>
                    <div class="cb-bg-color-wrapper">
                        <input type="color" id="cb-bg-color" class="cb-bg-color-input" value="${currentOptions?.backgroundColor || '#f5f5f5'}">
                        <input type="text" id="cb-bg-color-hex" class="cb-bg-color-hex" value="${currentOptions?.backgroundColor || '#f5f5f5'}" placeholder="#000000">
                    </div>
                </div>

                <div class="cb-appearance-row">
                    <label class="cb-option-label cb-appearance-sublabel">Text Color</label>
                    <div class="cb-bg-color-wrapper">
                        <input type="color" id="cb-text-color" class="cb-bg-color-input" value="${currentOptions?.textColor || '#373d3f'}">
                        <input type="text" id="cb-text-color-hex" class="cb-bg-color-hex" value="${currentOptions?.textColor || '#373d3f'}" placeholder="#000000">
                    </div>
                </div>

                ${(chartType === 'line' || chartType === 'bar') ? `
                <div class="cb-appearance-row">
                    <label class="cb-option-label cb-appearance-sublabel">Grid Color</label>
                    <div class="cb-bg-color-wrapper">
                        <input type="color" id="cb-grid-color" class="cb-bg-color-input" value="${currentOptions?.gridColor || '#e2e8f0'}">
                        <input type="text" id="cb-grid-color-hex" class="cb-bg-color-hex" value="${currentOptions?.gridColor || '#e2e8f0'}" placeholder="#000000">
                    </div>
                </div>
                ` : ''}
            </div>
        `;

        container.innerHTML = html;

        document.getElementById('cb-title')?.addEventListener('input', (e) => {
            onChange('title', { text: e.target.value, align: 'center' });
        });

        document.getElementById('cb-legend-position')?.addEventListener('change', (e) => {
            onChange('legend', { position: e.target.value });
        });

        if (chartType === 'line') {
            document.getElementById('cb-curve')?.addEventListener('change', (e) => {
                onChange('stroke', { curve: e.target.value });
            });
        }

        // Grid toggle event listener
        if (chartType === 'line' || chartType === 'bar') {
            document.getElementById('cb-grid-show')?.addEventListener('change', (e) => {
                onChange('grid', { show: e.target.checked });
            });
        }

        // Line width selector event listener
        if (chartType === 'line') {
            document.getElementById('cb-line-width')?.addEventListener('change', (e) => {
                onChange('stroke', { width: parseInt(e.target.value) });
            });
        }

        // Donut total toggle event listener
        if (chartType === 'donut') {
            document.getElementById('cb-donut-total-show')?.addEventListener('change', (e) => {
                const plotOptions = { ...currentOptions.plotOptions };
                if (!plotOptions.pie) plotOptions.pie = {};
                if (!plotOptions.pie.donut) plotOptions.pie.donut = {};
                if (!plotOptions.pie.donut.labels) plotOptions.pie.donut.labels = {};
                
                plotOptions.pie.donut.labels.total = { 
                    ...plotOptions.pie.donut.labels.total,
                    show: e.target.checked
                };
                
                onChange('plotOptions', plotOptions);
            });
        }

        // Donut hole size selector event listener
        if (chartType === 'donut') {
            document.getElementById('cb-donut-hole-size')?.addEventListener('change', (e) => {
                const plotOptions = { ...currentOptions.plotOptions };
                if (!plotOptions.pie) plotOptions.pie = {};
                if (!plotOptions.pie.donut) plotOptions.pie.donut = {};
                
                plotOptions.pie.donut.size = e.target.value + '%';
                
                onChange('plotOptions', plotOptions);
            });
        }

        document.getElementById('cb-data-labels')?.addEventListener('change', (e) => {
            onChange('dataLabels', { enabled: e.target.checked });
        });

        if (chartType === 'bar') {
            document.getElementById('cb-horizontal')?.addEventListener('change', (e) => {
                onChange('plotOptions', { bar: { horizontal: e.target.checked } });
            });
        }

        // Background color picker
        document.getElementById('cb-bg-color')?.addEventListener('input', (e) => {
            const hex = e.target.value;
            const hexInput = document.getElementById('cb-bg-color-hex');
            if (hexInput) hexInput.value = hex;
            onChange('backgroundColor', hex);
        });

        // Background color text input
        document.getElementById('cb-bg-color-hex')?.addEventListener('input', (e) => {
            const hex = normalizeHex(e.target.value);
            if (hex) {
                const colorInput = document.getElementById('cb-bg-color');
                if (colorInput) colorInput.value = hex;
                onChange('backgroundColor', hex);
            }
        });

        // Text color picker
        document.getElementById('cb-text-color')?.addEventListener('input', (e) => {
            const hex = e.target.value;
            const hexInput = document.getElementById('cb-text-color-hex');
            if (hexInput) hexInput.value = hex;
            onChange('textColor', hex);
        });

        // Text color text input
        document.getElementById('cb-text-color-hex')?.addEventListener('input', (e) => {
            const hex = normalizeHex(e.target.value);
            if (hex) {
                const colorInput = document.getElementById('cb-text-color');
                if (colorInput) colorInput.value = hex;
                onChange('textColor', hex);
            }
        });

        // Grid color picker
        document.getElementById('cb-grid-color')?.addEventListener('input', (e) => {
            const hex = e.target.value;
            const hexInput = document.getElementById('cb-grid-color-hex');
            if (hexInput) hexInput.value = hex;
            onChange('gridColor', hex);
        });

        // Grid color text input
        document.getElementById('cb-grid-color-hex')?.addEventListener('input', (e) => {
            const hex = normalizeHex(e.target.value);
            if (hex) {
                const colorInput = document.getElementById('cb-grid-color');
                if (colorInput) colorInput.value = hex;
                onChange('gridColor', hex);
            }
        });
    }

    // Normalize hex input (add # if missing, validate format)
    function normalizeHex(value) {
        let hex = value.trim();
        if (!hex) return null;
        if (!hex.startsWith('#')) hex = '#' + hex;
        // Validate: #RGB or #RRGGBB
        if (/^#[0-9A-Fa-f]{6}$/.test(hex) || /^#[0-9A-Fa-f]{3}$/.test(hex)) {
            // Normalize 3-digit to 6-digit
            if (hex.length === 4) {
                hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
            }
            return hex.toLowerCase();
        }
        return null;
    }

    function getChartColors() {
        return chartColors;
    }

    return { generateOptionsPanel };
})();

window.ChartOptions = ChartOptions;