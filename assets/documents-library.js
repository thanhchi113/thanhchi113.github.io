

        /* =========================================
           MATH LIBRARY V3
        ========================================== */

        const SUPABASE_URL = "https://uiyqdqucqplifcvukwul.supabase.co";
        const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_eVPODZoNRLiGD8Ldl2VjAg_eC_KTKDg";
        const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        window.supabaseClient = supabaseClient;
        window.ScoreSubmissions.init(supabaseClient);
        window.SiteContent.start(supabaseClient);

        // Load heavy third-party libraries only when the user reaches the feature that needs them.
        const externalScriptPromises = new Map();
        function loadExternalScript(src, globalName, timeoutMs = 15000) {
            if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
            if (externalScriptPromises.has(src)) return externalScriptPromises.get(src);

            const promise = new Promise((resolve, reject) => {
                const existing = document.querySelector(`script[data-lazy-src="${src}"]`);
                if (existing) {
                    const done = () => window[globalName] ? resolve(window[globalName]) : reject(new Error(`Không tải được thư viện ${globalName}.`));
                    existing.addEventListener("load", done, { once: true });
                    existing.addEventListener("error", () => reject(new Error(`Không tải được thư viện ${globalName}.`)), { once: true });
                    if (globalName && window[globalName]) resolve(window[globalName]);
                    return;
                }

                const script = document.createElement("script");
                script.src = src;
                script.async = true;
                script.dataset.lazySrc = src;
                let timer = setTimeout(() => {
                    script.remove();
                    reject(new Error(`Hết thời gian tải thư viện ${globalName}.`));
                }, timeoutMs);
                script.onload = () => {
                    clearTimeout(timer);
                    if (globalName && window[globalName]) resolve(window[globalName]);
                    else reject(new Error(`Thư viện ${globalName} không sẵn sàng.`));
                };
                script.onerror = () => {
                    clearTimeout(timer);
                    reject(new Error(`Không tải được thư viện ${globalName}.`));
                };
                document.head.appendChild(script);
            }).catch(error => {
                externalScriptPromises.delete(src);
                document.querySelector(`script[data-lazy-src="${src}"]`)?.remove();
                throw error;
            });
            externalScriptPromises.set(src, promise);
            return promise;
        }

        function ensurePdfJs() {
            return loadExternalScript(
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
                "pdfjsLib"
            ).then(lib => {
                lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                return lib;
            });
        }

        function ensureQrCodeJs() {
            return loadExternalScript(
                "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
                "QRCode"
            );
        }

        let libraryDocuments = [];
        let libraryCategories = [];
        let activeDocumentCategoryId = null;
        let documentSortMode = "newest";
        let documentTypeMode = "all";
        let documentCurrentPage = 1;
        let documentPageSize = 9;
        let currentDocument = null;

        const documentIconMap = {
            "Lớp 10": "fa-calculator",
            "Lớp 11": "fa-chart-line",
            "Lớp 12": "fa-square-root-variable",
            "Ôn thi vào 10": "fa-graduation-cap",
            "Ôn thi THPT": "fa-award",
            "Chuyên đề": "fa-book-open"
        };

        function escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        let categoryIllustrationTimers = [];

        function categoryIllustrationCycle(frames) {
            return `<div class="category-illustration-cycle" data-cycle-duration="8000">${frames.map((frame, index) => `<div class="ci-cycle-frame${index === 0 ? " is-active" : ""}">${frame}</div>`).join("")}</div>`;
        }

        function clearCategoryIllustrationTimers() {
            categoryIllustrationTimers.forEach(dispose => dispose());
            categoryIllustrationTimers = [];
        }

        function startCategoryIllustrationCycles(root) {
            clearCategoryIllustrationTimers();
            const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
            root.querySelectorAll(".category-illustration-cycle").forEach(cycle => {
                const duration = Number(cycle.dataset.cycleDuration) || 8000;
                cycle.style.setProperty("--ci-scene-duration", `${duration}ms`);

                const activateScene = index => {
                    const frames = [...cycle.querySelectorAll(".ci-cycle-frame")];
                    const nextFrame = frames[index];
                    if (!nextFrame) return;
                    const activeFrame = frames.find(frame => frame.classList.contains("is-active"));

                    frames.forEach(frame => {
                        if (frame !== activeFrame && frame !== nextFrame) frame.classList.remove("is-complete");
                    });
                    if (activeFrame && activeFrame !== nextFrame) {
                        activeFrame.classList.remove("is-active");
                        activeFrame.classList.add("is-complete");
                    }

                    nextFrame.classList.remove("is-complete");
                    nextFrame.classList.add("is-resetting");
                    void nextFrame.offsetWidth;
                    nextFrame.classList.remove("is-resetting");
                    nextFrame.classList.add("is-active");
                };

                const onSceneComplete = event => {
                    if (reducedMotion.matches) return;
                    if (event.animationName !== "ciSceneClock" || event.target.parentElement !== cycle || !event.target.classList.contains("is-active")) return;
                    const frames = [...cycle.querySelectorAll(".ci-cycle-frame")];
                    const activeIndex = frames.indexOf(event.target);
                    if (activeIndex !== -1) activateScene((activeIndex + 1) % frames.length);
                };

                cycle.addEventListener("animationend", onSceneComplete);
                const onMotionChange = () => activateScene(0);
                reducedMotion.addEventListener("change", onMotionChange);
                categoryIllustrationTimers.push(() => {
                    cycle.removeEventListener("animationend", onSceneComplete);
                    reducedMotion.removeEventListener("change", onMotionChange);
                });
                activateScene(0);
            });
        }

        function getCategoryIllustration(name) {
            const key = String(name || "").trim();
            const common = 'viewBox="0 0 240 160" role="img" aria-hidden="true" focusable="false"';

            if (key === "Lớp 10") return categoryIllustrationCycle([
                `<svg class="category-illustration category-illustration-parabola" ${common}>
                    <g class="ci-axis"><path class="ci-axis-x" d="M28 110H214"/><path class="ci-axis-y" d="M105 145V18"/><path class="ci-axis" d="M208 106L214 110L208 114 M101 24L105 18L109 24"/></g>
                    <path class="ci-parabola" pathLength="520" d="M55.5 74.6 C72 98 86 110 105 110 C124 110 138 98 154.5 74.6"/>
                    <text class="ci-label" x="209" y="101">x</text><text class="ci-label" x="111" y="18">y</text><text class="ci-label" x="92" y="127">O</text>
                </svg>`,
                `<svg class="category-illustration category-illustration-parabola" ${common}>
                    <g class="ci-axis"><path class="ci-axis-x" d="M28 110H214"/><path class="ci-axis-y" d="M105 145V18"/><path class="ci-axis" d="M208 106L214 110L208 114 M101 24L105 18L109 24"/></g>
                    <path class="ci-parabola" pathLength="520" d="M84 154 Q147 -4 210 154"/>
                    <text class="ci-label" x="209" y="101">x</text><text class="ci-label" x="111" y="18">y</text><text class="ci-label" x="92" y="127">O</text>
                </svg>`
            ]);

            if (key === "Lớp 11") return categoryIllustrationCycle([
                `<svg class="category-illustration category-illustration-sine" ${common}>
                    <g class="ci-axis"><path class="ci-axis-x" d="M18 84H226"/><path class="ci-axis-y" d="M120 137V24"/><path d="M220 80L226 84L220 88 M116 30L120 24L124 30"/></g>
                    <path class="ci-sine-curve" pathLength="640" d="${Array.from({ length: 161 }, (_, index) => {
                        const x = -2 * Math.PI + index * Math.PI / 40;
                        return `${index ? "L" : "M"}${(120 + x * 48 / Math.PI).toFixed(2)} ${(84 - 34 * Math.sin(x)).toFixed(2)}`;
                    }).join(" ")}"/>
                    <g class="ci-axis"><path d="M24 81V87 M72 81V87 M168 81V87 M216 81V87 M117 50H123 M117 118H123"/></g>
                    <text class="ci-label" x="225" y="76">x</text><text class="ci-label" x="126" y="28">y</text><text class="ci-label" x="109" y="98">O</text>
                    <text class="ci-label" x="24" y="100" text-anchor="middle">−2π</text><text class="ci-label" x="72" y="100" text-anchor="middle">−π</text><text class="ci-label" x="168" y="100" text-anchor="middle">π</text><text class="ci-label" x="216" y="100" text-anchor="middle">2π</text>
                    <text class="ci-label" x="109" y="53">1</text><text class="ci-label" x="104" y="121">−1</text><text class="ci-label ci-formula" x="164" y="29">y = sin x</text>
                </svg>`,
                `<svg class="category-illustration category-illustration-pyramid" ${common}>
                    <g class="ci-pyramid">
                        <path class="ci-hidden" d="M59 80L183 104"/>
                        <path class="ci-visible" pathLength="180" d="M80 124L59 80 M80 124L183 104 M122 22L59 80 M122 22L80 124 M122 22L183 104"/>
                    </g>
                    <g class="ci-vertices"><circle class="ci-vertex" cx="122" cy="22" r="2.4"/><circle class="ci-vertex" cx="59" cy="80" r="2.4"/><circle class="ci-vertex" cx="80" cy="124" r="2.4"/><circle class="ci-vertex" cx="183" cy="104" r="2.4"/></g>
                </svg>`,
                `<svg class="category-illustration category-illustration-box" ${common}>
                    <g class="ci-box">
                        <path class="ci-visible" d="M62 58H142"/><path class="ci-visible" d="M142 58V119"/><path class="ci-visible" d="M142 119H62"/><path class="ci-visible" d="M62 119V58"/>
                        <path class="ci-visible" d="M62 58L99 35"/><path class="ci-visible" d="M142 58L179 35"/><path class="ci-visible" d="M142 119L179 96"/>
                        <path class="ci-visible" d="M99 35H179"/><path class="ci-visible" d="M179 35V96"/>
                        <path class="ci-hidden" d="M62 119L99 96"/><path class="ci-hidden" d="M99 96H179"/><path class="ci-hidden" d="M99 35V96"/>
                    </g>
                    <g class="ci-vertices"><circle cx="62" cy="58" r="2.3"/><circle cx="142" cy="58" r="2.3"/><circle cx="142" cy="119" r="2.3"/><circle cx="62" cy="119" r="2.3"/><circle cx="99" cy="35" r="2.3"/><circle cx="179" cy="35" r="2.3"/><circle cx="179" cy="96" r="2.3"/><circle cx="99" cy="96" r="2.3"/></g>
                </svg>`
            ]);

            if (key === "Lớp 12") return categoryIllustrationCycle([
                `<svg class="category-illustration category-illustration-area" ${common}>
                    <defs><clipPath id="ciParabolaReveal"><rect class="ci-area-reveal" x="79" y="24" width="0" height="120"/></clipPath></defs>
                    <g class="ci-axis"><path class="ci-axis-x" d="M28 92H214"/><path class="ci-axis-y" d="M105 142V20"/><path class="ci-axis" d="M208 88L214 92L208 96 M101 26L105 20L109 26"/></g>
                    <path class="ci-curve-primary" pathLength="600" d="M62 136 C80 84 96 57 119 57 C142 57 158 84 176 136"/>
                    <path class="ci-curve-secondary" pathLength="600" d="M64 57 C83 108 99 129 120 129 C141 129 157 108 175 57"/>
                    <path class="ci-area" clip-path="url(#ciParabolaReveal)" d="M82 91 C92 71 104 59 119 57 C135 59 147 71 157 91 C147 115 135 128 120 129 C104 128 92 115 82 91Z"/>
                    <circle class="ci-intersection" cx="82" cy="91" r="3"/><circle class="ci-intersection" cx="157" cy="91" r="3"/>
                    <text class="ci-label" x="211" y="83">x</text><text class="ci-label" x="112" y="17">y</text><text class="ci-label" x="88" y="108">O</text>
                </svg>`,
                `<svg class="category-illustration category-illustration-cubic-area" ${common}>
                    <defs><clipPath id="ciCubicReveal"><rect class="ci-area-reveal" x="94" y="28" width="0" height="118"/></clipPath></defs>
                    <g class="ci-axis"><path class="ci-axis-x" d="M28 92H214"/><path class="ci-axis-y" d="M105 142V20"/><path class="ci-axis" d="M208 88L214 92L208 96 M101 26L105 20L109 26"/></g>
                    <path class="ci-curve-primary" pathLength="700" d="M37 89 C48 61 59 55 65 56 C80 56 91 75 105 92 C121 112 131 130 145 128 C161 126 171 98 185 56"/>
                    <path class="ci-curve-secondary" pathLength="700" d="M73 118 C87 95 92 77 105 74 C119 71 130 88 137 103 C147 124 161 146 185 146"/>
                    <path class="ci-area" clip-path="url(#ciCubicReveal)" d="M94.5 78 C110 92 130 133 145 128 C151 127 154 125 155.5 124 C146 119 134 102 125 85 C115 72 104 73 94.5 78Z"/>
                    <circle class="ci-intersection" cx="94.5" cy="78" r="3"/><circle class="ci-intersection" cx="155.5" cy="124" r="3"/>
                    <text class="ci-label" x="211" y="83">x</text><text class="ci-label" x="112" y="17">y</text><text class="ci-label" x="88" y="108">O</text>
                </svg>`
            ]);

            if (key === "Ôn thi THPT") return categoryIllustrationCycle([
                `<svg class="category-illustration category-illustration-xyz" ${common}>
                    <g class="ci-axis"><path class="ci-axis-x" d="M72 108H202"/><path class="ci-axis-y" d="M72 108L34 130"/><path class="ci-axis-z" d="M72 108V22"/></g>
                    <polygon class="ci-arrow" points="202,103 214,108 202,113"/><polygon class="ci-arrow" points="36,124 25,135 40,133"/><polygon class="ci-arrow" points="67,24 72,12 77,24"/><circle class="ci-origin" cx="72" cy="108" r="3"/>
                    <text class="ci-label" x="59" y="122">O</text><text class="ci-label" x="204" y="101">x</text><text class="ci-label" x="20" y="139">y</text><text class="ci-label" x="79" y="16">z</text>
                </svg>`,
                `<svg class="category-illustration category-illustration-cubic-oxy" ${common}>
                    <g class="ci-axis"><path class="ci-axis-x" d="M28 102H214"/><path class="ci-axis-y" d="M105 142V19"/><path class="ci-axis" d="M208 98L214 102L208 106 M101 25L105 19L109 25"/></g>
                    <path class="ci-cubic-curve" pathLength="640" d="M45 126 C64 131 76 113 86 91 C95 70 109 58 123 69 C140 82 148 117 162 125 C177 134 188 110 200 62"/>
                    <text class="ci-label" x="211" y="93">x</text><text class="ci-label" x="112" y="17">y</text><text class="ci-label" x="88" y="118">O</text>
                </svg>`,
                `<svg class="category-illustration category-illustration-variation" ${common}>
                    <text class="ci-table-label ci-table-formula" x="124" y="20" text-anchor="middle">y = x³ − 3x</text>
                    <path class="ci-table-grid" pathLength="1" d="M14 32H228V146H14Z"/>
                    <path class="ci-table-grid" pathLength="1" d="M42 32V146"/>
                    <path class="ci-table-grid" pathLength="1" d="M14 58H228"/>
                    <path class="ci-table-grid" pathLength="1" d="M14 85H228"/>
                    <g class="ci-table-label" text-anchor="middle">
                        <text x="28" y="50">x</text><text x="60" y="50">−∞</text><text x="112" y="50">−1</text><text x="162" y="50">1</text><text x="214" y="50">+∞</text>
                        <text x="28" y="77">y′</text><text x="85" y="77">+</text><text x="112" y="77">0</text><text x="137" y="77">−</text><text x="162" y="77">0</text><text x="188" y="77">+</text>
                        <text x="28" y="120">y</text><text x="60" y="138">−∞</text><text x="112" y="103">2</text><text x="162" y="138">−2</text><text x="214" y="103">+∞</text>
                    </g>
                    <g class="ci-variation-step">
                        <path class="ci-variation-arrow" pathLength="1" d="M69 124L102 109"/><polygon class="ci-variation-head" points="102,109 96,109 99,115"/>
                    </g>
                    <g class="ci-variation-step ci-variation-step-2">
                        <path class="ci-variation-arrow" pathLength="1" d="M122 109L153 124"/><polygon class="ci-variation-head" points="153,124 150,118 147,124"/>
                    </g>
                    <g class="ci-variation-step ci-variation-step-3">
                        <path class="ci-variation-arrow" pathLength="1" d="M173 124L205 109"/><polygon class="ci-variation-head" points="205,109 199,109 202,115"/>
                    </g>
                </svg>`
            ]);

            if (key === "Lớp 10") return `<svg class="category-illustration category-illustration-parabola" ${common}>
                <g class="ci-axis">
                    <path class="ci-axis-x" d="M28 110H214"/>
                    <path class="ci-axis-y" d="M105 145V18"/>
                    <path class="ci-axis" d="M208 106L214 110L208 114 M101 24L105 18L109 24"/>
                </g>
                <path class="ci-parabola" pathLength="520" d="M 55.5 74.6 L 57.9 77.9 L 60.2 81.0 L 62.6 84.0 L 64.9 86.8 L 67.3 89.5 L 69.6 91.9 L 72.0 94.3 L 74.4 96.4 L 76.7 98.4 L 79.1 100.3 L 81.4 102.0 L 83.8 103.5 L 86.1 104.9 L 88.5 106.1 L 90.9 107.1 L 93.2 108.0 L 95.6 108.7 L 97.9 109.3 L 100.3 109.7 L 102.6 109.9 L 105.0 110.0 L 107.4 109.9 L 109.7 109.7 L 112.1 109.3 L 114.4 108.7 L 116.8 108.0 L 119.1 107.1 L 121.5 106.1 L 123.9 104.9 L 126.2 103.5 L 128.6 102.0 L 130.9 100.3 L 133.3 98.4 L 135.6 96.4 L 138.0 94.3 L 140.4 91.9 L 142.7 89.5 L 145.1 86.8 L 147.4 84.0 L 149.8 81.0 L 152.1 77.9 L 154.5 74.6"/>
                <text class="ci-label" x="209" y="101">x</text>
                <text class="ci-label" x="111" y="18">y</text>
                <text class="ci-label" x="92" y="127">O</text>
            </svg>`;

            if (key === "Lớp 11") return `<svg class="category-illustration category-illustration-box" ${common}>
                <g class="ci-box">
                    <!-- Front face -->
                    <path class="ci-visible" d="M52 62H128"/>
                    <path class="ci-visible" d="M128 62V116"/>
                    <path class="ci-visible" d="M128 116H52"/>
                    <path class="ci-visible" d="M52 116V62"/>
                    <!-- Connecting edges -->
                    <path class="ci-visible" d="M52 62L86 42"/>
                    <path class="ci-visible" d="M128 62L162 42"/>
                    <path class="ci-visible" d="M128 116L162 96"/>
                    <path class="ci-hidden" d="M52 116L86 96"/>
                    <!-- Back face: top and right visible; left and bottom hidden -->
                    <path class="ci-visible" d="M86 42H162"/>
                    <path class="ci-visible" d="M162 42V96"/>
                    <path class="ci-hidden" d="M162 96H86"/>
                    <path class="ci-hidden" d="M86 96V42"/>
                </g>
                <g class="ci-vertices">
                    <circle cx="52" cy="62" r="2.3"/><circle cx="128" cy="62" r="2.3"/><circle cx="128" cy="116" r="2.3"/><circle cx="52" cy="116" r="2.3"/>
                    <circle cx="86" cy="42" r="2.3"/><circle cx="162" cy="42" r="2.3"/><circle cx="162" cy="96" r="2.3"/><circle cx="86" cy="96" r="2.3"/>
                </g>
            </svg>`;

            if (key === "Lớp 12") return `<svg class="category-illustration category-illustration-area" ${common}>
                <defs>
                    <clipPath id="ciAreaPlotClip" clipPathUnits="userSpaceOnUse">
                        <rect x="28" y="20" width="184" height="120" rx="0"/>
                    </clipPath>
                    <clipPath id="ciAreaReveal" clipPathUnits="userSpaceOnUse">
                        <rect class="ci-area-reveal" x="79" y="20" width="0" height="120"/>
                    </clipPath>
                </defs>
                <g class="ci-axis">
                    <path class="ci-axis-x" d="M28 92H214"/>
                    <path class="ci-axis-y" d="M105 140V20"/>
                    <path class="ci-axis" d="M208 88L214 92L208 96 M101 26L105 20L109 26"/>
                </g>
                <g clip-path="url(#ciAreaPlotClip)">
                    <path class="ci-curve-primary" pathLength="600" d="M 73.28 39.29 L 75.93 47.26 L 78.59 54.85 L 81.24 62.07 L 83.89 68.92 L 86.55 75.38 L 89.20 81.48 L 91.85 87.20 L 94.51 92.54 L 97.16 97.51 L 99.82 102.11 L 102.47 106.32 L 105.12 110.17 L 107.78 113.64 L 110.43 116.73 L 113.08 119.45 L 115.74 121.80 L 118.39 123.77 L 121.04 125.36 L 123.70 126.58 L 126.35 127.42 L 129.00 127.89 L 131.66 127.99 L 134.31 127.71 L 136.96 127.05 L 139.62 126.02 L 142.27 124.62 L 144.93 122.84 L 147.58 120.68 L 150.23 118.15 L 152.89 115.25 L 155.54 111.97 L 158.19 108.31 L 160.85 104.28 L 163.50 99.88"/>
                    <path class="ci-curve-secondary" pathLength="600" d="M 73.28 64.79 L 75.93 60.50 L 78.59 56.58 L 81.24 53.03 L 83.89 49.86 L 86.55 47.07 L 89.20 44.65 L 91.85 42.60 L 94.51 40.93 L 97.16 39.64 L 99.82 38.72 L 102.47 38.17 L 105.12 38.00 L 107.78 38.21 L 110.43 38.78 L 113.08 39.74 L 115.74 41.07 L 118.39 42.77 L 121.04 44.85 L 123.70 47.31 L 126.35 50.14 L 129.00 53.34 L 131.66 56.92 L 134.31 60.88 L 136.96 65.21 L 139.62 69.91 L 142.27 74.99 L 144.93 80.44 L 147.58 86.27 L 150.23 92.48 L 152.89 99.06 L 155.54 106.01 L 158.19 113.34 L 160.85 121.05 L 163.50 129.12"/>
                    <path class="ci-area" clip-path="url(#ciAreaReveal)" d="M 79.00 56.00 L 81.60 52.58 L 84.20 49.52 L 86.80 46.82 L 89.40 44.48 L 92.00 42.50 L 94.60 40.88 L 97.20 39.62 L 99.80 38.72 L 102.40 38.18 L 105.00 38.00 L 107.60 38.18 L 110.20 38.72 L 112.80 39.62 L 115.40 40.88 L 118.00 42.50 L 120.60 44.48 L 123.20 46.82 L 125.80 49.52 L 128.40 52.58 L 131.00 56.00 L 133.60 59.78 L 136.20 63.92 L 138.80 68.42 L 141.40 73.28 L 144.00 78.50 L 146.60 84.08 L 149.20 90.02 L 151.80 96.32 L 154.40 102.98 L 157.00 110.00 L 157.00 110.00 L 154.40 113.42 L 151.80 116.48 L 149.20 119.18 L 146.60 121.52 L 144.00 123.50 L 141.40 125.12 L 138.80 126.38 L 136.20 127.28 L 133.60 127.82 L 131.00 128.00 L 128.40 127.82 L 125.80 127.28 L 123.20 126.38 L 120.60 125.12 L 118.00 123.50 L 115.40 121.52 L 112.80 119.18 L 110.20 116.48 L 107.60 113.42 L 105.00 110.00 L 102.40 106.22 L 99.80 102.08 L 97.20 97.58 L 94.60 92.72 L 92.00 87.50 L 89.40 81.92 L 86.80 75.98 L 84.20 69.68 L 81.60 63.02 L 79.00 56.00 Z"/>
                </g>
                <text class="ci-label" x="211" y="83">x</text>
                <text class="ci-label" x="112" y="17">y</text>
                <text class="ci-label" x="88" y="108">O</text>
            </svg>`;

            if (key === "Ôn thi vào 10") return categoryIllustrationCycle([`<svg class="category-illustration category-illustration-paper" ${common}>
                <rect class="ci-paper" x="60" y="18" width="116" height="124" rx="5"/>
                <rect class="ci-paper-inner" x="71" y="30" width="94" height="8" rx="2"/>
                <path class="ci-paper-line l1" d="M71 52H157"/><path class="ci-paper-line l2" d="M71 67H153"/><path class="ci-paper-line l3" d="M71 82H159"/><path class="ci-paper-line l4" d="M71 97H149"/><path class="ci-paper-line l5" d="M71 112H156"/><path class="ci-paper-line l6" d="M71 127H139"/>
            </svg>`,
            `<svg class="category-illustration category-illustration-sector" ${common}>
                <defs><clipPath id="ciSectorReveal"><rect class="ci-sector-reveal" x="64" y="34" width="0" height="104"/></clipPath></defs>
                <path class="ci-sector-fill" clip-path="url(#ciSectorReveal)" d="M116 86L168 86A52 52 0 0 0 90 40.9667Z"/>
                <path class="ci-circle-outline" pathLength="1" d="M168 86A52 52 0 1 0 64 86A52 52 0 1 0 168 86"/>
                <path class="ci-radius" pathLength="1" d="M116 86L168 86"/><path class="ci-radius" pathLength="1" d="M116 86L90 40.9667"/>
                <circle class="ci-sector-center" cx="116" cy="86" r="3"/>
                <text class="ci-label ci-center-label" x="103" y="102">O</text>
                <g class="ci-radius-label"><text class="ci-label" x="175" y="91">A</text><text class="ci-label" x="81" y="33">B</text><text class="ci-label" x="140" y="102">r</text><text class="ci-label" x="94" y="72">r</text><text class="ci-label" x="132" y="66">120°</text></g>
            </svg>`]);

            if (key === "Ôn thi THPT") return `<svg class="category-illustration category-illustration-xyz" ${common}>
                <g class="ci-axis">
                    <path class="ci-axis-x" d="M72 108H202"/>
                    <path class="ci-axis-y" d="M72 108L34 130"/>
                    <path class="ci-axis-z" d="M72 108V22"/>
                </g>
                <!-- Separate single arrowheads; never overlap another axis. -->
                <polygon class="ci-arrow" points="202,103 214,108 202,113"/>
                <polygon class="ci-arrow" points="36,124 25,135 40,133"/>
                <polygon class="ci-arrow" points="67,24 72,12 77,24"/>
                <circle class="ci-origin" cx="72" cy="108" r="3"/>
                <!-- Labels sit beside the axes, not on them. -->
                <text class="ci-label" x="59" y="122">O</text>
                <text class="ci-label" x="204" y="101">x</text>
                <text class="ci-label" x="20" y="139">y</text>
                <text class="ci-label" x="79" y="16">z</text>
            </svg>`;

            if (key === "Chuyên đề") return categoryIllustrationCycle([`<svg class="category-illustration category-illustration-stat" ${common}>
                <g class="ci-chart-axis">
                    <path d="M28 130H212"/>
                    <path d="M38 138V34"/>
                </g>
                <g class="ci-bars">
                    <rect class="ci-chart-bar b1" x="50" y="103" width="15" height="27" rx="1.5"/>
                    <rect class="ci-chart-bar b2" x="70" y="82" width="15" height="48" rx="1.5"/>
                    <rect class="ci-chart-bar b3" x="90" y="63" width="15" height="67" rx="1.5"/>
                    <rect class="ci-chart-bar b4" x="110" y="49" width="15" height="81" rx="1.5"/>
                    <rect class="ci-chart-bar b5" x="130" y="60" width="15" height="70" rx="1.5"/>
                    <rect class="ci-chart-bar b6" x="150" y="79" width="15" height="51" rx="1.5"/>
                    <rect class="ci-chart-bar b7" x="170" y="101" width="15" height="29" rx="1.5"/>
                </g>
                <path class="ci-chart-curve" pathLength="320" d="M42 111 C60 106 70 90 82 71 C95 50 108 39 119 38 C131 37 144 49 157 70 C169 88 181 104 198 110"/>
            </svg>`]);

            return categoryIllustrationCycle([`<svg class="category-illustration category-illustration-stat" ${common}><path class="ci-chart-axis" d="M28 130H212 M38 138V34"/><path class="ci-chart-curve" d="M42 111 C70 102 78 46 119 38 C158 45 167 103 198 110"/></svg>`]);
        }
        function getCategoryIcon(name) {
            return documentIconMap[name] || "fa-folder-open";
        }

        function formatDocumentDate(value) {
            if (!value) return "";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return new Intl.DateTimeFormat("vi-VN", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric"
            }).format(date);
        }

        function formatNumber(value) {
            return new Intl.NumberFormat("vi-VN").format(Number(value) || 0);
        }

        function getPublicPdfUrl(path) {
            if (!path) return "";
            return supabaseClient.storage.from("math-pdfs").getPublicUrl(path).data.publicUrl;
        }

        function getPublicStorageUrl(path) {
            if (!path) return "";
            return supabaseClient.storage.from("math-pdfs").getPublicUrl(path).data.publicUrl;
        }

        function getChildren(categoryId) {
            return libraryCategories.filter(category => String(category.parent_id || "") === String(categoryId || ""));
        }

        function getDescendantCategoryIds(categoryId) {
            const ids = [String(categoryId)];
            const walk = (id) => {
                getChildren(id).forEach(child => {
                    ids.push(String(child.id));
                    walk(child.id);
                });
            };
            walk(categoryId);
            return ids;
        }

        function getCategoryPath(categoryId) {
            const path = [];
            let current = libraryCategories.find(c => String(c.id) === String(categoryId));
            while (current) {
                path.unshift(current);
                current = libraryCategories.find(c => String(c.id) === String(current.parent_id || ""));
            }
            return path;
        }

        function countDocsForCategory(categoryId) {
            const ids = new Set(getDescendantCategoryIds(categoryId));
            return libraryDocuments.filter(doc => ids.has(String(doc.category_id))).length;
        }

        function setDocumentFiltersVisible(visible) {
            const sortWrap = document.getElementById("documentSortWrap");
            const typeFilter = document.getElementById("documentTypeFilter");
            if (sortWrap) sortWrap.hidden = !visible;
            if (typeFilter) typeFilter.hidden = !visible;
        }

        function renderBreadcrumb() {
            const root = document.getElementById("documentBreadcrumb");
            if (!root) return;
            const path = activeDocumentCategoryId ? getCategoryPath(activeDocumentCategoryId) : [];

            if (!path.length) {
                root.innerHTML = '<div class="document-breadcrumb-path"><button type="button" class="document-crumb active"><i class="fa-solid fa-house"></i> Danh mục</button></div>';
                return;
            }

            const backButton = '<button type="button" class="document-breadcrumb-back" id="documentBreadcrumbBack" aria-label="Quay lại danh mục trước" title="Quay lại danh mục trước"><i class="fa-solid fa-arrow-left"></i><span>Quay lại</span></button>';

            root.innerHTML = `<div class="document-breadcrumb-path">
                <button type="button" class="document-crumb" data-breadcrumb-id="root">Danh mục</button>
                ${path.map((item, index) => {
                    const active = index === path.length - 1 ? "active" : "";
                    return `<span class="document-crumb-sep">/</span><button type="button" class="document-crumb ${active}" data-breadcrumb-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`;
                }).join("")}
            </div>
            ${backButton}`;

            root.querySelectorAll("[data-breadcrumb-id]").forEach(button => {
                button.addEventListener("click", () => {
                    const id = button.dataset.breadcrumbId;
                    if (id === "root") setCategoryView(null);
                    else setCategoryView(id);
                });
            });

            root.querySelector("#documentBreadcrumbBack")?.addEventListener("click", () => {
                goBackToParent();
            });
        }

        function setCategoryView(categoryId, page = 1) {
            if (!window.SiteContent.isVisible("documents")) { ensureVisibleRoute(); return; }
            activeDocumentCategoryId = categoryId == null ? null : String(categoryId);
            documentCurrentPage = page;
            const searchInput = document.getElementById("documentSearch");
            if (searchInput) {
                searchInput.value = "";
                searchInput.placeholder = activeDocumentCategoryId ? "Tìm tài liệu trong danh mục..." : "Tìm danh mục hoặc tài liệu...";
            }
            renderDocumentLibrary();
        }

        function isNewDocument(createdAt) {
            if (!createdAt) return false;
            const age = Date.now() - new Date(createdAt).getTime();
            return age >= 0 && age <= 1000 * 60 * 60 * 24 * 14;
        }

        function sortDocuments(documents) {
            const items = [...documents];
            items.sort((a, b) => {
                if (documentSortMode === "oldest") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
                if (documentSortMode === "az") return String(a.title || "").localeCompare(String(b.title || ""), "vi", { sensitivity: "base" });
                if (documentSortMode === "za") return String(b.title || "").localeCompare(String(a.title || ""), "vi", { sensitivity: "base" });
                if (documentSortMode === "views") return (Number(b.view_count) || 0) - (Number(a.view_count) || 0);
                const created = new Date(b.created_at || 0) - new Date(a.created_at || 0);
                return created !== 0 ? created : (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
            });
            return items;
        }

        function renderPagination(total) {
            const root = document.getElementById("documentPagination");
            if (!root) return;

            const pages = Math.max(1, Math.ceil(total / documentPageSize));

            documentCurrentPage = Math.max(
                1,
                Math.min(Number(documentCurrentPage) || 1, pages)
            );

            if (pages <= 1) {
                root.hidden = true;
                root.innerHTML = "";
                return;
            }

            root.hidden = false;

            const buttons = [];

            /* Trang trước */
            buttons.push(`
                <button
                    type="button"
                    class="document-page-btn"
                    data-page="${Math.max(1, documentCurrentPage - 1)}"
                    ${documentCurrentPage === 1 ? "disabled" : ""}
                    aria-label="Trang trước"
                    title="Trang trước"
                >
                    <i class="fa-solid fa-chevron-left"></i>
                </button>
            `);

            /* Các số trang */
            const visiblePages = [];
            const addPage = page => {
                if (page >= 1 && page <= pages && !visiblePages.includes(page)) {
                    visiblePages.push(page);
                }
            };

            if (pages <= 9) {
                for (let page = 1; page <= pages; page++) addPage(page);
            } else {
                addPage(1);
                addPage(2);
                addPage(documentCurrentPage - 1);
                addPage(documentCurrentPage);
                addPage(documentCurrentPage + 1);
                addPage(pages - 1);
                addPage(pages);
            }

            visiblePages.sort((a, b) => a - b);

            let previous = null;
            visiblePages.forEach(page => {
                if (previous !== null && page - previous > 1) {
                    buttons.push('<span class="document-page-ellipsis" aria-hidden="true">…</span>');
                }

                buttons.push(`
                    <button
                        type="button"
                        class="document-page-btn ${page === documentCurrentPage ? "active" : ""}"
                        data-page="${page}"
                        ${page === documentCurrentPage ? 'aria-current="page"' : ""}
                        aria-label="Trang ${page}"
                    >
                        ${page}
                    </button>
                `);

                previous = page;
            });

            /* Trang sau */
            buttons.push(`
                <button
                    type="button"
                    class="document-page-btn"
                    data-page="${Math.min(pages, documentCurrentPage + 1)}"
                    ${documentCurrentPage === pages ? "disabled" : ""}
                    aria-label="Trang sau"
                    title="Trang sau"
                >
                    <i class="fa-solid fa-chevron-right"></i>
                </button>
            `);

            /* Đi tới trang X / tổng số trang */
            buttons.push(`
                <label class="document-page-jump">
                    <span>Tới trang:</span>
                    <input
                        id="documentPageJumpInput"
                        type="number"
                        min="1"
                        max="${pages}"
                        value="${documentCurrentPage}"
                        inputmode="numeric"
                        aria-label="Nhập số trang"
                    >
                    <b>/ ${pages}</b>
                </label>
            `);

            root.innerHTML = buttons.join("");

            const goToPage = page => {
                const nextPage = Math.max(
                    1,
                    Math.min(pages, Number(page) || 1)
                );

                documentCurrentPage = nextPage;
                renderDocumentLibrary();

                document.getElementById("documentList")?.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });
            };

            root.querySelectorAll("[data-page]").forEach(button => {
                button.addEventListener("click", () => {
                    if (button.disabled) return;
                    goToPage(button.dataset.page);
                });
            });

            const jumpInput = root.querySelector("#documentPageJumpInput");

            jumpInput?.addEventListener("change", () => {
                goToPage(jumpInput.value);
            });

            jumpInput?.addEventListener("keydown", event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    goToPage(jumpInput.value);
                }
            });
        }

        function renderCategoryCards(categories) {
            const list = document.getElementById("documentList");
            const empty = document.getElementById("documentEmpty");
            const status = document.getElementById("documentStatus");
            const title = document.getElementById("documentViewTitle");
            const backbar = document.getElementById("documentBackbar");
            if (!list || !empty || !status || !title || !backbar) return;
            clearCategoryIllustrationTimers();

            const currentCategory = activeDocumentCategoryId
                ? libraryCategories.find(c => String(c.id) === String(activeDocumentCategoryId))
                : null;

            title.textContent = currentCategory?.name || "Danh mục tài liệu";
            backbar.hidden = !activeDocumentCategoryId;
            setDocumentFiltersVisible(false);
            renderBreadcrumb();
            status.textContent = `${categories.length} danh mục`;

            if (!categories.length) {
                list.innerHTML = "";
                empty.hidden = false;
                empty.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><h3>Không tìm thấy danh mục</h3><p>Hãy thử từ khóa khác.</p>';
                renderPagination(0);
                return;
            }

            empty.hidden = true;
            list.className = "document-grid document-category-grid";
            list.innerHTML = categories.map(category => {
                const count = countDocsForCategory(category.id);
                const childCount = getChildren(category.id).length;
                const icon = getCategoryIcon(category.name);
                const shareUrl = shareCategoryUrl(category.id);

                return `<article class="document-card document-category-card reveal show" tabindex="0" role="button" data-category-id="${escapeHtml(category.id)}">
                    <div class="document-card-glow"></div>
                    <div class="category-card-main ${(() => {
                        const n = String(category.name || "").trim();
                        if (n === "Lớp 10") return "category-tone-10";
                        if (n === "Lớp 11") return "category-tone-11";
                        if (n === "Lớp 12") return "category-tone-12";
                        if (n === "Ôn thi vào 10") return "category-tone-exam10";
                        if (n === "Ôn thi THPT") return "category-tone-thpt";
                        return "category-tone-topic";
                    })()}">
                        <div class="category-card-info">
                            <div class="document-category-icon"><i class="fa-solid ${escapeHtml(icon)}"></i></div>
                            <div class="document-card-category">${childCount ? "FOLDER" : "CATEGORY"}</div>
                            <h3>${escapeHtml(category.name)}</h3>
                            <p>${escapeHtml(category.description || "Tài liệu học tập và luyện tập môn Toán.")}</p>
                        </div>
                        <div class="category-card-illustration" aria-hidden="true">${getCategoryIllustration(category.name)}</div>
                    </div>
                    <div class="document-category-footer">
                        <span class="document-category-count">
                            <i class="fa-regular fa-file-lines"></i>
                            <span>${formatNumber(count)} tài liệu</span>
                        </span>
                        <button type="button" class="document-open-label" data-category-open="${escapeHtml(category.id)}">
                            ${childCount ? "Mở thư mục" : "Xem tài liệu"}
                            <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                </article>`;
            }).join("");

            startCategoryIllustrationCycles(list);

            list.querySelectorAll("[data-category-id]").forEach(card => {
                const open = () => setCategoryView(card.dataset.categoryId);
                card.addEventListener("click", event => {
                    if (event.target.closest("[data-category-open]")) {
                        event.stopPropagation();
                        open();
                        return;
                    }
                    open();
                });
                card.addEventListener("keydown", e => {
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open();
                    }
                });
            });

            list.querySelectorAll("[data-category-open]").forEach(button => {
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    setCategoryView(button.dataset.categoryOpen);
                });
            });
            renderPagination(0);
        }

        function renderDocumentCard(item, categoryName) {
            const url = getPublicPdfUrl(item.file_path);
            const rawThumbnail = String(item.thumbnail_path || "").trim();
            const coverDisabled = item.cover_enabled === false || rawThumbnail.startsWith("disabled:");
            const cleanThumbnailPath = rawThumbnail.replace(/^disabled:/, "");
            const thumbnailUrl = !coverDisabled && cleanThumbnailPath ? getPublicStorageUrl(cleanThumbnailPath) : "";
            const isExam = item.document_type === "exam";
            const newBadge = isNewDocument(item.created_at) ? '<span class="document-new-badge">MỚI</span>' : '';
            const typeBadge = isExam ? '<span class="document-type-badge exam">ĐỀ THI</span>' : '<span class="document-type-badge">PDF</span>';
            const tags = Array.isArray(item.tags) ? item.tags.filter(Boolean).slice(0, 4) : [];
            const tagHtml = tags.length ? `<div class="document-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : "";
            const meta = [
                formatDocumentDate(item.created_at),
                isExam && item.exam_year ? `Năm ${item.exam_year}` : "",
                isExam && item.duration_minutes ? `${item.duration_minutes} phút` : "",
                `${formatNumber(item.view_count)} lượt xem`
            ].filter(Boolean).join(" · ");
            const title = item.title || item.file_name || "Tài liệu không có tiêu đề";
            const previewId = `pdf-preview-${item.id}`;
            const previewHtml = thumbnailUrl
                ? `<div class="document-card-preview uploaded-thumbnail" data-preview-kind="thumbnail">
                        <img src="${escapeHtml(thumbnailUrl)}" alt="Ảnh xem trước ${escapeHtml(title)}" loading="lazy" decoding="async">
                   </div>`
                : `<div class="document-card-preview" data-pdf-preview="${escapeHtml(url)}" data-preview-kind="pdf">
                        <div class="document-preview-loading" id="${previewId}-loading">
                            <i class="fa-regular fa-file-pdf"></i>
                            <span>Đang tạo xem trước...</span>
                        </div>
                        <canvas id="${previewId}" class="document-preview-canvas" aria-label="Trang đầu của PDF"></canvas>
                   </div>`;
            return `<article class="document-card document-card-clickable reveal show" tabindex="0" role="button" data-document-id="${item.id}" data-url="${escapeHtml(url)}" data-title="${escapeHtml(title)}">
                <div class="document-card-glow"></div>
                <div class="document-card-content-wrap">
                    <div class="document-card-info">
                        <div class="document-card-topline">
                            <div class="document-card-top-badges">${typeBadge}${newBadge}</div>
                        </div>
                        <div class="document-card-category">${escapeHtml(categoryName || "Tài liệu")}</div>
                        <div class="document-card-title-line">
                            <h3>${escapeHtml(title)}</h3>
                        </div>
                        <p>${escapeHtml(item.description || "Tài liệu học tập và luyện tập môn Toán.")}</p>
                        ${tagHtml}
                        <div class="document-card-footer-inline">
                            ${escapeHtml(meta)}
                        </div>
                    </div>
                    ${previewHtml}
                    <div class="document-card-actions">
                        <button type="button" class="document-card-action compact-share" data-share-id="${item.id}" aria-label="Sao chép liên kết" title="Sao chép liên kết">
                            <i class="fa-solid fa-link"></i>
                            <span>Chia sẻ</span>
                        </button>
                        <button type="button" class="document-card-action compact-qr" data-qr-id="${item.id}" aria-label="Tạo QR" title="Tạo QR">
                            <i class="fa-solid fa-qrcode"></i>
                            <span>QR</span>
                        </button>
                        <button type="button" class="document-card-action open" data-open-id="${item.id}" aria-label="Mở tài liệu">
                            <span>Mở tài liệu</span>
                            <i class="fa-solid fa-arrow-right"></i>
                        </button>
                    </div>
                </div>
            </article>`;
        }

        function matchesDocumentSearch(item, keyword) {
            if (!keyword) return true;
            const haystack = [item.title, item.description, item.file_name, ...(Array.isArray(item.tags) ? item.tags : []), item.math_categories?.name].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(keyword);
        }

        function renderDocuments(items, titleText, statusPrefix = "") {
            const list = document.getElementById("documentList");
            const empty = document.getElementById("documentEmpty");
            const status = document.getElementById("documentStatus");
            const heading = document.getElementById("documentViewTitle");
            const backbar = document.getElementById("documentBackbar");
            const selected = document.getElementById("documentSelectedCategory");
            if (!list || !empty || !status || !heading || !backbar) return;
            heading.textContent = titleText;
            backbar.hidden = !activeDocumentCategoryId;
            renderBreadcrumb();
            setDocumentFiltersVisible(true);
            const keyword = (document.getElementById("documentSearch")?.value || "").trim().toLowerCase();
            let filtered = items.filter(item => {
                if (documentTypeMode !== "all" && item.document_type !== documentTypeMode) return false;
                return matchesDocumentSearch(item, keyword);
            });
            filtered = sortDocuments(filtered);
            status.textContent = `${filtered.length}${statusPrefix ? " · " + statusPrefix : ""} tài liệu`;
            if (selected) selected.textContent = statusPrefix;
            if (!filtered.length) {
                list.innerHTML = "";
                empty.hidden = false;
                empty.innerHTML = '<i class="fa-regular fa-folder-open"></i><h3>Chưa có tài liệu phù hợp</h3><p>Danh mục này chưa có PDF hoặc không có kết quả theo từ khóa.</p>';
                renderPagination(0);
                return;
            }
            empty.hidden = true;
            const start = (documentCurrentPage - 1) * documentPageSize;
            const pageItems = filtered.slice(start, start + documentPageSize);
            list.className = "document-grid document-pdf-grid";
            list.innerHTML = pageItems.map(item => renderDocumentCard(item, item.math_categories?.name)).join("");
            renderPagination(filtered.length);
            bindDocumentCards();
        }

        function renderGlobalSearch(keyword) {
            const query = keyword.trim().toLowerCase();
            if (!query) {
                renderCategoryMenu();
                return;
            }
            activeDocumentCategoryId = null;
            setDocumentFiltersVisible(true);
            const matching = libraryDocuments.filter(item => {
                if (documentTypeMode !== "all" && item.document_type !== documentTypeMode) return false;
                return matchesDocumentSearch(item, query);
            });
            const list = document.getElementById("documentList");
            const empty = document.getElementById("documentEmpty");
            const status = document.getElementById("documentStatus");
            const heading = document.getElementById("documentViewTitle");
            const backbar = document.getElementById("documentBackbar");
            const typeFilter = document.getElementById("documentTypeFilter");
            if (typeFilter) typeFilter.hidden = false;
            backbar.hidden = true;
            renderBreadcrumb();
            heading.textContent = "Kết quả tìm kiếm toàn thư viện";
            status.textContent = `${matching.length} tài liệu`;
            if (!matching.length) {
                list.innerHTML = "";
                empty.hidden = false;
                empty.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i><h3>Không tìm thấy tài liệu</h3><p>Hãy thử từ khóa khác.</p>';
                renderPagination(0);
                return;
            }
            empty.hidden = true;
            const sorted = sortDocuments(matching);
            const start = (documentCurrentPage - 1) * documentPageSize;
            const pageItems = sorted.slice(start, start + documentPageSize);
            list.className = "document-grid document-pdf-grid";
            list.innerHTML = pageItems.map(item => renderDocumentCard(item, item.math_categories?.name)).join("");
            renderPagination(sorted.length);
            bindDocumentCards();
        }

        function renderCategoryMenu() {
            const searchInput = document.getElementById("documentSearch");
            const keyword = (searchInput?.value || "").trim().toLowerCase();
            const rootCategories = libraryCategories.filter(category => !category.parent_id);
            const visibleCategories = rootCategories.filter(category => !keyword || [category.name, category.description, category.slug].filter(Boolean).join(" ").toLowerCase().includes(keyword));
            documentCurrentPage = 1;
            if (keyword) {
                renderGlobalSearch(keyword);
                return;
            }
            renderCategoryCards(visibleCategories);
        }

        function renderActiveCategory() {
            const category = libraryCategories.find(c => String(c.id) === String(activeDocumentCategoryId));
            if (!category) {
                activeDocumentCategoryId = null;
                renderCategoryMenu();
                return;
            }
            const children = getChildren(category.id);
            const descendantIds = new Set(getDescendantCategoryIds(category.id));
            const docs = libraryDocuments.filter(item => descendantIds.has(String(item.category_id)));
            const selectedCategory = document.getElementById("documentSelectedCategory");
            if (selectedCategory) selectedCategory.textContent = `${countDocsForCategory(category.id)} tài liệu`;
            if (children.length) {
                renderCategoryCards(children);
                const directDocs = libraryDocuments.filter(item => String(item.category_id) === String(category.id));
                if (directDocs.length) {
                    const list = document.getElementById("documentList");
                    const divider = document.createElement("div");
                    divider.className = "document-subsection-title";
                    divider.innerHTML = `<span>Tài liệu trực tiếp</span><span>${directDocs.length}</span>`;
                    list.parentNode.insertBefore(divider, list.nextSibling);
                }
                return;
            }
            renderDocuments(docs, category.name, category.name);
        }

        function renderDocumentLibrary() {
            if (activeDocumentCategoryId == null) renderCategoryMenu();
            else renderActiveCategory();
        }

        function goBackToParent() {
            if (!activeDocumentCategoryId) return;
            const category = libraryCategories.find(c => String(c.id) === String(activeDocumentCategoryId));
            setCategoryView(category?.parent_id || null);
        }

        async function trackView(documentId) {
            try {
                const { data } = await supabaseClient.rpc("increment_document_view", { p_document_id: documentId });
                const item = libraryDocuments.find(doc => Number(doc.id) === Number(documentId));
                if (item && data != null) item.view_count = Number(data);
                updatePublicStats();
            } catch (error) {
                console.warn("Could not track document view", error);
            }
        }

        function updatePublicStats() {
            document.getElementById("publicDocCount").textContent = formatNumber(libraryDocuments.length);
            document.getElementById("publicCategoryCount").textContent = formatNumber(libraryCategories.length);
            const totalViews = libraryDocuments.reduce((sum, item) => sum + (Number(item.view_count) || 0), 0);
            document.getElementById("publicViewCount").textContent = formatNumber(totalViews);
            document.getElementById("publicExamCount").textContent = formatNumber(libraryDocuments.filter(item => item.document_type === "exam").length);
        }

        function shareUrlFor(id) {
            const url = new URL(window.location.href);
            url.searchParams.set("doc", id);
            url.searchParams.delete("category");
            url.hash = "documents";
            return url.toString();
        }

        function shareCategoryUrl(categoryId) {
            const url = new URL(window.location.href);
            url.searchParams.delete("doc");
            url.searchParams.set("category", categoryId);
            url.hash = "documents";
            return url.toString();
        }

        async function openQrForCategory(category) {
            if (!category) return;
            qrTarget = { title: category.name, url: shareCategoryUrl(category.id) };
            const modal = document.getElementById("qrModal");
            const qr = document.getElementById("qrCode");
            const title = document.getElementById("qrTitle");
            const urlEl = document.getElementById("qrUrl");
            if (!modal || !qr) return;
            title.textContent = category.name || "Danh mục";
            urlEl.textContent = qrTarget.url;
            qr.innerHTML = '<div class="qr-fallback">Đang tải mã QR...</div>';
            try {
                await ensureQrCodeJs();
                qr.innerHTML = "";
                new QRCode(qr, { text: qrTarget.url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
            } catch (error) {
                console.warn("QRCode load failed:", error);
                qr.innerHTML = '<div class="qr-fallback">Không tải được thư viện QR.</div>';
            }
            modal.classList.add("open");
            modal.setAttribute("aria-hidden", "false");
        }

        function showCopyToast(message) {
            let toast = document.getElementById("documentCopyToast");
            if (!toast) {
                toast = document.createElement("div");
                toast.id = "documentCopyToast";
                toast.className = "document-copy-toast";
                document.body.appendChild(toast);
            }
            toast.textContent = message;
            toast.classList.add("show");
            clearTimeout(window.__documentCopyToastTimer);
            window.__documentCopyToastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
        }

        async function copyText(text) {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            textarea.setAttribute("readonly", "");
            document.body.appendChild(textarea);
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            const ok = document.execCommand("copy");
            textarea.remove();
            return ok;
        }

        async function shareDocument(item) {
            if (!item) return;
            const url = shareUrlFor(item.id);
            try {
                const copied = await copyText(url);
                if (copied) {
                    showCopyToast("✓ Đã sao chép đường link, liên kết");
                } else {
                    showCopyToast("Không thể sao chép liên kết");
                }
            } catch (error) {
                console.error("Copy link failed:", error);
                showCopyToast("Không thể sao chép liên kết");
            }
        }

        let qrTarget = null;
        async function openQr(item) {
            if (!item) return;
            qrTarget = { title: item.title || item.file_name || "Tài liệu", url: shareUrlFor(item.id) };
            const modal = document.getElementById("qrModal");
            const qr = document.getElementById("qrCode");
            const title = document.getElementById("qrTitle");
            const urlEl = document.getElementById("qrUrl");
            if (!modal || !qr) return;
            title.textContent = qrTarget.title;
            urlEl.textContent = qrTarget.url;
            qr.innerHTML = '<div class="qr-fallback">Đang tải mã QR...</div>';
            try {
                await ensureQrCodeJs();
                qr.innerHTML = "";
                new QRCode(qr, { text: qrTarget.url, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
            } catch (error) {
                console.warn("QRCode load failed:", error);
                qr.innerHTML = '<div class="qr-fallback">Không tải được thư viện QR.</div>';
            }
            modal.classList.add("open");
            modal.setAttribute("aria-hidden", "false");
        }

        function closeQr() {
            const modal = document.getElementById("qrModal");
            if (!modal) return;
            modal.classList.remove("open");
            modal.setAttribute("aria-hidden", "true");
        }

        function downloadQr() {
            const canvas = document.querySelector("#qrCode canvas");
            if (!canvas || !qrTarget) return;
            const a = document.createElement("a");
            a.href = canvas.toDataURL("image/png");
            a.download = `${(qrTarget.title || "tai-lieu").replace(/[^a-zA-Z0-9\-_]+/g, "-")}-QR.png`;
            a.click();
        }

        function relatedDocuments(item) {
            if (!item) return [];
            const tags = new Set(Array.isArray(item.tags) ? item.tags.map(x => String(x).toLowerCase()) : []);
            return libraryDocuments
                .filter(other => Number(other.id) !== Number(item.id))
                .map(other => {
                    let score = 0;
                    if (String(other.category_id) === String(item.category_id)) score += 4;
                    const otherTags = Array.isArray(other.tags) ? other.tags : [];
                    otherTags.forEach(tag => { if (tags.has(String(tag).toLowerCase())) score += 2; });
                    if (other.document_type === item.document_type) score += 1;
                    return { item: other, score };
                })
                .filter(x => x.score > 0)
                .sort((a,b) => b.score - a.score || (Number(b.item.view_count)||0) - (Number(a.item.view_count)||0))
                .slice(0, 4)
                .map(x => x.item);
        }

        function renderRelatedDocuments(item) {
            const root = document.getElementById("pdfRelatedList");
            const tagRoot = document.getElementById("pdfRelatedTags");
            if (!root || !tagRoot || !item) return;

            const currentId = Number(item.id);
            const currentTags = Array.isArray(item.tags)
                ? item.tags.map(v => String(v || "").trim()).filter(Boolean)
                : [];

            const normalizeTag = value => String(value || "").trim().toLowerCase();
            const sameCategory = doc => String(doc.category_id) === String(item.category_id);
            const sameType = doc => String(doc.document_type || "document") === String(item.document_type || "document");
            const hasTag = (doc, selected) => Array.isArray(doc.tags) && doc.tags.some(v => normalizeTag(v) === selected);

            const smartRelated = libraryDocuments
                .filter(doc => Number(doc.id) !== currentId)
                .map(doc => {
                    let score = 0;
                    if (sameCategory(doc)) score += 6;
                    if (sameType(doc)) score += 2;
                    currentTags.forEach(tag => {
                        if (hasTag(doc, normalizeTag(tag))) score += 3;
                    });
                    return { doc, score };
                })
                .filter(x => x.score > 0)
                .sort((a, b) =>
                    b.score - a.score ||
                    (Number(b.doc.view_count) || 0) - (Number(a.doc.view_count) || 0)
                )
                .map(x => x.doc);

            const allRelated = smartRelated.length
                ? smartRelated
                : libraryDocuments
                    .filter(doc => Number(doc.id) !== currentId)
                    .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0))
                    .slice(0, 8);

            const categoryDocs = libraryDocuments
                .filter(doc => Number(doc.id) !== currentId && sameCategory(doc))
                .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0));

            const typeDocs = libraryDocuments
                .filter(doc => Number(doc.id) !== currentId && sameType(doc))
                .sort((a, b) => (Number(b.view_count) || 0) - (Number(a.view_count) || 0));

            const tagMap = new Map();
            const collectTags = docs => {
                docs.forEach(doc => {
                    if (!Array.isArray(doc.tags)) return;
                    doc.tags.forEach(value => {
                        const raw = String(value || "").trim();
                        if (!raw) return;
                        const key = normalizeTag(raw);
                        if (!tagMap.has(key)) tagMap.set(key, raw);
                    });
                });
            };
            collectTags([item]);
            collectTags(allRelated);

            const tags = [...tagMap.values()].slice(0, 12);

            const optionButtons = [
                { key: "all", label: "Tất cả" },
                { key: "category", label: "Cùng danh mục" },
                { key: "type", label: item.document_type === "exam" ? "Cùng loại đề" : "Cùng loại tài liệu" }
            ];

            tags.forEach(tag => optionButtons.push({
                key: `tag:${normalizeTag(tag)}`,
                label: `#${tag}`
            }));

            tagRoot.innerHTML = optionButtons.map((option, index) => `
                <button
                    type="button"
                    class="pdf-related-tag ${index === 0 ? "active" : ""}"
                    data-related-option="${escapeHtml(option.key)}"
                >
                    ${escapeHtml(option.label)}
                </button>
            `).join("");

            const renderCards = (documents, label) => {
                if (!documents.length) {
                    root.innerHTML = `
                        <div class="pdf-related-choice-label">${escapeHtml(label)}</div>
                        <div class="pdf-related-empty">
                            Không có tài liệu phù hợp với lựa chọn này.
                        </div>
                    `;
                    return;
                }

                root.innerHTML = `
                    <div class="pdf-related-choice-label">
                        ${escapeHtml(label)} · ${documents.length} tài liệu
                    </div>
                    <div class="pdf-related-list">
                        ${documents.map(doc => `
                            <button
                                type="button"
                                class="pdf-related-card"
                                data-related-id="${escapeHtml(doc.id)}"
                            >
                                <span class="pdf-related-icon">
                                    <i class="fa-solid ${doc.document_type === "exam" ? "fa-file-circle-check" : "fa-file-pdf"}"></i>
                                </span>
                                <span>
                                    <b>${escapeHtml(doc.title || doc.file_name || "Tài liệu")}</b>
                                    <small>
                                        ${escapeHtml(doc.math_categories?.name || "Tài liệu")}
                                        · ${formatNumber(doc.view_count)} lượt xem
                                    </small>
                                </span>
                            </button>
                        `).join("")}
                    </div>
                `;

                root.querySelectorAll("[data-related-id]").forEach(button => {
                    button.addEventListener("click", event => {
                        event.stopPropagation();
                        const next = libraryDocuments.find(doc => Number(doc.id) === Number(button.dataset.relatedId));
                        if (next) {
                            openPdfViewer(next);
                        }
                    });
                });
            };

            renderCards(allRelated, "Tài liệu đề xuất");

            tagRoot.querySelectorAll("[data-related-option]").forEach(button => {
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    tagRoot.querySelectorAll("[data-related-option]").forEach(btn => btn.classList.remove("active"));
                    button.classList.add("active");

                    const key = button.dataset.relatedOption || "all";

                    if (key === "all") {
                        renderCards(allRelated, "Tài liệu đề xuất");
                        return;
                    }

                    if (key === "category") {
                        renderCards(categoryDocs, "Tài liệu cùng danh mục");
                        return;
                    }

                    if (key === "type") {
                        renderCards(typeDocs, "Tài liệu cùng loại");
                        return;
                    }

                    if (key.startsWith("tag:")) {
                        const selected = key.slice(4);
                        const matches = libraryDocuments
                            .filter(doc => Number(doc.id) !== currentId)
                            .filter(doc => hasTag(doc, selected))
                            .sort((a, b) =>
                                (Number(b.view_count) || 0) - (Number(a.view_count) || 0)
                            );

                        renderCards(
                            matches,
                            `Tài liệu theo #${button.textContent.trim().replace(/^#/, "")}`
                        );
                    }
                });
            });
        }

        let currentPdfDocument = null;
        let currentPdfInstance = null;
        let currentPdfFitScale = 1;
        let currentPdfZoom = 1;
        let currentPdfPage = 1;
        let currentPdfRenderToken = 0;

        function updatePdfControls() {
            const select = document.getElementById("pdfZoomSelect");
            const input = document.getElementById("pdfPageInput");
            const total = document.getElementById("pdfPageTotal");
            const prev = document.getElementById("pdfPrevPage");
            const next = document.getElementById("pdfNextPage");
            if (select) select.value = String(currentPdfZoom);
            if (input) input.value = String(currentPdfPage);
            if (total) total.textContent = String(currentPdfInstance?.numPages || 0);
            if (prev) prev.disabled = !currentPdfInstance || currentPdfPage <= 1;
            if (next) next.disabled = !currentPdfInstance || currentPdfPage >= (currentPdfInstance?.numPages || 0);
        }

        function getPdfTargetWidth(container) {
            return Math.min(980, Math.max(320, (container?.clientWidth || 980) - 36));
        }

        function scrollToPdfPage(pageNumber, behavior = "smooth") {
            if (!currentPdfInstance) return;
            const page = Math.max(1, Math.min(Number(pageNumber) || 1, currentPdfInstance.numPages));
            currentPdfPage = page;
            updatePdfControls();

            const viewer = document.querySelector(".pdf-viewer-scroll");
            const target = document.querySelector(`[data-pdf-page-wrap="${page}"]`);
            if (!viewer || !target) return;

            const top = Math.max(0, target.offsetTop - 12);
            viewer.scrollTo({ top, behavior });
            ensurePdfPageRendered(page);
        }

        function getPdfRenderRatio() {
            const deviceRatio = window.devicePixelRatio || 1;
            return Math.min(Math.max(deviceRatio, 1.5), 2);
        }

        async function renderPdfPageNumber(pageNumber, token = currentPdfRenderToken) {
            const pdf = currentPdfInstance;
            const wrap = document.querySelector(`[data-pdf-page-wrap="${pageNumber}"]`);
            if (!pdf || !wrap || token !== currentPdfRenderToken) return;
            if (wrap.dataset.rendering === "1" || wrap.dataset.rendered === "1") return;

            wrap.dataset.rendering = "1";
            try {
                const page = await pdf.getPage(pageNumber);
                if (token !== currentPdfRenderToken) return;

                const viewer = document.querySelector(".pdf-viewer-scroll");
                const isDesktopViewer = window.matchMedia("(min-width:901px)").matches;
                const scrollbarReserve = viewer ? 12 : 0;
                const pageHorizontalPadding = 24;
                const viewerWidth = Math.max(240, viewer?.clientWidth || 980);
                const availableWidth = Math.max(180, viewerWidth - scrollbarReserve - pageHorizontalPadding);

                const baseViewport = page.getViewport({ scale: 1 });
                const CSS_UNITS = 96 / 72;
                const requestedScale = currentPdfZoom * CSS_UNITS;
                const fitScaleByWidth = availableWidth / baseViewport.width;
                const actualScale = isDesktopViewer
                    ? Math.max(0.1, Math.min(requestedScale, fitScaleByWidth))
                    : Math.max(0.1, currentPdfFitScale * currentPdfZoom);

                const viewport = page.getViewport({ scale: actualScale });
                const canvas = wrap.querySelector(".pdf-page-canvas");
                if (!canvas) return;

                const ratio = getPdfRenderRatio();
                canvas.width = Math.ceil(viewport.width * ratio);
                canvas.height = Math.ceil(viewport.height * ratio);
                canvas.style.width = `${viewport.width}px`;
                canvas.style.height = `${viewport.height}px`;
                canvas.style.maxWidth = "100%";
                canvas.style.maxHeight = "none";

                wrap.style.minHeight = `${viewport.height + 34}px`;

                const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
                await page.render({
                    canvasContext: ctx,
                    viewport,
                    transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null,
                    intent: "display"
                }).promise;

                if (token !== currentPdfRenderToken) return;
                wrap.dataset.rendered = "1";
            } catch (error) {
                if (token === currentPdfRenderToken) {
                    console.warn(`PDF page ${pageNumber} render failed:`, error);
                }
            } finally {
                wrap.dataset.rendering = "";
            }
        }

        function ensurePdfPageRendered(pageNumber) {
            const token = currentPdfRenderToken;
            const page = Math.max(1, Number(pageNumber) || 1);
            // Render the active page first. Adjacent pages are left to the
            // IntersectionObserver so fast wheel/touch scrolling never
            // starts three expensive PDF renders at once.
            renderPdfPageNumber(page, token);
        }

        function setupPdfLazyRendering() {
            const viewer = document.querySelector(".pdf-viewer-scroll");
            const container = document.getElementById("pdfViewerPages");
            if (!viewer || !container) return;

            if (window.__pdfPageObserver) {
                window.__pdfPageObserver.disconnect();
            }

            const token = currentPdfRenderToken;
            if ("IntersectionObserver" in window) {
                window.__pdfPageObserver = new IntersectionObserver(entries => {
                    if (token !== currentPdfRenderToken) return;
                    const visible = entries
                        .filter(entry => entry.isIntersecting)
                        .sort((a, b) => Math.abs(a.boundingClientRect.top - viewer.getBoundingClientRect().top) - Math.abs(b.boundingClientRect.top - viewer.getBoundingClientRect().top));
                    if (!visible.length) return;
                    const pageNumber = Number(visible[0].target.dataset.pdfPageWrap);
                    // Never render synchronously inside the observer callback.
                    // Yield one frame to the browser first, keeping wheel/touch
                    // scrolling on the compositor path.
                    cancelAnimationFrame(window.__pdfRenderRaf || 0);
                    window.__pdfRenderRaf = requestAnimationFrame(() => {
                        if (token === currentPdfRenderToken) renderPdfPageNumber(pageNumber, token);
                    });
                }, {
                    root: viewer,
                    rootMargin: "260px 0px",
                    threshold: 0.01
                });

                container.querySelectorAll("[data-pdf-page-wrap]").forEach(wrap => {
                    window.__pdfPageObserver.observe(wrap);
                });
            } else {
                ensurePdfPageRendered(currentPdfPage);
            }
        }

        async function renderAllPdfPages() {
            const container = document.getElementById("pdfViewerPages");
            const pdf = currentPdfInstance;
            if (!container || !pdf) return;

            const token = ++currentPdfRenderToken;
            const keepPage = currentPdfPage;
            container.innerHTML = `
                <div class="pdf-viewer-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <span>Đang dựng PDF...</span>
                </div>`;

            const viewer = document.querySelector(".pdf-viewer-scroll");
            const firstPage = await pdf.getPage(1);
            if (token !== currentPdfRenderToken) return;
            const firstBaseViewport = firstPage.getViewport({ scale: 1 });

            const isDesktopViewer = window.matchMedia("(min-width:901px)").matches;
            const viewerWidth = Math.max(240, viewer?.clientWidth || 980);
            const scrollbarReserve = 12;
            const pageHorizontalPadding = 24;
            const availableWidth = Math.max(180, viewerWidth - scrollbarReserve - pageHorizontalPadding);
            const availableHeight = Math.max(240, (viewer?.clientHeight || 720) - 36);

            const fitScaleByWidth = availableWidth / firstBaseViewport.width;
            const fitScaleByHeight = availableHeight / firstBaseViewport.height;
            currentPdfFitScale = Math.max(0.1, Math.min(fitScaleByWidth, fitScaleByHeight));

            const CSS_UNITS = 96 / 72;
            const requestedScale = currentPdfZoom * CSS_UNITS;
            const actualScale = isDesktopViewer
                ? Math.max(0.1, Math.min(requestedScale, fitScaleByWidth))
                : Math.max(0.1, currentPdfFitScale * currentPdfZoom);

            const firstViewport = firstBaseViewport.clone({ scale: actualScale });
            container.innerHTML = "";

            /*
             * Create lightweight page placeholders first. Only pages near the
             * viewport are rendered. This prevents dozens of large canvases
             * from competing for CPU/RAM while the user scrolls.
             */
            for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
                if (token !== currentPdfRenderToken) return;

                const wrap = document.createElement("div");
                wrap.className = "pdf-page-wrap pdf-page-placeholder";
                wrap.dataset.pdfPageWrap = String(pageNumber);
                wrap.dataset.rendered = "";
                wrap.dataset.rendering = "";
                wrap.style.minHeight = `${firstViewport.height + 34}px`;
                wrap.style.aspectRatio = `${firstBaseViewport.width} / ${firstBaseViewport.height}`;

                const canvas = document.createElement("canvas");
                canvas.className = "pdf-page-canvas";
                canvas.dataset.page = String(pageNumber);
                canvas.setAttribute("aria-label", `Trang ${pageNumber}`);

                const pageLabel = document.createElement("div");
                pageLabel.className = "pdf-page-number";
                pageLabel.textContent = `Trang ${pageNumber} / ${pdf.numPages}`;

                wrap.appendChild(canvas);
                wrap.appendChild(pageLabel);
                container.appendChild(wrap);
            }

            currentPdfPage = Math.max(1, Math.min(keepPage, pdf.numPages));
            updatePdfControls();
            setupPdfLazyRendering();

            requestAnimationFrame(() => {
                ensurePdfPageRendered(currentPdfPage);
                scrollToPdfPage(currentPdfPage, "auto");
            });
        }

        async function renderPdfDocument(item) {
            const container = document.getElementById("pdfViewerPages");
            if (!container) return;
            container.innerHTML = `
                <div class="pdf-viewer-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <span>Đang tải tài liệu...</span>
                </div>`;

            try {
                await ensurePdfJs();
                currentPdfInstance = await window.pdfjsLib.getDocument({
                    url: getPublicPdfUrl(item.file_path),
                    disableAutoFetch: false,
                    disableStream: false
                }).promise;
                currentPdfDocument = item;
                currentPdfPage = 1;
                currentPdfZoom = 1;
                updatePdfControls();
                await renderAllPdfPages();
            } catch (error) {
                console.error("PDF render error:", error);
                currentPdfInstance = null;
                container.innerHTML = '<div class="pdf-viewer-loading"><i class="fa-solid fa-triangle-exclamation"></i><span>Không thể hiển thị PDF. Bạn có thể dùng nút Tải xuống.</span></div>';
                updatePdfControls();
            }
        }

        function setDocumentViewerMode(enabled) {
            const section = document.getElementById("documents");
            if (!section) return;
            section.classList.toggle("document-viewer-mode", Boolean(enabled));
        }

        function openPdfViewer(item) {
            if (!window.SiteContent.isVisible("documents")) { ensureVisibleRoute(); return; }
            if (!item?.file_path) return;
            currentDocument = item;
            currentPdfDocument = item;
            currentPdfInstance = null;
            currentPdfPage = 1;
            currentPdfZoom = 1;
            currentPdfRenderToken++;

            setDocumentViewerMode(true);

            const modal = document.getElementById("pdfModal");
            const modalTitle = document.getElementById("pdfModalTitle");
            const download = document.getElementById("pdfDownload");
            const viewer = document.getElementById("pdfViewerPages");
            if (!modal || !modalTitle || !download || !viewer) return;

            modalTitle.textContent = item.title || item.file_name || "Tài liệu";
            download.href = getPublicPdfUrl(item.file_path);
            viewer.innerHTML = `
                <div class="pdf-viewer-loading">
                    <i class="fa-solid fa-spinner fa-spin"></i>
                    <span>Đang tải tài liệu...</span>
                </div>`;

            modal.classList.add("open");
            modal.setAttribute("aria-hidden", "false");
            updatePdfControls();
            renderRelatedDocuments(item);
            trackView(item.id);

            const url = new URL(window.location.href);
            url.searchParams.set("doc", item.id);
            url.hash = "documents";
            window.history.replaceState({}, "", url.toString());

            requestAnimationFrame(() => {
                renderPdfDocument(item);
                modal.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }

        function closePdfViewer() {
            const modal = document.getElementById("pdfModal");
            const viewer = document.getElementById("pdfViewerPages");
            if (!modal) return;
            currentPdfRenderToken++;
            modal.classList.remove("open");
            modal.setAttribute("aria-hidden", "true");
            if (viewer) viewer.innerHTML = "";
            currentPdfInstance = null;
            currentPdfDocument = null;
            currentDocument = null;
            currentPdfPage = 1;
            currentPdfZoom = 1;
            updatePdfControls();
            setDocumentViewerMode(false);

            const url = new URL(window.location.href);
            url.searchParams.delete("doc");
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash || "#documents"}`);
        }

        function bindDocumentCards() {
            const list = document.getElementById("documentList");
            if (!list) return;

            list.querySelectorAll(".document-card-clickable").forEach(card => {
                const open = () => {
                    const item = libraryDocuments.find(doc => Number(doc.id) === Number(card.dataset.documentId));
                    if (item) openPdfViewer(item);
                };

                card.addEventListener("click", event => {
                    if (event.target.closest(".document-card-action")) return;
                    open();
                });

                card.addEventListener("keydown", event => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        open();
                    }
                });

                card.querySelector("[data-open-id]")?.addEventListener("click", event => {
                    event.stopPropagation();
                    open();
                });
            });

            list.querySelectorAll("[data-share-id]").forEach(button => {
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    const item = libraryDocuments.find(doc => Number(doc.id) === Number(button.dataset.shareId));
                    shareDocument(item);
                });
            });

            list.querySelectorAll("[data-qr-id]").forEach(button => {
                button.addEventListener("click", event => {
                    event.stopPropagation();
                    const item = libraryDocuments.find(doc => Number(doc.id) === Number(button.dataset.qrId));
                    openQr(item);
                });
            });

            bindPdfPreviewRendering(list);
        }

        function bindPdfPreviewRendering(container) {
            const renderOne = async preview => {
                const url = preview.dataset.pdfPreview;
                const canvas = preview.querySelector(".document-preview-canvas");
                const loading = preview.querySelector(".document-preview-loading");
                if (!url || !canvas || canvas.dataset.rendered === "1") return;
                canvas.dataset.rendered = "1";
                try {
                    await ensurePdfJs();
                    const task = window.pdfjsLib.getDocument({ url, disableAutoFetch: false, disableStream: false });
                    const pdf = await task.promise;
                    const page = await pdf.getPage(1);
                    const baseViewport = page.getViewport({ scale: 1 });

                    /* Fit the preview frame to the real PDF page ratio. */
                    preview.style.aspectRatio = `${baseViewport.width} / ${baseViewport.height}`;
                    preview.style.height = "auto";

                    /* Read the frame after setting its aspect ratio so the page
                       can be fitted to the actual available area. */
                    const frameWidth = Math.max(1, preview.clientWidth || 220);
                    const frameHeight = Math.max(1, preview.clientHeight || (
                        frameWidth * baseViewport.height / baseViewport.width
                    ));
                    const fitScale = Math.min(
                        frameWidth / baseViewport.width,
                        frameHeight / baseViewport.height
                    );
                    const scale = Math.max(0.1, fitScale);
                    const viewport = page.getViewport({ scale });
                    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
                    canvas.width = Math.ceil(viewport.width * ratio);
                    canvas.height = Math.ceil(viewport.height * ratio);
                    canvas.style.width = `${viewport.width}px`;
                    canvas.style.height = `${viewport.height}px`;
                    canvas.style.maxWidth = "100%";
                    canvas.style.maxHeight = "100%";
                    const ctx = canvas.getContext("2d", { alpha: false });
                    await page.render({
                        canvasContext: ctx,
                        viewport,
                        transform: ratio !== 1 ? [ratio,0,0,ratio,0,0] : null
                    }).promise;
                    if (loading) loading.classList.add("loaded");
                } catch (error) {
                    console.warn("PDF preview failed:", error);
                    if (loading) {
                        loading.querySelector("span").textContent = "Chưa thể xem trước";
                    }
                    canvas.dataset.rendered = "";
                }
            };

            const previews = [...container.querySelectorAll("[data-pdf-preview]")];
            if ("IntersectionObserver" in window) {
                const observer = new IntersectionObserver(entries => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            renderOne(entry.target);
                            observer.unobserve(entry.target);
                        }
                    });
                }, { rootMargin: "250px 0px" });
                previews.forEach(preview => observer.observe(preview));
            } else {
                previews.forEach(renderOne);
            }
        }

        async function loadDocumentLibrary() {
            const status = document.getElementById("documentStatus");
            const empty = document.getElementById("documentEmpty");
            try {
                const [categoriesResponse, documentsResponse] = await Promise.all([
                    supabaseClient.from("math_categories").select("id,name,slug,description,sort_order,parent_id").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
                    supabaseClient.from("math_documents").select("id,title,description,category_id,file_path,file_name,published,sort_order,created_at,updated_at,tags,thumbnail_path,cover_enabled,document_type,exam_year,duration_minutes,view_count,math_categories(name,slug)").eq("published", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false })
                ]);
                if (categoriesResponse.error) throw categoriesResponse.error;
                let finalDocumentsResponse = documentsResponse;
                // Older projects may not have the optional cover columns yet; keep the library usable.
                // Keep the public library usable when an older Supabase schema
                // does not yet contain optional cover columns.  PostgREST can
                // expose this as several different error codes/messages, so
                // retry the known-compatible projection for any select error.
                if (documentsResponse.error) {
                    finalDocumentsResponse = await supabaseClient.from("math_documents").select("id,title,description,category_id,file_path,file_name,published,sort_order,created_at,updated_at,tags,thumbnail_path,document_type,exam_year,duration_minutes,view_count,math_categories(name,slug)").eq("published", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
                }
                if (finalDocumentsResponse.error) {
                    finalDocumentsResponse = await supabaseClient.from("math_documents").select("id,title,description,category_id,file_path,file_name,published,sort_order,created_at,updated_at,tags,document_type,exam_year,duration_minutes,view_count,math_categories(name,slug)").eq("published", true).order("sort_order", { ascending: true }).order("created_at", { ascending: false });
                }
                if (finalDocumentsResponse.error) throw finalDocumentsResponse.error;
                libraryCategories = categoriesResponse.data || [];
                libraryDocuments = finalDocumentsResponse.data || [];
                updatePublicStats();
                const requestCategory = document.getElementById("requestCategory");
                if (requestCategory) {
                    requestCategory.innerHTML = '<option value="">-- Chọn danh mục --</option>' + libraryCategories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
                }
                const contributionCategory = document.getElementById("contributionCategory");
                if (contributionCategory) {
                    contributionCategory.innerHTML = '<option value="">-- Chọn danh mục --</option>' + libraryCategories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("");
                }
                renderDocumentLibrary();
                const currentUrl = new URL(window.location.href);
                const targetId = currentUrl.searchParams.get("doc");
                const categoryId = currentUrl.searchParams.get("category");

                if (targetId) {
                    const target = libraryDocuments.find(doc => String(doc.id) === String(targetId));
                    if (target) {
                        openPdfViewer(target);
                    }
                } else if (categoryId) {
                    const category = libraryCategories.find(c => String(c.id) === String(categoryId));
                    if (category) {
                        setCategoryView(category.id);
                    }
                }
            } catch (error) {
                console.error("Document library error:", error);
                if (status) status.textContent = "Không thể tải thư viện";
                if (empty) {
                    empty.hidden = false;
                    empty.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><h3>Không thể tải tài liệu</h3><p>Vui lòng tải lại trang sau ít phút.</p>';
                }
            }
        }

        document.getElementById("documentSearch")?.addEventListener("input", () => {
            documentCurrentPage = 1;
            renderDocumentLibrary();
        });

        document.getElementById("documentSort")?.addEventListener("change", event => {
            documentSortMode = event.target.value;
            documentCurrentPage = 1;
            renderDocumentLibrary();
        });

        document.getElementById("documentTypeFilter")?.addEventListener("change", event => {
            documentTypeMode = event.target.value;
            documentCurrentPage = 1;
            renderDocumentLibrary();
        });

        document.getElementById("documentBackButton")?.addEventListener("click", goBackToParent);
        document.getElementById("pdfClose")?.addEventListener("click", closePdfViewer);
        document.getElementById("pdfShare")?.addEventListener("click", () => shareDocument(currentDocument));
        document.getElementById("pdfZoomOut")?.addEventListener("click", async () => {
            if (!currentPdfInstance) return;
            const levels = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
            const index = Math.max(0, levels.indexOf(currentPdfZoom) - 1);
            currentPdfZoom = levels[index];
            await renderAllPdfPages();
        });
        document.getElementById("pdfZoomIn")?.addEventListener("click", async () => {
            if (!currentPdfInstance) return;
            const levels = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
            const index = Math.min(levels.length - 1, Math.max(0, levels.indexOf(currentPdfZoom) + 1));
            currentPdfZoom = levels[index];
            await renderAllPdfPages();
        });
        document.getElementById("pdfZoomSelect")?.addEventListener("change", async event => {
            if (!currentPdfInstance) return;
            currentPdfZoom = Number(event.target.value) || 1;
            await renderAllPdfPages();
        });
        document.getElementById("pdfPageInput")?.addEventListener("change", event => {
            scrollToPdfPage(event.target.value);
        });
        document.getElementById("pdfPageInput")?.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                event.preventDefault();
                scrollToPdfPage(event.target.value);
            }
        });
        document.getElementById("pdfPrevPage")?.addEventListener("click", () => scrollToPdfPage(currentPdfPage - 1));
        document.getElementById("pdfNextPage")?.addEventListener("click", () => scrollToPdfPage(currentPdfPage + 1));
        document.getElementById("pdfQr")?.addEventListener("click", () => openQr(currentDocument));
        document.getElementById("qrClose")?.addEventListener("click", closeQr);
        document.getElementById("qrDownload")?.addEventListener("click", downloadQr);
        document.getElementById("pdfModal")?.addEventListener("click", event => { if (event.target === event.currentTarget) closePdfViewer(); });
        document.getElementById("qrModal")?.addEventListener("click", event => { if (event.target === event.currentTarget) closeQr(); });

        const pdfViewerPagesRoot = document.getElementById("pdfViewerPages");
        const pdfPageObserver = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
            if (!currentPdfInstance) return;
            const visible = entries
                .filter(entry => entry.isIntersecting)
                .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
            if (visible?.target?.dataset?.pdfPageWrap) {
                currentPdfPage = Number(visible.target.dataset.pdfPageWrap) || currentPdfPage;
                updatePdfControls();
            }
        }, { threshold: [0.4, 0.6, 0.8] }) : null;
        if (pdfViewerPagesRoot && pdfPageObserver) {
            const observePdfPages = () => {
                pdfPageObserver.disconnect();
                pdfViewerPagesRoot.querySelectorAll("[data-pdf-page-wrap]").forEach(el => pdfPageObserver.observe(el));
            };
            const pdfObserverMutation = new MutationObserver(observePdfPages);
            pdfObserverMutation.observe(pdfViewerPagesRoot, { childList: true });
        }

        document.addEventListener("keydown", event => {
            if (!currentPdfInstance) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); scrollToPdfPage(currentPdfPage - 1); }
            if (event.key === "ArrowRight") { event.preventDefault(); scrollToPdfPage(currentPdfPage + 1); }
        });


        async function notifySiteAdmin(type,payload){
            try{ await supabaseClient.functions.invoke("send-site-notification",{body:{type,payload}}); }catch(error){ console.warn("Không gửi được email thông báo:",error); }
        }
        document.getElementById("openTikzContribution")?.addEventListener("click",()=>{const p=document.getElementById("tikzContributionPanel");p?.removeAttribute("hidden");p?.scrollIntoView({behavior:"smooth",block:"center"});});
        document.getElementById("closeTikzContribution")?.addEventListener("click",()=>document.getElementById("tikzContributionPanel")?.setAttribute("hidden",""));
        document.getElementById("tikzContributionForm")?.addEventListener("submit",async event=>{
            event.preventDefault(); const status=document.getElementById("tikzContributionStatus"); const button=event.target.querySelector("button[type=submit]");
            const payload={title:document.getElementById("contribTitle").value.trim(),author_name:document.getElementById("contribAuthor").value.trim()||null,contact:document.getElementById("contribContact").value.trim()||null,packages:document.getElementById("contribPackages").value.trim()||null,description:document.getElementById("contribDescription").value.trim()||null,code:document.getElementById("contribCode").value.trim(),show_author:document.getElementById("contribShowAuthor").checked,status:"pending"};
            if(!payload.title||!payload.code)return; button.disabled=true; status.textContent="Đang gửi đóng góp...";
            const {error}=await supabaseClient.from("tikz_contributions").insert(payload);
            if(error){console.error(error);status.textContent="Không thể gửi đóng góp. Vui lòng thử lại.";button.disabled=false;return;}
            await notifySiteAdmin("tikz_contribution",payload);
            document.getElementById("tikzContributionPanel").innerHTML='<div class="tikz-contribution-thanks"><i class="fa-solid fa-circle-check"></i><h4>Cảm ơn bạn đã đóng góp!</h4><p>Đóng góp của bạn đã được gửi đến tác giả để kiểm duyệt. Nếu được duyệt, hình vẽ sẽ xuất hiện trong thư viện TikZ/LaTeX.</p><button id="closeContributionThanks" class="tikz-back-button" type="button" style="margin-top:16px">Đóng</button></div>';
            document.getElementById("closeContributionThanks")?.addEventListener("click",()=>document.getElementById("tikzContributionPanel")?.setAttribute("hidden",""));
        });

        document.getElementById("materialRequestForm")?.addEventListener("submit", async event => {
            event.preventDefault();
            const status = document.getElementById("requestStatus");
            const requestText = document.getElementById("requestText").value.trim();
            if (!requestText) return;
            status.textContent = "Đang gửi...";
            const { error } = await supabaseClient.from("math_requests").insert({
                name: document.getElementById("requestName").value.trim() || null,
                email: document.getElementById("requestEmail").value.trim() || null,
                category_id: document.getElementById("requestCategory").value ? Number(document.getElementById("requestCategory").value) : null,
                request_text: requestText,
                status: "pending"
            });
            if (error) {
                status.textContent = "Không thể gửi yêu cầu. Vui lòng thử lại.";
                console.error(error);
                return;
            }
            const requestPayload={name:document.getElementById("requestName").value.trim()||null,email:document.getElementById("requestEmail").value.trim()||null,category_id:document.getElementById("requestCategory").value ? Number(document.getElementById("requestCategory").value) : null,request_text:requestText};
            await notifySiteAdmin("material_request",requestPayload);
            event.target.reset();
            status.textContent = "Đã gửi yêu cầu. Cảm ơn bạn!";
        });

        function contributionFileLabel(file) {
            if (!file) return "";
            const size = file.size >= 1024 * 1024
                ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                : `${Math.ceil(file.size / 1024)} KB`;
            return `${file.name} · ${size}`;
        }

        function contributionStoragePath(file) {
            const base = String(file.name || "tai-lieu.pdf")
                .replace(/\.pdf$/i, "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-zA-Z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .toLowerCase() || "tai-lieu";
            const token = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            return `submissions/${Date.now()}-${token}-${base}.pdf`;
        }

        document.getElementById("contributionFile")?.addEventListener("change", event => {
            const file = event.target.files?.[0];
            document.getElementById("contributionFileName").textContent = contributionFileLabel(file);
        });

        document.getElementById("documentContributionForm")?.addEventListener("submit", async event => {
            event.preventDefault();
            const form = event.currentTarget;
            const status = document.getElementById("contributionStatus");
            const submit = form.querySelector('button[type="submit"]');
            const file = document.getElementById("contributionFile").files?.[0];
            const title = document.getElementById("contributionTitle").value.trim();
            const categoryId = Number(document.getElementById("contributionCategory").value) || null;

            if (!file || !title || !categoryId) return;
            if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== "application/pdf")) {
                status.textContent = "Vui lòng chọn đúng file PDF.";
                return;
            }
            if (file.size > 15 * 1024 * 1024) {
                status.textContent = "File PDF cần nhỏ hơn hoặc bằng 15 MB.";
                return;
            }

            submit.disabled = true;
            status.textContent = "Đang tải PDF lên...";
            const filePath = contributionStoragePath(file);
            try {
                const { error: uploadError } = await supabaseClient.storage
                    .from("document-submissions")
                    .upload(filePath, file, { contentType: "application/pdf", upsert: false });
                if (uploadError) throw uploadError;

                const payload = {
                    title,
                    description: document.getElementById("contributionDescription").value.trim() || null,
                    category_id: categoryId,
                    contributor_name: document.getElementById("contributionName").value.trim() || null,
                    contributor_email: document.getElementById("contributionEmail").value.trim() || null,
                    file_path: filePath,
                    file_name: file.name,
                    file_size: file.size,
                    status: "pending"
                };
                const { error } = await supabaseClient.from("document_contributions").insert(payload);
                if (error) throw error;

                await notifySiteAdmin("document_contribution", payload);
                form.reset();
                document.getElementById("contributionFileName").textContent = "";
                status.textContent = "Đã gửi PDF. Tài liệu sẽ được kiểm duyệt trước khi hiển thị.";
            } catch (error) {
                console.error(error);
                status.textContent = "Không thể gửi PDF. Vui lòng thử lại sau.";
            } finally {
                submit.disabled = false;
            }
        });

        loadDocumentLibrary();

        /* =========================================
           MOBILE MENU
        ========================================= */

        const menuToggle = document.getElementById("menuToggle");
        const mainMenu = document.getElementById("mainMenu");

        function toggleMobileMenu(event) {

            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }

            if (!mainMenu || !menuToggle) {
                return;
            }

            const isOpen =
                mainMenu.classList.toggle("open");

            menuToggle.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

            menuToggle.setAttribute(
                "aria-label",
                isOpen ? "Đóng menu" : "Mở menu"
            );

            const icon =
                menuToggle.querySelector("i");

            if (icon) {
                icon.className =
                    isOpen
                        ? "fa-solid fa-xmark"
                        : "fa-solid fa-bars";
            }
        }

        function closeMenu() {
            if (!mainMenu || !menuToggle) return;

            mainMenu.classList.remove("open");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", "Mở menu");

            const icon = menuToggle.querySelector("i");

            if (icon) {
                icon.className = "fa-solid fa-bars";
            }
        }

        if (menuToggle && mainMenu) {

            /* The button uses the inline toggleMobileMenu handler above. */


            mainMenu
                .querySelectorAll("a")
                .forEach(function (link) {

                    link.addEventListener(
                        "click",
                        closeMenu
                    );

                });

        }


        window.addEventListener(
            "resize",
            function () {

                if (window.innerWidth > 1180) {
                    closeMenu();
                }

            }
        );


        /* =========================================
           HEADER SCROLL STATE
        ========================================== */

        const siteHeader =
            document.getElementById("siteHeader");

        function updateHeader() {

            if (!siteHeader) return;

            siteHeader.classList.toggle(
                "scrolled",
                window.scrollY > 20
            );

        }

        window.addEventListener(
            "scroll",
            updateHeader,
            { passive: true }
        );

        updateHeader();

        document.addEventListener("click", event => {
            if (!siteHeader?.contains(event.target)) closeMenu();
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && mainMenu?.classList.contains("open")) {
                closeMenu();
                menuToggle.focus();
            }
        });


        /* =========================================
           ACTIVE NAVIGATION
        ========================================== */

        const sections =
            document.querySelectorAll("main section[id]");

        const navLinks =
            document.querySelectorAll(".nav-link");

        const sectionObserver =
            new IntersectionObserver(
                function (entries) {

                    entries.forEach(
                        function (entry) {

                            if (!entry.isIntersecting || !window.SiteContent.isVisible(entry.target.id)) {
                                return;
                            }

                            navLinks.forEach(
                                function (link) {

                                    link.classList.remove(
                                        "active"
                                    );

                                    if (
                                        link.getAttribute("href") ===
                                        `#${entry.target.id}`
                                    ) {
                                        link.classList.add(
                                            "active"
                                        );
                                    }

                                }
                            );

                        }
                    );

                },
                {
                    rootMargin:
                        "-30% 0px -55% 0px"
                }
            );


        sections.forEach(
            function (section) {

                sectionObserver.observe(section);

            }
        );


        /* =========================================
           SCROLL REVEAL
        ========================================== */

        const revealElements =
            document.querySelectorAll(".reveal");


        function showAllReveals() {

            revealElements.forEach(
                function (element) {

                    element.classList.add("show");

                }
            );

        }


        if (
            "IntersectionObserver" in window
        ) {

            const revealObserver =
                new IntersectionObserver(
                    function (entries, observer) {

                        entries.forEach(
                            function (entry) {

                                if (
                                    !entry.isIntersecting
                                ) {
                                    return;
                                }

                                entry.target.classList.add(
                                    "show"
                                );

                                observer.unobserve(
                                    entry.target
                                );

                            }
                        );

                    },
                    {
                        threshold: 0.12
                    }
                );


            revealElements.forEach(
                function (element) {

                    revealObserver.observe(element);

                }
            );

        } else {

            showAllReveals();

        }


        /* =========================================
           GALLERY
        ========================================== */

        const galleryData = {
            grade10: [],
            grade12: [],
            feedback: []
        };


        let currentGallery = [];
        let currentImageIndex = 0;

        function openAchievementEvidence(type) {
            const url = new URL("achievements.html", window.location.href);
            url.searchParams.set("type", type);
            window.location.href = url.toString();
        }

        document.querySelectorAll("[data-achievement-evidence]").forEach(card => {
            card.addEventListener("keydown", event => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                openAchievementEvidence(card.dataset.achievementEvidence);
            });
        });


        function openGallery(type) {

            currentGallery =
                galleryData[type] || [];

            currentImageIndex = 0;


            if (!currentGallery.length) {

                alert(
                    "Hiện chưa có hình ảnh cho mục này. " +
                    "Bạn có thể thêm ảnh vào thư mục " +
                    "assets/achievements sau."
                );

                return;

            }


            updateGallery();


            const modal =
                document.getElementById(
                    "galleryModal"
                );


            if (!modal) return;


            modal.classList.add("active");

            modal.setAttribute(
                "aria-hidden",
                "false"
            );

            document.body.style.overflow =
                "hidden";

        }


        function updateGallery() {

            const image =
                document.getElementById(
                    "galleryImage"
                );

            const counter =
                document.getElementById(
                    "galleryCounter"
                );


            if (!image || !counter) {
                return;
            }


            image.src =
                currentGallery[
                    currentImageIndex
                ];


            counter.textContent =
                `${currentImageIndex + 1} / ${currentGallery.length}`;

        }


        function changeImage(direction) {

            if (!currentGallery.length) {
                return;
            }


            currentImageIndex += direction;


            if (
                currentImageIndex < 0
            ) {

                currentImageIndex =
                    currentGallery.length - 1;

            }


            if (
                currentImageIndex >=
                currentGallery.length
            ) {

                currentImageIndex = 0;

            }


            updateGallery();

        }


        function closeGallery(event) {

            const modal =
                document.getElementById(
                    "galleryModal"
                );


            if (!modal) return;


            if (
                event &&
                event.target !== modal
            ) {

                return;

            }


            modal.classList.remove(
                "active"
            );

            modal.setAttribute(
                "aria-hidden",
                "true"
            );

            document.body.style.overflow =
                "";

        }


        document.addEventListener(
            "keydown",
            function (event) {

                const modal =
                    document.getElementById(
                        "galleryModal"
                    );


                if (
                    !modal ||
                    !modal.classList.contains(
                        "active"
                    )
                ) {

                    return;

                }


                if (
                    event.key === "Escape"
                ) {

                    closeGallery();

                }


                if (
                    event.key === "ArrowLeft"
                ) {

                    changeImage(-1);

                }


                if (
                    event.key === "ArrowRight"
                ) {

                    changeImage(1);

                }

            }
        );

    


        /* =========================================
           TIKZ / LATEX DRAWING LIBRARY
        ========================================== */
        const TIKZ_RENDER_ENDPOINT = "https://latex.ytotech.com/builds/sync";
        let tikzDrawings = [];
        let currentTikzDrawing = null;

        function formatTikzDate(value) {
            if (!value) return "";
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return "";
            return new Intl.DateTimeFormat("vi-VN", {day:"2-digit", month:"2-digit", year:"numeric"}).format(d);
        }

        function normalizeTikzCode(code) {
            return String(code || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
        }

        function splitTikzPackages(value) {
            return String(value || "")
                .split(/[\s,;]+/)
                .map(x => x.trim())
                .filter(Boolean)
                .map(x => x.replace(/^\\usepackage(?:\[[^\]]*\])?\{/, "").replace(/\}$/, ""))
                .flatMap(x => x.split(","))
                .map(x => x.trim())
                .filter(Boolean);
        }

        function detectTikzPackages(code) {
            const source = normalizeTikzCode(code);
            const packages = new Set(["tikz"]);
            if (/\\begin\s*\{axis\}|\\addplot|pgfplots/i.test(source)) packages.add("pgfplots");
            if (/\\frac|\\dfrac|\\tfrac|\\begin\s*\{align|\\mathbb|\\text\{/i.test(source)) packages.add("amsmath");
            if (/\\mathbb|\\mathfrak|\\mathcal/i.test(source)) packages.add("amssymb");
            if (/tkz-euclide|\\tkz[A-Za-z]/i.test(source)) packages.add("tkz-euclide");
            if (/circuitikz/i.test(source)) packages.add("circuitikz");
            if (/siunitx|\\qty\{|\\SI\{/i.test(source)) packages.add("siunitx");
            if (/\\definecolor|color=|draw=|fill=/i.test(source)) packages.add("xcolor");
            return [...packages];
        }

        function buildTikzLatex(code, extraPackages = "") {
            const source = normalizeTikzCode(code);
            if (/\\documentclass\b/i.test(source)) return source;

            const packageNames = new Set([
                ...detectTikzPackages(source),
                ...splitTikzPackages(extraPackages)
            ]);
            const packageLines = [...packageNames].map(name => `\\usepackage{${name}}`).join("\n");

            const libraries = [];
            const libraryMatches = [...source.matchAll(/\\usetikzlibrary\s*\{([^}]+)\}/g)];
            libraryMatches.forEach(m => m[1].split(",").map(x => x.trim()).filter(Boolean).forEach(x => libraries.push(x)));
            const uniqueLibraries = [...new Set(libraries)];
            const libraryLine = uniqueLibraries.length ? `\\usetikzlibrary{${uniqueLibraries.join(",")}}` : "";

            const cleaned = source
                .replace(/\\usepackage(?:\[[^\]]*\])?\{[^}]+\}\s*/g, "")
                .replace(/\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*/g, "")
                .replace(/\\begin\s*\{document\}\s*/i, "")
                .replace(/\\end\s*\{document\}\s*/i, "")
                .replace(/\\usetikzlibrary\s*\{[^}]+\}\s*/g, "")
                .trim();

            const body = /\\begin\s*\{tikzpicture\}/i.test(cleaned) || /\\begin\s*\{axis\}/i.test(cleaned)
                ? cleaned
                : `\\begin{tikzpicture}\n${cleaned}\n\\end{tikzpicture}`;

            return `\\documentclass[tikz,border=6pt]{standalone}\n${packageLines}\n${libraryLine}\n\\begin{document}\n${body}\n\\end{document}`;
        }

        async function compileTikzPdf(code, packages = "") {
            const latex = buildTikzLatex(code, packages);
            const response = await fetch(TIKZ_RENDER_ENDPOINT, {
                method: "POST",
                headers: {"Content-Type": "application/json", "Accept": "application/pdf, application/json"},
                body: JSON.stringify({
                    compiler: "pdflatex",
                    resources: [{ main: true, content: latex }],
                    options: {
                        compiler: {
                            bibliography: false,
                            halt_on_error: true,
                            silent: true,
                            force: true
                        },
                        response: { log_files_on_failure: true, commands: false }
                    }
                })
            });

            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            if (!response.ok) {
                let detail = `HTTP ${response.status}`;
                try {
                    const text = await response.text();
                    if (text) {
                        try {
                            const json = JSON.parse(text);
                            detail = json.message || json.error || json.log || text;
                        } catch (_) {
                            detail = text;
                        }
                    }
                } catch (_) {}
                throw new Error(detail);
            }

            if (!contentType.includes("application/pdf")) {
                const text = await response.text();
                let detail = text || "Máy chủ biên dịch không trả về PDF.";
                try {
                    const json = JSON.parse(text);
                    detail = json.message || json.error || json.log || detail;
                } catch (_) {}
                throw new Error(detail);
            }

            return await response.blob();
        }

        async function getCachedTikzPdfUrl(drawing){if(!drawing?.render_path)throw new Error("Hình này chưa có bản render được lưu. Hãy render hình trong trang quản trị trước.");const result=supabaseClient.storage.from("tikz-renders").getPublicUrl(drawing.render_path);const url=result?.data?.publicUrl;if(!url)throw new Error("Không lấy được đường dẫn bản render đã lưu.");return url;}

        async function renderTikzInto(container, drawing) {
            if (!container || !drawing) return;
            container.innerHTML = `<div class="tikz-render-loading"><i class="fa-solid fa-spinner fa-spin"></i><span>Đang tải bản render đã lưu...</span></div>`;
            const status = document.getElementById("tikzRenderStatus");
            if (status) { status.className = "tikz-render-status"; status.textContent = "Đang tải hình đã render từ kho..."; }
            try {
                if(drawing.preview_path){
                    const url=getTikzPublicUrl(drawing.preview_path);
                    if(!url)throw new Error("Không lấy được URL ảnh preview đã lưu.");
                    await renderTikzImagePreview(container,url);
                } else if(drawing.render_path){
                    const url=getTikzPublicUrl(drawing.render_path);
                    if(!url)throw new Error("Không lấy được URL bản render PDF đã lưu.");
                    await renderTikzCachedPdfInto(container,url);
                } else {
                    throw new Error("Hình này chưa có bản render được lưu. Hãy vào trang quản trị và bấm Render.");
                }
                if (status) { status.className="tikz-render-status ok"; status.textContent=`Đã tải bản render đã lưu · ${formatTikzDate(drawing.rendered_at || drawing.created_at)}`; }
                return true;
            } catch(error) {
                console.error("TikZ cached render failed:",error);
                const safeMessage=escapeHtml(error?.message||"Không tải được bản render.");
                container.innerHTML=`<div class="tikz-render-loading"><i class="fa-solid fa-triangle-exclamation"></i><span>Chưa có bản render</span><small style="max-width:520px;line-height:1.6;text-align:center">${safeMessage}</small></div>`;
                if(status){status.className="tikz-render-status error";status.textContent=error?.message||"Không tải được bản render.";}
                return false;
            }
        }

        async function loadTikzDrawings() {
            const status = document.getElementById("tikzStatus");
            try {
                const {data, error} = await supabaseClient
                    .from("tikz_drawings")
                    .select("id,title,description,tags,packages,published,code_unlocked,sort_order,created_at,updated_at,render_path,preview_path,rendered_at,render_error")
                    .eq("published", true)
                    .order("sort_order", {ascending:true})
                    .order("created_at", {ascending:false});
                if (error) throw error;
                tikzDrawings = data || [];
                renderTikzLibrary();
                if (status) status.textContent = `${tikzDrawings.length} hình vẽ`;
                const hash = location.hash || "";
                if (hash.startsWith("#tikz-") && hash !== "#tikz-library") {
                    const id = decodeURIComponent(hash.slice(6));
                    setTimeout(() => openTikzDetail(id, true), 0);
                }
            } catch (error) {
                console.error("TikZ library error:", error);
                tikzDrawings = [];
                renderTikzLibrary();
                if (status) status.textContent = "Chưa kết nối được thư viện hình vẽ";
                const empty = document.getElementById("tikzEmpty");
                if (empty) {
                    empty.hidden = false;
                    empty.querySelector("h3").textContent = "Chưa có dữ liệu thư viện";
                    empty.querySelector("p").textContent = "Hãy tạo bảng tikz_drawings trong Supabase và đăng hình từ trang quản trị.";
                }
            }
        }

        const TIKZ_PAGE_SIZE=8;
