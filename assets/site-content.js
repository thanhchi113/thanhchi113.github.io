(function () {
    "use strict";
    const sections = [
        ["home", "Trang đầu"], ["about", "Giới thiệu"], ["skills", "Kỹ năng"],
        ["projects", "Dự án"], ["documents", "Tài liệu"], ["achievements", "Thành tích"],
        ["tikz-library", "Hình vẽ TikZ"], ["material-request", "Yêu cầu"], ["contact", "Liên hệ"]
    ];
    const editorSections = [...sections, ["appearance", "Giao diện & hiệu ứng"]];
    const hiddenByDocument = new WeakMap();
    const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
    function schema(doc) {
        const fields = [];
        fields.push({ section: "appearance", key: "appearance.motionEnabled", kind: "boolean", defaultValue: true,
            label: "Cho phép nền chuyển động trên website người dùng", offLabel: "Tắt",
            hint: "Tắt để giữ nền thiên hà tĩnh cho mọi người. Khi bật, người xem vẫn có thể tự tạm dừng bằng nút trên website. Các trang đang mở nhận thay đổi trong khoảng 45 giây hoặc khi quay lại tab." });
        function add(section, key, label, selector, kind = "text", max = 200) {
            const node = doc.querySelector(selector);
            if (!node) return;
            const raw = kind === "href" ? node.getAttribute("href") : kind === "firstText"
                ? Array.from(node.childNodes).find(child => child.nodeType === 3 && clean(child.textContent))?.textContent : node.textContent;
            fields.push({ section, key: `${section}.${key}`, label, selector, kind, max,
                textIndex: kind === "firstText" ? Array.from(node.childNodes).findIndex(child => child.nodeType === 3 && clean(child.textContent)) : -1,
                defaultValue: kind === "percent" ? Number(clean(raw).replace("%", "")) : clean(raw) });
        }
        for (const [id] of sections) {
            if (doc.getElementById(id)) fields.push({ section: id, key: `${id}.visible`, label: "Hiển thị mục này trên website", selector: `#${id}`, kind: "boolean", defaultValue: true });
            if (id === "home") continue;
            add(id, "kicker", "Dòng nhãn nhỏ", `#${id} .section-title .section-kicker`);
            add(id, "title", "Tiêu đề mục", `#${id} .section-title h2`);
            add(id, "subtitle", "Mô tả mục", `#${id} .section-title p`, "textarea", 1500);
        }
        add("home", "greeting", "Lời chào", ".hero-small");
        add("home", "nameFirst", "Tên — dòng đầu", ".hero-text h1", "firstText");
        add("home", "nameLast", "Tên — dòng sau", ".hero-text h1 span");
        add("home", "description", "Giới thiệu ngắn", ".hero-description", "textarea", 3000);
        add("home", "primaryButton", "Nút chính", ".hero-text .btn-primary span");
        add("home", "secondaryButton", "Nút liên hệ", ".hero-text .btn-outline");
        add("about", "intro", "Lời mở đầu", ".about-content h3", "firstText");
        add("about", "name", "Tên giới thiệu", ".about-content h3 span");
        doc.querySelectorAll(".about-content > p").forEach((_, i) => add("about", `paragraph${i + 1}`, `Đoạn giới thiệu ${i + 1}`, `.about-content > p:nth-of-type(${i + 1})`, "textarea", 3000));
        doc.querySelectorAll(".highlight-item").forEach((_, i) => {
            add("about", `highlight${i + 1}.number`, `Nổi bật ${i + 1} — số / nội dung`, `.highlight-item:nth-child(${i + 1}) .highlight-number`);
            add("about", `highlight${i + 1}.label`, `Nổi bật ${i + 1} — chú thích`, `.highlight-item:nth-child(${i + 1}) .highlight-text`);
        });
        doc.querySelectorAll("#skills .skill-item").forEach((_, i) => {
            const selector = `#skills .skill-item:nth-child(${i + 1})`;
            add("skills", `skill${i + 1}.name`, `Kỹ năng ${i + 1} — tên`, `${selector} h3`);
            add("skills", `skill${i + 1}.description`, `Kỹ năng ${i + 1} — chú thích`, `${selector} .skill-info p`);
            add("skills", `skill${i + 1}.percent`, `Kỹ năng ${i + 1} — tỷ lệ (%)`, `${selector} .skill-percent`, "percent");
        });
        doc.querySelectorAll("#projects .project-card").forEach((_, i) => {
            const selector = `#projects .project-card:nth-child(${i + 1})`;
            add("projects", `project${i + 1}.number`, `Dự án ${i + 1} — số hiển thị`, `${selector} .project-number`);
            add("projects", `project${i + 1}.name`, `Dự án ${i + 1} — tên`, `${selector} h3`);
            add("projects", `project${i + 1}.description`, `Dự án ${i + 1} — mô tả`, `${selector} p`, "textarea", 3000);
        });
        doc.querySelectorAll("#achievements .achievement-card, #achievements .achievement-card-large").forEach((node, i) => {
            const selector = `#achievements [data-content-achievement="${i}"]`;
            node.dataset.contentAchievement = String(i);
            add("achievements", `card${i + 1}.title`, `Thành tích ${i + 1} — tiêu đề`, `${selector} h3`);
            add("achievements", `card${i + 1}.description`, `Thành tích ${i + 1} — mô tả`, `${selector} p`, "textarea", 3000);
        });
        add("contact", "introTitle", "Lời mời kết nối", ".contact-intro h3");
        add("contact", "introText", "Nội dung liên hệ", ".contact-intro p", "textarea", 3000);
        doc.querySelectorAll(".contact-list .contact-item").forEach((_, i) => {
            add("contact", `item${i + 1}.text`, `Liên hệ ${i + 1} — thông tin hiển thị`, `.contact-item:nth-child(${i + 1}) strong`);
            add("contact", `item${i + 1}.url`, `Liên hệ ${i + 1} — liên kết (https:, mailto:, tel:)`, `.contact-item:nth-child(${i + 1})`, "href", 500);
        });
        return fields;
    }
    function validate(field, value) {
        if (field.kind === "boolean") {
            if (typeof value !== "boolean") throw new Error(`${field.label}: chọn Bật hoặc ${field.offLabel || "Ẩn"}.`);
            return value;
        }
        if (field.kind === "percent") {
            const number = Number(value);
            if (value === "" || !Number.isFinite(number) || number < 0 || number > 100) throw new Error(`${field.label}: nhập số từ 0 đến 100.`);
            return number;
        }
        if (typeof value !== "string" || value.length > field.max) throw new Error(`${field.label}: tối đa ${field.max} ký tự.`);
        const text = value.trim();
        if (field.kind === "href" && !/^(https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+|tel:\+?[\d.() -]+)$/i.test(text)) {
            throw new Error(`${field.label}: liên kết không hợp lệ.`);
        }
        return text;
    }
    function apply(doc, fields, values) {
        for (const field of fields) {
            if (field.kind === "boolean") continue;
            if (!Object.hasOwn(values || {}, field.key)) continue;
            let value;
            try { value = validate(field, values[field.key]); } catch (_) { continue; }
            const node = doc.querySelector(field.selector);
            if (!node) continue;
            if (field.kind === "href") node.setAttribute("href", value);
            else if (field.kind === "percent") {
                node.textContent = `${value}%`;
                node.closest(".skill-item")?.querySelector(".skill-progress")?.style.setProperty("--progress", `${value}%`);
            } else if (field.kind === "firstText") {
                const textNode = node.childNodes[field.textIndex];
                if (textNode) textNode.textContent = `${value} `;
            } else node.textContent = value;
        }
        applyVisibility(doc, values);
        doc.documentElement.dataset.siteMotionAllowed = String(values?.["appearance.motionEnabled"] !== false);
        doc.dispatchEvent(new CustomEvent("site-appearance-change"));
    }
    function isVisible(id, doc = document) { return !hiddenByDocument.get(doc)?.has(id); }
    function firstVisible(doc = document) { return sections.find(([id]) => isVisible(id, doc))?.[0] || null; }
    function sectionForHash(hash, doc = document) {
        let id;
        try { id = decodeURIComponent(String(hash || "").replace(/^#/, "")); } catch (_) { return null; }
        if (id.startsWith("tikz-")) return "tikz-library";
        if (id === "scoreSubmission") return "achievements";
        if (sections.some(([section]) => section === id)) return id;
        return doc.getElementById(id)?.closest("main > section[id]")?.id || null;
    }
    function applyVisibility(doc, values) {
        const hidden = new Set(sections.filter(([id]) => values?.[`${id}.visible`] === false).map(([id]) => id));
        hiddenByDocument.set(doc, hidden);
        for (const [id] of sections) {
            const node = doc.getElementById(id);
            if (node) node.toggleAttribute("data-site-section-hidden", hidden.has(id));
            if (node && hidden.has(id)) node.dataset.siteSectionHidden = "true";
        }
        doc.querySelectorAll("[data-site-link-hidden]").forEach(node => node.removeAttribute("data-site-link-hidden"));
        const base = new URL("index.html", doc.baseURI === "about:blank" ? location.href : doc.baseURI);
        const directory = base.pathname.replace(/index\.html$/, "");
        for (const link of doc.querySelectorAll("a[href]")) {
            // Preserve home/back navigation even when its original section is switched off.
            const original = link.dataset.siteOriginalHref || link.getAttribute("href");
            let url;
            try { url = new URL(original, base); } catch (_) { continue; }
            if (url.origin !== base.origin || ![base.pathname, directory].includes(url.pathname)) continue;
            const id = sectionForHash(url.hash, doc);
            if (!id) continue;
            if (link.matches(".logo,.back-to-top,.evidence-back-link")) {
                link.dataset.siteOriginalHref = original;
                const fallback = firstVisible(doc);
                link.setAttribute("href", hidden.has(id) ? `${doc.getElementById("home") ? "" : "index.html"}#${fallback || ""}` : original);
                if (link.matches(".evidence-back-link")) {
                    const label = link.querySelector("[data-back-label]");
                    if (label) label.textContent = hidden.has(id) ? "Quay lại website" : "Quay lại thành tích";
                }
            } else if (hidden.has(id)) {
                link.dataset.siteLinkHidden = "true";
                if (link.closest(".nav-links")) link.closest("li")?.setAttribute("data-site-link-hidden", "true");
                link.classList.remove("active");
                link.removeAttribute("aria-current");
            }
        }
        doc.querySelectorAll("[data-tikz-open]").forEach(node => {
            if (hidden.has("tikz-library")) node.dataset.siteLinkHidden = "true";
        });
        // The existing router handles fallback URLs after asynchronous configuration loads.
        doc.dispatchEvent(new CustomEvent("site-content-visibility-change"));
    }
    async function start(client) {
        const fields = schema(document);
        const defaults = Object.fromEntries(fields.map(field => [field.key, field.defaultValue]));
        const preview = new URLSearchParams(location.search).get("admin-content-preview") === "1" && window.parent !== window;
        if (preview) {
            document.addEventListener("submit", event => event.preventDefault(), true);
            document.addEventListener("click", event => { if (event.target.closest("a,button,[role=button]")) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
            document.querySelectorAll("form input,form select,form button,form textarea").forEach(node => { node.disabled = true; });
            window.addEventListener("message", event => {
                if (event.source !== parent || event.origin !== location.origin || event.data?.type !== "site-content-preview") return;
                apply(document, fields, { ...defaults, ...event.data.values });
                const section = sections.find(([id]) => id === event.data.section)?.[0];
                if (section && isVisible(section)) {
                    if (typeof window.navigateFromMainTaskbar === "function") window.navigateFromMainTaskbar(`#${section}`, true);
                    else document.getElementById(section)?.scrollIntoView({ behavior: "instant" });
                }
            });
            parent.postMessage({ type: "site-content-preview-ready" }, location.origin);
            return;
        }
        try {
            const { data, error } = await client.from("site_configuration").select("value").eq("id", "site_content").maybeSingle();
            if (!error && data?.value) apply(document, fields, data.value);
        } catch (_) { /* The original page stays available when configuration cannot load. */ }
        window.SiteExperience?.connect(client);
    }
    window.SiteContent = Object.freeze({ sections, editorSections, schema, validate, apply, start, isVisible, firstVisible, sectionForHash });
}());
