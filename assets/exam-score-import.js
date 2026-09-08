(function () {
    "use strict";
    const libraries = new Map();
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    const urls = {
        mammoth: "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js",
        ExcelJS: "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
        Tesseract: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"
    };
    function library(name) {
        if (libraries.has(name)) return libraries.get(name);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = urls[name]; script.async = true;
            const timeout = setTimeout(() => { script.remove(); reject(new Error("Không tải được công cụ đọc tệp. Kiểm tra kết nối rồi thử lại.")); }, 30000);
            script.onload = () => { clearTimeout(timeout); window[name] ? resolve(window[name]) : reject(new Error("Công cụ đọc tệp không khởi tạo được.")); };
            script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("Không tải được công cụ đọc tệp. Kiểm tra kết nối rồi thử lại.")); };
            document.head.appendChild(script);
        }).catch(error => { libraries.delete(name); throw error; });
        libraries.set(name, promise);
        return promise;
    }
    window.ExamScoreImport = {
        init(client) {
            const mount = document.getElementById("scoreImportAdmin");
            if (!mount) return { load() {}, clear() {} };
            if (mount.scoreImportController) return mount.scoreImportController;
            const api = window.ExamScores, parser = window.ExamScoreImportParser;
            const perPage = 10;
            let rows = [], sources = [], busy = false, enabled = false, page = 1, epoch = 0, worker = null;
            mount.classList.add("exam-score-import");
            mount.innerHTML = `<div class="score-import-heading"><div><h3>Nhập điểm từ tệp</h3><p>Kéo thả bảng điểm hoặc ảnh, kiểm tra các dòng nhận diện rồi lưu hàng loạt.</p></div><span class="score-import-tag">Có bước kiểm tra</span></div>
                <fieldset data-import-fields disabled><div class="score-import-defaults">
                    <label>Năm học mặc định<input data-import-default="school_year" value="${escape(api.schoolYear())}" maxlength="9" placeholder="2026-2027"></label>
                    <label>Khối mặc định<select data-import-default="grade">${[10,11,12].map(grade => `<option value="${grade}" ${grade === 12 ? "selected" : ""}>Khối ${grade}</option>`).join("")}</select></label>
                    <label>Kỳ thi mặc định<select data-import-default="period">${api.periods.map(period => `<option value="${period.key}">${period.label}</option>`).join("")}</select></label>
                    <label>Lớp mặc định<input data-import-default="class_name" maxlength="80" placeholder="Dùng khi tệp thiếu lớp"></label></div>
                <p class="score-import-hint">Các giá trị mặc định chỉ bổ sung thông tin còn thiếu khi đọc tệp.</p>
                <label class="score-import-drop" data-import-drop tabindex="0" role="button"><span class="score-import-drop-icon" aria-hidden="true">↥</span><strong>Kéo thả tệp vào đây hoặc bấm để chọn</strong><span>Word .docx · Excel .xlsx · .csv, .txt · ảnh JPG, PNG, WebP</span><small>Tối đa 20 tệp/lượt · ảnh 10 MB · tài liệu 25 MB/tệp</small><input type="file" data-import-files multiple accept=".docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp" aria-label="Chọn tệp bảng điểm" hidden></label>
                <div class="score-import-files" data-import-sources></div>
                <p class="score-import-notice">Điểm OCR có thể sai: hãy đối chiếu tên và số điểm với ảnh gốc. Ảnh được dùng để đọc và xem tại đây; thêm ảnh minh chứng riêng cho từng học sinh trong mục sửa điểm sau khi lưu.</p>
                <div class="score-import-toolbar"><label><input type="checkbox" data-import-publish> Công bố các dòng hợp lệ khi lưu</label><label><input type="checkbox" data-import-hide-name> Ẩn tên và ảnh khi công bố</label></div>
                <div class="score-import-toolbar"><button type="button" data-import-save>Lưu các dòng đã chọn</button><button type="button" class="secondary" data-import-delete>Xóa dòng đã chọn khỏi bản nhập</button><button type="button" class="secondary" data-import-clear>Xóa bản nhập</button></div>
                <p class="score-import-status" data-import-status role="status" aria-live="polite">Chưa có tệp. Dữ liệu mặc định được lưu dưới dạng nháp.</p>
                <div class="score-import-table-wrap"><table><thead><tr><th><input type="checkbox" data-import-select-all aria-label="Chọn tất cả các dòng"></th><th>STT</th><th>Học sinh</th><th>Lớp</th><th>Điểm</th><th>Kỳ thi</th><th>Khối</th><th>Năm học</th><th>Nguồn / kiểm tra</th></tr></thead><tbody data-import-rows></tbody></table></div>
                <nav class="score-import-pagination" data-import-pagination aria-label="Trang bản nhập điểm"></nav></fieldset>`;
            const find = selector => mount.querySelector(selector);
            const fields = find("[data-import-fields]"), table = find("[data-import-rows]"), status = find("[data-import-status]"), sourceList = find("[data-import-sources]");
            function message(value, error = false) { status.textContent = value; status.dataset.error = String(error); }
            function lock(value) { busy = value; fields.disabled = value || !enabled; mount.setAttribute("aria-busy", String(value)); }
            function defaults() { return Object.fromEntries([...mount.querySelectorAll("[data-import-default]")].map(input => [input.dataset.importDefault, input.value])); }
            function errorsFor(row) {
                const errors = {};
                if (!row.student_name.trim() || row.student_name.length > 160) errors.student_name = "Cần tên học sinh (tối đa 160 ký tự).";
                if (!row.class_name.trim() || row.class_name.length > 80) errors.class_name = "Cần lớp / khóa học (tối đa 80 ký tự).";
                if (api.parseScore(row.score) === null) errors.score = "Điểm phải từ 0 đến 10, tối đa 2 số thập phân.";
                if (!api.periods.some(period => period.key === row.period)) errors.period = "Chọn kỳ thi hợp lệ.";
                if (![10,11,12].includes(Number(row.grade))) errors.grade = "Chọn khối 10, 11 hoặc 12.";
                if (!/^20\d{2}-20\d{2}$/.test(row.school_year) || Number(row.school_year.slice(5)) !== Number(row.school_year.slice(0, 4)) + 1) errors.school_year = "Năm học phải gồm 2 năm liên tiếp.";
                return errors;
            }
            function renderSources() {
                sourceList.innerHTML = sources.map(source => `<div class="score-import-source" data-source-id="${source.id}">${source.preview ? `<a href="${escape(source.preview)}" target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh gốc ${escape(source.name)}"><img src="${escape(source.preview)}" alt="Ảnh bảng điểm gốc"></a>` : '<span class="score-import-source-icon" aria-hidden="true">▤</span>'}<div><strong>${escape(source.name)}</strong><span data-source-status>${escape(source.status)}</span></div></div>`).join("");
            }
            function sourceStatus(source, value) {
                source.status = value;
                const element = sourceList.querySelector(`[data-source-id="${source.id}"] [data-source-status]`);
                if (element) element.textContent = value;
            }
            function input(row, key, label, attrs = "") {
                return `<input data-import-field="${key}" aria-label="${label} dòng ${rows.indexOf(row) + 1}" value="${escape(row[key])}" ${row.attempt ? "disabled" : ""} ${attrs}>`;
            }
            function options(row, key, choices) {
                const invalid = !choices.some(([value]) => String(value) === String(row[key]));
                return `<select data-import-field="${key}" aria-label="${key === "grade" ? "Khối" : "Kỳ thi"} dòng ${rows.indexOf(row) + 1}" ${row.attempt ? "disabled" : ""}>${invalid ? '<option value="">Cần chọn</option>' : ""}${choices.map(([value, label]) => `<option value="${value}" ${String(row[key]) === String(value) ? "selected" : ""}>${label}</option>`).join("")}</select>`;
            }
            function markRow(row, element) {
                const errors = errorsFor(row);
                element.querySelectorAll("[data-import-field]").forEach(input => {
                    const error = errors[input.dataset.importField];
                    input.setAttribute("aria-invalid", String(Boolean(error)));
                    input.title = error || "";
                });
                const note = element.querySelector("[data-row-note]");
                note.textContent = row.attempt ? "Chưa xác nhận lưu · bấm Lưu để kiểm tra lại" : Object.values(errors).join(" ") || "Sẵn sàng lưu";
                note.dataset.error = String(Object.keys(errors).length > 0 || Boolean(row.attempt));
            }
            function render() {
                const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
                page = Math.max(1, Math.min(page, totalPages));
                const visible = rows.slice((page - 1) * perPage, page * perPage);
                table.innerHTML = visible.map((row, index) => `<tr data-import-id="${row.id}"><td><input type="checkbox" data-import-select ${row.selected ? "checked" : ""} aria-label="Chọn dòng ${(page - 1) * perPage + index + 1}"></td><td>${(page - 1) * perPage + index + 1}</td><td>${input(row,"student_name","Tên học sinh",'maxlength="160"')}</td><td>${input(row,"class_name","Lớp",'maxlength="80"')}</td><td>${input(row,"score","Điểm",'inputmode="decimal" maxlength="8"')}</td><td>${options(row,"period",api.periods.map(period => [period.key,period.short]))}</td><td>${options(row,"grade",[10,11,12].map(grade => [grade,grade]))}</td><td>${input(row,"school_year","Năm học",'maxlength="9"')}</td><td class="score-import-source-cell"><small>${escape(row.source)} · dòng ${row.sourceLine}</small><span data-row-note></span>${row.raw ? `<details><summary>Văn bản gốc</summary><pre>${escape(row.raw)}</pre></details>` : ""}</td></tr>`).join("");
                visible.forEach(row => markRow(row, table.querySelector(`[data-import-id="${row.id}"]`)));
                const all = find("[data-import-select-all]");
                all.checked = rows.length > 0 && rows.every(row => row.selected);
                all.indeterminate = rows.some(row => row.selected) && !all.checked;
                find("[data-import-pagination]").innerHTML = rows.length ? `<button type="button" class="secondary" data-import-page="${page - 1}" ${page === 1 ? "disabled" : ""} aria-label="Trang trước">←</button><span>Trang ${page}/${totalPages} · ${rows.length} dòng</span><button type="button" class="secondary" data-import-page="${page + 1}" ${page === totalPages ? "disabled" : ""} aria-label="Trang sau">→</button>` : "";
            }
            async function readFile(file, source, requestEpoch) {
                const extension = file.name.split(".").pop().toLowerCase();
                const context = defaults();
                if (["csv", "txt"].includes(extension)) return parser.fromText(await file.text(), context, file.name);
                if (extension === "xlsx") {
                    const ExcelJS = await library("ExcelJS");
                    const workbook = new ExcelJS.Workbook();
                    await workbook.xlsx.load(await file.arrayBuffer());
                    const result = { rows: [], warnings: [] };
                    workbook.eachSheet(sheet => {
                        const grid = [];
                        sheet.eachRow({ includeEmpty: false }, row => { grid.push(row.values.slice(1).map(value => {
                            if (value && typeof value === "object") {
                                if ("formula" in value || "sharedFormula" in value) return value.result ?? "";
                                if (value.richText) return value.richText.map(part => part.text).join("");
                                return value.text ?? "";
                            }
                            return value ?? "";
                        })); });
                        const parsed = parser.fromRows(grid, context, `${file.name} · ${sheet.name}`);
                        result.rows.push(...parsed.rows); result.warnings.push(...parsed.warnings);
                    });
                    return result;
                }
                if (extension === "docx") {
                    const mammoth = await library("mammoth");
                    const output = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) });
                    // Word HTML is parsed in an inert template and only text is copied out.
                    const template = document.createElement("template");
                    template.innerHTML = output.value;
                    const tables = [...template.content.querySelectorAll("table")];
                    if (!tables.length) return parser.fromText([...template.content.querySelectorAll("p")].map(p => p.textContent).join("\n"), context, file.name);
                    const result = { rows: [], warnings: [] };
                    tables.forEach((table, index) => {
                        const grid = [...table.querySelectorAll("tr")].map(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).map(cell => cell.textContent));
                        const parsed = parser.fromRows(grid, context, `${file.name} · bảng ${index + 1}`);
                        result.rows.push(...parsed.rows); result.warnings.push(...parsed.warnings);
                    });
                    return result;
                }
                const Tesseract = await library("Tesseract");
                if (requestEpoch !== epoch) return { rows: [], warnings: [] };
                const activeWorker = await Tesseract.createWorker("vie+eng", 1, { logger: progress => {
                    if (requestEpoch === epoch && progress.status === "recognizing text") sourceStatus(source, `Đang đọc ảnh ${Math.round(progress.progress * 100)}%...`);
                } });
                worker = activeWorker;
                try {
                    if (requestEpoch !== epoch) return { rows: [], warnings: [] };
                    const result = await activeWorker.recognize(file);
                    return parser.fromText(result?.data?.text || "", context, file.name);
                } finally { await activeWorker.terminate(); if (worker === activeWorker) worker = null; }
            }
            async function importFiles(files) {
                if (busy || !enabled || !files?.length) return;
                if (files.length > 20) { message("Chỉ chọn tối đa 20 tệp mỗi lượt.", true); return; }
                const requestEpoch = epoch;
                lock(true);
                let added = 0, failed = 0;
                for (const file of files) {
                    if (requestEpoch !== epoch) break;
                    const extension = file.name.split(".").pop().toLowerCase();
                    const image = ["png", "jpg", "jpeg", "webp"].includes(extension);
                    const source = { id: crypto.randomUUID(), name: file.name, status: "Đang đọc...", preview: image ? URL.createObjectURL(file) : "" };
                    sources.push(source); renderSources();
                    try {
                        if (!["docx","xlsx","csv","txt","png","jpg","jpeg","webp"].includes(extension)) throw new Error("Định dạng chưa hỗ trợ. Với .doc hoặc .xls, hãy lưu lại thành .docx hoặc .xlsx.");
                        if (!file.size || file.size > (image ? 10 : 25) * 1024 * 1024) throw new Error(`Tệp trống hoặc vượt quá ${image ? 10 : 25} MB.`);
                        const parsed = await readFile(file, source, requestEpoch);
                        if (requestEpoch !== epoch) break;
                        if (rows.length + parsed.rows.length > 3000) throw new Error("Bản nhập vượt quá 3.000 dòng. Hãy chia tệp thành các phần nhỏ hơn.");
                        parsed.rows.forEach(row => rows.push({ ...row, id: crypto.randomUUID(), selected: true, attempt: null }));
                        added += parsed.rows.length;
                        sourceStatus(source, parsed.rows.length ? `${parsed.rows.length} dòng · ${parsed.warnings[0] || "Hãy kiểm tra trước khi lưu."}` : "Không tìm thấy dữ liệu. Kiểm tra lại bố cục và tiêu đề tên, lớp, điểm.");
                    } catch (error) { failed++; if (requestEpoch === epoch) sourceStatus(source, `Không đọc được: ${error.message}`); }
                }
                if (requestEpoch !== epoch) return;
                find("[data-import-files]").value = "";
                page = 1; render(); lock(false);
                message(`Đã thêm ${added} dòng vào bản kiểm tra${failed ? `; ${failed} tệp gặp lỗi` : ""}. Chưa lưu dữ liệu lên website.`, failed > 0);
            }
            async function knownIds(ids) {
                const { data, error } = await client.from("exam_scores").select("id").in("id", ids);
                if (error) throw error;
                if (!Array.isArray(data)) throw new Error("Không xác nhận được các dòng đã lưu.");
                return new Set(data.map(row => row.id));
            }
            async function save() {
                if (busy || !enabled) return;
                const selected = rows.filter(row => row.selected);
                if (!selected.length) { message("Hãy chọn ít nhất một dòng để lưu.", true); return; }
                const invalid = selected.filter(row => !row.attempt && Object.keys(errorsFor(row)).length);
                if (invalid.length) { page = Math.floor(rows.indexOf(invalid[0]) / perPage) + 1; render(); message(`Còn ${invalid.length} dòng được chọn thiếu hoặc sai thông tin. Sửa ô đánh dấu đỏ hoặc bỏ chọn các dòng đó.`, true); return; }
                const requestEpoch = epoch;
                const published = find("[data-import-publish]").checked, hidden = find("[data-import-hide-name]").checked;
                const confirmed = new Set();
                let failure = null;
                lock(true);
                for (let start = 0; start < selected.length && requestEpoch === epoch; start += 50) {
                    const batch = selected.slice(start, start + 50);
                    const ids = batch.map(row => row.id);
                    try {
                        message(`Đang kiểm tra và lưu ${Math.min(start + 50, selected.length)}/${selected.length} dòng...`);
                        const known = await knownIds(ids);
                        if (requestEpoch !== epoch) break;
                        known.forEach(id => confirmed.add(id));
                        const missing = batch.filter(row => !known.has(row.id));
                        if (!missing.length) continue;
                        const payloads = missing.map(row => {
                            if (!row.attempt) row.attempt = { id: row.id, ...api.validate({ ...row, published, hide_student_name: hidden }) };
                            return row.attempt;
                        });
                        const result = await client.from("exam_scores").insert(payloads).select("id");
                        if (requestEpoch !== epoch) break;
                        if (result.error) throw result.error;
                        const saved = new Set((result.data || []).map(row => row.id));
                        missing.forEach(row => { if (saved.has(row.id)) confirmed.add(row.id); });
                        if (missing.some(row => !saved.has(row.id))) throw new Error("Máy chủ chưa xác nhận đủ các dòng.");
                    } catch (error) {
                        if (requestEpoch !== epoch) break;
                        // Stable UUIDs + reconciliation protect retries after a lost response.
                        try { (await knownIds(ids)).forEach(id => confirmed.add(id)); }
                        catch (_) { /* Keep uncertain rows and their original payload for retry. */ }
                        if (batch.some(row => !confirmed.has(row.id))) { failure = error; break; }
                    }
                }
                if (requestEpoch !== epoch) return;
                rows = rows.filter(row => !confirmed.has(row.id));
                render(); lock(false);
                if (confirmed.size) {
                    window.dispatchEvent(new CustomEvent("exam-scores-imported", { detail: { count: confirmed.size } }));
                    window.examScoreAdmin?.load?.();
                }
                message(failure ? `Đã xác nhận ${confirmed.size} dòng. Các dòng còn lại vẫn được giữ. ${api.errorMessage(failure, true)} Bấm Lưu để kiểm tra và thử lại, không nhập lại tệp.` : `Đã lưu ${confirmed.size} dòng. Xem trạng thái nháp hoặc công bố trong danh sách quản lý.`, Boolean(failure));
            }
            function clear() {
                epoch++; enabled = false;
                if (worker) { worker.terminate().catch(() => {}); worker = null; }
                sources.forEach(source => { if (source.preview) URL.revokeObjectURL(source.preview); });
                rows = []; sources = []; page = 1;
                find("[data-import-files]").value = "";
                find("[data-import-publish]").checked = false;
                find("[data-import-hide-name]").checked = false;
                renderSources(); render(); lock(false);
                message("Chưa có tệp. Dữ liệu mặc định được lưu dưới dạng nháp.");
            }
            const drop = find("[data-import-drop]");
            document.querySelector('[data-score-import-jump]')?.addEventListener("click", () => {
                const tabs = document.querySelector(".workspace-tabs");
                const tabBottom = tabs ? (parseFloat(getComputedStyle(tabs).top) || 0) + tabs.offsetHeight : 0;
                const navBottom = document.querySelector(".admin-nav")?.getBoundingClientRect().bottom || 0;
                mount.style.scrollMarginTop = `${Math.max(tabBottom, navBottom) + 16}px`;
                mount.scrollIntoView({ behavior: "instant", block: "start" });
                drop.focus({ preventScroll: true });
            });
            drop.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key) && enabled && !busy) { event.preventDefault(); find("[data-import-files]").click(); } });
            ["dragenter","dragover"].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); if (enabled && !busy) drop.classList.add("drag-over"); }));
            ["dragleave","drop"].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove("drag-over"); if (type === "drop") importFiles([...event.dataTransfer.files]); }));
            find("[data-import-files]").addEventListener("change", event => importFiles([...event.target.files]));
            find("[data-import-save]").addEventListener("click", save);
            find("[data-import-clear]").addEventListener("click", () => { if (!busy && confirm("Xóa bản nhập đang kiểm tra? Thao tác này không xóa các điểm đã lưu trên máy chủ.")) { clear(); enabled = true; lock(false); } });
            find("[data-import-delete]").addEventListener("click", () => {
                if (busy) return;
                const count = rows.filter(row => row.selected).length;
                if (count && confirm(`Bỏ ${count} dòng đã chọn khỏi bản nhập? Điểm đã lưu trên máy chủ không bị xóa.`)) { rows = rows.filter(row => !row.selected); render(); message(`Đã bỏ ${count} dòng khỏi bản nhập.`); }
            });
            find("[data-import-select-all]").addEventListener("change", event => { rows.forEach(row => { row.selected = event.target.checked; }); render(); });
            table.addEventListener("input", event => {
                const tr = event.target.closest("[data-import-id]");
                const row = rows.find(row => row.id === tr?.dataset.importId);
                if (!row || busy) return;
                const key = event.target.dataset.importField;
                if (key && !row.attempt) { row[key] = event.target.value; markRow(row, tr); }
                if (event.target.matches("[data-import-select]")) { row.selected = event.target.checked; const all = find("[data-import-select-all]"); all.checked = rows.every(row => row.selected); all.indeterminate = rows.some(row => row.selected) && !all.checked; }
            });
            find("[data-import-pagination]").addEventListener("click", event => { const button = event.target.closest("[data-import-page]"); if (button && !busy) { page = Number(button.dataset.importPage); render(); } });
            mount.scoreImportController = { load() { enabled = !document.getElementById("adminPanel")?.classList.contains("hidden"); lock(busy); }, clear };
            render();
            return mount.scoreImportController;
        }
    };
}());
