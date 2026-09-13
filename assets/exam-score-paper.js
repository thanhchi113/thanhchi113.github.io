(function (global) {
    "use strict";

    // Seven-segment digits are SVG paths, so the score does not depend on a font.
    const segments = [
        "M4 0H19L22 3L19 6H4L1 3Z",
        "M20 5L23 8V19L20 22L17 19V8Z",
        "M20 24L23 27V38L20 41L17 38V27Z",
        "M4 40H19L22 43L19 46H4L1 43Z",
        "M3 24L6 27V38L3 41L0 38V27Z",
        "M3 5L6 8V19L3 22L0 19V8Z",
        "M4 20H19L22 23L19 26H4L1 23Z"
    ];
    const litSegments = ["012345", "12", "01346", "01236", "1256", "02356", "023456", "012", "0123456", "012356"];

    function scoreText(value) {
        if (typeof value !== "number" && typeof value !== "string") return "–";
        const raw = String(value).trim();
        if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return "–";
        const number = Number(raw.replace(",", "."));
        if (!Number.isFinite(number) || number < 0 || number > 10) return "–";
        return String(Number(number.toFixed(2))).replace(".", ",");
    }

    function digit(value, x) {
        const active = value === "–" ? "6" : litSegments[Number(value)];
        return `<g class="esp-digit" transform="translate(${x} 0)">${segments.map((path, index) => `<path class="esp-segment ${active.includes(String(index)) ? "esp-segment-on" : "esp-segment-off"}" d="${path}"/>`).join("")}</g>`;
    }

    function axes(originY) {
        // The O, x and y labels are strokes too, and follow the axes as they draw.
        return `<path class="esp-axes" d="M71 ${originY}H150M109 194V116M146 ${originY - 4}L150 ${originY}L146 ${originY + 4}M105 120L109 116L113 120M105 ${originY + 7}a2 2.5 0 1 0-4 0a2 2.5 0 1 0 4 0M154 ${originY - 3}l4 6m0-6l-4 6M115 112l2 3 2-3m-2 3v4" fill="none" stroke="#8ca9c6" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/>`;
    }

    function polynomialPath(evaluate, domain, originY, scaleY) {
        return Array.from({ length: 81 }, (_, index) => {
            const x = -domain + domain * 2 * index / 80;
            return `${index ? "L" : "M"}${(75 + 68 * index / 80).toFixed(2)} ${(originY - evaluate(x) * scaleY).toFixed(2)}`;
        }).join("");
    }

    function graphScene(name, originY, path, color) {
        return `<g class="esp-scene esp-scene-${name}" data-scene="${name}">${axes(originY)}<path class="esp-curve" d="${path}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></g>`;
    }

    function render(score) {
        const display = scoreText(score);
        const glyphs = Array.from(display);
        const width = glyphs.reduce((total, glyph) => total + (glyph === "," ? 8 : 23), 0) + Math.max(0, glyphs.length - 1) * 3;
        let cursor = 0;
        const digits = glyphs.map(glyph => {
            const x = cursor;
            cursor += (glyph === "," ? 8 : 23) + 3;
            if (glyph === ",") return `<path class="esp-segment esp-segment-on esp-decimal" transform="translate(${x} 0)" d="M2 39H7V45L3 50H0L3 44H2Z"/>`;
            return digit(glyph, x);
        }).join("");

        return `<svg class="exam-student-illustration exam-score-paper" viewBox="0 0 220 260" aria-hidden="true" focusable="false" data-score-display="${display}">
            <circle cx="110" cy="127" r="88" fill="rgba(125,211,252,.035)"/>
            <rect class="esp-outline" x="51" y="31" width="118" height="184" rx="9" fill="rgba(15,32,51,.7)" stroke="#7dd3fc" stroke-width="1.6" pathLength="1"/>
            <g class="esp-headings">
                <rect x="67" y="49" width="65" height="7" rx="3" fill="rgba(125,211,252,.35)"/>
                <g fill="none" stroke="rgba(125,211,252,.4)" stroke-width="2" stroke-linecap="round"><path d="M67 73H151"/><path d="M67 86H142"/><path d="M67 99H150"/></g>
                <path d="M77 202H143" fill="none" stroke="rgba(125,211,252,.17)" stroke-width="2" stroke-linecap="round"/>
            </g>
            <g class="esp-graph">
                ${graphScene("parabola", 178, "M75 130Q109 226 143 130", "#6fe0b8")}
                ${graphScene("cubic", 159, polynomialPath(x => x * x * x - 3 * x, 2.2, 159, 8), "#8ad8ff")}
                <g class="esp-scene esp-scene-integral" data-scene="integral" fill="none" stroke="#c4afff" stroke-linecap="round" stroke-linejoin="round">
                    <path class="esp-integral-sign" d="M98 126C89 120 88 134 86 149L83 170C81 186 77 189 72 183" stroke-width="3" pathLength="1"/>
                    <path class="esp-integral-expression" d="M108 147C103 144 102 147 102 152V169M98 155H108M114 146Q108 157 114 169M117 153L123 163M123 153L117 163M127 146Q133 157 127 169M143 146V169M143 158C136 151 132 159 135 165C137 172 143 168 143 163M149 153L156 169M156 153L149 169" stroke-width="1.6" pathLength="1"/>
                </g>
                ${graphScene("quartic", 169, polynomialPath(x => x ** 4 - 3 * x * x + 1, 1.9, 169, 12), "#f5bcdd")}
            </g>
            <g class="esp-led">
                <rect x="61" y="121" width="98" height="73" rx="7" fill="#091d2a" fill-opacity=".92" stroke="#78dacd" stroke-opacity=".24" stroke-width=".8"/>
                <path d="M66 133V129Q66 126 69 126H74M146 189H151Q154 189 154 186V182" fill="none" stroke="#8ff5dd" stroke-opacity=".45" stroke-width="1.2" stroke-linecap="round"/>
                <g class="esp-led-digits" transform="translate(${(220 - width) / 2} 134)">${digits}</g>
            </g>
            <g class="esp-accent" fill="none" stroke-linecap="round"><path d="M177 63V75M171 69H183" stroke="#a78bfa" stroke-width="1.6"/><path d="M40 180V188M36 184H44" stroke="#7dd3fc" stroke-width="1.4"/></g>
        </svg>`;
    }

    global.ExamScorePaper = Object.freeze({ render });
})(window);
