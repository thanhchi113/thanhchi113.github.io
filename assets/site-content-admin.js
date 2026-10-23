(function () {
    "use strict";
    window.SiteContentAdmin = { init(client) {
        const mount = document.getElementById("contentWorkspace");
        if (!mount || !window.SiteContent) return { load: async () => {}, clear() {} };
        if (mount.controller) return mount.controller;
        const api = window.SiteContent;
        const editorSections = api.editorSections || api.sections;
        let fields = [], defaults = {}, saved = {}, draft = {}, version = null, section = "about";
        let epoch = 0, ready = false, busy = false, pending = null, dirty = false;
        mount.innerHTML = `<section class="site-content-editor"><h1>Nội dung trang web</h1><p>Bật, ẩn các mục hoặc chỉnh sửa chữ, thông tin liên hệ và các con số. Bản xem trước cập nhật khi bạn nhập; website chỉ thay đổi khi bấm Lưu nội dung.</p>
            <div class="site-content-toolbar"><label for="siteContentSection">Mục cần chỉnh sửa<select id="siteContentSection">${editorSections.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label><button type="button" class="admin-btn ghost" data-content-reload>Tải lại nội dung</button></div>
            <div class="site-content-layout"><form data-content-form><fieldset class="site-content-fields" data-content-fields disabled></fieldset><div class="site-content-actions"><button class="admin-btn success" type="submit" data-content-save disabled>Lưu nội dung</button><button class="admin-btn ghost" type="button" data-content-undo disabled>Hủy thay đổi</button><button class="admin-btn ghost" type="button" data-content-defaults disabled>Khôi phục mẫu gốc</button></div></form>
            <div class="site-content-preview"><p data-content-preview-label>Bản xem trước · chưa công bố</p><iframe title="Xem trước nội dung trang web" data-content-preview sandbox="allow-scripts allow-same-origin" loading="lazy"></iframe></div></div>
            <p data-content-status role="status" aria-live="polite"></p></section>`;
        const form = mount.querySelector("form"), fieldset = mount.querySelector("fieldset"), selector = mount.querySelector("select"), status = mount.querySelector("[data-content-status]"), frame = mount.querySelector("iframe");
        const buttons = [...mount.querySelectorAll("button")];
        selector.value = section;
        function message(text, error = false, success = false) { status.textContent = text; status.dataset.error = String(error); status.dataset.saved = String(success); }
        function lock() { fieldset.disabled = !ready || busy; selector.disabled = busy; buttons.forEach(button => { button.disabled = busy || (!ready && !button.hasAttribute("data-content-reload")); }); mount.setAttribute("aria-busy", String(busy)); }
        function preview(scroll = false) {
            const values = { ...defaults, ...draft };
            for (const option of selector.options) {
                const name = editorSections.find(([id]) => id === option.value)?.[1] || option.value;
                option.textContent = `${name}${values[`${option.value}.visible`] === false ? " · Đang ẩn" : ""}`;
            }
            mount.querySelector("[data-content-preview-label]").textContent = values[`${section}.visible`] === false
                ? "Mục này đang ẩn trong bản xem trước. Bạn vẫn có thể chỉnh sửa và bật lại bất cứ lúc nào."
                : "Bản xem trước · chưa công bố";
            frame.contentWindow?.postMessage({ type: "site-content-preview", values: { ...defaults, ...draft }, section: scroll ? section : null }, location.origin);
        }
        function resolveAvatarUrl(raw) {
            if (!raw) return "assets/avatar.jpg";
            const s = String(raw).trim();
            if (!s) return "assets/avatar.jpg";
            if (/^(data:image\/|blob:|https?:\/\/|assets\/)/i.test(s)) return s;
            return `https://uiyqdqucqplifcvukwul.supabase.co/storage/v1/object/public/math-pdfs/${s.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/")}`;
        }
        function cropSquareAvatarDataUrl(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement("canvas");
                        const side = Math.min(img.width, img.height);
                        const target = Math.min(640, side || 640);
                        canvas.width = target; canvas.height = target;
                        canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, target, target);
                        resolve(canvas.toDataURL("image/jpeg", 0.88));
                    };
                    img.onerror = () => resolve(reader.result);
                    img.src = reader.result;
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }
        function render() {
            fieldset.replaceChildren();
            if (section === "home") {
                const avatarWrap = document.createElement("div");
                avatarWrap.className = "hero-avatar-admin-field";
                const currentAvatar = draft["home.avatarPath"] ?? saved["home.avatarPath"] ?? (typeof localStorage !== "undefined" ? localStorage.getItem("thanhchi.hero.avatar") : "") ?? "assets/avatar.jpg";
                avatarWrap.innerHTML = `<span class="field-label">Ảnh đại diện ở Hero</span>
                    <div class="hero-avatar-admin-row">
                        <div class="hero-avatar-admin-thumb"><img data-hero-avatar-preview src="${resolveAvatarUrl(currentAvatar)}" alt="Ảnh đại diện Hero"></div>
                        <div class="hero-avatar-admin-meta">
                            <strong>Ảnh đại diện khung tròn ở Hero</strong>
                            <small>Chọn ảnh JPG, PNG hoặc WebP để thay ảnh đại diện hiển thị ở phần mở đầu website.</small>
                            <div class="hero-avatar-admin-actions">
                                <button type="button" class="admin-btn" data-hero-avatar-pick><i class="fa-solid fa-camera"></i> Đổi ảnh đại diện ở Hero</button>
                                <button type="button" class="admin-btn ghost" data-hero-avatar-reset><i class="fa-solid fa-rotate-left"></i> Ảnh mặc định</button>
                            </div>
                        </div>
                    </div>`;
                const fileInput = document.createElement("input");
                fileInput.type = "file"; fileInput.accept = "image/jpeg,image/png,image/webp"; fileInput.hidden = true;
                const previewImg = avatarWrap.querySelector("[data-hero-avatar-preview]");
                avatarWrap.querySelector("[data-hero-avatar-pick]").addEventListener("click", () => fileInput.click());
                avatarWrap.querySelector("[data-hero-avatar-reset]").addEventListener("click", () => {
                    draft["home.avatarPath"] = "assets/avatar.jpg";
                    try { localStorage.removeItem("thanhchi.hero.avatar"); } catch (_) {}
                    previewImg.src = "assets/avatar.jpg";
                    dirty = true; preview(false); message("Đã đặt lại ảnh đại diện mặc định trong bản xem trước. Bấm Lưu nội dung để áp dụng.");
                });
                fileInput.addEventListener("change", async () => {
                    const file = fileInput.files?.[0]; fileInput.value = "";
                    if (!file || !file.type.startsWith("image/")) return;
                    try {
                        const dataUrl = await cropSquareAvatarDataUrl(file);
                        let storedRef = dataUrl;
                        if (client?.storage) {
                            const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
                            const storagePath = `avatars/hero-avatar-${Date.now()}.${ext}`;
                            const up = await client.storage.from("math-pdfs").upload(storagePath, file, { contentType: file.type, upsert: true });
                            if (!up.error) storedRef = storagePath;
                        }
                        draft["home.avatarPath"] = storedRef;
                        try { localStorage.setItem("thanhchi.hero.avatar", dataUrl); } catch (_) {}
                        previewImg.src = dataUrl;
                        dirty = true; preview(false); message("Đã chọn ảnh đại diện Hero mới. Bấm Lưu nội dung để công bố.");
                    } catch (_) {
                        message("Không đọc được tệp ảnh đã chọn.", true);
                    }
                });
                fieldset.append(avatarWrap);
            }
            for (const field of fields.filter(item => item.section === section)) {
                const label = document.createElement("label"); label.textContent = field.label;
                const input = document.createElement(field.kind === "textarea" ? "textarea" : "input");
                input.id = `content-${field.key}`; input.name = field.key;
                label.htmlFor = input.id;
                if (field.kind === "boolean") {
                    label.className = "site-content-visibility";
                    input.type = "checkbox"; input.className = "site-content-toggle"; input.setAttribute("role", "switch");
                    input.checked = (draft[field.key] ?? defaults[field.key]) !== false;
                    const copy = document.createElement("span"); copy.className = "site-content-visibility-copy";
                    const title = document.createElement("span"); title.id = `${input.id}-title`; title.textContent = field.label;
                    const hint = document.createElement("small"); hint.id = `${input.id}-hint`;
                    hint.textContent = field.hint || "Khi tắt, mục này và liên kết trên thanh điều hướng sẽ ẩn. Nội dung vẫn được lưu để bật lại.";
                    input.setAttribute("aria-labelledby", title.id); input.setAttribute("aria-describedby", hint.id);
                    copy.append(title, hint);
                    const state = document.createElement("span"); state.className = "site-content-toggle-state"; state.setAttribute("aria-hidden", "true");
                    state.textContent = input.checked ? "Bật" : field.offLabel || "Ẩn";
                    label.replaceChildren(copy, input, state);
                } else {
                    if (field.kind === "percent") { input.type = "number"; input.min = "0"; input.max = "100"; input.step = "any"; }
                    else input.maxLength = field.max;
                    input.value = draft[field.key] ?? defaults[field.key];
                    label.append(input);
                }
                fieldset.append(label);
            }
            preview(true); lock();
        }
        async function load() {
            if (document.getElementById("adminPanel")?.classList.contains("hidden") || busy || dirty) return;
            if (ready) return;
            if (pending) return pending;
            const requestEpoch = epoch; busy = true; lock(); message("Đang tải nội dung...");
            pending = (async () => {
                try {
                    if (!fields.length) {
                        const response = await fetch("index.html", { cache: "no-store" });
                        if (!response.ok) throw new Error("Không tải được mẫu trang chủ.");
                        const doc = new DOMParser().parseFromString(await response.text(), "text/html");
                        if (requestEpoch !== epoch) return;
                        fields = api.schema(doc); defaults = Object.fromEntries(fields.map(field => [field.key, field.defaultValue]));
                    }
                    const { data, error } = await client.from("site_configuration").select("value,updated_at").eq("id", "site_content").maybeSingle();
                    if (requestEpoch !== epoch) return;
                    if (error) throw error;
                    if (!data) throw new Error("Cấu hình nội dung chưa được thiết lập.");
                    saved = data.value || {}; draft = { ...saved }; version = data.updated_at; dirty = false; ready = true;
                    if (!frame.getAttribute("src")) {
                        const parentScrollY = window.scrollY;
                        frame.addEventListener("load", () => {
                            window.scrollTo({ top: parentScrollY, behavior: "instant" });
                        }, { once: true });
                        frame.src = "index.html?admin-content-preview=1#about";
                    }
                    render(); message("Đã tải nội dung đang hiển thị. Chọn một mục để chỉnh sửa.");
                } catch (error) {
                    if (requestEpoch !== epoch) return;
                    ready = false;
                    message(["42P01", "PGRST205"].includes(error?.code) ? "Chưa thiết lập lưu nội dung trên máy chủ. Cần áp dụng bản cập nhật dữ liệu trước khi chỉnh sửa." : error.message || "Không tải được nội dung. Hãy thử lại.", true);
                } finally { if (requestEpoch === epoch) { busy = false; pending = null; lock(); } }
            })();
            return pending;
        }
        selector.addEventListener("change", () => { section = selector.value; render(); });
        form.addEventListener("input", event => {
            const field = fields.find(item => item.key === event.target.name);
            if (!ready || busy || !field) return;
            draft[field.key] = field.kind === "boolean" ? event.target.checked : event.target.value;
            if (field.kind === "boolean") event.target.closest("label").querySelector(".site-content-toggle-state").textContent = event.target.checked ? "Bật" : field.offLabel || "Ẩn";
            dirty = true; preview(field.kind === "boolean"); message("Có thay đổi chưa lưu. Bấm Lưu nội dung để công bố.");
        });
        form.addEventListener("submit", async event => {
            event.preventDefault(); if (!ready || busy) return;
            const next = { ...saved };
            if (Object.hasOwn(draft, "home.avatarPath")) next["home.avatarPath"] = String(draft["home.avatarPath"] || "assets/avatar.jpg");
            try { for (const field of fields) if (Object.hasOwn(draft, field.key)) next[field.key] = api.validate(field, draft[field.key]); }
            catch (error) { message(error.message, true); return; }
            const requestEpoch = epoch; busy = true; lock(); message("Đang lưu nội dung...");
            try {
                const { data, error } = await client.from("site_configuration").update({ value: next }).eq("id", "site_content").eq("updated_at", version).select("value,updated_at").maybeSingle();
                if (requestEpoch !== epoch) return;
                if (error) throw error;
                if (!data) throw new Error("Nội dung đã được cập nhật ở nơi khác hoặc quyền quản trị đã thay đổi. Bản sửa vẫn được giữ; tải lại để đối chiếu trước khi lưu.");
                saved = data.value; draft = { ...saved }; version = data.updated_at; dirty = false;
                message("Đã lưu. Nội dung mới sẽ hiển thị khi mở hoặc tải lại trang chủ.", false, true);
            } catch (error) { if (requestEpoch === epoch) message(error.message || "Không lưu được. Bản sửa vẫn được giữ để thử lại.", true); }
            finally { if (requestEpoch === epoch) { busy = false; lock(); } }
        });
        mount.querySelector("[data-content-undo]").addEventListener("click", () => { draft = { ...saved }; dirty = false; render(); message("Đã trở về nội dung được lưu gần nhất."); });
        mount.querySelector("[data-content-defaults]").addEventListener("click", () => {
            fields.filter(field => field.section === section).forEach(field => { draft[field.key] = defaults[field.key]; });
            dirty = true; render(); message("Đã đưa mục này về mẫu gốc trong bản xem trước. Bấm Lưu nội dung nếu muốn áp dụng.");
        });
        mount.querySelector("[data-content-reload]").addEventListener("click", () => {
            if (dirty && !confirm("Tải lại sẽ bỏ những thay đổi chưa lưu. Tiếp tục?")) return;
            dirty = false; ready = false; load();
        });
        window.addEventListener("message", event => { if (event.origin === location.origin && event.source === frame.contentWindow && event.data?.type === "site-content-preview-ready") preview(true); });
        window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
        function clear() { epoch++; ready = false; busy = false; pending = null; dirty = false; saved = {}; draft = {}; version = null; fieldset.replaceChildren(); frame.removeAttribute("src"); preview(); message(""); lock(); }
        mount.controller = { load, clear }; return mount.controller;
    } };
}());
