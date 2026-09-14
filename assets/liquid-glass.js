(() => {
    "use strict";
    const selector = ".about-content,.highlight-item,.skill-item,.project-card,.achievement-card,.achievement-card-large,.document-card,.tikz-card,.evidence-card,.exam-student-card,.material-request-card,.score-submission-box,.tikz-contribution-card,.pdf-related-card,.exam-chart";
    function mount(root) {
        if (root.nodeType !== 1) return;
        const cards = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
        for (const card of cards) {
            card.classList.add("liquid-glass-card");
            if (card.querySelector(":scope > .liquid-glass-rim")) continue;
            const rim = document.createElement("span");
            rim.className = "liquid-glass-rim";
            rim.setAttribute("aria-hidden", "true");
            card.append(rim);
        }
    }
    mount(document.body);
    // Library pagination and the gallery replace cards after initial page load.
    new MutationObserver(records => {
        for (const record of records) record.addedNodes.forEach(mount);
    }).observe(document.body, { childList: true, subtree: true });

    const pointer = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 761px)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let active = null, frame = 0, x = 0, y = 0;
    function clear() {
        cancelAnimationFrame(frame);
        frame = 0;
        if (active) {
            active.style.removeProperty("--glass-x");
            active.style.removeProperty("--glass-y");
        }
        active = null;
    }
    document.addEventListener("pointermove", event => {
        if (!pointer.matches || reduced.matches || event.pointerType === "touch") return;
        const card = event.target.closest(".liquid-glass-card");
        if (card !== active) { clear(); active = card; }
        if (!active) return;
        x = event.clientX; y = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            if (!active?.isConnected) { clear(); return; }
            const rect = active.getBoundingClientRect();
            active.style.setProperty("--glass-x", `${Math.max(0, Math.min(100, (x - rect.left) / rect.width * 100)).toFixed(1)}%`);
            active.style.setProperty("--glass-y", `${Math.max(0, Math.min(100, (y - rect.top) / rect.height * 100)).toFixed(1)}%`);
        });
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", clear);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
    window.addEventListener("blur", clear);
    window.addEventListener("pagehide", clear);
    pointer.addEventListener("change", clear);
    reduced.addEventListener("change", clear);
})();
