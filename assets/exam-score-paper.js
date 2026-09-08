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
                <path class="esp-axes" d="M71 178H150M109 194V116M146 174L150 178L146 182M105 120L109 116L113 120" fill="none" stroke="#8ca9c6" stroke-width="1.2" pathLength="1"/>
                <path class="esp-curve" d="M75 130Q109 224 143 130" fill="none" stroke="#6fe0b8" stroke-width="2.4" stroke-linecap="round" pathLength="1"/>
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
