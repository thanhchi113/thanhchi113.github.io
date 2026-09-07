(function () {
    "use strict";
    const api = window.ExamScores;
    const root = document.getElementById("examScores");
    const get = id => document.getElementById(id);
    let records = [], pending = null, charts = [], chartLibrary = null, loaded = false;
    let renderVersion = 0;
    const filters = () => ({
        school_year: get("scoreYearFilter").value, grade: get("scoreGradeFilter").value,
        class_name: get("scoreClassFilter").value, period: get("scorePeriodFilter").value
    });
    function setOptions(select, values, placeholder) {
        const previous = select.value;
        select.replaceChildren(new Option(placeholder, "all"), ...values.map(value => new Option(value, value)));
        if (values.includes(previous)) select.value = previous;
    }
    function updateClasses() {
        const { school_year, grade } = filters();
        const available = api.filter(records, { school_year, grade });
        setOptions(get("scoreClassFilter"), [...new Set(available.map(row => row.class_name))].sort((a, b) => a.localeCompare(b, "vi")), "Tất cả lớp / khóa");
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
    async function render() {
        if (root.hidden || !loaded) return;
        const version = ++renderVersion;
        const selected = filters();
        const summary = api.summarize(api.filter(records, selected));
        destroyCharts();
        get("scoreCount").textContent = api.format(summary.count);
        get("scoreAverage").textContent = api.format(summary.average);
        get("scoreHighest").textContent = api.format(summary.highest);
        get("scorePassRate").textContent = summary.passRate === null ? "—" : `${api.format(summary.passRate)}%`;
        get("examScoreResults").hidden = !summary.count;
        status(summary.count ? `${api.format(summary.count)} bài thi môn Toán · ${selected.period === "all" ? "Tất cả kỳ thi" : api.label(selected.period)} · ${selected.school_year === "all" ? "Tất cả năm học" : selected.school_year}` : "Chưa có điểm thi đã công bố phù hợp với bộ lọc này.");
        get("scorePeriodRows").innerHTML = summary.byPeriod.map(period => `<tr><th scope="row">${period.label}</th><td>${api.format(period.count)}</td><td>${api.format(period.average)}</td></tr>`).join("");
        if (!summary.count) return;
        let Chart;
        try { Chart = await loadChartLibrary(); }
        catch (_) {
            if (version === renderVersion && !root.hidden) {
                get("examScoreCharts").hidden = true;
                status("Chưa tải được biểu đồ. Bảng thống kê vẫn hiển thị bên dưới; hãy thử làm mới.", true);
            }
            return;
        }
        if (version !== renderVersion || root.hidden) return;
        get("examScoreCharts").hidden = false;
        const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const base = () => ({
            responsive: true, maintainAspectRatio: false, animation: motion ? { duration: 650 } : false,
            color: "#bdcddd", font: { family: "Inter, Arial, sans-serif", size: 12 },
            plugins: { legend: { display: false }, tooltip: { backgroundColor: "#101924", padding: 12, titleColor: "#fff", bodyColor: "#e2edf8" } }
        });
        const axis = title => ({ title: { display: true, text: title, color: "#abb8ca" }, ticks: { color: "#abb8ca" }, grid: { color: "rgba(187,207,228,.1)" }, border: { color: "rgba(187,207,228,.2)" } });
        const histogramLabels = Array.from({ length: 10 }, (_, index) => index === 9 ? "9–10" : `${index}–<${index + 1}`);
        const barOptions = base();
        barOptions.scales = { x: axis("Khoảng điểm"), y: { ...axis("Số bài thi"), beginAtZero: true, ticks: { color: "#abb8ca", precision: 0 } } };
        get("scoreBarChart").setAttribute("aria-label", `Phổ điểm: ${histogramLabels.map((label, index) => `${label}: ${summary.histogram[index]} bài`).join("; ")}`);
        charts.push(new Chart(get("scoreBarChart"), { type: "bar", data: { labels: histogramLabels, datasets: [{ label: "Số bài thi", data: summary.histogram, backgroundColor: "#72c9f4", borderRadius: 4, maxBarThickness: 36 }] }, options: barOptions }));
        const pieOptions = base();
        pieOptions.plugins.legend = { display: true, position: "bottom", labels: { color: "#bdcddd", boxWidth: 10, boxHeight: 10, padding: 16, font: { size: 11 } } };
        pieOptions.plugins.tooltip.callbacks = { label: context => `${context.label}: ${context.raw} bài (${api.format(context.raw / summary.count * 100)}%)` };
        get("scorePieChart").setAttribute("aria-label", `Tỷ lệ nhóm điểm: ${summary.distribution.map(band => `${band.label}: ${band.count} bài`).join("; ")}`);
        charts.push(new Chart(get("scorePieChart"), { type: "pie", data: { labels: api.bands.map(band => band.label), datasets: [{ data: summary.distribution.map(band => band.count), backgroundColor: api.bands.map(band => band.color), borderColor: "#0a111e", borderWidth: 3 }] }, options: pieOptions }));
        const lineOptions = base();
        lineOptions.scales = { x: axis("Kỳ thi"), y: { ...axis("Điểm trung bình"), min: 0, max: 10 } };
        lineOptions.plugins.tooltip.callbacks = { label: context => `Điểm TB: ${api.format(context.raw)} · ${summary.byPeriod[context.dataIndex].count} bài` };
        get("scoreLineChart").setAttribute("aria-label", `Điểm trung bình theo kỳ: ${summary.byPeriod.map(period => `${period.label}: ${api.format(period.average)}`).join("; ")}`);
        charts.push(new Chart(get("scoreLineChart"), { type: "line", data: { labels: api.periods.map(period => period.label), datasets: [{ label: "Điểm trung bình", data: summary.byPeriod.map(period => period.average), borderColor: "#6fe0b8", backgroundColor: "#6fe0b8", borderWidth: 2, pointRadius: 5, pointHoverRadius: 7, tension: 0, spanGaps: false }] }, options: lineOptions }));
    }
    async function load() {
        if (pending) return pending;
        loaded = false;
        renderVersion++;
        destroyCharts();
        get("examScoreResults").hidden = true;
        ["scoreCount", "scoreAverage", "scoreHighest", "scorePassRate"].forEach(id => { get(id).textContent = "—"; });
        status("Đang tải điểm thi...");
        root.setAttribute("aria-busy", "true");
        get("scoreRefresh").disabled = true;
        pending = (async () => {
            try {
                records = await api.fetchAll(supabaseClient, true);
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
        get(id).addEventListener("change", () => { if (["scoreYearFilter", "scoreGradeFilter"].includes(id)) updateClasses(); render(); });
    });
    get("scoreRefresh").addEventListener("click", load);
    window.examScorePage = { load };
    if (!root.hidden) load();
}());