let tikzCurrentPage=1;

function getFilteredTikzDrawings() {
            const q = (document.getElementById("tikzSearch")?.value || "").trim().toLowerCase();
            const sort = document.getElementById("tikzSort")?.value || "newest";
            let list = tikzDrawings.filter(d => !q || [d.title,d.description,d.tags].filter(Boolean).join(" ").toLowerCase().includes(q));
            list.sort((a,b) => sort === "oldest" ? new Date(a.created_at)-new Date(b.created_at) : sort === "az" ? String(a.title||"").localeCompare(String(b.title||""),"vi") : new Date(b.created_at)-new Date(a.created_at));
            return list;
        }

        function getTikzPublicUrl(path){
            if(!path) return "";
            const {data}=supabaseClient.storage.from("tikz-renders").getPublicUrl(path);
            return data?.publicUrl || "";
        }

        function renderTikzPagination(total, totalPages){
            const root=document.getElementById("tikzPagination");
            if(!root) return;
            if(totalPages<=1){ root.innerHTML=""; root.hidden=true; return; }
            root.hidden=false;
            const buttons=[];
            buttons.push(`<button type="button" class="${tikzCurrentPage<=1?'is-disabled':''}" data-tikz-page="${tikzCurrentPage-1}" aria-label="Trang trước"><i class="fa-solid fa-chevron-left"></i></button>`);
            const windowSize=7;
            let start=Math.max(1,tikzCurrentPage-Math.floor(windowSize/2));
            let finish=Math.min(totalPages,start+windowSize-1);
            start=Math.max(1,finish-windowSize+1);
            if(start>1){buttons.push(`<button type="button" data-tikz-page="1">1</button>`);if(start>2)buttons.push(`<span class="tikz-page-label">…</span>`);}
            for(let i=start;i<=finish;i++) buttons.push(`<button type="button" data-tikz-page="${i}" class="${i===tikzCurrentPage?'active':''}">${i}</button>`);
            if(finish<totalPages){if(finish<totalPages-1)buttons.push(`<span class="tikz-page-label">…</span>`);buttons.push(`<button type="button" data-tikz-page="${totalPages}">${totalPages}</button>`);}
            buttons.push(`<button type="button" class="${tikzCurrentPage>=totalPages?'is-disabled':''}" data-tikz-page="${tikzCurrentPage+1}" aria-label="Trang sau"><i class="fa-solid fa-chevron-right"></i></button>`);
            buttons.push(`<span class="tikz-page-label">Tới trang <input id="tikzPageJumpInput" type="number" min="1" max="${totalPages}" value="${tikzCurrentPage}"><button type="button" class="tikz-page-jump" data-tikz-jump="1">Đi</button> / ${totalPages}</span>`);
            root.innerHTML=buttons.join("");
            root.querySelectorAll('[data-tikz-page]').forEach(btn=>btn.addEventListener('click',()=>{
                const page=Number(btn.dataset.tikzPage); if(!page||page<1||page>totalPages||page===tikzCurrentPage)return;
                tikzCurrentPage=page; renderTikzLibrary();
                requestAnimationFrame(()=>document.getElementById('tikz-library')?.scrollIntoView({behavior:'auto',block:'start'}));
            }));
            root.querySelector('[data-tikz-jump]')?.addEventListener('click',()=>{
                const input=document.getElementById('tikzPageJumpInput');
                const page=Math.min(totalPages,Math.max(1,Number(input?.value)||1));
                tikzCurrentPage=page; renderTikzLibrary();
                requestAnimationFrame(()=>document.getElementById('tikz-library')?.scrollIntoView({behavior:'auto',block:'start'}));
            });
            root.querySelector('#tikzPageJumpInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')root.querySelector('[data-tikz-jump]')?.click();});
        }

        function renderTikzLibrary() {
            const grid = document.getElementById("tikzGrid");
            const empty = document.getElementById("tikzEmpty");
            if (!grid || !empty) return;
            const list = getFilteredTikzDrawings();
            const totalPages=Math.max(1,Math.ceil(list.length/TIKZ_PAGE_SIZE));
            tikzCurrentPage=Math.min(Math.max(1,tikzCurrentPage),totalPages);
            const start=(tikzCurrentPage-1)*TIKZ_PAGE_SIZE;
            const pageItems=list.slice(start,start+TIKZ_PAGE_SIZE);
            grid.innerHTML = pageItems.map(d => {
                const tags = String(d.tags || "").split(",").map(x=>x.trim()).filter(Boolean).slice(0,5);
                const previewUrl=getTikzPublicUrl(d.preview_path);
                const legacyPdfUrl=getTikzPublicUrl(d.render_path);
                let previewHtml;
                if(previewUrl) {
                    previewHtml=`<div class="tikz-preview-stage" data-tikz-image-preview="${escapeHtml(previewUrl)}"><img class="tikz-preview-source" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(d.title || 'Hình vẽ TikZ')}" loading="lazy"></div>`;
                } else if(legacyPdfUrl) {
                    previewHtml=`<div class="tikz-preview-stage" data-tikz-pdf-preview="${escapeHtml(legacyPdfUrl)}"><div class="tikz-mini-loading"><i class="fa-solid fa-spinner fa-spin"></i><br>Đang chuẩn bị hình đã lưu...</div></div>`;
                } else {
                    previewHtml=`<div class="tikz-mini-loading"><i class="fa-regular fa-image"></i><br>Chưa có bản render</div>`;
                }
                return `<article class="tikz-card" data-tikz-id="${escapeHtml(d.id)}" data-tikz-card-open="${escapeHtml(d.id)}" role="button" tabindex="0" aria-label="Mở ${escapeHtml(d.title || 'Hình vẽ TikZ')}">
                    <div class="tikz-card-render" data-tikz-mini-render="${escapeHtml(d.id)}">${previewHtml}</div>
                    <div class="tikz-card-body">
                        <h3 class="tikz-card-title">${escapeHtml(d.title || "Hình vẽ TikZ")}</h3>
                        <p class="tikz-card-description">${escapeHtml(d.description || "Hình vẽ TikZ/LaTeX.")}</p>
                        <div class="tikz-card-meta">${tags.map(t=>`<span class="tikz-tag">${escapeHtml(t)}</span>`).join("")}</div>
                        <div class="tikz-card-footer"><span class="tikz-date"><i class="fa-regular fa-calendar"></i> ${formatTikzDate(d.created_at)}</span><button class="tikz-open-button" type="button" data-tikz-detail="${escapeHtml(d.id)}">Xem chi tiết <i class="fa-solid fa-arrow-right"></i></button></div>
                    </div>
                </article>`;
            }).join("");
            empty.hidden = list.length > 0;
            grid.hidden = list.length === 0;
            renderTikzPagination(list.length,totalPages);
            grid.querySelectorAll("[data-tikz-detail]").forEach(btn => btn.addEventListener("click", (event) => { event.stopPropagation(); openTikzDetail(btn.dataset.tikzDetail); }));
            grid.querySelectorAll("[data-tikz-card-open]").forEach(card => {
                card.addEventListener("click", () => openTikzDetail(card.dataset.tikzCardOpen));
                card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " " ) { event.preventDefault(); openTikzDetail(card.dataset.tikzCardOpen); } });
            });
            requestAnimationFrame(renderVisibleTikzCardPreviews);
        }

        async function waitForImage(img){
            if (img.complete && img.naturalWidth) return;
            await new Promise((resolve,reject)=>{
                const onLoad=()=>{cleanup();resolve();};
                const onError=()=>{cleanup();reject(new Error("Không tải được ảnh preview đã lưu."));};
                const cleanup=()=>{img.removeEventListener("load",onLoad);img.removeEventListener("error",onError);};
                img.addEventListener("load",onLoad,{once:true});
                img.addEventListener("error",onError,{once:true});
            });
        }

        function getVisibleContentBounds(ctx,w,h){
            const sampleMax=900;
            const scale=Math.min(1,sampleMax/Math.max(w,h));
            const sw=Math.max(1,Math.round(w*scale)), sh=Math.max(1,Math.round(h*scale));
            if(sw!==w || sh!==h){
                const probe=document.createElement("canvas");
                probe.width=sw; probe.height=sh;
                const pctx=probe.getContext("2d",{willReadFrequently:true});
                pctx.drawImage(ctx.canvas,0,0,sw,sh);
                ctx=pctx; w=sw; h=sh;
            }
            const data=ctx.getImageData(0,0,w,h).data;
            let minX=w,minY=h,maxX=-1,maxY=-1;
            const step=2;
            for(let y=0;y<h;y+=step){
                for(let x=0;x<w;x+=step){
                    const i=(y*w+x)*4;
                    const a=data[i+3];
                    if(a<12) continue;
                    const r=data[i],g=data[i+1],b=data[i+2];
                    const notBackground = !(r>247 && g>247 && b>247);
                    if(notBackground){
                        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
                    }
                }
            }
            if(maxX<0) return null;
            const inv=1/scale;
            return {
                x:Math.max(0,Math.floor(minX*inv)),
                y:Math.max(0,Math.floor(minY*inv)),
                width:Math.min(w*inv,Math.ceil((maxX-minX+1)*inv)),
                height:Math.min(h*inv,Math.ceil((maxY-minY+1)*inv))
            };
        }

        function fitRasterCanvas(container, sourceCanvas){
            if(!container)return;
            const maxW=Math.max(120,container.clientWidth-12);
            const maxH=Math.max(120,container.clientHeight-12);
            const bounds=getVisibleContentBounds(sourceCanvas.getContext("2d",{willReadFrequently:true}),sourceCanvas.width,sourceCanvas.height) || {x:0,y:0,width:sourceCanvas.width,height:sourceCanvas.height};
            const margin=0.015;
            const cropW=Math.max(1,bounds.width), cropH=Math.max(1,bounds.height);
            const usableW=maxW*(1-margin), usableH=maxH*(1-margin);
            const scale=Math.max(0.08,Math.min(usableW/cropW,usableH/cropH));
            const cssW=Math.max(1,Math.round(cropW*scale));
            const cssH=Math.max(1,Math.round(cropH*scale));
            const ratio=Math.min(Math.max(window.devicePixelRatio||1,1),2);
            const out=document.createElement("canvas");
            out.className="tikz-fit-canvas";
            out.width=Math.ceil(cssW*ratio);
            out.height=Math.ceil(cssH*ratio);
            out.style.width=`${cssW}px`;
            out.style.height=`${cssH}px`;
            const octx=out.getContext("2d",{alpha:false});
            octx.fillStyle="#fff";
            octx.fillRect(0,0,out.width,out.height);
            octx.setTransform(ratio*scale,0,0,ratio*scale, -bounds.x*ratio*scale, -bounds.y*ratio*scale);
            octx.drawImage(sourceCanvas,0,0);
            container.innerHTML="";
            container.appendChild(out);
        }

        async function renderTikzImagePreview(container,url){
            const img=new Image();
            img.decoding="async";
            img.src=url;
            await waitForImage(img);
            const maxW=Math.min(img.naturalWidth,1600);
            const scale=maxW/img.naturalWidth;
            const source=document.createElement("canvas");
            source.width=Math.max(1,Math.round(img.naturalWidth*scale));
            source.height=Math.max(1,Math.round(img.naturalHeight*scale));
            const ctx=source.getContext("2d",{alpha:true,willReadFrequently:true});
            ctx.drawImage(img,0,0,source.width,source.height);
            fitRasterCanvas(container,source);
        }

        async function renderTikzCachedPdfInto(container,url){
            await ensurePdfJs();
            const pdf=await window.pdfjsLib.getDocument({url,disableAutoFetch:false,disableStream:false}).promise;
            try{
                const page=await pdf.getPage(1);
                const base=page.getViewport({scale:1});
                const sourceScale=Math.min(2,Math.max(1.25,1200/base.width));
                const viewport=page.getViewport({scale:sourceScale});
                const source=document.createElement("canvas");
                source.width=Math.ceil(viewport.width);
                source.height=Math.ceil(viewport.height);
                const ctx=source.getContext("2d",{alpha:false,willReadFrequently:true});
                ctx.fillStyle="#fff";ctx.fillRect(0,0,source.width,source.height);
                await page.render({canvasContext:ctx,viewport}).promise;
                fitRasterCanvas(container,source);
            } finally { try{await pdf.destroy();}catch(_){} }
        }

        async function renderTikzCardPreview(container,drawing){
            try{
                if(drawing.preview_path){
                    const url=getTikzPublicUrl(drawing.preview_path);
                    if(!url)throw new Error("Không lấy được URL ảnh preview đã lưu.");
                    await renderTikzImagePreview(container,url);
                    return;
                }
                if(drawing.render_path){
                    const url=getTikzPublicUrl(drawing.render_path);
                    if(!url)throw new Error("Không lấy được URL bản render PDF đã lưu.");
                    await renderTikzCachedPdfInto(container,url);
                    return;
                }
                throw new Error("Chưa có bản render được lưu.");
            }catch(e){
                console.error("TikZ cached preview failed:",e);
                container.innerHTML=`<div class="tikz-mini-loading"><i class="fa-solid fa-triangle-exclamation"></i><br>Chưa có bản render<br><small style="opacity:.75">Hãy render hình trong trang quản trị.</small></div>`;
            }
        }

        function renderVisibleTikzCardPreviews(){
            const grid=document.getElementById("tikzGrid");
            if(!grid)return;
            grid.querySelectorAll("[data-tikz-image-preview]").forEach(stage=>{
                if(stage.dataset.done==="1")return;
                stage.dataset.done="1";
                const url=stage.dataset.tikzImagePreview;
                renderTikzImagePreview(stage,url).catch(e=>{console.error(e);stage.innerHTML='<div class="tikz-mini-loading"><i class="fa-solid fa-triangle-exclamation"></i><br>Không tải được preview</div>';});
            });
            grid.querySelectorAll("[data-tikz-pdf-preview]").forEach(stage=>{
                if(stage.dataset.done==="1")return;
                stage.dataset.done="1";
                const url=stage.dataset.tikzPdfPreview;
                renderTikzCachedPdfInto(stage,url).catch(e=>{console.error(e);stage.innerHTML='<div class="tikz-mini-loading"><i class="fa-solid fa-triangle-exclamation"></i><br>Không tải được bản render</div>';});
            });
        }

        function resetDocumentNavigationState(){
            activeDocumentCategoryId = null;
            documentCurrentPage = 1;
            const search = document.getElementById("documentSearch");
            if(search){
                search.value = "";
                search.placeholder = "Tìm danh mục hoặc tài liệu...";
            }
            const sort = document.getElementById("documentSortMode");
            if(sort) sort.value = "newest";
            const type = document.getElementById("documentTypeFilter");
            if(type) type.value = "all";
            documentSortMode = "newest";
            documentTypeMode = "all";
            closePdfViewer();
            renderDocumentLibrary();
        }

        function navigateFromMainTaskbar(target, replace = false){
            let hash = target === "tikz" ? "#tikz-library" : target.startsWith("#") ? target : `#${target}`;
            const section = window.SiteContent.sectionForHash(hash);
            if (section && !window.SiteContent.isVisible(section)) hash = `#${window.SiteContent.firstVisible() || ""}`;
            if(hash === "#tikz-library") { openTikzLibrary(); return; }
            // Always leave document/category/PDF detail state when using the main navigation.
            resetDocumentNavigationState();
            // Leaving the TikZ library/detail view must restore the normal one-page website.
            document.body.classList.remove("tikz-library-mode","tikz-detail-mode");
            document.getElementById("tikz-library")?.setAttribute("hidden", "");
            document.getElementById("tikzDetail")?.setAttribute("hidden", "");
            currentTikzDrawing = null;
            const destination = new URL(location.href);
            destination.searchParams.delete("doc");
            destination.searchParams.delete("category");
            destination.hash = hash;
            history[replace ? "replaceState" : "pushState"](null,"",destination);
            requestAnimationFrame(()=>{
                const el=hash.length > 1 ? document.getElementById(decodeURIComponent(hash.slice(1))) : null;
                if(el) el.scrollIntoView({behavior:"auto",block:"start"});
                else window.scrollTo({top:0,behavior:"auto"});
            });
        }

        function ensureVisibleRoute() {
            const api = window.SiteContent;
            const url = new URL(location.href);
            const target = api.sectionForHash(url.hash);
            const hiddenDocuments = !api.isVisible("documents") && (url.searchParams.has("doc") || url.searchParams.has("category"));
            const hiddenTikz = !api.isVisible("tikz-library") && document.body.classList.contains("tikz-library-mode");
            if ((target && !api.isVisible(target)) || (!url.hash && !api.isVisible("home")) || hiddenDocuments || hiddenTikz) {
                navigateFromMainTaskbar(`#${api.firstVisible() || ""}`, true);
                return true;
            }
            return false;
        }
        document.addEventListener("site-content-visibility-change", ensureVisibleRoute);
        window.addEventListener("hashchange", ensureVisibleRoute);

        document.querySelector('.logo')?.addEventListener('click',event=>{
            event.preventDefault();
            navigateFromMainTaskbar(event.currentTarget.getAttribute("href") || "#home");
        });

        document.querySelectorAll("[data-main-nav]").forEach(link=>link.addEventListener("click",event=>{
            event.preventDefault();
            const target=link.dataset.mainNav;
            if(target === "tikz") navigateFromMainTaskbar("tikz");
        }));

        // Normal navigation links must also work while the TikZ detail page is open.
        document.querySelectorAll(".nav-link:not([data-main-nav])").forEach(link=>link.addEventListener("click",event=>{
            const href=link.getAttribute("href")||"";
            if(!href.startsWith("#")) return;
            event.preventDefault();
            navigateFromMainTaskbar(href);
        }));

        function openTikzLibrary() {
            if (!window.SiteContent.isVisible("tikz-library")) { navigateFromMainTaskbar(`#${window.SiteContent.firstVisible() || ""}`, true); return; }
            document.body.classList.add("tikz-library-mode");
            document.body.classList.remove("tikz-detail-mode");
            currentTikzDrawing = null;
            document.getElementById("tikz-library")?.removeAttribute("hidden");
            document.getElementById("tikzDetail")?.setAttribute("hidden", "");
            document.getElementById("tikzGrid")?.removeAttribute("hidden");
            document.getElementById("tikzEmpty")?.setAttribute("hidden", "");
            ["tikzPagination", "tikzViewTitle"].forEach(id => document.getElementById(id)?.removeAttribute("hidden"));
            document.querySelectorAll("#tikz-library .tikz-library-intro,#tikz-library .tikz-library-toolbar,#tikz-library .tikz-library-heading").forEach(element => element.removeAttribute("hidden"));
            window.scrollTo({top:0,behavior:"auto"});
            loadTikzDrawings();
            const previousHash = location.hash || "";
            const destination = new URL(location.href);
            destination.searchParams.delete("doc");
            destination.searchParams.delete("category");
            destination.hash = "tikz-library";
            if (previousHash !== "#tikz-library") {
                history.pushState({tikzLibrary:true,from:previousHash || "#projects"},"",destination);
            } else {
                history.replaceState(null,"",destination);
            }
        }

        function closeTikzLibrary() {
            navigateFromMainTaskbar("#projects", true);
        }

        async function openTikzDetail(id, fromHistory = false) {
            if (!window.SiteContent.isVisible("tikz-library")) { ensureVisibleRoute(); return; }
            const drawing = tikzDrawings.find(d => String(d.id) === String(id));
            if (!drawing) return;
            currentTikzDrawing = drawing;
            if (!fromHistory) {
                const destination = new URL(location.href);
                destination.hash = `tikz-${encodeURIComponent(drawing.id)}`;
                history.pushState({tikzDetail:String(drawing.id)}, "", destination);
            }
            document.body.classList.add("tikz-detail-mode");
            ["tikzGrid","tikzEmpty","tikzPagination","tikzViewTitle"].forEach(id=>document.getElementById(id)?.setAttribute("hidden",""));
            document.querySelectorAll("#tikz-library .tikz-library-intro,#tikz-library .tikz-library-toolbar,#tikz-library .tikz-library-heading").forEach(el=>el.setAttribute("hidden",""));
            document.getElementById("tikzDetail")?.removeAttribute("hidden");
            document.getElementById("tikzDetailTitle").textContent = drawing.title || "Hình vẽ TikZ";
            document.getElementById("tikzDetailDescription").textContent = drawing.description || "";
            const tags = String(drawing.tags||"").split(",").map(x=>x.trim()).filter(Boolean);
            document.getElementById("tikzDetailMeta").innerHTML = `<span><i class="fa-regular fa-calendar"></i> Ngày đăng: ${escapeHtml(formatTikzDate(drawing.created_at))}</span>${tags.map(t=>`<span class="tikz-tag">${escapeHtml(t)}</span>`).join("")}`;
            const packages = drawing.packages || "Các package cần thiết đã được dùng khi render";
            document.getElementById("tikzPackageInfo").textContent = `Package: ${packages}`;
            const codeBlock = document.getElementById("tikzCodeBlock");
            if (drawing.code_unlocked) {
                codeBlock.className = "tikz-code-block";
                codeBlock.setAttribute("aria-label","Code TikZ");
                codeBlock.textContent = "Đang tải code...";
                try {
                    const {data:codeRow,error:codeError}=await supabaseClient.from("tikz_drawings").select("code").eq("id",drawing.id).eq("published",true).eq("code_unlocked",true).single();
                    if(codeError) throw codeError;
                    codeBlock.textContent = codeRow?.code || "Chưa có code.";
                    const head = codeBlock.closest(".tikz-code-panel")?.querySelector(".tikz-panel-head");
                    if(head && !head.querySelector("[data-tikz-copy]")) {
                        const btn=document.createElement("button"); btn.className="tikz-copy-button"; btn.type="button"; btn.dataset.tikzCopy=""; btn.innerHTML='<i class="fa-regular fa-copy"></i> Sao chép code';
                        btn.addEventListener("click",()=>navigator.clipboard.writeText(codeBlock.textContent||"").then(()=>btn.innerHTML='<i class="fa-solid fa-check"></i> Đã sao chép').catch(()=>{}));
                        head.appendChild(btn);
                    }
                } catch (e) { codeBlock.textContent = "Không tải được code TikZ."; }
            } else {
                const oldCopy = codeBlock.closest(".tikz-code-panel")?.querySelector("[data-tikz-copy]");
                if (oldCopy) oldCopy.remove();
                codeBlock.className = "tikz-code-protected";
                codeBlock.setAttribute("aria-label","Code TikZ được bảo vệ");
                codeBlock.innerHTML = '<div class="tikz-code-protected-overlay"><div class="tikz-code-lock"><i class="fa-solid fa-lock"></i></div><h4>Code TikZ được bảo vệ</h4><p>Muốn nhận code TikZ của hình vẽ này, vui lòng liên hệ tác giả.</p><div class="tikz-contact-actions"><a class="tikz-contact-button facebook" href="https://www.facebook.com/mendz1103" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-facebook-f"></i> Facebook</a><a class="tikz-contact-button zalo" href="https://zalo.me/0905957716" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-comment-dots"></i> Zalo: 0905957716</a></div></div>';
            }
            await renderTikzInto(document.getElementById("tikzRenderBox"), drawing);
            window.scrollTo({top:0,behavior:"auto"});
        }

        document.querySelectorAll("[data-tikz-open]").forEach(card => {
            card.addEventListener("click", openTikzLibrary);
            card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTikzLibrary(); } });
        });
        document.getElementById("tikzBackButton")?.addEventListener("click", closeTikzLibrary);
        document.getElementById("tikzDetailBack")?.addEventListener("click", () => {
            document.body.classList.remove("tikz-detail-mode");
            document.getElementById("tikzDetail")?.setAttribute("hidden","");
            document.getElementById("tikzGrid")?.removeAttribute("hidden");
            document.getElementById("tikzEmpty")?.removeAttribute("hidden");
            document.getElementById("tikzPagination")?.removeAttribute("hidden");
            document.querySelectorAll("#tikz-library .tikz-library-intro,#tikz-library .tikz-library-toolbar,#tikz-library .tikz-library-heading").forEach(el=>el.removeAttribute("hidden"));
            history.replaceState(null,"",`${location.pathname}#tikz-library`);
            window.scrollTo({top:0,behavior:"auto"});
        });
        window.addEventListener("popstate", () => {
            if (ensureVisibleRoute()) return;
            const hash = location.hash || "";
            if (hash.startsWith("#tikz-") && hash !== "#tikz-library") {
                const id = decodeURIComponent(hash.slice(6));
                if (tikzDrawings.length) openTikzDetail(id, true);
            } else if (hash === "#tikz-library") {
                document.body.classList.remove("tikz-detail-mode");
                document.getElementById("tikzDetail")?.setAttribute("hidden","");
                document.getElementById("tikzGrid")?.removeAttribute("hidden");
                document.getElementById("tikzEmpty")?.removeAttribute("hidden");
                document.getElementById("tikzPagination")?.removeAttribute("hidden");
                document.querySelectorAll("#tikz-library .tikz-library-intro,#tikz-library .tikz-library-toolbar,#tikz-library .tikz-library-heading").forEach(el=>el.removeAttribute("hidden"));
            }
        });
        document.getElementById("tikzSearch")?.addEventListener("input", ()=>{tikzCurrentPage=1;renderTikzLibrary();});
        document.getElementById("tikzSort")?.addEventListener("change", ()=>{tikzCurrentPage=1;renderTikzLibrary();});
        if (location.hash === "#tikz-library") setTimeout(openTikzLibrary, 50);


        /* =========================================
           TYPING EFFECT
        ========================================== */

        const typingRole =
            document.getElementById("typingRole");

        const typingPhrases = [
            "GIÁO VIÊN TOÁN",
            "GIÁO VIÊN TOÁN • AI",
            "GIÁO VIÊN TOÁN • CÔNG NGHỆ"
        ];

        let typingPhraseIndex = 0;
        let typingCharIndex = typingPhrases[0].length;
        let typingDeleting = false;

        function runTypingEffect() {

            if (!typingRole) {
                return;
            }

            const currentPhrase =
                typingPhrases[typingPhraseIndex];

            if (!typingDeleting) {
                typingCharIndex++;

                typingRole.textContent =
                    currentPhrase.slice(0, typingCharIndex);

                if (typingCharIndex >= currentPhrase.length) {
                    typingDeleting = true;
                    setTimeout(runTypingEffect, 1700);
                    return;
                }

                setTimeout(runTypingEffect, 75);
                return;
            }

            typingCharIndex--;

            typingRole.textContent =
                currentPhrase.slice(0, typingCharIndex);

            if (typingCharIndex <= 0) {
                typingDeleting = false;
                typingPhraseIndex =
                    (typingPhraseIndex + 1) % typingPhrases.length;

                setTimeout(runTypingEffect, 350);
                return;
            }

            setTimeout(runTypingEffect, 45);
        }

        setTimeout(function () {
            typingCharIndex = 0;
            typingDeleting = false;
            runTypingEffect();
        }, 1400);


        /* =========================================
           MOUSE GLOW
        ========================================== */

        const finePointer =
            window.matchMedia("(pointer: fine)").matches;


        /* =========================================
           TILT CARDS (Handled globally by liquid-glass.js)
        ========================================== */


