(() => {
    "use strict";
    const header = document.getElementById("siteHeader");
    const menu = header?.querySelector("#mainMenu");
    if (!menu) return;
    const nav = menu.closest("nav");
    // Keep the homepage sections in the same visual order as the primary bar.
    // Skills belongs with the About section, while the remaining sections map
    // one-to-one to the eight public navigation items.
    const main = document.querySelector("main");
    if (main && main.querySelector("#home")) {
        ["home", "about", "skills", "achievements", "documents", "projects", "tikz-library", "material-request", "contact"]
            .map(id => document.getElementById(id))
            .filter(Boolean)
            .forEach(section => main.appendChild(section));
    }
    const indicator = document.createElement("span");
    indicator.className = "site-nav-indicator";
    indicator.setAttribute("aria-hidden", "true");
    nav.append(indicator);
    header.dataset.navReady = "true";
    const desktop = matchMedia("(min-width: 1181px)");
    let hovered = null, frame = 0;
    const visible = link => link && menu.contains(link) && link.getClientRects().length > 0;
    function render() {
        frame = 0;
        const focused = menu.querySelector(".nav-link:focus-visible");
        const active = Array.from(menu.querySelectorAll(".nav-link.active")).find(visible);
        const target = visible(hovered) ? hovered : visible(focused) ? focused : active;
        indicator.dataset.visible = String(desktop.matches && !!target);
        if (!desktop.matches || !target) return;
        const rect = target.getBoundingClientRect(), origin = nav.getBoundingClientRect();
        indicator.style.width = `${rect.width}px`;
        indicator.style.height = `${rect.height}px`;
        indicator.style.transform = `translate3d(${rect.left - origin.left}px,${rect.top - origin.top}px,0)`;
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(render); }
    menu.addEventListener("pointerover", event => {
        if (event.pointerType === "touch") return;
        hovered = event.target.closest(".nav-link");
        schedule();
    });
    menu.addEventListener("pointerleave", () => { hovered = null; schedule(); });
    menu.addEventListener("focusin", () => { hovered = null; schedule(); });
    menu.addEventListener("focusout", schedule);
    new MutationObserver(schedule).observe(menu, {
        subtree: true, attributes: true, attributeFilter: ["class", "hidden", "data-site-link-hidden"]
    });
    new ResizeObserver(schedule).observe(nav);
    desktop.addEventListener("change", schedule);
    window.addEventListener("resize", schedule, { passive: true });
    document.addEventListener("site-content-visibility-change", schedule);
    document.fonts?.ready.then(schedule);
    schedule();
})();
