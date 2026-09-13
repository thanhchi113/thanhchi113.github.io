(() => {
    "use strict";
    const preferenceKey = "thanhchi.public.galaxy.motion";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const isPreview = new URLSearchParams(location.search).get("admin-content-preview") === "1" && parent !== window;
    let personal = true, button, client, timer = 0, pending = false;
    try { personal = localStorage.getItem(preferenceKey) !== "false"; } catch (_) { /* Preferences are optional. */ }

    function applyMotion() {
        if (document.getElementById("adminGalaxyScene")) return;
        const allowed = document.documentElement.dataset.siteMotionAllowed !== "false";
        const running = allowed && personal && !reduced.matches;
        document.documentElement.dataset.siteMotionRunning = String(running);
        document.querySelectorAll(".site-galaxy").forEach(scene => {
            const canvas = scene.querySelector(".milky-way-canvas");
            if (canvas) {
                canvas.dataset.galaxyPaused = String(!running);
                canvas.galaxyBackgroundController?.setPaused(!running);
            }
            window.GalaxyClouds?.mount(scene)?.configure({ paused: !running });
        });
        if (!button) return;
        button.disabled = !allowed || reduced.matches;
        button.setAttribute("aria-pressed", String(running));
        button.querySelector("[data-motion-icon]").textContent = running ? "Ⅱ" : "▷";
        button.querySelector("[data-motion-label]").textContent = !allowed ? "Nền tĩnh · Quản trị viên đã tắt" : reduced.matches ? "Nền tĩnh · Giảm chuyển động" : `Nền chuyển động: ${running ? "Bật" : "Tắt"}`;
        button.title = !allowed ? "Quản trị viên đang tắt nền chuyển động cho website" : reduced.matches ? "Đang theo cài đặt giảm chuyển động của thiết bị" : running ? "Tạm dừng chuyển động, giữ nền thiên hà tĩnh" : "Bật lại nền thiên hà chuyển động";
    }
    function schedule() {
        clearTimeout(timer);
        if (client && !document.hidden && !isPreview) timer = setTimeout(refresh, 45000);
    }
    async function refresh() {
        clearTimeout(timer);
        if (!client || pending || document.hidden || isPreview) return;
        pending = true;
        try {
            const { data, error } = await client.from("site_configuration").select("value").eq("id", "site_content").maybeSingle();
            if (!error && data?.value) {
                document.documentElement.dataset.siteMotionAllowed = String(data.value["appearance.motionEnabled"] !== false);
                applyMotion();
            }
        } catch (_) { /* Retain the last known setting while offline. */ }
        finally { pending = false; schedule(); }
    }
    function connect(nextClient) { client = nextClient; schedule(); }
    function mountGlow() {
        const glow = document.createElement("div");
        glow.className = "site-pointer-glow";
        glow.setAttribute("aria-hidden", "true");
        document.body.append(glow);
        let frame = 0, x = 0, y = 0;
        const pointer = matchMedia("(pointer:fine)");
        const hide = () => { cancelAnimationFrame(frame); frame = 0; glow.dataset.active = "false"; };
        document.addEventListener("pointermove", event => {
            if (!pointer.matches || event.pointerType === "touch") return;
            x = event.clientX - 170; y = event.clientY - 170;
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0; glow.style.transform = `translate3d(${x}px,${y}px,0)`;
                glow.dataset.active = "true";
            });
        }, { passive: true });
        document.documentElement.addEventListener("pointerleave", hide);
        window.addEventListener("blur", hide);
        document.addEventListener("visibilitychange", () => { if (document.hidden) hide(); });
    }
    function initialize() {
        mountGlow();
        if (!document.querySelector(".site-galaxy")) return;
        if (!isPreview) {
            button = document.createElement("button");
            button.id = "siteMotionToggle"; button.className = "site-motion-toggle"; button.type = "button";
            button.innerHTML = '<span data-motion-icon aria-hidden="true"></span><span data-motion-label></span>';
            button.addEventListener("click", () => {
                personal = !personal;
                try { localStorage.setItem(preferenceKey, String(personal)); } catch (_) { /* Saving is optional. */ }
                applyMotion();
            });
            document.body.append(button);
        }
        applyMotion();
        document.addEventListener("site-appearance-change", applyMotion);
        reduced.addEventListener("change", applyMotion);
        window.addEventListener("storage", event => {
            if (event.key === preferenceKey || event.key === null) {
                try { personal = localStorage.getItem(preferenceKey) !== "false"; } catch (_) { return; }
                applyMotion();
            }
        });
        document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else refresh(); });
        window.addEventListener("focus", refresh);
        window.addEventListener("pagehide", () => clearTimeout(timer));
        window.addEventListener("pageshow", () => { applyMotion(); refresh(); });
    }
    window.SiteExperience = Object.freeze({ connect, refresh });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize, { once: true });
    else initialize();
})();
