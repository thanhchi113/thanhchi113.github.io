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
            const curve = svg.querySelector('.esp-curve'), length = curve.getTotalLength();
            const curveX = Array.from({ length: 11 }, (_, index) => curve.getPointAtLength(length * index / 10).x);
            return { decoded, label: svg.dataset.scoreDisplay, hidden: svg.getAttribute('aria-hidden'), focusable: svg.getAttribute('focusable'), externalNodes: svg.querySelectorAll('image,foreignObject,script,[id]').length, curveX };
        }));
        assert.deepEqual(displays.map(item => item.decoded), [...expected, ...expected]);
        displays.forEach(item => {
            assert.equal(item.label, item.decoded);
            assert.equal(item.hidden, 'true');
            assert.equal(item.focusable, 'false');
            assert.equal(item.externalNodes, 0);
            assert(item.curveX.every((x, index, xs) => index === 0 || x > xs[index - 1]), 'The curve must draw from left to right');
        });

        async function at(time) {
            return page.evaluate(time => {
                document.getAnimations().forEach(animation => { animation.pause(); animation.currentTime = time; });
                return [...document.querySelectorAll('.exam-score-paper')].map(svg => ({
                    led: Number(getComputedStyle(svg.querySelector('.esp-led')).opacity),
                    graph: Number(getComputedStyle(svg.querySelector('.esp-graph')).opacity),
                    curve: parseFloat(getComputedStyle(svg.querySelector('.esp-curve')).strokeDashoffset)
                }));
            }, time);
        }
        for (const time of [0, 2000, 3000, 4200, 4900, 5100]) {
            const states = await at(time);
            states.forEach(state => {
                assert.equal(state.led, 0, `LED must stay hidden until the curve completes (t=${time})`);
                if (time === 3000) assert(state.graph === 1 && state.curve > 0 && state.curve < 1, 'The curve must visibly draw before the score');
                if (time === 4200) assert(state.graph === 1 && state.curve === 0, 'Show the completed curve before replacing it');
                if (time === 4900) assert.equal(state.graph, 0);
            });
        }
        for (const time of [6000, 10800]) {
            (await at(time)).forEach(state => { assert.equal(state.led, 1); assert.equal(state.graph, 0); });
        }
        (await at(12000)).forEach(state => assert.equal(state.led, 0, 'The next curve must start without the previous LED score'));
        assert.deepEqual(await page.evaluate(() => [...new Set(document.getAnimations().map(animation => animation.effect.getTiming().duration))]), [12000]);

        await at(6000);
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
