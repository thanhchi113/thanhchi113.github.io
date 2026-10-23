(() => {
    "use strict";
    const selector = [
        ".about-content",
        ".highlight-item",
        ".skill-item",
        ".project-card",
        ".achievement-card",
        ".achievement-card-large",
        ".document-category-card",
        ".document-card",
        ".document-public-stat",
        ".tikz-card",
        ".tikz-contribution-card",
        ".tikz-code-panel",
        ".tikz-render-panel",
        ".evidence-card",
        ".exam-student-card",
        ".exam-metric",
        ".exam-chart",
        ".exam-filter-row",
        ".material-request-card",
        ".score-submission-box",
        ".score-submission-invite",
        ".pdf-related-card",
        ".contact-item",
        ".contact-qr-panel",
        ".contact-direction",
        ".evidence-empty",
        ".document-empty",
        ".tikz-empty",
        ".account-card",
        ".password-recovery-card",
        ".admin-card",
        ".stat-box",
        ".admin-doc",
        ".review-item"
    ].join(",");

    let cursorGlow = null;

    function ensureCursorGlow() {
        if (!document.body) return null;
        if (cursorGlow && cursorGlow.isConnected) return cursorGlow;
        cursorGlow = document.getElementById("cursorGlow");
        if (!cursorGlow) {
            cursorGlow = document.createElement("div");
            cursorGlow.id = "cursorGlow";
            cursorGlow.className = "cursor-glow";
            cursorGlow.setAttribute("aria-hidden", "true");
        }
        if (cursorGlow.parentElement !== document.body || cursorGlow !== document.body.lastElementChild) {
            document.body.append(cursorGlow);
        }
        return cursorGlow;
    }

    function mount(root) {
        if (!root || root.nodeType !== 1) return;
        ensureCursorGlow();
        const isAdmin = Boolean(root.closest?.(".admin-page") || document.querySelector(".admin-page"));
        const cards = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
        for (const card of cards) {
            card.classList.add("liquid-glass-card");
            if (!isAdmin && !card.closest(".admin-page")) {
                card.classList.add("tilt-card");
            }
            if (card.querySelector(":scope > .liquid-glass-rim")) continue;
            const rim = document.createElement("span");
            rim.className = "liquid-glass-rim";
            rim.setAttribute("aria-hidden", "true");
            card.append(rim);
        }
    }

    if (document.body) mount(document.body);
    else document.addEventListener("DOMContentLoaded", () => mount(document.body), { once: true });

    // Library pagination, category switches, and galleries replace cards after initial page load.
    const observeTarget = document.body || document.documentElement;
    new MutationObserver(records => {
        for (const record of records) record.addedNodes.forEach(mount);
    }).observe(observeTarget, { childList: true, subtree: true });

    const pointer = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 761px)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let active = null, frame = 0, x = 0, y = 0;

    function isMotionDisabled() {
        const root = document.documentElement;
        return reduced.matches || root.dataset.motion === "reduced" || root.dataset.siteMotionRunning === "false";
    }

    function resetCard(card) {
        if (!card) return;
        card.style.removeProperty("--glass-x");
        card.style.removeProperty("--glass-y");
        card.style.setProperty("--spot-x", "50%");
        card.style.setProperty("--spot-y", "50%");
        card.style.setProperty("--tilt-x", "0deg");
        card.style.setProperty("--tilt-y", "0deg");
        delete card.dataset.cardHover;
    }

    function clear() {
        cancelAnimationFrame(frame);
        frame = 0;
        if (active) resetCard(active);
        active = null;
        if (cursorGlow) {
            delete cursorGlow.dataset.active;
        }
    }

    function handleMove(event) {
        if (event.pointerType === "touch") {
            if (active || cursorGlow?.dataset.active) clear();
            return;
        }
        const target = event.target && event.target.nodeType === 1 ? event.target : null;
        const card = target ? target.closest(".liquid-glass-card,.tilt-card,.hero-about-button") : null;
        if (card !== active) {
            if (active) resetCard(active);
            active = card;
        }
        x = event.clientX;
        y = event.clientY;
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            const glow = ensureCursorGlow();
            if (glow) {
                glow.style.transform = `translate3d(${(x - 210).toFixed(1)}px, ${(y - 210).toFixed(1)}px, 0)`;
                glow.dataset.active = "true";
            }
            if (!active?.isConnected) {
                active = null;
                return;
            }
            const rect = active.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const nx = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
            const ny = Math.max(0, Math.min(1, (y - rect.top) / rect.height));
            const cx = nx - 0.5;
            const cy = ny - 0.5;
            const pctX = `${(nx * 100).toFixed(1)}%`;
            const pctY = `${(ny * 100).toFixed(1)}%`;
            const disableTilt = Boolean(active.closest(".admin-page")) || isMotionDisabled();
            active.style.setProperty("--glass-x", pctX);
            active.style.setProperty("--glass-y", pctY);
            active.style.setProperty("--spot-x", pctX);
            active.style.setProperty("--spot-y", pctY);
            active.style.setProperty("--tilt-x", disableTilt ? "0deg" : `${(cy * -4).toFixed(2)}deg`);
            active.style.setProperty("--tilt-y", disableTilt ? "0deg" : `${(cx * 4).toFixed(2)}deg`);
            active.dataset.cardHover = "true";
        });
    }

    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("mousemove", handleMove, { passive: true });

    document.documentElement.addEventListener("pointerleave", clear);
    document.addEventListener("visibilitychange", () => { if (document.hidden) clear(); });
    window.addEventListener("blur", clear);
    window.addEventListener("pagehide", clear);
    window.addEventListener("site-motion-change", clear);
    pointer.addEventListener("change", clear);
    reduced.addEventListener("change", clear);
})();
