(function () {
    "use strict";
    if (!("IntersectionObserver" in window)) return;
    const selector = ".category-card-illustration,.exam-score-paper,.avatar-wrapper,.hero-text,.contact-direction";
    const observed = new Set();
    const observer = new IntersectionObserver(entries => {
        for (const entry of entries) entry.target.classList.toggle("motion-offscreen", !entry.isIntersecting);
    }, { rootMargin: "80px 0px" });
    function visit(root, add) {
        if (root.nodeType !== 1) return;
        const targets = [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
        for (const target of targets) {
            if (add && !observed.has(target)) {
                observed.add(target);
                target.classList.add("motion-offscreen");
                observer.observe(target);
            } else if (!add && observed.delete(target)) observer.unobserve(target);
        }
    }
    visit(document.body, true);
    const mutations = new MutationObserver(records => {
        for (const record of records) {
            record.removedNodes.forEach(node => visit(node, false));
            record.addedNodes.forEach(node => visit(node, true));
        }
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    function visibility() { document.documentElement.dataset.pageHidden = String(document.hidden); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", () => { document.documentElement.dataset.pageHidden = "true"; });
    window.addEventListener("pageshow", visibility);
    visibility();
}());
