(function (global) {
    "use strict";

    const flags = Object.freeze(["show_student_name", "show_image", "show_course_name", "show_school_name", "show_result_summary", "show_description"]);
    const columns = flags.join(",");
    let illustrationMarkup = "";

    function visibilityFlags(item = {}) {
        return Object.fromEntries(flags.map(key => [key, item[key] !== false]));
    }

    function illustration() {
        if (!illustrationMarkup) {
            const template = document.createElement("template");
            template.innerHTML = global.ExamScorePaper.render(null);
            const svg = template.content.querySelector("svg");
            svg.classList.add("evidence-math-paper");
            svg.removeAttribute("data-score-display");
            svg.querySelector(".esp-led")?.remove();
            illustrationMarkup = svg.outerHTML;
        }
        return illustrationMarkup;
    }

    async function signedImageUrl(client, path) {
        if (typeof path !== "string" || !path.trim()) return "";
        const { data, error } = await client.storage.from("achievement-evidence").createSignedUrl(path, 60);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error("Không thể tải ảnh minh chứng.");
        const url = new URL(data.signedUrl);
        if (url.protocol !== "https:") throw new Error("Đường dẫn ảnh minh chứng không hợp lệ.");
        return url.href;
    }

    // The caller supplies the attachment's own container, leaving its card controls intact.
    // No image URL is requested until that card is on screen; discarded cards cannot be updated.
    function mountMedia(container, item, client, options = {}) {
        let cancelled = false;
        let started = false;
        let observer;
        const current = () => !cancelled && container.isConnected && (!options.isCurrent || options.isCurrent());
        container.classList.add("evidence-media");
        container.innerHTML = illustration();
        const fallback = () => {
            if (!current()) return;
            container.classList.remove("evidence-media-has-image");
            container.innerHTML = illustration();
        };
        const visible = visibilityFlags(item);
        let localUrl = "";
        if (options.localUrl) {
            try {
                const candidate = new URL(options.localUrl);
                if (candidate.protocol === "blob:" && candidate.origin === location.origin) localUrl = candidate.href;
            } catch { /* Only object URLs created for a local attachment are accepted here. */ }
        }
        const example = item.is_example === true && options.exampleUrl === "assets/achievements/example-feedback-grade12.png"
            ? options.exampleUrl : "";
        const canLoad = visible.show_image && (localUrl || example || (typeof item.image_path === "string" && item.image_path.trim()));
        async function load() {
            if (started || !current()) return;
            started = true;
            observer?.disconnect();
            try {
                const url = localUrl || example || await signedImageUrl(client, item.image_path);
                if (!current()) return;
                const image = new Image();
                image.alt = "Ảnh minh chứng thành tích";
                image.decoding = "async";
                image.loading = "eager";
                image.addEventListener("load", () => {
                    if (!current()) return;
                    container.classList.add("evidence-media-has-image");
                    container.replaceChildren(image);
                }, { once: true });
                image.addEventListener("error", fallback, { once: true });
                image.src = url;
            } catch {
                fallback();
            }
        }
        if (canLoad) {
            // Renderers return detached cards; defer until their synchronous mount has finished.
            queueMicrotask(() => {
                if (!current()) return;
                if (options.detail || !("IntersectionObserver" in global)) load();
                else {
                    observer = new IntersectionObserver(entries => {
                        if (!container.isConnected) { observer.disconnect(); return; }
                        if (entries.some(entry => entry.isIntersecting)) load();
                    }, { rootMargin: "120px 0px" });
                    observer.observe(container);
                }
            });
        }
        return () => { cancelled = true; observer?.disconnect(); };
    }

    global.EvidenceDisplay = Object.freeze({ flags, columns, visibilityFlags, illustration, signedImageUrl, mountMedia });
})(window);
