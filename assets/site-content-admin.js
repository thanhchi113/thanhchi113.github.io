(function () {
    "use strict";
    window.SiteContentAdmin = { init(client) {
        const mount = document.getElementById("contentWorkspace");
        if (!mount || !window.SiteContent) return { load: async () => {}, clear() {} };
        if (mount.controller) return mount.controller;
        const api = window.SiteContent;
        let fields = [], defaults = {}, saved = {}, draft = {}, version = null, section = "about";
        let epoch = 0, ready = false, busy = false, pending = null, dirty = false;
        mount.innerHTML = `<section class="site-content-editor"><h1>Nội dung trang web</h1><p>Bật, ẩn các mục hoặc chỉnh sửa chữ, thông tin liên hệ và các con số. Bản xem trước cập nhật khi bạn nhập; website chỉ thay đổi khi bấm Lưu nội dung.</p>
            <div class="site-content-toolbar"><label for="siteContentSection">Mục cần chỉnh sửa<select id="siteContentSection">${api.sections.map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label><button type="button" class="admin-btn ghost" data-content-reload>Tải lại nội dung</button></div>
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
                const name = api.sections.find(([id]) => id === option.value)?.[1] || option.value;
                option.textContent = `${name}${values[`${option.value}.visible`] === false ? " · Đang ẩn" : ""}`;
            }
            mount.querySelector("[data-content-preview-label]").textContent = values[`${section}.visible`] === false
                ? "Mục này đang ẩn trong bản xem trước. Bạn vẫn có thể chỉnh sửa và bật lại bất cứ lúc nào."
                : "Bản xem trước · chưa công bố";
            frame.contentWindow?.postMessage({ type: "site-content-preview", values: { ...defaults, ...draft }, section: scroll ? section : null }, location.origin);
        }
        function render() {
            fieldset.replaceChildren();
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
                    hint.textContent = "Khi tắt, mục này và liên kết trên thanh điều hướng sẽ ẩn. Nội dung vẫn được lưu để bật lại.";
                    input.setAttribute("aria-labelledby", title.id); input.setAttribute("aria-describedby", hint.id);
                    copy.append(title, hint);
                    const state = document.createElement("span"); state.className = "site-content-toggle-state"; state.setAttribute("aria-hidden", "true");
                    state.textContent = input.checked ? "Bật" : "Ẩn";
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
                    if (!frame.getAttribute("src")) frame.src = "index.html?admin-content-preview=1#about";
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
            if (field.kind === "boolean") event.target.closest("label").querySelector(".site-content-toggle-state").textContent = event.target.checked ? "Bật" : "Ẩn";
            dirty = true; preview(field.kind === "boolean"); message("Có thay đổi chưa lưu. Bấm Lưu nội dung để công bố.");
        });
        form.addEventListener("submit", async event => {
            event.preventDefault(); if (!ready || busy) return;
            const next = { ...saved };
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
