const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const revision = process.env.PERF_REV;
function source(file) { return revision ? execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8'); }
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        for (const mobile of [true, false]) {
            const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile });
            page.on('pageerror', error => console.error('pageerror:', error.message));
            await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#01050d}.galaxy-scene{position:fixed;inset:0}canvas{position:absolute;width:100%;height:100%}</style><div class="galaxy-scene"><canvas id="adminGalaxyCanvas"></canvas></div>');
            const session = await page.context().newCDPSession(page);
            await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
            await page.evaluate(() => {
                window.metrics = { paints: 0, textures: 0, longTasks: [], initialized: 0 };
                new PerformanceObserver(list => metrics.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true });
                const clear = CanvasRenderingContext2D.prototype.clearRect;
                CanvasRenderingContext2D.prototype.clearRect = function (...args) { if (this.canvas.id === 'adminGalaxyCanvas') metrics.paints++; return clear.apply(this, args); };
                const put = CanvasRenderingContext2D.prototype.putImageData;
                CanvasRenderingContext2D.prototype.putImageData = function (...args) { metrics.textures++; return put.apply(this, args); };
            });
            const sources = ['assets/galaxy-streaks.js', 'assets/galaxy-background.js', 'assets/galaxy-clouds.js'].map(source);
            await page.evaluate(sources => { const begin = performance.now(); sources.forEach(code => (0, eval)(code)); metrics.initialized = performance.now() - begin; }, sources);
            if (!revision) {
                try { await page.waitForFunction(() => document.querySelector('canvas').dataset.galaxyTextureReady === 'true' && document.querySelector('[data-galaxy-clouds]')?.dataset.textureReady === 'true'); }
                catch (error) { console.error(await page.evaluate(() => ({hidden:document.hidden,canvases:[...document.querySelectorAll('canvas')].map(c => ({id:c.id,data:{...c.dataset}})),metrics}))); throw error; }
            }
            await page.waitForTimeout(1000);
            const start = await page.evaluate(() => { const snapshot = { ...metrics, longTasks: [...metrics.longTasks] }; metrics.longTasks = []; return snapshot; });
            await page.waitForTimeout(1000);
            const steady = await page.evaluate(() => ({ ...metrics, longTasks: [...metrics.longTasks] }));
            await page.evaluate(() => { metrics.longTasks = []; for (let i = 0; i < 8; i++) dispatchEvent(new Event('resize')); });
            await page.waitForTimeout(500);
            const resized = await page.evaluate(() => ({ ...metrics, longTasks: [...metrics.longTasks] }));
            console.log(JSON.stringify({ revision: revision || 'working', mobile, synchronousInitMs: Math.round(start.initialized), startupMaxTaskMs: Math.round(Math.max(0, ...start.longTasks)), paintsPerSecond: steady.paints - start.paints, resizeTextureWrites: resized.textures - steady.textures, resizeMaxTaskMs: Math.round(Math.max(0, ...resized.longTasks)) }));
            if (!revision) {
                assert.equal(resized.textures, steady.textures, 'A resize burst must reuse procedural textures');
                assert(steady.paints - start.paints <= (mobile ? 34 : 49), 'Background has a bounded paint rate');
                await page.evaluate(() => document.getElementById('adminGalaxyCanvas').galaxyBackgroundController.setPaused(true));
                const paused = await page.evaluate(() => metrics.paints);
                await page.waitForTimeout(180);
                assert.equal(await page.evaluate(() => metrics.paints), paused);
                await page.evaluate(() => document.getElementById('adminGalaxyCanvas').galaxyBackgroundController.setPaused(false));
                await page.waitForTimeout(180);
                assert(await page.evaluate(() => metrics.paints) > paused);
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await page.waitForTimeout(150);
                const reduced = await page.evaluate(() => metrics.paints);
                await page.waitForTimeout(150);
                assert.equal(await page.evaluate(() => metrics.paints), reduced);
                await page.emulateMedia({ reducedMotion: 'no-preference' });
                await page.screenshot({ path: path.join(root, `../../galaxy-optimized-${mobile ? 'mobile' : 'desktop'}.png`) });
            }
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
