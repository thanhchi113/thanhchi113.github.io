(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.ExamScores = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const periods = Object.freeze([
        { key: "gk1", label: "Giữa kỳ 1", short: "GK1" },
        { key: "ck1", label: "Cuối kỳ 1", short: "CK1" },
        { key: "gk2", label: "Giữa kỳ 2", short: "GK2" },
        { key: "ck2", label: "Cuối kỳ 2", short: "CK2" }
    ]);
    const bands = Object.freeze([
        { label: "Dưới 5", max: 5, color: "#fb8e9e" },
        { label: "5 đến dưới 6,5", max: 6.5, color: "#f5c96a" },
        { label: "6,5 đến dưới 8", max: 8, color: "#72c9f4" },
        { label: "8 đến 10", max: Infinity, color: "#6fe0b8" }
    ]);
    const columns = "id,period,score,grade,class_name,school_year,published,created_at";
    const format = value => value == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
    const label = key => periods.find(period => period.key === key)?.label || key;
    const schoolYear = (date = new Date()) => {
        const start = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
        return `${start}-${start + 1}`;
    };
    function parseScore(value) {
        if (typeof value !== "number" && typeof value !== "string") return null;
        const text = String(value).trim().replace(",", ".");
        if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(text)) return null;
        const number = Number(text);
        return Number.isFinite(number) && number >= 0 && number <= 10 ? number : null;
    }
    function validate(input) {
        const score = parseScore(input.score);
        if (score === null) throw new Error("Điểm phải từ 0 đến 10, tối đa 2 chữ số thập phân.");
        if (!periods.some(period => period.key === input.period)) throw new Error("Hãy chọn kỳ thi.");
        const grade = Number(input.grade);
        if (![10, 11, 12].includes(grade)) throw new Error("Hãy chọn khối 10, 11 hoặc 12.");
        const year = String(input.school_year || "").trim();
        if (!/^20\d{2}-20\d{2}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) {
            throw new Error("Năm học phải gồm 2 năm liên tiếp, ví dụ 2026-2027.");
        }
        const className = String(input.class_name || "").trim().replace(/\s+/g, " ");
        if (!className || className.length > 80) throw new Error("Nhập lớp / khóa học, tối đa 80 ký tự.");
        return { period: input.period, score, grade, school_year: year, class_name: className, published: input.published === true };
    }
    function filter(records, filters = {}) {
        return records.filter(row => ["period", "grade", "school_year", "class_name"].every(key =>
            !filters[key] || filters[key] === "all" || String(row[key]) === String(filters[key])
        ));
    }
    function summarize(records) {
        const valid = records.map(row => ({ ...row, score: parseScore(row.score) })).filter(row => row.score !== null);
        const histogram = Array(10).fill(0);
        const distribution = bands.map(band => ({ ...band, count: 0 }));
        const byPeriod = periods.map(period => ({ ...period, count: 0, sum: 0, average: null }));
        let total = 0, passed = 0, highest = null;
        for (const row of valid) {
            total += row.score;
            passed += row.score >= 5 ? 1 : 0;
            highest = highest === null ? row.score : Math.max(highest, row.score);
            histogram[Math.min(9, Math.floor(row.score))]++;
            distribution.find(band => row.score < band.max).count++;
            const period = byPeriod.find(period => period.key === row.period);
            if (period) { period.count++; period.sum += row.score; }
        }
        for (const period of byPeriod) period.average = period.count ? period.sum / period.count : null;
        return { count: valid.length, average: valid.length ? total / valid.length : null, highest,
            passRate: valid.length ? passed / valid.length * 100 : null, histogram, distribution, byPeriod };
    }
    async function fetchAll(client, publicOnly = false) {
        const rows = [];
        const batchSize = 500;
        // Page through the API cap: statistics must include every recorded score.
        for (let offset = 0; ; offset += batchSize) {
            let query = client.from("exam_scores").select(columns).order("created_at", { ascending: false }).order("id", { ascending: false });
            if (publicOnly) query = query.eq("published", true);
            const { data, error } = await query.range(offset, offset + batchSize - 1);
            if (error) throw error;
            rows.push(...(data || []));
            if (!data || data.length < batchSize) break;
        }
        return rows;
    }
    function errorMessage(error, admin = false) {
        if (["42P01", "PGRST205"].includes(error?.code)) {
            return admin ? "Chưa có bảng điểm thi. Cần chạy migration exam_scores trong Supabase SQL Editor trước khi lưu." : "Mục điểm thi đang được thiết lập. Chưa có thống kê để hiển thị.";
        }
        if (error?.code === "42501") return "Chưa có quyền truy cập điểm thi. Vui lòng kiểm tra quyền quản trị và cấu hình dữ liệu.";
        return "Không thể kết nối dữ liệu điểm thi. Vui lòng thử lại.";
    }
    return { periods, bands, columns, format, label, schoolYear, parseScore, validate, filter, summarize, fetchAll, errorMessage };
}));
