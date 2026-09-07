(function () {
    "use strict";
    const api = window.ExamScores;
    let records = [], page = 1, editingId = null, pending = null, busy = false, loading = false, ready = false;
    const perPage = 10;
    const form = $("scoreForm");
    $("scoreYear").value = api.schoolYear();
    function reset(keepContext = false) {
        const context = ["scorePeriod", "scoreGrade", "scoreYear", "scoreClass", "scorePublished"].map(id => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value]);
        editingId = null;
        form.reset();
        $("scoreYear").value = api.schoolYear();
        if (keepContext) context.forEach(([id, value]) => { if ($(id).type === "checkbox") $(id).checked = value; else $(id).value = value; });
        $("scoreFormTitle").textContent = "Nhập điểm thi";
        $("scoreSaveLabel").textContent = "Lưu điểm";
        setStatus("scoreFormStatus", "");
    }
    function lock(locked) {
        busy = locked;
        $("scoreFormFields").disabled = locked || loading || !ready;
        $("scoreAdminRefresh").disabled = locked || loading;
        $("scoreAdminRows").querySelectorAll("button").forEach(button => { button.disabled = locked || loading; });
        form.setAttribute("aria-busy", String(locked || loading));
    }
    function render() {
        const query = $("scoreAdminSearch").value.trim().toLocaleLowerCase("vi");
        const visibility = $("scoreAdminVisibility").value;
        const filtered = api.filter(records, { period: $("scoreAdminPeriod").value }).filter(row =>
            (!query || `${row.class_name} ${row.school_year} ${row.grade}`.toLocaleLowerCase("vi").includes(query)) &&
            (visibility === "all" || row.published === (visibility === "published"))
        );
        const result = pageItems(filtered, page, perPage);
        page = result.page;
        $("scoreAdminRows").innerHTML = result.items.map(row => `<tr>
            <td class="exam-record-score">${api.format(row.score)}</td>
            <td>${esc(row.class_name)}<span class="exam-record-meta">Khối ${row.grade} · ${esc(row.school_year)}</span></td>
            <td>${api.label(row.period)}</td><td><span class="status-pill ${row.published ? "on" : "off"}">${row.published ? "Đã công bố" : "Đang ẩn"}</span></td>
            <td><div class="doc-actions">
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="edit" data-score-id="${esc(row.id)}" title="Sửa điểm" aria-label="Sửa điểm"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="toggle" data-score-id="${esc(row.id)}" title="${row.published ? "Ẩn điểm" : "Công bố điểm"}" aria-label="${row.published ? "Ẩn điểm" : "Công bố điểm"}"><i class="fa-solid ${row.published ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i></button>
                <button class="admin-btn danger icon-btn" type="button" data-score-action="delete" data-score-id="${esc(row.id)}" title="Xóa điểm" aria-label="Xóa điểm"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </div></td>
        </tr>`).join("");
        setStatus("scoreAdminStatus", filtered.length ? `${filtered.length} bài thi · ${filtered.filter(row => row.published).length} đã công bố` : "Chưa có điểm thi phù hợp.");
        renderPagination("scoreAdminPagination", page, result.totalPages, next => { page = next; render(); }, filtered.length, perPage);
        lock(busy);
    }
    async function load() {
        if ($("adminPanel").classList.contains("hidden")) return;
        if (pending) return pending;
        loading = true;
        lock(busy);
        setStatus("scoreAdminStatus", "Đang tải điểm thi...");
        pending = (async () => {
            try {
                records = await api.fetchAll(supabaseClient);
                ready = true;
                $("scoreSetupHelp").classList.add("hidden");
                $("scoreClassSuggestions").replaceChildren(...[...new Set(records.map(row => row.class_name))].sort().map(value => new Option(value, value)));
                render();
            } catch (error) {
                ready = false;
                records = [];
                $("scoreAdminRows").replaceChildren();
                $("scoreAdminPagination").replaceChildren();
                setStatus("scoreAdminStatus", api.errorMessage(error, true));
                $("scoreSetupHelp").classList.toggle("hidden", !["42P01", "PGRST205", "42501"].includes(error.code));
            } finally { pending = null; loading = false; lock(busy); }
        })();
        return pending;
    }
    function startEdit(row) {
        editingId = row.id;
        $("scorePeriod").value = row.period;
        $("scoreValue").value = api.format(row.score);
        $("scoreGrade").value = row.grade;
        $("scoreYear").value = row.school_year;
        $("scoreClass").value = row.class_name;
        $("scorePublished").checked = row.published;
        $("scoreFormTitle").textContent = "Sửa điểm thi";
        $("scoreSaveLabel").textContent = "Cập nhật điểm";
        setStatus("scoreFormStatus", "");
        form.scrollIntoView({ behavior: "auto", block: "center" });
        $("scoreValue").focus({ preventScroll: true });
    }
    function writeError(error) {
        if (error.code === "PGRST116") return "Bản ghi không còn tồn tại hoặc bạn không có quyền sửa. Hãy làm mới danh sách.";
        return api.errorMessage(error, true);
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy || loading || !ready || !form.reportValidity()) return;
        let payload;
        try {
            payload = api.validate({ period: $("scorePeriod").value, score: $("scoreValue").value, grade: $("scoreGrade").value,
                class_name: $("scoreClass").value, school_year: $("scoreYear").value, published: $("scorePublished").checked });
        } catch (error) { setStatus("scoreFormStatus", error.message); return; }
        const wasEditing = editingId !== null;
        lock(true);
        setStatus("scoreFormStatus", "Đang lưu điểm thi...");
        try {
            const query = wasEditing ? supabaseClient.from("exam_scores").update(payload).eq("id", editingId) : supabaseClient.from("exam_scores").insert(payload);
            const { error } = await query.select("id").single();
            if (error) throw error;
            reset(true);
            if (!wasEditing) page = 1;
            await load();
            setStatus("scoreFormStatus", "Đã lưu điểm thi.", true);
            toast(wasEditing ? "Đã cập nhật điểm thi." : "Đã lưu điểm thi.", "ok");
        } catch (error) { setStatus("scoreFormStatus", writeError(error)); }
        finally { lock(false); if (!wasEditing && !editingId) $("scoreValue").focus(); }
    });
    $("scoreAdminRows").addEventListener("click", async event => {
        const button = event.target.closest("[data-score-action]");
        if (!button || busy || loading) return;
        const row = records.find(row => row.id === button.dataset.scoreId);
        if (!row) return;
        const action = button.dataset.scoreAction;
        if (action === "edit") { startEdit(row); return; }
        if (action === "delete" && !confirm(`Xóa vĩnh viễn điểm ${api.format(row.score)} của lớp ${row.class_name}, ${api.label(row.period)}, năm ${row.school_year}?`)) return;
        lock(true);
        try {
            const query = action === "delete" ? supabaseClient.from("exam_scores").delete() : supabaseClient.from("exam_scores").update({ published: !row.published });
            const { error } = await query.eq("id", row.id).select("id").single();
            if (error) throw error;
            if (editingId === row.id) {
                if (action === "delete") reset();
                else $("scorePublished").checked = !row.published;
            }
            await load();
            toast(action === "delete" ? "Đã xóa điểm thi." : row.published ? "Đã ẩn điểm khỏi thống kê." : "Đã công bố điểm thi.", "ok");
        } catch (error) { toast(writeError(error), "error"); }
        finally { lock(false); }
    });
    $("scoreResetBtn").addEventListener("click", () => { if (!busy) reset(); });
    $("scoreAdminRefresh").addEventListener("click", () => { if (!busy) load(); });
    ["scoreAdminSearch", "scoreAdminPeriod", "scoreAdminVisibility"].forEach(id => {
        $(id).addEventListener(id === "scoreAdminSearch" ? "input" : "change", () => { page = 1; if (ready) render(); });
    });
    window.examScoreAdmin = { load };
    lock(false);
    if ($("scoresWorkspace").classList.contains("active")) load();
}());
