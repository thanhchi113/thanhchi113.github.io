(function () {
    "use strict";
    const api = window.ExamScores;
    if (!api) return;
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    let client = null, pending = null, epoch = 0, controller = null, resetAdmin = null, observed = [], readVersion = null;
    function selectOptions(select, entries, placeholder) {
        if (!select) return;
        const previous = select.value;
        select.replaceChildren(...(placeholder ? [new Option(placeholder, "all")] : []), ...entries.map(([key, label]) => new Option(label, String(key))));
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
    }
    function suggestions(id, values) {
        let list = document.getElementById(id);
        if (!list) { list = document.createElement("datalist"); list.id = id; document.body.appendChild(list); }
        list.replaceChildren(...values.map(value => new Option(value, value)));
    }
    function sync() {
        const options = api.getOptions();
        const periods = options.periods.map(period => [period.key, period.label]);
        const grades = options.grades.map(grade => [grade, `Khối ${grade}`]);
        selectOptions(document.getElementById("scorePeriod"), periods);
        selectOptions(document.getElementById("scoreGrade"), grades);
        selectOptions(document.getElementById("scoreAdminPeriod"), periods, "Tất cả kỳ thi");
        selectOptions(document.getElementById("scorePeriodFilter"), periods, "Tất cả kỳ thi");
        selectOptions(document.getElementById("scoreGradeFilter"), grades, "Tất cả khối");
        suggestions("scoreClassSuggestions", options.classes);
        suggestions("scoreYearSuggestions", options.years);
        for (const input of document.querySelectorAll('#scoreClass, [data-import-default="class_name"]')) input.setAttribute("list", "scoreClassSuggestions");
        for (const input of document.querySelectorAll('#scoreYear, [data-import-default="school_year"]')) input.setAttribute("list", "scoreYearSuggestions");
        window.dispatchEvent(new CustomEvent("exam-score-options-change", { detail: options }));
    }
    function observeRecords(records) {
        // Keep historical choices available when editing/filtering existing scores.
        observed = records.map(row => ({ period: row.period, grade: row.grade, class_name: row.class_name, school_year: row.school_year }));
        api.observeRecords(observed);
        sync();
    }
    async function load() {
        if (!client) return api.getOptions();
        if (pending) return pending;
        const requestEpoch = epoch;
        pending = (async () => {
            const { data, error } = await client.from("site_configuration").select("value,updated_at").eq("id", "score_options").maybeSingle();
            if (requestEpoch !== epoch) return api.getOptions();
            if (error || !data?.updated_at) throw error || new Error("Chưa thiết lập danh mục.");
            readVersion = data.updated_at;
            api.configure(data.value || {});
            api.observeRecords(observed);
            sync();
            return api.getOptions();
        })().finally(() => { if (requestEpoch === epoch) pending = null; });
        return pending;
    }
    function init(supabase) {
        client = supabase;
        const mount = document.getElementById("scoreOptionsAdmin");
        if (!mount) return { load, clear, observeRecords };
        if (controller) return controller;
        let ready = false, busy = false, draft = api.getOptions(), dirty = false, draftVersion = null;
        mount.classList.add("score-options-admin");
        mount.innerHTML = `<details open><summary>Danh mục nhập điểm</summary><p class="score-options-intro">Thêm lớp, năm học, kỳ thi và khối để chọn nhanh khi nhập điểm. Lớp và năm học cũng có thể nhập trực tiếp trong từng bài thi.</p>
            <form data-options-form><fieldset data-options-fields disabled><div class="score-options-grid">
            <label>Lớp / khóa học <span>Mỗi dòng một lớp</span><textarea name="classes" rows="5" placeholder="10A1&#10;11A2&#10;Ôn thi THPT"></textarea></label>
            <label>Năm học <span>Mỗi dòng một năm học liên tiếp</span><textarea name="years" rows="5" placeholder="2026-2027&#10;2027-2028"></textarea></label>
            <fieldset class="score-options-grades"><legend>Khối lớp</legend><div>${Array.from({ length: 12 }, (_, index) => index + 1).map(grade => `<label><input type="checkbox" name="grades" value="${grade}" ${grade >= 10 ? "checked disabled" : ""}> Khối ${grade}</label>`).join("")}</div><small>Khối 10, 11, 12 luôn có sẵn.</small></fieldset>
            <div class="score-options-periods"><h3>Kỳ thi</h3><div data-options-periods></div><div class="score-options-add"><label for="scoreOptionsNewPeriod">Tên kỳ thi mới<input id="scoreOptionsNewPeriod" maxlength="80" placeholder="Ví dụ: Thi thử THPT lần 1"></label><button type="button" class="admin-btn ghost" data-options-add>Thêm kỳ thi</button></div></div>
            </div><p class="score-options-note">Các kỳ thi được giữ lại để bảo toàn tên trong bảng điểm cũ. Bạn có thể đổi tên hiển thị tại đây.</p><div class="admin-actions"><button type="submit" class="admin-btn success">Lưu danh mục</button></div></fieldset></form><button type="button" class="admin-btn ghost" data-options-refresh>Tải lại danh mục</button><p class="admin-status" data-options-status role="status" aria-live="polite"></p></details>`;
        const form = mount.querySelector("form"), fields = mount.querySelector("[data-options-fields]"), status = mount.querySelector("[data-options-status]");
        function message(value, error = false) { status.textContent = value; status.dataset.error = String(error); }
        function lock() { fields.disabled = !ready || busy; mount.querySelector("[data-options-refresh]").disabled = busy; mount.setAttribute("aria-busy", String(busy)); }
        function drawPeriods() {
            mount.querySelector("[data-options-periods]").innerHTML = draft.periods.map((period, index) => `<label class="score-options-period"><span>Kỳ thi ${index + 1}</span><input data-options-period="${escape(period.key)}" aria-label="Tên kỳ thi ${escape(period.label)}" required maxlength="80" value="${escape(period.label)}"></label>`).join("");
        }
        function fill() {
            draft = api.getOptions(); draftVersion = readVersion; dirty = false;
            form.elements.classes.value = draft.classes.join("\n"); form.elements.years.value = draft.years.join("\n");
            form.querySelectorAll('[name="grades"]').forEach(input => { input.checked = draft.grades.includes(Number(input.value)); });
            drawPeriods();
        }
        function values() {
            const classes = form.elements.classes.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
            const years = form.elements.years.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
            if (classes.length > 500 || years.length > 500) throw new Error("Mỗi danh mục có tối đa 500 mục.");
            if (classes.some(value => value.length > 80)) throw new Error("Tên lớp dài tối đa 80 ký tự.");
            if (years.some(value => !api.validYear(value))) throw new Error("Năm học phải gồm hai năm liên tiếp, ví dụ 2026-2027.");
            const periods = [...form.querySelectorAll("[data-options-period]")].map(input => ({ key: input.dataset.optionsPeriod, label: input.value.trim().replace(/\s+/g, " "), short: input.value.trim().slice(0, 24) }));
            if (periods.some(period => !period.label || period.label.length > 80)) throw new Error("Tên kỳ thi dài từ 1 đến 80 ký tự.");
            if (new Set(periods.map(period => period.label.toLocaleLowerCase("vi"))).size !== periods.length) throw new Error("Các kỳ thi cần có tên khác nhau.");
            const grades = [...form.querySelectorAll('[name="grades"]:checked')].map(input => Number(input.value));
            return api.normalizeOptions({ classes, years, periods, grades });
        }
        async function loadAdmin(force = false) {
            if (busy || document.getElementById("adminPanel")?.classList.contains("hidden")) return;
            if (ready && dirty && !force) return;
            const requestEpoch = epoch;
            busy = true; lock(); message("Đang tải danh mục...");
            try { await load(); if (requestEpoch !== epoch) return; ready = true; fill(); message("Danh mục dùng chung cho nhập điểm và học sinh gửi điểm."); }
            catch (_) { if (requestEpoch === epoch) { ready = false; message("Chưa tải được danh mục. Phần nhập điểm vẫn dùng các lựa chọn hiện có; hãy thử lại sau.", true); } }
            finally { if (requestEpoch === epoch) { busy = false; lock(); } }
        }
        mount.querySelector("[data-options-add]").addEventListener("click", () => {
            if (busy || !ready) return;
            const input = document.getElementById("scoreOptionsNewPeriod"), label = input.value.trim().replace(/\s+/g, " ");
            if (!label) { message("Nhập tên kỳ thi mới trước khi thêm.", true); input.focus(); return; }
            draft.periods = [...form.querySelectorAll("[data-options-period]")].map(input => ({ key: input.dataset.optionsPeriod, label: input.value, short: input.value.slice(0, 24) }));
            if (draft.periods.length >= 60) { message("Danh mục có tối đa 60 kỳ thi.", true); return; }
            if (draft.periods.some(period => period.label.toLocaleLowerCase("vi") === label.toLocaleLowerCase("vi"))) { message("Kỳ thi này đã có trong danh mục.", true); return; }
            const slug = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
            let key = `ky_${slug || "thi"}`, suffix = 2;
            while (draft.periods.some(period => period.key === key)) key = `ky_${slug || "thi"}_${suffix++}`;
            draft.periods.push({ key, label, short: label.slice(0, 24) });
            drawPeriods(); input.value = ""; dirty = true; message("Đã thêm kỳ thi vào bản chỉnh sửa. Bấm Lưu danh mục để sử dụng.");
        });
        form.addEventListener("input", event => { if (!event.target.matches("#scoreOptionsNewPeriod")) { dirty = true; message("Chưa lưu thay đổi danh mục."); } });
        form.addEventListener("submit", async event => {
            event.preventDefault();
            if (busy || !ready || !form.reportValidity()) return;
            let next; try { next = values(); } catch (error) { message(error.message, true); return; }
            const requestEpoch = epoch;
            busy = true; lock(); message("Đang lưu danh mục...");
            try {
                const { data, error } = await client.from("site_configuration").update({ value: next }).eq("id", "score_options").eq("updated_at", draftVersion).select("value,updated_at").maybeSingle();
                if (requestEpoch !== epoch) return;
                if (error) throw error;
                if (!data?.updated_at) { message("Danh mục đã thay đổi ở phiên khác. Bản chỉnh sửa đang được giữ; hãy sao chép phần cần giữ rồi bấm Tải lại danh mục trước khi lưu lại.", true); return; }
                readVersion = data.updated_at;
                api.configure(next); api.observeRecords(observed); sync(); fill(); message("Đã lưu danh mục. Các ô chọn kỳ thi và khối đã được cập nhật.");
            } catch (_) { if (requestEpoch === epoch) message("Chưa lưu được danh mục. Kiểm tra kết nối và quyền admin rồi thử lại; bản chỉnh sửa vẫn được giữ.", true); }
            finally { if (requestEpoch === epoch) { busy = false; lock(); } }
        });
        mount.querySelector("[data-options-refresh]").addEventListener("click", () => { if (!dirty || confirm("Tải lại danh mục sẽ bỏ thay đổi chưa lưu. Tiếp tục?")) loadAdmin(true); });
        resetAdmin = () => { ready = busy = dirty = false; fill(); message(""); lock(); };
        controller = { load: loadAdmin, clear, observeRecords };
        lock();
        return controller;
    }
    function clear() { epoch++; pending = null; readVersion = null; observed = []; api.configure({}); resetAdmin?.(); sync(); }
    window.ExamScoreOptions = { init, load, clear, sync, observeRecords, selectOptions };
}());
