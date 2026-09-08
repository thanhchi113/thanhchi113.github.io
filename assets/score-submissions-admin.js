(function () {
    "use strict";
    const columns = "id,student_name,period,score,grade,class_name,school_year,evidence_image_path,evidence_image_name,status,created_at";
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    const sourceBucket = "exam-score-submissions", destinationBucket = "exam-score-evidence";
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    window.ScoreSubmissionsAdmin = {
        init(client) {
            const mount = document.getElementById("scoreSubmissionAdmin");
            if (!mount) return { load: async () => {} };
            if (mount.scoreSubmissionsController) return mount.scoreSubmissionsController;
            const api = window.ExamScores;
            let records = [], page = 1, total = 0, busy = false, loading = false, pendingLoad = null, version = 0, authEpoch = 0;
            const transfers = new Map();
            mount.classList.add("score-submission-admin");
            mount.innerHTML = `<div class="score-submission-heading"><div><h3>Điểm học sinh gửi chờ duyệt</h3><p>Kiểm tra ảnh, chỉnh sửa thông tin rồi duyệt để công bố. Điểm đã duyệt có thể sửa trong danh sách điểm thi.</p></div><button type="button" class="score-submission-button secondary" data-submission-refresh>Làm mới</button></div>
                <p class="score-submission-status" data-submission-status role="status" aria-live="polite"></p><div class="score-submission-list" data-submission-list></div><nav class="score-submission-pagination" data-submission-pagination aria-label="Trang yêu cầu gửi điểm"></nav>`;
            const list = mount.querySelector("[data-submission-list]");
            const status = mount.querySelector("[data-submission-status]");
            const pagination = mount.querySelector("[data-submission-pagination]");
            function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
            function lock() {
                mount.setAttribute("aria-busy", String(busy || loading));
                mount.querySelectorAll("button,input,select").forEach(element => { element.disabled = busy || loading || element.dataset.pageDisabled === "true"; });
            }
            function field(row, key, label, attrs = "") {
                return `<label>${label}<input name="${key}" value="${escape(row[key])}" ${attrs}></label>`;
            }
            async function showImage(row, container, requestVersion) {
                if (!row.evidence_image_path) { container.textContent = "Học sinh không đính kèm ảnh xác nhận."; return; }
                container.textContent = "Đang tải ảnh xác nhận...";
                try {
                    const { data, error } = await client.storage.from(sourceBucket).createSignedUrl(row.evidence_image_path, 300);
                    if (error || !data?.signedUrl) throw error || new Error("Không có ảnh");
                    if (version !== requestVersion || !container.isConnected) return;
                    const anchor = document.createElement("a");
                    anchor.href = data.signedUrl;
                    anchor.target = "_blank";
                    anchor.rel = "noopener noreferrer";
                    anchor.setAttribute("aria-label", `Mở ảnh xác nhận của ${row.student_name}`);
                    const image = document.createElement("img");
                    image.alt = `Ảnh xác nhận điểm của ${row.student_name}`;
                    image.src = data.signedUrl;
                    image.addEventListener("error", () => imageError(container, row));
                    anchor.append(image);
                    container.replaceChildren(anchor);
                } catch (error) {
                    if (version === requestVersion && container.isConnected) imageError(container, row);
                }
            }
            function imageError(container, row) {
                container.replaceChildren();
                const button = document.createElement("button");
                button.type = "button";
                button.className = "score-submission-button secondary";
                button.textContent = "Không tải được ảnh · Thử lại";
                button.addEventListener("click", () => { if (!busy && !loading) showImage(row, container, version); });
                container.append(button);
                lock();
            }
            function render() {
                const requestVersion = ++version;
                list.innerHTML = records.map(row => `<form class="score-submission-item" data-submission-id="${escape(row.id)}">
                    <h4>${escape(row.student_name)}</h4><p>Chờ duyệt · ${escape(new Date(row.created_at).toLocaleString("vi-VN"))}</p>
                    <div class="score-submission-review"><div class="score-submission-grid">
                        ${field(row, "student_name", "Tên học sinh", 'required maxlength="160" autocomplete="off"')}
                        ${field(row, "class_name", "Lớp / khóa học", 'required maxlength="80"')}
                        <label>Khối<select name="grade">${[10, 11, 12].map(grade => `<option value="${grade}" ${Number(row.grade) === grade ? "selected" : ""}>Khối ${grade}</option>`).join("")}</select></label>
                        ${field(row, "school_year", "Năm học", 'required pattern="20[0-9]{2}-20[0-9]{2}" maxlength="9"')}
                        <label>Kỳ thi<select name="period">${api.periods.map(period => `<option value="${period.key}" ${row.period === period.key ? "selected" : ""}>${period.label}</option>`).join("")}</select></label>
                        ${field({ score: api.format(row.score) }, "score", "Điểm đạt được", 'required inputmode="decimal" maxlength="5"')}
                    </div><div class="score-submission-image" data-submission-image></div></div>
                    <div class="score-submission-actions"><button type="submit" class="score-submission-button">Duyệt và hiển thị</button><button type="button" class="score-submission-button danger" data-submission-delete>Xóa yêu cầu</button></div>
                    <p class="score-submission-status" data-submission-row-status role="status" aria-live="polite"></p>
                </form>`).join("");
                const pages = Math.max(1, Math.ceil(total / 10));
                const visiblePages = [...new Set([1, page - 1, page, page + 1, pages])].filter(number => number >= 1 && number <= pages).sort((a, b) => a - b);
                const button = (number, label, disabled = false, current = false) => `<button type="button" class="score-submission-button secondary" data-submission-page="${number}" ${disabled ? 'data-page-disabled="true" disabled' : ""} ${current ? 'aria-current="page"' : ""}>${label}</button>`;
                pagination.innerHTML = pages < 2 ? "" : button(page - 1, '<span aria-hidden="true">←</span><span class="sr-only"> Trang trước</span>', page === 1) + visiblePages.map((number, index) => `${index && number > visiblePages[index - 1] + 1 ? '<span aria-hidden="true">…</span>' : ""}${button(number, number, false, number === page)}`).join("") + button(page + 1, '<span class="sr-only">Trang sau </span><span aria-hidden="true">→</span>', page === pages);
                list.querySelectorAll("[data-submission-id]").forEach((form, index) => showImage(records[index], form.querySelector("[data-submission-image]"), requestVersion));
                lock();
            }
            async function load() {
                if (document.getElementById("adminPanel")?.classList.contains("hidden")) return;
                if (pendingLoad) return pendingLoad;
                loading = true;
                const requestEpoch = authEpoch;
                lock();
                message("Đang tải yêu cầu chờ duyệt...");
                pendingLoad = (async () => {
                    try {
                        let result = await client.from("exam_score_submissions").select(columns, { count: "exact" }).eq("status", "pending").order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 10, page * 10 - 1);
                        if (requestEpoch !== authEpoch) return;
                        if (result.error) throw result.error;
                        total = result.count ?? (result.data?.length || 0);
                        const lastPage = Math.max(1, Math.ceil(total / 10));
                        if (page > lastPage) {
                            page = lastPage;
                            result = await client.from("exam_score_submissions").select(columns, { count: "exact" }).eq("status", "pending").order("created_at", { ascending: false }).order("id", { ascending: false }).range((page - 1) * 10, page * 10 - 1);
                            if (requestEpoch !== authEpoch) return;
                            if (result.error) throw result.error;
                            total = result.count ?? total;
                        }
                        records = result.data || [];
                        render();
                        message(total ? `${total} yêu cầu chờ duyệt · Trang ${page}/${Math.max(1, Math.ceil(total / 10))}` : "Không có yêu cầu chờ duyệt.");
                    } catch (error) {
                        if (requestEpoch !== authEpoch) return;
                        records = []; total = 0; render();
                        message(["42P01", "PGRST205"].includes(error?.code) ? "Chưa thiết lập hộp thư điểm học sinh gửi. Cần cập nhật dữ liệu Supabase." : "Không tải được yêu cầu. Hãy làm mới để thử lại.", true);
                    } finally { loading = false; pendingLoad = null; lock(); }
                })();
                return pendingLoad;
            }
            async function cleanup(bucket, path) {
                if (!path) return true;
                try { return !(await client.storage.from(bucket).remove([path])).error; } catch (error) { return false; }
            }
            async function transferImage(row) {
                if (!row.evidence_image_path) return null;
                if (transfers.has(row.id)) return transfers.get(row.id);
                const { data: blob, error: downloadError } = await client.storage.from(sourceBucket).download(row.evidence_image_path);
                if (downloadError) throw downloadError;
                if (!blob || !extensions[blob.type] || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error("Ảnh xác nhận không hợp lệ. Hãy kiểm tra lại yêu cầu này.");
                const path = `scores/${crypto.randomUUID()}.${extensions[blob.type]}`;
                const { error } = await client.storage.from(destinationBucket).upload(path, blob, { contentType: blob.type, upsert: false });
                if (error) throw error;
                transfers.set(row.id, path);
                return path;
            }
            async function act(form, deleting) {
                if (busy || loading) return;
                const row = records.find(record => record.id === form.dataset.submissionId);
                if (!row) return;
                const rowStatus = form.querySelector("[data-submission-row-status]");
                rowStatus.dataset.error = "false";
                let details;
                if (deleting) {
                    if (!window.confirm(`Xóa yêu cầu gửi điểm của ${row.student_name}? Yêu cầu sẽ không được hiển thị công khai.`)) return;
                } else {
                    if (!form.reportValidity()) return;
                    try {
                        details = api.validate(Object.fromEntries(new FormData(form)));
                        if (!details.student_name) throw new Error("Hãy nhập tên học sinh.");
                        delete details.published;
                    } catch (error) { rowStatus.textContent = error.message; rowStatus.dataset.error = "true"; return; }
                }
                busy = true; lock();
                rowStatus.textContent = deleting ? "Đang xóa yêu cầu..." : "Đang duyệt và công bố điểm...";
                let destinationPath = null, committed = false, cleanupOK = true;
                try {
                    if (deleting) {
                        const { data, error } = await client.from("exam_score_submissions").delete().eq("id", row.id).eq("status", "pending").select("id").single();
                        if (error || !data?.id) throw error || new Error("Yêu cầu đã được xử lý ở nơi khác. Hãy làm mới danh sách.");
                    } else {
                        destinationPath = await transferImage(row);
                        const { data, error } = await client.rpc("approve_exam_score_submission", { submission_id: row.id, details: { ...details, evidence_image_path: destinationPath, evidence_image_name: destinationPath ? row.evidence_image_name : null } });
                        if (error || !data) throw error || new Error("Chưa xác nhận được kết quả duyệt. Hãy thử lại.");
                    }
                    committed = true;
                } catch (error) {
                    // A lost network response can follow a committed approval. Never delete its image blindly.
                    let state;
                    try { state = await client.from("exam_score_submissions").select("status").eq("id", row.id).maybeSingle(); } catch (lookupError) { state = { error: lookupError }; }
                    if (!state.error && ((!deleting && state.data?.status === "approved") || (deleting && !state.data))) {
                        committed = true;
                    } else {
                        if (destinationPath && !state.error && state.data?.status === "pending") {
                            cleanupOK = await cleanup(destinationBucket, destinationPath);
                            if (cleanupOK) transfers.delete(row.id);
                        }
                        rowStatus.textContent = error instanceof Error ? error.message : "Chưa xử lý được yêu cầu. Hãy kiểm tra kết nối và thử lại.";
                        if (!cleanupOK) rowStatus.textContent += " Ảnh đã tải lên sẽ được dùng lại khi thử duyệt.";
                        rowStatus.dataset.error = "true";
                    }
                }
                if (committed) {
                    if (deleting && transfers.has(row.id)) await cleanup(destinationBucket, transfers.get(row.id));
                    transfers.delete(row.id);
                    records = records.filter(record => record.id !== row.id);
                    total = Math.max(0, total - 1);
                    render();
                    cleanupOK = await cleanup(sourceBucket, row.evidence_image_path);
                    await load();
                    message(`${deleting ? "Đã xóa yêu cầu." : "Đã duyệt và hiển thị điểm thi."}${cleanupOK ? "" : " Ảnh gửi ban đầu chưa xóa được khỏi kho lưu trữ."}`);
                    if (!deleting) window.examScoreAdmin?.load();
                }
                busy = false; lock();
            }
            mount.addEventListener("submit", event => {
                const form = event.target.closest("[data-submission-id]");
                if (form) { event.preventDefault(); act(form, false); }
            });
            mount.addEventListener("click", event => {
                if (event.target.closest("[data-submission-refresh]")) { if (!busy && !loading) load(); return; }
                const pageButton = event.target.closest("[data-submission-page]");
                if (pageButton && !busy && !loading && !pageButton.disabled) { page = Number(pageButton.dataset.submissionPage); load(); return; }
                const deleteButton = event.target.closest("[data-submission-delete]");
                if (deleteButton) act(deleteButton.closest("[data-submission-id]"), true);
            });
            const controller = { load, clear() { authEpoch++; version++; records = []; total = 0; page = 1; render(); message(""); } };
            mount.scoreSubmissionsController = controller;
            return controller;
        }
    };
}());
