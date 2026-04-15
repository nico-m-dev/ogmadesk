/**
 * Chart Types Registry
 * Modular registry for chart types with their default configurations.
 * Add new chart types here to make them available in the UI.
 */

var ChartTypes = (() => {
    const defaultColors = ['#2E93fA', '#66DA26', '#546E7A', '#E91E63', '#FF9800'];

    const registry = {
        line: {
            id: 'line',
            name: 'Line',
            icon: 'ph-chart-line-up',
            enabled: true,
            defaultData: {
                series: [
                    { name: 'Sales', data: [30, 40, 35, 50, 49, 60] },
                    { name: 'Expenses', data: [20, 25, 30, 35, 40, 45] }
                ],
                xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] },
                colors: ['#2E93fA', '#66DA26']
            },
            defaultOptions: {
                chart: { type: 'line', height: 500, toolbar: { show: false } },
                stroke: { curve: 'smooth', width: 2 },
                dataLabels: { enabled: false },
                legend: { show: true, position: 'bottom' },
                grid: { show: true },
                backgroundColor: '#f5f5f5',
                textColor: '#373d3f',
                gridColor: '#e2e8f0'
            }
        },
        bar: {
            id: 'bar',
            name: 'Bar',
            icon: 'ph-chart-bar-horizontal',
            enabled: true,
            defaultData: {
                series: [{ name: 'Revenue', data: [30, 40, 45, 50, 49, 60, 70] }],
                xaxis: { categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'] },
                colors: ['#2E93fA']
            },
            defaultOptions: {
                chart: { type: 'bar', height: 500, toolbar: { show: false } },
                plotOptions: { bar: { horizontal: false, columnWidth: '55%' } },
                dataLabels: { enabled: false },
                legend: { position: 'bottom' },
                grid: { show: true },
                backgroundColor: '#f5f5f5',
                textColor: '#373d3f',
                gridColor: '#e2e8f0'
            }
        },
        pie: {
            id: 'pie',
            name: 'Pie',
            icon: 'ph-chart-pie-slice',
            enabled: true,
            defaultData: {
                series: [44, 55, 13, 33],
                labels: ['Apple', 'Mango', 'Orange', 'Watermelon'],
                colors: ['#2E93fA', '#66DA26', '#546E7A', '#E91E63']
            },
            defaultOptions: {
                chart: { type: 'pie', height: 500, toolbar: { show: false } },
                colors: defaultColors,
                legend: { position: 'bottom' },
                dataLabels: { enabled: true },
                backgroundColor: '#f5f5f5',
                textColor: '#373d3f',
                grid: { show: false },
                plotOptions: {
                    pie: {
                        dataLabels: {
                            value: {
                                formatter: function(val) {
                                    return val;
                                }
                            }
                        }
                    }
                }
            }
        },
        donut: {
            id: 'donut',
            name: 'Donut',
            icon: 'ph-chart-donut',
            enabled: true,
            defaultData: {
                series: [44, 55, 13, 33],
                labels: ['Apple', 'Mango', 'Orange', 'Watermelon'],
                colors: ['#2E93fA', '#66DA26', '#546E7A', '#E91E63']
            },
            defaultOptions: {
                chart: { type: 'donut', height: 500, toolbar: { show: false } },
                colors: defaultColors,
                legend: { position: 'bottom' },
                dataLabels: { enabled: true },
                backgroundColor: '#f5f5f5',
                textColor: '#373d3f',
                grid: { show: false },
                plotOptions: {
                    pie: {
                        dataLabels: {
                            value: {
                                formatter: function(val) {
                                    return val;
                                }
                            }
                        },
                        donut: { 
                            size: '65%', 
                            labels: { 
                                show: true, 
                                name: { show: true }, 
                                value: { 
                                    show: true,
                                    formatter: function(val) {
                                        return val;
                                    }
                                },
                                total: {
                                    show: true,
                                    label: 'Total',
                                    formatter: function (w) {
                                        return w.globals.seriesTotals.reduce((a, b) => {
                                            return a + b
                                        }, 0)
                                    }
                                }
                            } 
                        }
                    }
                }
            }
        }
    };

    function getAllTypes() {
        return Object.values(registry);
    }

    function getType(id) {
        return registry[id];
    }

    function getEnabledTypes() {
        return Object.values(registry).filter(t => t.enabled);
    }

    return { registry, getAllTypes, getType, getEnabledTypes };
})();

window.ChartTypes = ChartTypes;