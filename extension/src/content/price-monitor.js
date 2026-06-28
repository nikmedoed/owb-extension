(() => {
    'use strict';

    // Legacy entrypoint kept only for history. Active scripts are split by platform:
    // - src/content/price-monitor/common.js
    // - src/content/price-monitor/ozon.js
    // - src/content/price-monitor/wb.js
    console.warn('[OWB] Legacy price-monitor entrypoint is deprecated. Use split platform scripts.');
})();
