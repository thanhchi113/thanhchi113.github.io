(function () {
    "use strict";
    const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    window.ScoreSubmissions = {
        init(client) {
            const form = document.getElementById("studentScoreSubmissionForm");
            if (!form || form.dataset.initialized) return;
            form.dataset.initialized = "true";
            const api = window.ExamScores;
            const field = name => form.elements.namedItem(name);
            const status = document.getElementById("studentScoreSubmissionStatus");
            const input = document.getElementById("studentScoreSubmissionImage");
            const drop = document.getElementById("studentScoreSubmissionDrop");
            const preview = document.getElementById("studentScoreSubmissionPreview");
            const filename = document.getElementById("studentScoreSubmissionFilename");
            const remove = document.getElementById("studentScoreSubmissionRemove");
            const fields = document.getElementById("studentScoreSubmissionFields");
            let file = null, localUrl = null, busy = false, id = crypto.randomUUID(), uploadedPath = null;
            field("school_year").value = api.schoolYear();
            function message(text, error = false) {
                status.textContent = text;
                status.dataset.error = String(error);
            }
            function clearImage() {
                if (localUrl) URL.revokeObjectURL(localUrl);
                file = localUrl = uploadedPath = null;
                input.value = "";
                preview.hidden = true;
                preview.removeAttribute("src");
                filename.textContent = "Chưa chọn ảnh";
                remove.hidden = true;
            }
            function choose(files) {
                if (busy || !files?.length) return;
                const candidate = files[0];
                if (files.length !== 1 || !extensions[candidate.type] || !candidate.size || candidate.size > 10 * 1024 * 1024) {
                    input.value = "";
                    message("Chọn một ảnh JPG, PNG hoặc WebP, dung lượng tối đa 10 MB.", true);
                    return;
                }
                clearImage();
                file = candidate;
                localUrl = URL.createObjectURL(file);
                preview.src = localUrl;
                preview.hidden = false;
                filename.textContent = file.name;
                remove.hidden = false;
                message("");
            }
            input.addEventListener("change", () => choose(input.files));
            remove.addEventListener("click", () => { if (!busy) clearImage(); });
            ["dragenter", "dragover"].forEach(type => drop.addEventListener(type, event => {
                event.preventDefault();
                if (!busy) drop.classList.add("drag-over");
            }));
            ["dragleave", "drop"].forEach(type => drop.addEventListener(type, event => {
                event.preventDefault();
                drop.classList.remove("drag-over");
                if (type === "drop") choose(event.dataTransfer?.files);
            }));
            preview.addEventListener("error", () => { preview.hidden = true; });
            window.addEventListener("pagehide", () => { if (localUrl) URL.revokeObjectURL(localUrl); });
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (busy || !form.reportValidity()) return;
                let details;
                try {
                    details = api.validate(Object.fromEntries(new FormData(form)));
                    if (!details.student_name) throw new Error("Hãy nhập tên học sinh.");
                    delete details.published;
                    delete details.hide_student_name;
                } catch (error) { message(error.message, true); return; }
                busy = true;
                fields.disabled = true;
                form.setAttribute("aria-busy", "true");
                message("Đang gửi kết quả của bạn...");
                try {
                    if (file && !uploadedPath) {
                        const path = `${id}/${crypto.randomUUID()}.${extensions[file.type]}`;
                        const { error } = await client.storage.from("exam-score-submissions").upload(path, file, { contentType: file.type, upsert: false });
                        if (error) throw error;
                        uploadedPath = path;
                    }
                    const { error } = await client.from("exam_score_submissions").insert({
                        ...details, id, status: "pending", evidence_image_path: uploadedPath,
                        evidence_image_name: uploadedPath ? file.name : null
                    });
                    // The same random ID is retained on retry if a successful response was lost.
                    if (error && error.code !== "23505") throw error;
                    form.reset();
                    clearImage();
                    id = crypto.randomUUID();
                    field("school_year").value = api.schoolYear();
                    message("Đã gửi kết quả. Thầy sẽ kiểm tra và duyệt trước khi hiển thị trên trang thành tích.");
                } catch (error) {
                    message(["42P01", "PGRST205", "42501"].includes(error?.code)
                        ? "Chức năng gửi điểm đang được thiết lập. Vui lòng thử lại sau."
                        : "Chưa gửi được kết quả. Thông tin của bạn vẫn được giữ lại, hãy thử gửi lại.", true);
                } finally {
                    busy = false;
                    fields.disabled = false;
                    form.setAttribute("aria-busy", "false");
                }
            });
        }
    };
}());
