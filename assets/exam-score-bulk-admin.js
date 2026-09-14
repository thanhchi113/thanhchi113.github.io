(function () {
    "use strict";
    const mount = document.getElementById("scoreBulkTools");
    const rows = document.getElementById("scoreAdminRows");
    const admin = window.examScoreAdmin;
    const scores = window.ExamScores;
    if (!mount || !rows || !admin?.getState || !admin?.mutateRows || !scores) return;

    const selected = new Set();
    let epoch, filterKey = null, submitting = false;
    const visibilityFields = [
        ["published", "Thẻ điểm", "Công bố", "Ẩn thẻ"],
        ["show_student_name", "Tên học sinh"], ["show_image", "Ảnh học sinh"],
        ["show_score", "Điểm số"], ["show_class_name", "Lớp / khóa học"],
        ["show_grade", "Khối"], ["show_school_year", "Năm học"], ["show_period", "Kỳ thi"]
    ];
    mount.classList.add("score-bulk-tools");
    mount.innerHTML = `<div class="score-bulk-toolbar">
        <span id="scoreBulkCount" class="score-bulk-count" role="status" aria-live="polite">Chưa chọn bài thi</span>
        <div class="score-bulk-selection-actions">
            <button type="button" class="admin-btn ghost" id="scoreBulkSelectPage">Chọn trang này</button>
            <button type="button" class="admin-btn ghost" id="scoreBulkSelectAll">Chọn tất cả kết quả</button>
            <button type="button" class="admin-btn ghost" id="scoreBulkClear">Bỏ chọn</button>
        </div>
    </div>
    <details class="score-bulk-editor">
        <summary>Chỉnh sửa hàng loạt <span>Thông tin và quyền hiển thị</span></summary>
        <p class="score-bulk-hint">Chọn bài thi trong danh sách, rồi chọn các thông tin cần đổi. Mục để trống hoặc “Giữ nguyên” sẽ không thay đổi. Lựa chọn được giữ khi chuyển trang.</p>
        <form id="scoreBulkForm">
            <fieldset id="scoreBulkFields" disabled>
                <legend class="score-bulk-group-title">Cập nhật thông tin</legend>
                <div class="score-bulk-edit-grid">
                    <label>Lớp / khóa học<input data-score-bulk-field="class_name" maxlength="80" list="scoreClassSuggestions" placeholder="Giữ nguyên" autocomplete="off"></label>
                    <label>Năm học<input data-score-bulk-field="school_year" maxlength="9" list="scoreYearSuggestions" placeholder="Giữ nguyên · 2026-2027" autocomplete="off"></label>
                    <label>Kỳ thi<select data-score-bulk-field="period"><option value="">Giữ nguyên</option></select></label>
                    <label>Khối<select data-score-bulk-field="grade"><option value="">Giữ nguyên</option></select></label>
                    <label>Điểm số<input data-score-bulk-field="score" inputmode="decimal" maxlength="6" placeholder="Giữ nguyên · từ 0 đến 10" autocomplete="off"></label>
                </div>
                <h4 class="score-bulk-group-title">Hiển thị trên website</h4>
                <div class="score-bulk-visibility-grid">${visibilityFields.map(([field, label, on = "Hiện", off = "Ẩn"]) => `<label>${label}<select data-score-bulk-field="${field}"><option value="">Giữ nguyên</option><option value="true">${on}</option><option value="false">${off}</option></select></label>`).join("")}</div>
                <div class="score-bulk-apply-actions">
                    <button type="submit" class="admin-btn success" id="scoreBulkApply">Áp dụng cho bài thi đã chọn</button>
                    <button type="button" class="admin-btn ghost" id="scoreBulkReset">Đặt lại lựa chọn chỉnh sửa</button>
                    <button type="button" class="admin-btn danger" id="scoreBulkDelete">Xóa bài thi đã chọn</button>
                </div>
            </fieldset>
        </form>
    </details>
    <div id="scoreBulkStatus" class="admin-status score-bulk-status" role="status" aria-live="polite"></div>`;

    const find = id => document.getElementById(id);
    const form = find("scoreBulkForm");
    const status = find("scoreBulkStatus");
    const idsOf = list => (list || []).map(row => typeof row === "string" ? row : row.id);
    const currentFilter = () => ["scoreAdminSearch", "scoreAdminPeriod", "scoreAdminVisibility"].map(id => find(id)?.value || "").join("\u001f");
    const available = state => state.ready && !state.busy && !submitting;

    function message(text, error = false) {
        status.replaceChildren();
        status.textContent = text;
        status.dataset.error = String(error);
    }
    function syncOptions() {
        const options = scores.getOptions();
        [["period", options.periods.map(period => [period.key, period.label])], ["grade", options.grades.map(grade => [String(grade), `Khối ${grade}`])]].forEach(([field, entries]) => {
            const select = form.querySelector(`[data-score-bulk-field="${field}"]`);
            const value = select.value;
            select.replaceChildren(new Option("Giữ nguyên", ""), ...entries.map(([key, label]) => new Option(label, key)));
            if ([...select.options].some(option => option.value === value)) select.value = value;
        });
    }
    function sync() {
        const state = admin.getState();
        if (epoch !== state.epoch) {
            selected.clear();
            submitting = false;
            epoch = state.epoch;
            filterKey = currentFilter();
            form.reset();
            message("");
        }
        if (state.ready) {
            const existing = new Set(idsOf(state.records));
            for (const id of selected) if (!existing.has(id)) selected.delete(id);
            const nextFilter = currentFilter();
            if (nextFilter !== filterKey || (!state.busy && !submitting)) {
                const matching = new Set(idsOf(state.filtered));
                for (const id of selected) if (!matching.has(id)) selected.delete(id);
                filterKey = nextFilter;
            }
        }
        const enabled = available(state);
        const pageIds = state.pageIds || [];
        const filteredIds = idsOf(state.filtered);
        rows.querySelectorAll("input[data-score-select]").forEach(input => {
            input.checked = selected.has(input.value);
            input.disabled = !enabled;
            input.closest("tr")?.classList.toggle("score-record-selected", input.checked);
        });
        find("scoreBulkCount").textContent = selected.size ? `Đã chọn ${selected.size} bài thi` : "Chưa chọn bài thi";
        find("scoreBulkSelectPage").disabled = !enabled || !pageIds.length || pageIds.every(id => selected.has(id));
        find("scoreBulkSelectAll").textContent = `Chọn tất cả ${filteredIds.length} kết quả`;
        find("scoreBulkSelectAll").disabled = !enabled || !filteredIds.length || filteredIds.every(id => selected.has(id));
        find("scoreBulkClear").disabled = !enabled || !selected.size;
        find("scoreBulkFields").disabled = !enabled || !selected.size;
        find("scoreBulkApply").textContent = selected.size ? `Áp dụng cho ${selected.size} bài thi đã chọn` : "Áp dụng cho bài thi đã chọn";
        find("scoreBulkDelete").textContent = selected.size ? `Xóa ${selected.size} bài thi đã chọn` : "Xóa bài thi đã chọn";
        mount.setAttribute("aria-busy", String(state.busy || submitting));
    }
    function selectItems(ids) {
        if (!available(admin.getState())) return;
        ids.forEach(id => selected.add(id));
        message("");
        sync();
    }
    function readPatch() {
        const patch = {};
        form.querySelectorAll("[data-score-bulk-field]").forEach(input => {
            const value = input.value.trim();
            if (!value) return;
            const field = input.dataset.scoreBulkField;
            if (field === "show_student_name") patch.hide_student_name = value !== "true";
            else if (visibilityFields.some(([key]) => key === field)) patch[field] = value === "true";
            else patch[field] = value;
        });
        return patch;
    }
    function showResult(result, remove) {
        const succeeded = result.succeeded || [], failed = result.failed || [], skipped = result.skipped || [];
        succeeded.forEach(id => selected.delete(id));
        message([
            succeeded.length ? `Đã ${remove ? "xóa" : "cập nhật"} ${succeeded.length} bài thi.` : "",
            skipped.length ? `${skipped.length} bài thi chưa được xử lý; hãy kiểm tra phiên đăng nhập rồi thử lại.` : "",
            failed.length ? `${failed.length} bài thi chưa ${remove ? "xóa" : "lưu"} được; các mục này vẫn được chọn để thử lại.` : ""
        ].filter(Boolean).join(" ") || "Không có bài thi nào được thay đổi.", !!failed.length || !!result.warnings?.length);
        if (failed.length) {
            const list = document.createElement("ul");
            failed.slice(0, 8).forEach(item => {
                const entry = document.createElement("li");
                entry.textContent = `${item.name || "Bài thi"}: ${item.message || "Chưa thể lưu thay đổi."}`;
                list.appendChild(entry);
            });
            if (failed.length > 8) {
                const entry = document.createElement("li");
                entry.textContent = `Và ${failed.length - 8} bài thi khác chưa được cập nhật.`;
                list.appendChild(entry);
            }
            status.appendChild(list);
        }
        (result.warnings || []).forEach(warning => {
            const paragraph = document.createElement("p");
            paragraph.textContent = warning;
            status.appendChild(paragraph);
        });
        if (!failed.length) form.reset();
    }
    async function apply(remove = false) {
        const state = admin.getState();
        if (!available(state) || !selected.size) return;
        const ids = [...selected];
        const patch = remove ? {} : readPatch();
        if (!remove && !Object.keys(patch).length) { message("Hãy chọn ít nhất một thông tin cần thay đổi."); return; }
        if (!remove && !form.reportValidity()) return;
        if (remove && !window.confirm(`Xóa ${ids.length} bài thi đã chọn và ảnh đính kèm của các bài thi này? Thao tác này không thể hoàn tác.`)) return;
        const requestEpoch = state.epoch;
        submitting = true;
        message(`Đang ${remove ? "xóa" : "cập nhật"} ${ids.length} bài thi...`);
        sync();
        try {
            const result = await admin.mutateRows(ids, patch, remove);
            if (admin.getState().epoch !== requestEpoch) return;
            showResult(result, remove);
        } catch (error) {
            if (admin.getState().epoch === requestEpoch) message(error.message || "Chưa thể xử lý. Các bài thi vẫn được chọn để bạn thử lại.", true);
        } finally {
            if (admin.getState().epoch === requestEpoch) {
                submitting = false;
                sync();
            }
        }
    }
    find("scoreBulkSelectPage").addEventListener("click", () => selectItems(admin.getState().pageIds || []));
    find("scoreBulkSelectAll").addEventListener("click", () => selectItems(idsOf(admin.getState().filtered)));
    find("scoreBulkClear").addEventListener("click", () => { if (available(admin.getState())) { selected.clear(); message(""); sync(); } });
    find("scoreBulkReset").addEventListener("click", () => { if (available(admin.getState())) { form.reset(); message(""); } });
    find("scoreBulkDelete").addEventListener("click", () => apply(true));
    rows.addEventListener("change", event => {
        const input = event.target.closest("input[data-score-select]");
        if (!input) return;
        if (!available(admin.getState())) { sync(); return; }
        if (input.checked) selected.add(input.value);
        else selected.delete(input.value);
        message("");
        sync();
    });
    form.addEventListener("submit", event => { event.preventDefault(); apply(); });
    window.addEventListener("exam-score-admin-change", sync);
    window.addEventListener("exam-score-options-change", syncOptions);
    syncOptions();
    sync();
}());
