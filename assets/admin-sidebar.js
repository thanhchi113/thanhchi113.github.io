(function () {
    "use strict";
    const sidebar = document.getElementById("adminSidebar"), panel = document.getElementById("adminPanel");
    if (!sidebar || !panel) return;
    const opener = document.getElementById("adminSidebarOpen"), closeButton = document.getElementById("adminSidebarClose"), collapseButton = document.getElementById("adminSidebarCollapse"), backdrop = document.getElementById("adminSidebarBackdrop");
    const main = document.querySelector("main.admin-page"), header = document.querySelector(".admin-nav");
    const mobile = matchMedia("(max-width:900px)"), storageKey = "thanhchi.admin.sidebar.collapsed";
    const tabs = [...sidebar.querySelectorAll("[data-workspace-tab]")];
    let collapsed = false, open = false, savedOverflow = null;
    try { collapsed = localStorage.getItem(storageKey) === "true"; } catch (_) { /* The sidebar also works with browser storage disabled. */ }
    const icons = {
        pdf: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
        requests: '<path d="M4 4h16v16H4zM4 13h5l1 3h4l1-3h5M8 8h8"/>',
        evidence: '<circle cx="12" cy="8" r="5"/><path d="m8 12-2 9 6-3 6 3-2-9M12 6v4M10 8h4"/>',
        scores: '<path d="M4 3v18h17M8 16v-4M13 16V7M18 16v-7"/>',
        tikz: '<path d="m5 17 3-12 12 4-4 12zM8 5l8 16M5 17l15-8"/><circle cx="8" cy="5" r="1.5"/><circle cx="20" cy="9" r="1.5"/>',
        contributions: '<path d="m7 8-4 4 4 4m10-8 4 4-4 4M14 5l-4 14"/>',
        account: '<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z"/><circle cx="12" cy="10" r="2"/><path d="M8 16c1-3 7-3 8 0"/>'
    };
    sidebar.querySelectorAll("[data-sidebar-icon]").forEach(element => { element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[element.dataset.sidebarIcon] || icons.pdf}</svg>`; });
    tabs.forEach(tab => {
        tab.setAttribute("aria-label", tab.title);
        const workspace = document.getElementById(tab.getAttribute("aria-controls"));
        if (workspace) { workspace.setAttribute("role", "tabpanel"); workspace.setAttribute("aria-labelledby", tab.id); workspace.tabIndex = -1; }
    });
    const authenticated = () => !panel.classList.contains("hidden");
    function syncSelection() {
        tabs.forEach(tab => { tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1; });
    }
    function render() {
        const authed = authenticated(), drawer = authed && mobile.matches && open;
        if (!authed || !mobile.matches) open = false;
        sidebar.hidden = !authed;
        opener.hidden = !authed;
        document.body.classList.toggle("admin-sidebar-visible", authed);
        document.body.classList.toggle("admin-sidebar-collapsed", collapsed);
        sidebar.classList.toggle("is-open", drawer);
        sidebar.inert = !authed || (mobile.matches && !drawer);
        sidebar.setAttribute("aria-hidden", String(!authed || (mobile.matches && !drawer)));
        opener.setAttribute("aria-expanded", String(drawer));
        collapseButton.setAttribute("aria-expanded", String(!collapsed));
        collapseButton.setAttribute("aria-label", collapsed ? "Mở rộng thanh điều hướng" : "Thu gọn thanh điều hướng");
        backdrop.hidden = !drawer;
        main.inert = header.inert = drawer;
        if (drawer && savedOverflow === null) { savedOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
        if (!drawer && savedOverflow !== null) { document.body.style.overflow = savedOverflow; savedOverflow = null; }
        if (drawer) { sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true"); }
        else { sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal"); }
        syncSelection();
    }
    function close(returnFocus = true) { const wasOpen = open; open = false; render(); if (wasOpen && returnFocus && authenticated()) opener.focus({ preventScroll: true }); }
    opener.addEventListener("click", () => {
        if (!authenticated() || !mobile.matches) return;
        open = true;
        render();
        requestAnimationFrame(() => { if (open) closeButton.focus({ preventScroll: true }); });
    });
    closeButton.addEventListener("click", () => close());
    backdrop.addEventListener("click", () => close());
    collapseButton.addEventListener("click", () => {
        if (mobile.matches || !authenticated()) return;
        collapsed = !collapsed;
        try { localStorage.setItem(storageKey, String(collapsed)); } catch (_) { /* Preference persistence is optional. */ }
        render();
    });
    sidebar.addEventListener("click", event => {
        if (!event.target.closest("[data-workspace-tab]")) return;
        // Existing workspace listeners run synchronously on the clicked button first.
        syncSelection();
        if (mobile.matches) close();
    });
    sidebar.addEventListener("keydown", event => {
        const tab = event.target.closest("[data-workspace-tab]");
        if (tab && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const index = tabs.indexOf(tab);
            const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + tabs.length) % tabs.length;
            tabs[next].focus();
        }
        if (!open || !mobile.matches || event.key !== "Tab") return;
        const focusable = [closeButton, ...tabs.filter(tab => tab.tabIndex === 0)];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || tabs.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } });
    new MutationObserver(() => { if (!authenticated()) open = false; render(); }).observe(panel, { attributes: true, attributeFilter: ["class"] });
    new MutationObserver(syncSelection).observe(document.getElementById("adminSidebarNavigation"), { attributes: true, attributeFilter: ["aria-selected"], subtree: true });
    mobile.addEventListener("change", () => { close(false); });
    window.adminSidebar = { syncSelection, close };
    render();
}());
