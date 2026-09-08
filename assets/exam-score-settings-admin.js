(function () {
    "use strict";
    const keys = ["statistics_enabled", "summary_enabled", "bar_enabled", "pie_enabled", "line_enabled"];
    const periods = [{ key: "gk1", label: "Giữa kỳ 1" }, { key: "ck1", label: "Cuối kỳ 1" }, { key: "gk2", label: "Giữa kỳ 2" }, { key: "ck2", label: "Cuối kỳ 2" }];
    window.ExamScoreSettingsAdmin = {
        init(client) {
            const mount = document.getElementById("scoreStatisticsSettings");
            if (!mount) return { load: async () => {}, clear() {} };
            if (mount.controller) return mount.controller;
            let ready = false, busy = false, pending = null, epoch = 0;
            mount.classList.add("exam-statistics-settings");
            mount.innerHTML = `<div class="exam-settings-heading"><div><h2>Hiển thị thống kê</h2><p>Bật hoặc tắt các phần thống kê trên trang thành tích.</p></div><button type="button" class="admin-btn ghost" data-settings-refresh>Làm mới</button></div>
                <form data-settings-form><fieldset data-settings-fields disabled>
                <label class="exam-settings-toggle exam-settings-master"><input type="checkbox" name="statistics_enabled" checked> Toàn bộ thống kê</label>
                <fieldset class="exam-settings-details" data-settings-details><legend>Các phần hiển thị</legend><div class="exam-settings-options">
                    <label class="exam-settings-toggle"><input type="checkbox" name="summary_enabled" checked> Tổng quan</label>
                    <label class="exam-settings-toggle"><input type="checkbox" name="bar_enabled" checked> Biểu đồ cột</label>
                    <label class="exam-settings-toggle"><input type="checkbox" name="pie_enabled" checked> Biểu đồ tròn</label>
                    <label class="exam-settings-toggle"><input type="checkbox" name="line_enabled" checked> Biểu đồ đoạn thẳng</label>
                </div><p class="exam-settings-label">Kỳ đưa vào thống kê</p><div class="exam-settings-options">${periods.map(period => `<label class="exam-settings-toggle"><input type="checkbox" name="enabled_periods" value="${period.key}" checked> ${period.label}</label>`).join("")}</div></fieldset>
                <p class="exam-settings-help">Các lựa chọn này chỉ áp dụng cho thống kê. Thẻ điểm học sinh vẫn được quản lý bằng nút hiển thị điểm riêng.</p>
                <div class="admin-actions"><button type="submit" class="admin-btn success">Lưu cài đặt thống kê</button></div>
                </fieldset></form><p class="admin-status" data-settings-status role="status" aria-live="polite"></p>`;
            const form = mount.querySelector("[data-settings-form]");
            const fields = mount.querySelector("[data-settings-fields]");
            const details = mount.querySelector("[data-settings-details]");
            const refresh = mount.querySelector("[data-settings-refresh]");
            const status = mount.querySelector("[data-settings-status]");
            const checkbox = name => form.elements.namedItem(name);
            function message(text, error = false) { status.textContent = text; status.dataset.error = String(error); }
            function lock() {
                fields.disabled = !ready || busy || Boolean(pending);
                refresh.disabled = busy || Boolean(pending);
                details.disabled = !checkbox("statistics_enabled").checked;
                mount.setAttribute("aria-busy", String(busy || Boolean(pending)));
            }
            async function load() {
                if (document.getElementById("adminPanel")?.classList.contains("hidden") || busy) return;
                if (pending) return pending;
                const requestEpoch = epoch;
                message("Đang tải cài đặt thống kê...");
                pending = (async () => {
                    try {
                        const { data, error } = await client.from("exam_score_settings").select("*").eq("id", 1).single();
                        if (requestEpoch !== epoch) return;
                        if (error || data?.id !== 1) throw error || new Error("Missing settings");
                        keys.forEach(key => { checkbox(key).checked = data[key] === true; });
                        form.querySelectorAll('[name="enabled_periods"]').forEach(input => { input.checked = (data.enabled_periods || []).includes(input.value); });
                        ready = true;
                        message("Các thay đổi chỉ áp dụng sau khi bấm Lưu cài đặt thống kê.");
                    } catch (error) {
                        if (requestEpoch !== epoch) return;
                        ready = false;
                        message(["42P01", "PGRST205", "PGRST116"].includes(error?.code) ? "Chưa thiết lập cài đặt thống kê. Bạn vẫn có thể nhập và sửa điểm ở trên." : "Không tải được cài đặt thống kê. Hãy bấm Làm mới để thử lại; phần nhập điểm vẫn hoạt động.", true);
                    } finally { if (requestEpoch === epoch) { pending = null; lock(); } }
                })();
                lock();
                return pending;
            }
            form.addEventListener("change", () => {
                lock();
                message(checkbox("statistics_enabled").checked ? "Chưa lưu thay đổi." : "Thống kê sẽ được ẩn sau khi lưu. Các lựa chọn bên dưới được giữ lại để bật lại sau.");
            });
            form.addEventListener("submit", async event => {
                event.preventDefault();
                if (!ready || busy || pending) return;
                const requestEpoch = epoch;
                const payload = Object.fromEntries(keys.map(key => [key, checkbox(key).checked]));
                payload.enabled_periods = [...form.querySelectorAll('[name="enabled_periods"]')].filter(input => input.checked).map(input => input.value);
                busy = true;
                lock();
                message("Đang lưu cài đặt...");
                try {
                    const { data, error } = await client.from("exam_score_settings").update(payload).eq("id", 1).select("id").single();
                    if (requestEpoch !== epoch) return;
                    if (error || data?.id !== 1) throw error || new Error("Settings not saved");
                    message("Đã lưu cài đặt thống kê.");
                } catch (error) {
                    if (requestEpoch === epoch) message("Chưa lưu được cài đặt. Hãy kiểm tra quyền admin và thử lại.", true);
                } finally { if (requestEpoch === epoch) { busy = false; lock(); } }
            });
            refresh.addEventListener("click", load);
            const controller = { load, clear() { epoch++; ready = busy = false; pending = null; form.reset(); message(""); lock(); } };
            mount.controller = controller;
            lock();
            return controller;
        }
    };
}());
