const fs = require('node:fs');
const path = require('node:path');

// Supply unchanged, downloaded vendor builds when the test machine blocks external CDNs.
// Application files still load the exact deployed URLs; only the browser test transport changes.
async function installVendorFallback(context) {
    const directory = process.env.TEST_VENDOR_DIR;
    if (!directory) return;
    const supabase = path.join(directory, 'supabase-2.116.0.js');
    const chart = path.join(directory, 'chart-4.5.1.js');
    for (const file of [supabase, chart]) {
        if (!fs.existsSync(file)) throw new Error(`Missing real vendor build: ${file}`);
    }
    await context.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@(?:2|2\.116\.0)(?:\/.*)?$/, route => route.fulfill({ contentType: 'application/javascript', path: supabase }));
    await context.route('https://cdn.jsdelivr.net/npm/chart.js@4.5.1/**', route => route.fulfill({ contentType: 'application/javascript', path: chart }));
    await context.route(/^https:\/\/(?:cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.fulfill({ contentType: 'text/css', body: '' }));
}

function logScriptFailures(page) {
    page.on('requestfailed', request => {
        if (request.resourceType() === 'script') console.error('Script request failed:', request.url(), request.failure()?.errorText);
    });
}

module.exports = { installVendorFallback, logScriptFailures };
