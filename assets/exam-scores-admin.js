(function () {
    "use strict";
    const api = window.ExamScores;
    let records = [], page = 1, editingId = null, pending = null, busy = false, loading = false, ready = false, authEpoch = 0;
    let selectedImage = null, storedImagePath = null, storedImageName = null, removeImage = false, localImageUrl = null, imageRequest = 0;
    const imageBucket = "exam-score-evidence";
    const imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const perPage = 10;
    const form = $("scoreForm");
    $("scoreYear").value = api.schoolYear();
    function clearImage() {
        imageRequest++;
        if (localImageUrl) URL.revokeObjectURL(localImageUrl);
        selectedImage = storedImagePath = storedImageName = localImageUrl = null;
        removeImage = false;
        $("scoreImageInput").value = "";
        setStatus("scoreImageStatus", "");
    }
    async function renderImage() {
        const request = ++imageRequest;
        const visibleStoredImage = storedImagePath && !removeImage;
        $("scoreImageName").textContent = selectedImage ? selectedImage.name : visibleStoredImage ? storedImageName || "Ảnh xác nhận hiện tại" : "Chưa đính kèm ảnh";
        $("scoreRemoveImage").hidden = !selectedImage && !visibleStoredImage;
        $("scorePreviewImage").hidden = true;
        $("scorePreviewImage").removeAttribute("src");
        $("scorePreviewFallback").hidden = false;
        if ($("scoreHideName").checked) return;
        try {
            const url = localImageUrl || (visibleStoredImage ? await api.signedImageUrl(supabaseClient, storedImagePath) : null);
            if (request !== imageRequest || !url) return;
            $("scorePreviewImage").src = url;
            $("scorePreviewImage").hidden = false;
            $("scorePreviewFallback").hidden = true;
        } catch (error) {
            if (request === imageRequest) setStatus("scoreImageStatus", "Không tải được ảnh đã lưu. Bạn vẫn có thể sửa thông tin hoặc chọn ảnh khác.");
        }
    }
    function chooseImage(files) {
        if (busy || loading || !ready || !files?.length) return;
        const file = files[0];
        if (files.length !== 1 || !imageExtensions[file.type] || file.size > 10 * 1024 * 1024 || !file.size) {
            $("scoreImageInput").value = "";
            setStatus("scoreImageStatus", "Hãy chọn một ảnh PNG, JPG hoặc WebP, dung lượng tối đa 10 MB.");
            return;
        }
        if (localImageUrl) URL.revokeObjectURL(localImageUrl);
        selectedImage = file;
        localImageUrl = URL.createObjectURL(file);
        removeImage = false;
        setStatus("scoreImageStatus", "");
        renderImage();
    }
    async function cleanupImage(path) {
        if (!path) return true;
        try {
            const { error } = await supabaseClient.storage.from(imageBucket).remove([path]);
            return !error;
        } catch (error) { return false; }
    }
    function renderPreview() {
        const hideName = $("scoreHideName").checked;
        const number = editingId ? Math.max(1, records.findIndex(row => row.id === editingId) + 1) : records.length + 1;
        $("scoreEntryNumber").textContent = number;
        $("scorePreviewNumber").textContent = `STT ${number}`;
        $("scorePreviewName").textContent = hideName ? "Tên học sinh" : $("scoreStudentName").value.trim() || "Tên học sinh";
        $("scorePreviewName").classList.toggle("is-name-hidden", hideName);
        if (hideName) $("scorePreviewName").setAttribute("aria-label", "Tên học sinh đã được ẩn");
        else $("scorePreviewName").removeAttribute("aria-label");
        $("scorePreviewClass").textContent = `${$("scoreClass").value.trim() || "Lớp / khóa học"} · Khối ${$("scoreGrade").value}`;
        $("scorePreviewPeriod").textContent = api.label($("scorePeriod").value);
        $("scorePreviewValue").textContent = api.format(api.parseScore($("scoreValue").value));
        const paper = $("scorePreviewFallback"), score = api.parseScore($("scoreValue").value);
        const paperScore = api.format(score);
        if (paper.dataset.score !== paperScore && window.ExamScorePaper) {
            paper.innerHTML = window.ExamScorePaper.render(score) + '<span>Thành tích học tập</span>';
            paper.dataset.score = paperScore;
        }
        $("scorePreviewYear").textContent = $("scoreYear").value.trim() || "—";
        $("scorePreviewVisibility").textContent = $("scorePublished").checked ? "Sẽ công bố" : "Bản nháp · chỉ admin";
        $("scorePreviewPrivacyNote").textContent = !$("scorePublished").checked ? "Thẻ và điểm này chỉ hiển thị trong trang admin." : hideName ? "Tên và ảnh xác nhận được ẩn trên website. Admin vẫn giữ đầy đủ thông tin để chỉnh sửa." : "Tên, điểm và ảnh xác nhận sẽ hiển thị trên trang thành tích.";
        $("scorePreviewCard").dataset.published = String($("scorePublished").checked);
    }
    function reset(keepContext = false) {
        const context = ["scorePeriod", "scoreGrade", "scoreYear", "scoreClass", "scorePublished"].map(id => [id, $(id).type === "checkbox" ? $(id).checked : $(id).value]);
        editingId = null;
        form.reset();
        clearImage();
        $("scoreYear").value = api.schoolYear();
        if (keepContext) context.forEach(([id, value]) => { if ($(id).type === "checkbox") $(id).checked = value; else $(id).value = value; });
        $("scoreFormTitle").textContent = "Nhập điểm thi";
        $("scoreSaveLabel").textContent = "Lưu điểm";
        setStatus("scoreFormStatus", "");
        renderPreview();
        renderImage();
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
            (!query || `${row.student_name || ""} ${row.class_name} ${row.school_year} ${row.grade}`.toLocaleLowerCase("vi").includes(query)) &&
            (visibility === "all" || row.published === (visibility === "published"))
        );
        const result = pageItems(filtered, page, perPage);
        page = result.page;
        $("scoreAdminRows").innerHTML = result.items.map((row, index) => `<tr>
            <td class="exam-record-number">${(page - 1) * perPage + index + 1}</td>
            <td class="exam-record-score">${api.format(row.score)}</td>
            <td><span class="exam-record-name">${esc(row.student_name || "Chưa có tên học sinh")}</span>${esc(row.class_name)}<span class="exam-record-meta">Khối ${row.grade} · ${esc(row.school_year)}</span></td>
            <td>${api.label(row.period)}</td><td><span class="status-pill ${row.published ? "on" : "off"}">${row.published ? "Đã công bố" : "Đang ẩn"}</span>${row.hide_student_name ? '<span class="exam-record-privacy">Ẩn tên và ảnh</span>' : ''}</td>
            <td><div class="doc-actions">
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="edit" data-score-id="${esc(row.id)}" title="Sửa điểm" aria-label="Sửa điểm"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="toggle" data-score-id="${esc(row.id)}" title="${row.published ? "Ẩn điểm" : "Công bố điểm"}" aria-label="${row.published ? "Ẩn điểm" : "Công bố điểm"}"><i class="fa-solid ${row.published ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i></button>
                <button class="admin-btn danger icon-btn" type="button" data-score-action="delete" data-score-id="${esc(row.id)}" title="Xóa điểm" aria-label="Xóa điểm"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </div></td>
        </tr>`).join("");
        setStatus("scoreAdminStatus", filtered.length ? `${filtered.length} bài thi · ${filtered.filter(row => row.published).length} đã công bố` : "Chưa có điểm thi phù hợp.");
        renderPagination("scoreAdminPagination", page, result.totalPages, next => { page = next; render(); }, filtered.length, perPage);
        renderPreview();
        lock(busy);
    }
    async function load() {
        if ($("adminPanel").classList.contains("hidden")) return;
        if (pending) return pending;
        loading = true;
        const requestEpoch = authEpoch;
        lock(busy);
        setStatus("scoreAdminStatus", "Đang tải điểm thi...");
        pending = (async () => {
            try {
                const loaded = await api.fetchAll(supabaseClient);
                if (requestEpoch !== authEpoch) return;
                records = loaded;
                ready = true;
                $("scoreSetupHelp").classList.add("hidden");
                $("scoreClassSuggestions").replaceChildren(...[...new Set(records.map(row => row.class_name))].sort().map(value => new Option(value, value)));
                render();
            } catch (error) {
                if (requestEpoch !== authEpoch) return;
                ready = false;
                records = [];
                $("scoreAdminRows").replaceChildren();
                $("scoreAdminPagination").replaceChildren();
                setStatus("scoreAdminStatus", api.errorMessage(error, true));
                $("scoreSetupHelp").classList.toggle("hidden", !["42P01", "PGRST205", "42703", "PGRST204", "42501"].includes(error.code));
            } finally { if (requestEpoch === authEpoch) { pending = null; loading = false; lock(busy); } }
        })();
        return pending;
    }
    function startEdit(row) {
        editingId = row.id;
        clearImage();
        storedImagePath = row.evidence_image_path || null;
        storedImageName = row.evidence_image_name || null;
        $("scoreStudentName").value = row.student_name || "";
        $("scorePeriod").value = row.period;
        $("scoreValue").value = api.format(row.score);
        $("scoreGrade").value = row.grade;
        $("scoreYear").value = row.school_year;
        $("scoreClass").value = row.class_name;
        $("scorePublished").checked = row.published;
        $("scoreHideName").checked = Boolean(row.hide_student_name);
        $("scoreFormTitle").textContent = "Sửa điểm thi";
        $("scoreSaveLabel").textContent = "Cập nhật điểm";
        setStatus("scoreFormStatus", "");
        renderPreview();
        renderImage();
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
            payload = api.validate({ student_name: $("scoreStudentName").value, period: $("scorePeriod").value, score: $("scoreValue").value, grade: $("scoreGrade").value,
                class_name: $("scoreClass").value, school_year: $("scoreYear").value, published: $("scorePublished").checked, hide_student_name: $("scoreHideName").checked });
        } catch (error) { setStatus("scoreFormStatus", error.message); return; }
        const wasEditing = editingId !== null;
        const oldImagePath = storedImagePath;
        let uploadedPath = null, committed = false, imageCleanupFailed = false;
        lock(true);
        setStatus("scoreFormStatus", "Đang lưu điểm thi...");
        try {
            let imagePath = removeImage ? null : storedImagePath;
            let imageName = removeImage ? null : storedImageName;
            if (selectedImage) {
                setStatus("scoreFormStatus", "Đang tải ảnh xác nhận điểm...");
                const path = `scores/${crypto.randomUUID()}.${imageExtensions[selectedImage.type]}`;
                const { error: uploadError } = await supabaseClient.storage.from(imageBucket).upload(path, selectedImage, { contentType: selectedImage.type, upsert: false });
                if (uploadError) throw uploadError;
                uploadedPath = path;
                imagePath = path;
                imageName = selectedImage.name;
            }
            payload.evidence_image_path = imagePath;
            payload.evidence_image_name = imageName;
            const query = wasEditing ? supabaseClient.from("exam_scores").update(payload).eq("id", editingId) : supabaseClient.from("exam_scores").insert(payload);
            const { error } = await query.select("id").single();
            if (error) throw error;
            committed = true;
            if (oldImagePath && oldImagePath !== imagePath) imageCleanupFailed = !await cleanupImage(oldImagePath);
            reset(true);
            if (!wasEditing) page = 1;
            await load();
            setStatus("scoreFormStatus", imageCleanupFailed ? "Đã lưu điểm thi. Chưa dọn được ảnh cũ khỏi kho lưu trữ." : "Đã lưu điểm thi.", !imageCleanupFailed);
            toast(wasEditing ? "Đã cập nhật điểm thi." : "Đã lưu điểm thi.", "ok");
        } catch (error) {
            if (uploadedPath && !committed) await cleanupImage(uploadedPath);
            setStatus("scoreFormStatus", committed ? "Đã lưu điểm thi nhưng chưa làm mới được danh sách. Hãy bấm làm mới." : writeError(error));
        }
        finally { lock(false); if (!wasEditing && !editingId) $("scoreStudentName").focus(); }
    });
    $("scoreAdminRows").addEventListener("click", async event => {
        const button = event.target.closest("[data-score-action]");
        if (!button || busy || loading) return;
        const row = records.find(row => row.id === button.dataset.scoreId);
        if (!row) return;
        const action = button.dataset.scoreAction;
        if (action === "edit") { startEdit(row); return; }
        if (action === "delete" && !confirm(`Xóa vĩnh viễn điểm ${api.format(row.score)} của ${row.student_name ? row.student_name + ", lớp " : "lớp "}${row.class_name}, ${api.label(row.period)}, năm ${row.school_year}?`)) return;
        lock(true);
        try {
            const query = action === "delete" ? supabaseClient.from("exam_scores").delete() : supabaseClient.from("exam_scores").update({ published: !row.published });
            const { error } = await query.eq("id", row.id).select("id").single();
            if (error) throw error;
            const cleanupFailed = action === "delete" && row.evidence_image_path && !await cleanupImage(row.evidence_image_path);
            if (editingId === row.id) {
                if (action === "delete") reset();
                else $("scorePublished").checked = !row.published;
                renderPreview();
            }
            await load();
            toast(cleanupFailed ? "Đã xóa điểm nhưng chưa dọn được ảnh xác nhận khỏi kho lưu trữ." : action === "delete" ? "Đã xóa điểm thi." : row.published ? "Đã ẩn điểm khỏi thống kê." : "Đã công bố điểm thi.", cleanupFailed ? "error" : "ok");
        } catch (error) { toast(writeError(error), "error"); }
        finally { lock(false); }
    });
    $("scoreResetBtn").addEventListener("click", () => { if (!busy) reset(); });
    $("scoreAdminRefresh").addEventListener("click", () => { if (!busy) load(); });
    $("scoreImageInput").addEventListener("change", event => chooseImage(event.target.files));
    $("scoreHideName").addEventListener("change", renderImage);
    $("scoreRemoveImage").addEventListener("click", () => {
        if (busy || loading) return;
        if (localImageUrl) URL.revokeObjectURL(localImageUrl);
        localImageUrl = selectedImage = null;
        removeImage = true;
        $("scoreImageInput").value = "";
        setStatus("scoreImageStatus", "Ảnh sẽ được bỏ khi lưu điểm thi.");
        renderImage();
    });
    ["dragenter", "dragover"].forEach(type => $("scoreImageDropZone").addEventListener(type, event => {
        event.preventDefault();
        if (!busy && !loading && ready) $("scoreImageDropZone").classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach(type => $("scoreImageDropZone").addEventListener(type, event => {
        event.preventDefault();
        $("scoreImageDropZone").classList.remove("drag-over");
        if (type === "drop") chooseImage(event.dataTransfer?.files);
    }));
    $("scorePreviewImage").addEventListener("error", () => {
        $("scorePreviewImage").hidden = true;
        $("scorePreviewFallback").hidden = false;
        setStatus("scoreImageStatus", "Không hiển thị được ảnh này. Hãy chọn lại ảnh PNG, JPG hoặc WebP hợp lệ.");
    });
    window.addEventListener("pagehide", () => { if (localImageUrl) URL.revokeObjectURL(localImageUrl); });
    form.addEventListener("input", renderPreview);
    form.addEventListener("change", renderPreview);
    ["scoreAdminSearch", "scoreAdminPeriod", "scoreAdminVisibility"].forEach(id => {
        $(id).addEventListener(id === "scoreAdminSearch" ? "input" : "change", () => { page = 1; if (ready) render(); });
    });
    function clear() {
        authEpoch++;
        pending = null;
        loading = ready = false;
        records = [];
        page = 1;
        reset();
        $("scoreAdminRows").replaceChildren();
        $("scoreAdminPagination").replaceChildren();
        $("scoreClassSuggestions").replaceChildren();
        setStatus("scoreAdminStatus", "");
        lock(busy);
    }
    window.examScoreAdmin = { load, clear };
    renderPreview();
    renderImage();
    lock(false);
    if ($("scoresWorkspace").classList.contains("active")) load();
}());
