(function () {
    "use strict";
    const sections = [
        ["home", "Trang đầu"], ["about", "Giới thiệu"], ["skills", "Kỹ năng"],
        ["projects", "Dự án"], ["documents", "Tài liệu"], ["achievements", "Thành tích"], ["contact", "Liên hệ"]
    ];
    const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
    function schema(doc) {
        const fields = [];
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
                if (section) document.getElementById(section)?.scrollIntoView({ behavior: "instant" });
            });
            parent.postMessage({ type: "site-content-preview-ready" }, location.origin);
            return;
        }
        try {
            const { data, error } = await client.from("site_configuration").select("value").eq("id", "site_content").maybeSingle();
            if (!error && data?.value) apply(document, fields, data.value);
        } catch (_) { /* The original page stays available when configuration cannot load. */ }
    }
    window.SiteContent = Object.freeze({ sections, schema, validate, apply, start });
}());
