(function () {
    "use strict";
    const api = window.ExamScores;
    let records = [], page = 1, editingId = null, pending = null, busy = false, loading = false, ready = false, authEpoch = 0;
    let selectedImage = null, storedImagePath = null, storedImageName = null, removeImage = false, localImageUrl = null, imageRequest = 0;
    const imageBucket = "exam-score-evidence";
    const imageExtensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const perPage = 10;
    const form = $("scoreForm");
    const visibilityInputs = { show_image: "scoreShowImage", show_score: "scoreShowScore", show_class_name: "scoreShowClassName", show_grade: "scoreShowGrade", show_school_year: "scoreShowSchoolYear", show_period: "scoreShowPeriod" };
    const visibilityLabels = { show_image: "ảnh", show_score: "điểm", show_class_name: "lớp", show_grade: "khối", show_school_year: "năm học", show_period: "kỳ thi" };
    const formVisibility = () => Object.fromEntries(Object.entries(visibilityInputs).map(([key, id]) => [key, $(id).checked]));
    let pageIds = [];
    function filteredRecords() {
        const query = $("scoreAdminSearch").value.trim().toLocaleLowerCase("vi");
        const visibility = $("scoreAdminVisibility").value;
        return api.filter(records, { period: $("scoreAdminPeriod").value }).filter(row =>
            (!query || `${row.student_name || ""} ${row.student_tag || ""} ${row.class_name} ${row.school_year} ${row.grade}`.toLocaleLowerCase("vi").includes(query)) &&
            (visibility === "all" || row.published === (visibility === "published"))
        );
    }
    function notifyList() { window.dispatchEvent(new Event("exam-score-admin-change")); }
    function canManage() { return ready && !$("adminPanel").classList.contains("hidden"); }
    function getState() { return { records, filtered: filteredRecords(), pageIds: [...pageIds], ready: canManage(), busy: busy || loading, epoch: authEpoch }; }
    function quickControls(row) {
        const flags = { hide_student_name: !row.hide_student_name, ...api.visibility(row) };
        return `<div class="score-quick-controls" aria-label="Thông tin công khai của ${esc(row.student_name || row.class_name)}">${Object.entries({ hide_student_name: "Tên", show_image: "Ảnh", show_score: "Điểm", show_class_name: "Lớp", show_grade: "Khối", show_school_year: "Năm học", show_period: "Kỳ thi" }).map(([key, label]) =>
            `<button class="score-quick-toggle" type="button" data-score-field="${key}" data-score-id="${esc(row.id)}" aria-pressed="${flags[key]}" aria-label="Hiện ${label.toLocaleLowerCase("vi")} của ${esc(row.student_name || row.class_name)}" title="${flags[key] ? "Đang hiện · bấm để ẩn" : "Đang ẩn · bấm để hiện"}${key === 'show_image' && !row.evidence_image_path ? ' (chưa có ảnh đính kèm)' : ''}"><span class="score-quick-dot" aria-hidden="true"></span><span>${label}</span></button>`
        ).join("")}</div>`;
    }
    function hiddenFields(row) {
        const flags = api.visibility(row);
        return [...(row.hide_student_name ? ["tên"] : []), ...Object.keys(flags).filter(key => !flags[key]).map(key => visibilityLabels[key])];
    }
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
        if (!$("scoreShowImage").checked) return;
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
        const hideName = !$("scoreShowStudentName").checked;
        const flags = formVisibility();
        const number = editingId ? Math.max(1, records.findIndex(row => row.id === editingId) + 1) : records.length + 1;
        $("scoreEntryNumber").textContent = number;
        $("scorePreviewNumber").textContent = `STT ${number}`;
        $("scorePreviewName").textContent = hideName ? "Tên học sinh" : $("scoreStudentName").value.trim() || "Tên học sinh";
        $("scorePreviewName").classList.toggle("is-name-hidden", hideName);
        if (hideName) $("scorePreviewName").setAttribute("aria-label", "Tên học sinh đã được ẩn");
        else $("scorePreviewName").removeAttribute("aria-label");
        $("scorePreviewClass").textContent = [flags.show_class_name ? $("scoreClass").value.trim() || "Lớp / khóa học" : "", flags.show_grade ? `Khối ${$("scoreGrade").value}` : ""].filter(Boolean).join(" · ");
        $("scorePreviewClass").hidden = !flags.show_class_name && !flags.show_grade;
        $("scorePreviewPeriod").textContent = flags.show_period ? api.label($("scorePeriod").value) : "";
        $("scorePreviewPeriod").hidden = !flags.show_period;
        $("scorePreviewValue").textContent = flags.show_score ? api.format(api.parseScore($("scoreValue").value)) : "";
        $("scorePreviewValue").closest(".exam-admin-result").hidden = !flags.show_score;
        const paper = $("scorePreviewFallback"), score = flags.show_score ? api.parseScore($("scoreValue").value) : null;
        const paperScore = flags.show_score ? api.format(score) : "hidden";
        if (paper.dataset.score !== paperScore && window.ExamScorePaper) {
            paper.innerHTML = (flags.show_score ? window.ExamScorePaper.render(score) : window.EvidenceDisplay.illustration()) + '<span>Thành tích học tập</span>';
            paper.dataset.score = paperScore;
        }
        $("scorePreviewYear").textContent = flags.show_school_year ? $("scoreYear").value.trim() || "—" : "";
        $("scorePreviewYear").closest(".exam-admin-year").hidden = !flags.show_school_year;
        $("scorePreviewVisibility").textContent = $("scorePublished").checked ? "Sẽ công bố" : "Bản nháp · chỉ admin";
        const hidden = hiddenFields({ ...flags, hide_student_name: hideName });
        $("scorePreviewPrivacyNote").textContent = !$("scorePublished").checked ? "Thẻ và điểm này chỉ hiển thị trong trang admin." : hidden.length ? `Đang ẩn: ${hidden.join(", ")}. Admin vẫn giữ đầy đủ thông tin để chỉnh sửa.` : "Các thông tin đã chọn sẽ hiển thị trên trang thành tích.";
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
        $("scoreAdminRows").querySelectorAll("button,input").forEach(button => { button.disabled = locked || loading || !ready; });
        $("scoreAdminPagination").querySelectorAll("button,input").forEach(button => { button.disabled = locked || loading || !ready || button.dataset.scoreDisabled === "true"; });
        ["scoreAdminSearch", "scoreAdminPeriod", "scoreAdminVisibility"].forEach(id => { $(id).disabled = locked || loading; });
        form.setAttribute("aria-busy", String(locked || loading));
        $("scoreAdminRows").setAttribute("aria-busy", String(locked || loading));
        notifyList();
    }
    function render() {
        const filtered = filteredRecords();
        const result = pageItems(filtered, page, perPage);
        page = result.page;
        pageIds = result.items.map(row => row.id);
        $("scoreAdminRows").innerHTML = result.items.map((row, index) => `<tr data-score-row="${esc(row.id)}">
            <td class="score-record-select"><label><input type="checkbox" data-score-select value="${esc(row.id)}" aria-label="Chọn ${esc(row.student_name || row.class_name)} · ${esc(api.label(row.period))}"></label></td>
            <td class="exam-record-number">${(page - 1) * perPage + index + 1}</td>
            <td class="exam-record-score">${api.format(row.score)}</td>
            <td><span class="exam-record-name">${esc(row.student_name || "Chưa có tên học sinh")}</span>${esc(row.class_name)}<span class="exam-record-meta">Khối ${row.grade} · ${esc(row.school_year)}${row.student_tag ? ` · Nhãn: ${esc(row.student_tag)}` : ""}</span></td>
            <td>${esc(api.label(row.period))}</td><td><span class="status-pill ${row.published ? "on" : "off"}">${row.published ? "Đã công bố" : "Đang ẩn"}</span>${hiddenFields(row).length ? `<span class="exam-record-privacy">Ẩn: ${esc(hiddenFields(row).join(", "))}</span>` : ''}${quickControls(row)}</td>
            <td><div class="doc-actions">
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="edit" data-score-id="${esc(row.id)}" title="Sửa điểm" aria-label="Sửa điểm"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
                <button class="admin-btn ghost icon-btn" type="button" data-score-action="toggle" data-score-id="${esc(row.id)}" aria-pressed="${row.published}" title="${row.published ? "Ẩn điểm" : "Công bố điểm"}" aria-label="${row.published ? "Ẩn điểm" : "Công bố điểm"}"><i class="fa-solid ${row.published ? "fa-eye-slash" : "fa-eye"}" aria-hidden="true"></i></button>
                <button class="admin-btn danger icon-btn" type="button" data-score-action="delete" data-score-id="${esc(row.id)}" title="Xóa điểm" aria-label="Xóa điểm"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>
            </div></td>
        </tr>`).join("");
        setStatus("scoreAdminStatus", filtered.length ? `${filtered.length} bài thi · ${filtered.filter(row => row.published).length} đã công bố` : "Chưa có điểm thi phù hợp.");
        renderPagination("scoreAdminPagination", page, result.totalPages, next => { page = next; render(); }, filtered.length, perPage);
        $("scoreAdminPagination").querySelectorAll("button,input").forEach(control => { control.dataset.scoreDisabled = String(control.disabled); });
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
                const [loaded] = await Promise.all([api.fetchAll(supabaseClient), window.ExamScoreOptions?.load().catch(() => {})]);
                if (requestEpoch !== authEpoch) return;
                records = loaded;
                ready = true;
                $("scoreSetupHelp").classList.add("hidden");
                if (window.ExamScoreOptions) window.ExamScoreOptions.observeRecords(records);
                else $("scoreClassSuggestions").replaceChildren(...[...new Set(records.map(row => row.class_name))].sort().map(value => new Option(value, value)));
                render();
                return true;
            } catch (error) {
                if (requestEpoch !== authEpoch) return;
                ready = false;
                records = [];
                pageIds = [];
                $("scoreAdminRows").replaceChildren();
                $("scoreAdminPagination").replaceChildren();
                setStatus("scoreAdminStatus", api.errorMessage(error, true));
                $("scoreSetupHelp").classList.toggle("hidden", !["42P01", "PGRST205", "42703", "PGRST204", "42501"].includes(error.code));
                return false;
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
        $("scoreStudentTag").value = row.student_tag || "";
        $("scorePeriod").value = row.period;
        $("scoreValue").value = api.format(row.score);
        $("scoreGrade").value = row.grade;
        $("scoreYear").value = row.school_year;
        $("scoreClass").value = row.class_name;
        $("scorePublished").checked = row.published;
        $("scoreShowStudentName").checked = !row.hide_student_name;
        const flags = api.visibility(row);
        Object.entries(visibilityInputs).forEach(([key, id]) => { $(id).checked = flags[key]; });
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
    function validatePatch(input) {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Thông tin cập nhật không hợp lệ.");
        const patch = {};
        for (const [key, value] of Object.entries(input)) {
            if (["published", "hide_student_name", ...api.visibilityFields].includes(key)) {
                if (typeof value !== "boolean") throw new Error("Hãy chọn hiện hoặc ẩn cho thông tin cần cập nhật.");
                patch[key] = value;
            } else if (key === "score") {
                patch.score = api.parseScore(value);
                if (patch.score === null) throw new Error("Điểm thi phải nằm trong khoảng 0 đến 10.");
            } else if (key === "grade") {
                patch.grade = Number(value);
                if (!api.grades.includes(patch.grade)) throw new Error("Hãy chọn khối trong danh mục.");
            } else if (key === "period") {
                if (!api.periods.some(period => period.key === value)) throw new Error("Hãy chọn kỳ thi trong danh mục.");
                patch.period = value;
            } else if (key === "school_year") {
                patch.school_year = String(value).trim();
                if (!api.validYear(patch.school_year)) throw new Error("Năm học phải gồm 2 năm liên tiếp, ví dụ 2026-2027.");
            } else if (key === "class_name") {
                patch.class_name = String(value).trim().replace(/\s+/g, " ");
                if (!patch.class_name || patch.class_name.length > 80) throw new Error("Nhập lớp / khóa học, tối đa 80 ký tự.");
            } else throw new Error("Trường thông tin này không hỗ trợ chỉnh sửa hàng loạt.");
        }
        if (!Object.keys(patch).length) throw new Error("Hãy chọn ít nhất một mục cần thay đổi.");
        return patch;
    }
    function syncEditingPatch(id, patch, removed) {
        if (editingId !== id) return;
        if (removed) { reset(); return; }
        const fields = { period: "scorePeriod", grade: "scoreGrade", school_year: "scoreYear", class_name: "scoreClass", score: "scoreValue", published: "scorePublished", hide_student_name: "scoreShowStudentName", ...visibilityInputs };
        for (const [key, value] of Object.entries(patch)) {
            const input = $(fields[key]);
            if (!input) continue;
            if (input.type === "checkbox") input.checked = key === "hide_student_name" ? !value : value;
            else input.value = key === "score" ? api.format(value) : value;
        }
        renderPreview();
        if (Object.hasOwn(patch, "show_image")) renderImage();
    }
    async function mutateRows(ids, input = {}, remove = false) {
        if (!canManage() || busy || loading) throw new Error("Danh sách chưa sẵn sàng. Vui lòng chờ tải xong hoặc đăng nhập lại.");
        if (!Array.isArray(ids) || !ids.length) throw new Error("Hãy chọn ít nhất một học sinh.");
        const patch = remove ? {} : validatePatch(input);
        const snapshot = [...new Set(ids.map(String))].map(id => records.find(row => String(row.id) === id));
        if (snapshot.some(row => !row)) throw new Error("Có điểm thi không còn trong danh sách. Hãy làm mới rồi chọn lại.");
        const result = { succeeded: [], failed: [], skipped: [], warnings: [] };
        const requestEpoch = authEpoch;
        lock(true);
        try {
            for (const [index, row] of snapshot.entries()) {
                if (requestEpoch !== authEpoch || !canManage()) {
                    result.skipped.push(...snapshot.slice(index).map(item => item.id));
                    break;
                }
                try {
                    const query = remove ? supabaseClient.from("exam_scores").delete() : supabaseClient.from("exam_scores").update(patch);
                    const { data, error } = await query.eq("id", row.id).select("id").single();
                    if (error) throw error;
                    if (!data || String(data.id) !== String(row.id)) throw { code: "PGRST116" };
                    result.succeeded.push(row.id);
                    if (requestEpoch === authEpoch && canManage()) {
                        records = remove ? records.filter(item => item.id !== row.id) : records.map(item => item.id === row.id ? { ...item, ...patch } : item);
                        syncEditingPatch(row.id, patch, remove);
                        if (remove && row.evidence_image_path && !await cleanupImage(row.evidence_image_path)) result.warnings.push(`Đã xóa điểm của ${row.student_name || row.class_name}, nhưng chưa dọn được ảnh đính kèm.`);
                    }
                } catch (error) { result.failed.push({ id: row.id, name: row.student_name || row.class_name, message: writeError(error) }); }
            }
            if (requestEpoch === authEpoch && canManage() && !await load()) result.warnings.push("Chưa làm mới được danh sách. Các thay đổi đã lưu không cần thực hiện lại.");
        } finally { if (requestEpoch === authEpoch) lock(false); }
        return result;
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (busy || loading || !ready || !form.reportValidity()) return;
        let payload;
        try {
            const name = $("scoreStudentName").value;
            const className = $("scoreClass").value;
            const year = $("scoreYear").value;
            const usedNumbers = records.map(row => String(row.student_tag || "").match(/^HS-(\d+)$/i)?.[1]).filter(Boolean).map(Number);
            const autoTag = `HS-${String((usedNumbers.length ? Math.max(...usedNumbers) : 0) + 1).padStart(3, "0")}`;
            payload = api.validate({ student_name: name, student_tag: $("scoreStudentTag").value || autoTag, period: $("scorePeriod").value, score: $("scoreValue").value, grade: $("scoreGrade").value,
                class_name: className, school_year: year, published: $("scorePublished").checked, hide_student_name: !$("scoreShowStudentName").checked });
            Object.assign(payload, formVisibility());
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
        const button = event.target.closest("[data-score-action],[data-score-field]");
        if (!button || busy || loading || !canManage()) return;
        const row = records.find(row => row.id === button.dataset.scoreId);
        if (!row) return;
        const action = button.dataset.scoreAction;
        if (action === "edit") { startEdit(row); return; }
        const field = button.dataset.scoreField;
        if (!field && !["toggle", "delete"].includes(action)) return;
        if (action === "delete" && !confirm(`Xóa vĩnh viễn điểm ${api.format(row.score)} của ${row.student_name ? row.student_name + ", lớp " : "lớp "}${row.class_name}, ${api.label(row.period)}, năm ${row.school_year}?`)) return;
        const requestEpoch = authEpoch;
        try {
            const patch = field ? { [field]: field === "hide_student_name" ? !row.hide_student_name : !api.visibility(row)[field] } : { published: !row.published };
            const result = await mutateRows([row.id], patch, action === "delete");
            if (requestEpoch !== authEpoch) return;
            const error = result.failed[0]?.message || result.warnings[0];
            toast(error || (field ? "Đã cập nhật thông tin hiển thị." : action === "delete" ? "Đã xóa điểm thi." : row.published ? "Đã ẩn điểm khỏi thống kê." : "Đã công bố điểm thi."), error ? "error" : "ok");
            [...$("scoreAdminRows").querySelectorAll("[data-score-action],[data-score-field]")].find(node => node.dataset.scoreId === row.id && (field ? node.dataset.scoreField === field : node.dataset.scoreAction === action))?.focus({ preventScroll: true });
        } catch (error) { if (requestEpoch === authEpoch) toast(error.message || writeError(error), "error"); }
    });
    $("scoreResetBtn").addEventListener("click", () => { if (!busy) reset(); });
    $("scoreAdminRefresh").addEventListener("click", () => { if (!busy) load(); });
    $("scoreImageInput").addEventListener("change", event => chooseImage(event.target.files));
    $("scoreShowImage").addEventListener("change", renderImage);
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
        busy = loading = ready = false;
        records = [];
        pageIds = [];
        page = 1;
        reset();
        $("scoreAdminRows").replaceChildren();
        $("scoreAdminPagination").replaceChildren();
        $("scoreClassSuggestions").replaceChildren();
        setStatus("scoreAdminStatus", "");
        lock(busy);
    }
    window.examScoreAdmin = { load, clear, getState, mutateRows };
    window.addEventListener("exam-score-options-change", () => { if (ready) render(); });
    renderPreview();
    renderImage();
    lock(false);
    if ($("scoresWorkspace").classList.contains("active")) load();
}());
