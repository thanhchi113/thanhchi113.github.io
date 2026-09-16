(function () {
    "use strict";
    const api = window.ExamScores;
    window.ExamScoreOptions?.init(supabaseClient);
    const root = document.getElementById("examScores");
    const get = id => document.getElementById(id);
    let records = [], pending = null, charts = [], chartLibrary = null, loaded = false;
    let renderVersion = 0, studentPage = 1, studentRenderVersion = 0, studentRows = [];
    let settings = null, settingsUnavailable = false;
    const studentPerPage = 10;
    const escape = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
    const filters = () => ({
        school_year: get("scoreYearFilter").value, grade: get("scoreGradeFilter").value,
        class_name: get("scoreClassFilter").value, period: get("scorePeriodFilter").value,
        student_tag: get("scoreStudentTagFilter").value.trim()
    });
    function setOptions(select, values, placeholder) {
        const previous = select.value;
        select.replaceChildren(new Option(placeholder, "all"), ...values.filter(value => value != null && value !== "").map(value => new Option(value, value)));
        if (values.includes(previous)) select.value = previous;
    }
    function updateClasses() {
        const { school_year, grade } = filters();
        const available = api.filter(records, { school_year, grade });
        setOptions(get("scoreClassFilter"), [...new Set(available.map(row => row.class_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi")), "Tất cả lớp / khóa");
    }
    function destroyCharts() {
        charts.forEach(chart => chart.destroy());
        charts = [];
    }
    function loadChartLibrary() {
        if (window.Chart) return Promise.resolve(window.Chart);
        if (chartLibrary) return chartLibrary;
        chartLibrary = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            const fail = () => { script.remove(); chartLibrary = null; reject(new Error("chart-load")); };
            const timeout = setTimeout(fail, 15000);
            script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js";
            script.onload = () => { clearTimeout(timeout); window.Chart ? resolve(window.Chart) : fail(); };
            script.onerror = () => { clearTimeout(timeout); fail(); };
            document.head.appendChild(script);
        });
        return chartLibrary;
    }
    function status(message, error = false) {
        get("examScoreStatus").textContent = message;
        get("examScoreStatus").dataset.error = String(error);
    }
    function selectedRecords() {
        const value = filters().student_tag.toLocaleLowerCase("vi");
        return api.filter(records, { ...filters(), student_tag: "all" }).filter(row => !value || String(row.student_tag || "").toLocaleLowerCase("vi").includes(value));
    }
    function examIllustration(caption, score) {
        return `${score == null ? window.EvidenceDisplay?.illustration() || "" : window.ExamScorePaper?.render(score) || ""}<figcaption>${escape(caption)}</figcaption>`;
    }
    function loadStudentImage(figure, row, isCurrent, gallery = false) {
        if (!row.show_image || !row.evidence_image_path || typeof api.signedImageUrl !== "function") return;
        const current = () => figure.isConnected && isCurrent();
        const failed = () => { if (current()) figure.innerHTML = examIllustration("Ảnh chưa tải được · Minh họa bài thi", row.score); };
        (async () => {
            try {
                const source = await api.signedImageUrl(supabaseClient, row.evidence_image_path);
                if (!current()) return;
                const url = new URL(source);
                if (url.protocol !== "https:") throw new Error("Invalid image URL");
                const link = document.createElement(gallery ? "div" : "a");
                link.className = "exam-student-image-link";
                if (!gallery) {
                    link.href = url.href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.setAttribute("aria-label", `Xem ảnh điểm của ${String(row.student_name || "học sinh")}`);
                }
                const picture = document.createElement("img");
                picture.alt = `Ảnh xác nhận${row.period ? ` ${api.label(row.period)}` : ""} của ${String(row.student_name || "học sinh")}`;
                picture.loading = "lazy";
                picture.decoding = "async";
                picture.onerror = failed;
                picture.src = url.href;
                link.appendChild(picture);
                const caption = document.createElement("figcaption");
                caption.textContent = gallery ? "Ảnh điểm học sinh" : "Ảnh điểm học sinh · Bấm để xem rõ";
                figure.replaceChildren(link, caption);
            } catch (_) { failed(); }
        })();
    }
    function createStudentCard(row, { gallery = false, index = 0, version = studentRenderVersion } = {}) {
        row = api.publicRecord(row);
        const student = row.hide_student_name ? "Tên học sinh" : String(row.student_name || "").trim() || "Học sinh chưa ghi tên";
        const nameMarkup = row.hide_student_name ? `<h3 aria-label="Tên học sinh đã được ẩn"><span class="exam-name-mask" aria-hidden="true">${student}</span><span class="exam-name-hidden-label" aria-hidden="true">Đã ẩn tên</span></h3>` : `<h3>${escape(student)}</h3>`;
        const card = document.createElement("article");
        card.className = `exam-student-card${gallery ? " exam-student-card-detail" : ""}`;
        if (!gallery) {
            card.tabIndex = 0;
            card.dataset.studentIndex = String(index);
            card.setAttribute("aria-haspopup", "dialog");
            card.setAttribute("aria-label", [`Xem thẻ điểm${row.period ? ` ${api.label(row.period)}` : ""}`, row.hide_student_name ? "Học sinh đã ẩn tên" : student, row.class_name ? `Lớp ${row.class_name}` : ""].filter(Boolean).join(" · "));
        }
        const hasImage = row.show_image && row.evidence_image_path;
        const facts = [["show_class_name", "Lớp / khóa học", row.class_name], ["show_grade", "Khối", row.grade], ["show_school_year", "Năm học", row.school_year]].filter(([flag]) => row[flag]);
        card.innerHTML = `<div class="exam-student-info">
            <div class="exam-student-top">${row.show_period ? `<span class="exam-student-period"><i class="fa-solid fa-calendar-check" aria-hidden="true"></i>${escape(api.label(row.period))}</span>` : ""}<span class="exam-student-subject">Môn Toán</span></div>
            <div class="exam-student-main"><div class="exam-student-identity"><span class="exam-student-label">Học sinh</span>${nameMarkup}</div>${row.show_score ? `<div class="exam-student-score" aria-label="Điểm đạt được: ${escape(api.format(row.score))} trên 10"><strong>${escape(api.format(row.score))}</strong><span>/ 10 điểm</span></div>` : ""}</div>
            ${facts.length ? `<dl class="exam-student-facts">${facts.map(([, label, value]) => `<div><dt>${label}</dt><dd>${escape(value ?? "—")}</dd></div>`).join("")}</dl>` : ""}</div>
            <figure class="exam-student-media">${examIllustration(hasImage ? "Đang tải ảnh điểm…" : "Minh họa bài thi", row.score)}</figure>`;
        // The gallery attaches this fresh card synchronously. Disconnected cards must not receive late images.
        queueMicrotask(() => {
            const figure = card.querySelector(".exam-student-media");
            if (!figure.isConnected) return;
            loadStudentImage(figure, row, () => gallery || version === studentRenderVersion, gallery);
        });
        return card;
    }
    function openStudentCard(card) {
        const index = Number(card.dataset.studentIndex);
        if (!Number.isInteger(index) || !studentRows[index] || !window.AchievementGallery) return false;
        window.AchievementGallery.open({
            items: studentRows.slice(), index, trigger: card, label: "Điểm thi học sinh",
            render: row => createStudentCard(row, { gallery: true })
        });
        return true;
    }
    function renderStudents(rows = selectedRecords()) {
        const version = ++studentRenderVersion;
        studentRows = rows.slice();
        const totalPages = Math.max(1, Math.ceil(rows.length / studentPerPage));
        studentPage = Math.min(Math.max(1, studentPage), totalPages);
        const offset = (studentPage - 1) * studentPerPage;
        get("examStudentResults").hidden = false;
        get("scoreStudentCount").textContent = rows.length
            ? `Hiển thị ${api.format(offset + 1)}–${api.format(Math.min(offset + studentPerPage, rows.length))} / ${api.format(rows.length)} kết quả · Mỗi thẻ là một bài thi.`
            : "Chưa có kết quả đã công bố phù hợp với bộ lọc này.";
        const visibleRows = rows.slice(offset, offset + studentPerPage);
        get("scoreStudentCards").replaceChildren(...visibleRows.map((row, index) => createStudentCard(row, { index: offset + index, version })));
        const pagination = get("scoreStudentPagination");
        pagination.hidden = rows.length < studentPerPage;
        pagination.replaceChildren();
        if (pagination.hidden) return;
        function button(page, text, label, disabled = false) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = "evidence-page-button";
            item.dataset.studentPage = String(page);
            item.textContent = text;
            item.setAttribute("aria-label", label);
            item.disabled = disabled;
            if (page === studentPage && !disabled) { item.classList.add("active"); item.setAttribute("aria-current", "page"); }
            pagination.appendChild(item);
        }
        button(studentPage - 1, "‹", "Trang trước", studentPage === 1);
        const pages = new Set([1, totalPages]);
        for (let page = Math.max(1, studentPage - 1); page <= Math.min(totalPages, studentPage + 1); page++) pages.add(page);
        let previous = 0;
        [...pages].sort((a, b) => a - b).forEach(page => {
            if (previous && page - previous > 1) {
                const ellipsis = document.createElement("span");
                ellipsis.className = "evidence-page-ellipsis";
                ellipsis.textContent = "…";
                pagination.appendChild(ellipsis);
            }
            button(page, String(page), `Trang ${page}`);
            previous = page;
        });
        button(studentPage + 1, "›", "Trang sau", studentPage === totalPages);
    }
    async function render() {
        if (root.hidden || !loaded) return;
        const version = ++renderVersion;
        const selected = filters();
        const filtered = selectedRecords();
        const statisticsOn = settings?.statistics_enabled === true;
        const periods = settings?.enabled_periods || [];
        const summary = api.summarize(statisticsOn ? filtered.filter(row => periods.includes(row.period)) : []);
        const periodSummary = summary.byPeriod.filter(period => periods.includes(period.key));
        renderStudents(filtered);
        destroyCharts();
        get("examScoreSummary").hidden = !statisticsOn || !settings.summary_enabled;
        get("examScorePeriodTable").hidden = !statisticsOn || !settings.summary_enabled;
        for (const [id, key] of [["scoreBarChart","bar_enabled"],["scorePieChart","pie_enabled"],["scoreLineChart","line_enabled"]]) {
            get(id).closest("figure").hidden = !statisticsOn || !settings[key];
        }
        get("scoreCount").textContent = api.format(summary.count);
        get("scoreAverage").textContent = api.format(summary.average);
        get("scoreHighest").textContent = api.format(summary.highest);
        get("scorePassRate").textContent = summary.passRate === null ? "—" : `${api.format(summary.passRate)}%`;
        get("examScoreResults").hidden = !statisticsOn || !summary.count;
        status(settingsUnavailable ? "Chưa tải được cài đặt thống kê. Kết quả học sinh vẫn hiển thị bên dưới." : !statisticsOn ? "" : summary.count ? `${api.format(summary.count)} bài thi môn Toán · ${selected.period === "all" ? "Các kỳ đang được thống kê" : api.label(selected.period)} · ${selected.school_year === "all" ? "Tất cả năm học" : selected.school_year}` : filtered.length ? "Chưa có điểm phù hợp với các kỳ đang bật thống kê." : "Chưa có điểm thi đã công bố phù hợp với bộ lọc này.");
        get("scorePeriodRows").innerHTML = periodSummary.map(period => `<tr><th scope="row">${escape(period.label)}</th><td>${api.format(period.count)}</td><td>${api.format(period.average)}</td></tr>`).join("");
        const anyChart = statisticsOn && (settings.bar_enabled || settings.pie_enabled || settings.line_enabled);
        get("examScoreCharts").hidden = !anyChart;
        if (!summary.count || !anyChart) return;
        let Chart;
        try { Chart = await loadChartLibrary(); }
        catch (_) {
            if (version === renderVersion && !root.hidden) {
                get("examScoreCharts").hidden = true;
                status("Chưa tải được biểu đồ. Bảng thống kê và thẻ học sinh vẫn hiển thị bên dưới; hãy thử làm mới.", true);
            }
            return;
        }
        if (version !== renderVersion || root.hidden) return;
        get("examScoreCharts").hidden = false;
        const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const base = () => ({
            responsive: true, maintainAspectRatio: false, animation: motion ? { duration: 650 } : false,
            color: "#bdcddd", font: { family: '"Site Noto Sans", "Segoe UI", Arial, sans-serif', size: 12 },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: "#101924", padding: 12, titleColor: "#fff", bodyColor: "#e2edf8" } }
        });
        const axis = title => ({ title: { display: true, text: title, color: "#abb8ca" }, ticks: { color: "#abb8ca" }, grid: { color: "rgba(187,207,228,.1)" }, border: { color: "rgba(187,207,228,.2)" } });
        const histogramLabels = Array.from({ length: 10 }, (_, index) => index === 9 ? "9–10" : `${index}–<${index + 1}`);
        const barOptions = base();
        barOptions.scales = { x: axis("Khoảng điểm"), y: { ...axis("Số bài thi"), beginAtZero: true, ticks: { color: "#abb8ca", precision: 0 } } };
        get("scoreBarChart").setAttribute("aria-label", `Phổ điểm: ${histogramLabels.map((label, index) => `${label}: ${summary.histogram[index]} bài`).join("; ")}`);
        if (settings.bar_enabled) charts.push(new Chart(get("scoreBarChart"), { type: "bar", data: { labels: histogramLabels, datasets: [{ label: "Số bài thi", data: summary.histogram, backgroundColor: "#72c9f4", borderRadius: 4, maxBarThickness: 36 }] }, options: barOptions }));
        const pieOptions = base();
        pieOptions.plugins.legend = { display: true, position: "bottom", labels: { color: "#bdcddd", boxWidth: 10, boxHeight: 10, padding: 16, font: { size: 11 } } };
        pieOptions.plugins.tooltip.callbacks = { label: context => `${context.label}: ${context.raw} bài (${api.format(context.raw / summary.count * 100)}%)` };
        get("scorePieChart").setAttribute("aria-label", `Tỷ lệ nhóm điểm: ${summary.distribution.map(band => `${band.label}: ${band.count} bài`).join("; ")}`);
        if (settings.pie_enabled) charts.push(new Chart(get("scorePieChart"), { type: "pie", data: { labels: api.bands.map(band => band.label), datasets: [{ data: summary.distribution.map(band => band.count), backgroundColor: api.bands.map(band => band.color), borderColor: "#0a111e", borderWidth: 3 }] }, options: pieOptions }));
        const lineOptions = base();
        lineOptions.scales = { x: axis("Kỳ thi"), y: { ...axis("Điểm trung bình"), min: 0, max: 10 } };
        lineOptions.plugins.tooltip.callbacks = { label: context => `Điểm TB: ${api.format(context.raw)} · ${periodSummary[context.dataIndex].count} bài` };
        get("scoreLineChart").setAttribute("aria-label", `Điểm trung bình theo kỳ: ${periodSummary.map(period => `${period.label}: ${api.format(period.average)}`).join("; ")}`);
        if (settings.line_enabled) charts.push(new Chart(get("scoreLineChart"), { type: "line", data: { labels: periodSummary.map(period => period.label), datasets: [{ label: "Điểm trung bình", data: periodSummary.map(period => period.average), borderColor: "#6fe0b8", backgroundColor: "#6fe0b8", borderWidth: 2, pointRadius: 5, pointHoverRadius: 7, tension: 0, spanGaps: false }] }, options: lineOptions }));
    }
    async function load() {
        if (pending) return pending;
        loaded = false;
        renderVersion++;
        destroyCharts();
        get("examScoreResults").hidden = true;
        get("examScoreSummary").hidden = true;
        get("examStudentResults").hidden = true;
        studentPage = 1;
        ["scoreCount", "scoreAverage", "scoreHighest", "scorePassRate"].forEach(id => { get(id).textContent = "—"; });
        status("Đang tải điểm thi...");
        root.setAttribute("aria-busy", "true");
        get("scoreRefresh").disabled = true;
        pending = (async () => {
            try {
                const [scoreResult, configuration] = await Promise.allSettled([
                    api.fetchAll(supabaseClient, true),
                    supabaseClient.from("exam_score_settings").select("*").eq("id", 1).single(),
                    window.ExamScoreOptions?.load()
                ]);
                if (scoreResult.status === "rejected") throw scoreResult.reason;
                records = scoreResult.value;
                if (window.ExamScoreOptions) window.ExamScoreOptions.observeRecords(records);
                else api.observeRecords?.(records);
                settingsUnavailable = configuration.status === "rejected" || Boolean(configuration.value.error) || !configuration.value.data;
                settings = settingsUnavailable ? null : configuration.value.data;
                setOptions(get("scoreYearFilter"), [...new Set(records.map(row => row.school_year))].sort().reverse(), "Tất cả năm học");
                updateClasses();
                loaded = true;
                await render();
            } catch (error) { status(api.errorMessage(error), true); }
            finally { root.setAttribute("aria-busy", "false"); get("scoreRefresh").disabled = false; pending = null; }
        })();
        return pending;
    }
    ["scoreYearFilter", "scoreGradeFilter", "scoreClassFilter", "scorePeriodFilter"].forEach(id => {
        get(id).addEventListener("change", () => { studentPage = 1; if (["scoreYearFilter", "scoreGradeFilter"].includes(id)) updateClasses(); render(); });
    });
    get("scoreStudentTagFilter").addEventListener("input", () => { studentPage = 1; render(); });
    get("scoreStudentPagination").addEventListener("click", event => {
        const button = event.target.closest("[data-student-page]");
        if (!button || button.disabled) return;
        studentPage = Number(button.dataset.studentPage);
        renderStudents();
        get("scoreStudentsTitle").focus({ preventScroll: true });
        get("examStudentResults").scrollIntoView({ behavior: "auto", block: "start" });
    });
    get("scoreStudentCards").addEventListener("click", event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const card = event.target.closest(".exam-student-card[data-student-index]");
        if (card && openStudentCard(card)) event.preventDefault();
    });
    get("scoreStudentCards").addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest(".exam-student-card[data-student-index]");
        if (card && event.target === card && openStudentCard(card)) event.preventDefault();
    });
    get("scoreRefresh").addEventListener("click", load);
    window.examScorePage = { load };
    if (!root.hidden) load();
}());
