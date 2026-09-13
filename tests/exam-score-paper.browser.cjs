const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, channel: process.env.TEST_BROWSER_CHANNEL || 'msedge' });
    try {
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        await page.route('**/*', route => route.abort());
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<style>body{margin:16px;background:#081420;color:white}section{max-width:580px;margin:20px auto}article{margin:12px 0}</style><section id="publicScores" class="exam-scores"></section><section id="scoresWorkspace"></section>');
        // Include both existing stylesheets: their old animation and admin ID selectors must not override the shared illustration.
        for (const file of ['exam-scores.css', 'exam-scores-admin-cards.css', 'exam-score-paper.css']) {
            await page.addStyleTag({ path: path.resolve(__dirname, '../assets', file) });
        }
        await page.addScriptTag({ path: path.resolve(__dirname, '../assets/exam-score-paper.js') });
        const values = [0, 4.5, '7,25', 9.99, 10, null, '', 'invalid'];
        const expected = ['0', '4,5', '7,25', '9,99', '10', '–', '–', '–'];
        await page.evaluate(values => {
            document.getElementById('publicScores').innerHTML = values.map(score => `<article class="exam-student-card"><div class="exam-student-info">Điểm học sinh</div><figure class="exam-student-media">${ExamScorePaper.render(score)}</figure></article>`).join('');
            document.getElementById('scoresWorkspace').innerHTML = values.map(score => `<article class="exam-admin-student-card"><div class="exam-admin-student-info">Điểm học sinh</div><div class="exam-admin-student-media"><div class="exam-admin-paper">${ExamScorePaper.render(score)}</div></div></article>`).join('');
        }, values);

        // Decode the illuminated geometry itself, rather than trusting the SVG's data-score label.
        const displays = await page.locator('.exam-score-paper').evaluateAll(svgs => svgs.map(svg => {
            const numerals = { abcdef: '0', bc: '1', abdeg: '2', abcdg: '3', bcfg: '4', acdfg: '5', acdefg: '6', abc: '7', abcdefg: '8', abcdfg: '9', g: '–' };
            const decoded = [...svg.querySelector('.esp-led-digits').children].map(glyph => {
                if (glyph.classList.contains('esp-decimal')) return ',';
                const active = [...glyph.querySelectorAll('.esp-segment-on')].map(segment => {
                    const box = segment.getBBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
                    if (box.width > box.height) return y < 10 ? 'a' : y > 35 ? 'd' : 'g';
                    return x < 10 ? (y < 23 ? 'f' : 'e') : (y < 23 ? 'b' : 'c');
                }).sort().join('');
                return numerals[active] || '?';
            }).join('');
            const curves = [...svg.querySelectorAll('.esp-curve')].map(curve => {
                const length = curve.getTotalLength();
                return Array.from({ length: 81 }, (_, index) => {
                    const point = curve.getPointAtLength(length * index / 80);
                    return { x: point.x, y: point.y };
                });
            });
            return { decoded, label: svg.dataset.scoreDisplay, hidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable'), externalNodes: svg.querySelectorAll('image,foreignObject,script,[id]').length, scenes: [...svg.querySelectorAll('[data-scene]')].map(scene => scene.dataset.scene), curves };
        }));
        assert.deepEqual(displays.map(item => item.decoded), [...expected, ...expected]);
        displays.forEach(item => {
            assert.equal(item.label, item.decoded);
            assert.equal(item.hidden, 'true');
            assert.equal(item.focusable, 'false');
            assert.equal(item.externalNodes, 0);
            assert.deepEqual(item.scenes, ['parabola', 'cubic', 'integral', 'quartic']);
            item.curves.forEach((curve, graphIndex) => {
                assert(curve.every((point, index, points) => index === 0 || point.x > points[index - 1].x), 'Every polynomial must draw from left to right');
                assert(curve.every(point => point.x >= 51 && point.x <= 169 && point.y >= 115 && point.y <= 195), 'The graph must fit inside the paper');
                const directions = curve.slice(1).map((point, index) => Math.sign(point.y - curve[index].y)).filter(Boolean);
                const turns = directions.filter((direction, index) => index > 0 && direction !== directions[index - 1]).length;
                assert.equal(turns, graphIndex + 1, 'The parabola, cubic and quartic must have one, two and three visible turning points');
            });
        });

        async function at(time) {
            return page.evaluate(time => {
                document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; });
                return [...document.querySelectorAll('.exam-score-paper')].map(svg => ({
                    led: Number(getComputedStyle(svg.querySelector('.esp-led')).opacity),
                    graph: Number(getComputedStyle(svg.querySelector('.esp-graph')).opacity),
                    scenes: [...svg.querySelectorAll('[data-scene]')].map(scene => ({
                        name: scene.dataset.scene,
                        opacity: Number(getComputedStyle(scene).opacity),
                        strokes: [...scene.querySelectorAll('path')].map(path => parseFloat(getComputedStyle(path).strokeDashoffset))
                    }))
                }));
            }, time);
        }
        for (const [time, name] of [[5000, 'parabola'], [9800, 'cubic'], [14400, 'integral'], [19000, 'quartic']]) {
            const states = await at(time);
            states.forEach(state => {
                assert.equal(state.led, 0, `LED must stay hidden until all drawings complete (t=${time})`);
                const visible = state.scenes.filter(scene => scene.opacity > 0);
                assert.equal(visible.length, 1);
                assert.equal(visible[0].name, name);
                assert.equal(visible[0].opacity, 1, 'Hold the completed drawing before replacing it');
                assert(visible[0].strokes.every(offset => offset === 0));
            });
        }
        for (const [time, name, strokeIndex] of [[3000, 'parabola', 1], [8000, 'cubic', 1], [11500, 'integral', 0], [13200, 'integral', 1], [17500, 'quartic', 1]]) {
            (await at(time)).forEach(state => {
                const scene = state.scenes.find(scene => scene.name === name);
                assert.equal(scene.opacity, 1);
                assert(scene.strokes[strokeIndex] > 0 && scene.strokes[strokeIndex] < 1, 'The active drawing must progressively reveal its path');
            });
        }
        for (let time = 0; time < 24000; time += 240) {
            (await at(time)).forEach(state => assert(state.scenes.filter(scene => scene.opacity > 0).length + (state.led > 0 ? 1 : 0) <= 1, `Drawings and LED must never overlap (t=${time})`));
        }
        for (const time of [21600, 23000]) {
            (await at(time)).forEach(state => { assert.equal(state.led, 1); assert(state.scenes.every(scene => scene.opacity === 0)); });
        }
        (await at(24000)).forEach(state => { assert.equal(state.led, 0, 'The next cycle must start without the previous LED score'); assert(state.scenes.every(scene => scene.opacity === 0)); });
        assert.deepEqual(await page.evaluate(() => [...new Set(document.getAnimations().map(animation => animation.effect.getTiming().duration))]), [24000]);

        await at(21600);
        for (const width of [1200, 390]) {
            await page.setViewportSize({ width, height: 900 });
            const bounds = await page.locator('.exam-score-paper').evaluateAll(svgs => svgs.map(svg => {
                const digits = svg.querySelector('.esp-led-digits').getBoundingClientRect();
                const screen = svg.querySelector('.esp-led > rect').getBoundingClientRect();
                return { fits: digits.left >= screen.left && digits.right <= screen.right && digits.top >= screen.top && digits.bottom <= screen.bottom, width: digits.width };
            }));
            bounds.forEach(box => assert(box.fits && box.width > 0, `All score digits must fit the paper at viewport ${width}`));
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
        (await at(0)).forEach(state => { assert.equal(state.led, 1); assert.equal(state.graph, 0); });
        assert.deepEqual(errors, []);
        console.log('PASS: score LED geometry, public/admin CSS, sequential drawing, mobile fit and reduced motion');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
