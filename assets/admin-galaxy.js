(function () {
    "use strict";
    const scene = document.getElementById("adminGalaxyScene");
    const canvas = document.getElementById("adminGalaxyCanvas");
    const button = document.getElementById("adminGalaxyToggle");
    if (!scene || !canvas || !button) return;
    const preferenceKey = "thanhchi.admin.galaxy.enabled";
    let enabled = true;
    try { enabled = localStorage.getItem(preferenceKey) !== "false"; } catch (_) { /* Works without saved preferences. */ }
    function apply() {
        scene.hidden = !enabled;
        canvas.dataset.galaxyPaused = String(!enabled);
        canvas.galaxyBackgroundController?.setPaused(!enabled);
        window.GalaxyClouds?.mount(scene)?.configure({ paused: !enabled });
        button.setAttribute("aria-pressed", String(enabled));
        button.querySelector("[data-galaxy-state]").textContent = enabled ? "Bật" : "Tắt";
        const label = enabled ? "Tắt nền thiên hà" : "Bật nền thiên hà";
        button.setAttribute("aria-label", label);
        button.title = label;
    }
    button.addEventListener("click", () => {
        enabled = !enabled;
        try { localStorage.setItem(preferenceKey, String(enabled)); } catch (_) { /* Saving is optional. */ }
        apply();
    });
    apply();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply, { once: true });
    window.addEventListener("pageshow", apply);
}());
