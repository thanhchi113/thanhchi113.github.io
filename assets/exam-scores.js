(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.ExamScores = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const defaultPeriods = Object.freeze([
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
    const visibilityFields = Object.freeze(["show_image", "show_score", "show_class_name", "show_grade", "show_school_year", "show_period"]);
    const columns = "id,student_name,student_tag,period,score,grade,class_name,school_year,published,created_at,evidence_image_path,evidence_image_name,hide_student_name," + visibilityFields.join(",");
    function visibility(input = {}) {
        // Old records coupled image privacy to name privacy; preserve that until migrated.
        return Object.fromEntries(visibilityFields.map(key => [key, key === "show_image" && input[key] == null ? !input.hide_student_name : input[key] !== false]));
    }
    function publicRecord(input) {
        const row = { ...input, ...visibility(input) };
        if (row.hide_student_name) { row.student_name = null; row.student_tag = null; }
        for (const key of ["score", "class_name", "grade", "school_year", "period"]) if (!row[`show_${key}`]) row[key] = null;
        if (!row.show_image) row.evidence_image_path = row.evidence_image_name = null;
        return row;
    }
    const format = value => value == null ? "—" : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
    const label = key => options.periods.find(period => period.key === key)?.label || key;
    const schoolYear = (date = new Date()) => {
        const start = date.getFullYear() - (date.getMonth() < 7 ? 1 : 0);
        return `${start}-${start + 1}`;
    };
    const validPeriodKey = key => typeof key === "string" && /^[a-z][a-z0-9_-]{0,47}$/.test(key);
    const validYear = year => /^20\d{2}-20\d{2}$/.test(year) && Number(year.slice(5)) === Number(year.slice(0, 4)) + 1;
    let options = { periods: defaultPeriods.map(period => ({ ...period })), grades: [10, 11, 12], classes: [], years: [schoolYear()] };
    function normalizeOptions(value = {}) {
        if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
        const periods = defaultPeriods.map(period => ({ ...period }));
        for (const item of Array.isArray(value.periods) ? value.periods.slice(0, 60) : []) {
            if (!validPeriodKey(item?.key) || typeof item.label !== "string") continue;
            const label = item.label.trim().replace(/\s+/g, " ").slice(0, 80);
            if (!label) continue;
            const period = { key: item.key, label, short: String(item.short || label).slice(0, 24) };
            const existing = periods.findIndex(entry => entry.key === period.key);
            if (existing >= 0) periods[existing] = period; else periods.push(period);
        }
        const strings = (items, max, valid) => [...new Set((Array.isArray(items) ? items : []).filter(item => typeof item === "string").map(item => item.trim().replace(/\s+/g, " ")).filter(item => item && item.length <= max && (!valid || valid(item))))].slice(0, 500);
        return { periods, grades: [...new Set([10, 11, 12, ...(Array.isArray(value.grades) ? value.grades : []).map(Number).filter(grade => Number.isInteger(grade) && grade >= 1 && grade <= 12)])].sort((a, b) => a - b),
            classes: strings(value.classes, 80), years: [...new Set([schoolYear(), ...strings(value.years, 9, validYear)])].sort().reverse() };
    }
    function configure(value) { options = normalizeOptions(value); return getOptions(); }
    function getOptions() { return { periods: options.periods.map(period => ({ ...period })), grades: [...options.grades], classes: [...options.classes], years: [...options.years] }; }
    function observeRecords(records) {
        const next = getOptions();
        for (const row of records) {
            if (validPeriodKey(row.period) && !next.periods.some(period => period.key === row.period)) next.periods.push({ key: row.period, label: row.period, short: row.period });
            next.grades.push(row.grade); next.classes.push(row.class_name); next.years.push(row.school_year);
        }
        return configure(next);
    }
    function parseScore(value) {
        if (typeof value !== "number" && typeof value !== "string") return null;
        const text = String(value).trim().replace(",", ".");
        if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(text)) return null;
        const number = Number(text);
        return Number.isFinite(number) && number >= 0 && number <= 10 ? number : null;
    }
    function normalizeStudentTag(value) {
        const raw = String(value || "").trim().replace(/\s+/g, "-");
        if (!raw) return "";
        const match = raw.match(/^(?:HS[-_ ]*)?(\d{1,6})$/i);
        if (match) return `HS-${match[1].padStart(3, "0")}`;
        return raw.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 100);
    }
    function validate(input) {
        const score = parseScore(input.score);
        if (score === null) throw new Error("Điểm phải từ 0 đến 10, tối đa 2 chữ số thập phân.");
        if (!options.periods.some(period => period.key === input.period)) throw new Error("Hãy chọn kỳ thi trong danh mục.");
        const grade = Number(input.grade);
        if (!options.grades.includes(grade)) throw new Error("Hãy chọn khối trong danh mục.");
        const year = String(input.school_year || "").trim();
        if (!/^20\d{2}-20\d{2}$/.test(year) || Number(year.slice(5)) !== Number(year.slice(0, 4)) + 1) {
            throw new Error("Năm học phải gồm 2 năm liên tiếp, ví dụ 2026-2027.");
        }
        const className = String(input.class_name || "").trim().replace(/\s+/g, " ");
        if (!className || className.length > 80) throw new Error("Nhập lớp / khóa học, tối đa 80 ký tự.");
        const studentName = String(input.student_name || "").trim().replace(/\s+/g, " ");
        if (!studentName || studentName.length > 160) throw new Error("Nhập tên học sinh, tối đa 160 ký tự.");
        const studentTag = normalizeStudentTag(input.student_tag);
        if (studentTag.length > 100) throw new Error("Mã học sinh tối đa 100 ký tự.");
        return { period: input.period, score, grade, school_year: year, class_name: className, student_name: studentName, student_tag: studentTag || null, published: input.published === true, hide_student_name: input.hide_student_name === true };
    }
    function filter(records, filters = {}) {
        return records.filter(row => ["period", "grade", "school_year", "class_name", "student_tag"].every(key =>
            !filters[key] || filters[key] === "all" || String(row[key]) === String(filters[key])
        ));
    }
    function summarize(records) {
        const valid = records.map(row => ({ ...row, score: row.show_score === false ? null : parseScore(row.score) })).filter(row => row.score !== null);
        const histogram = Array(10).fill(0);
        const distribution = bands.map(band => ({ ...band, count: 0 }));
        const byPeriod = options.periods.map(period => ({ ...period, count: 0, sum: 0, average: null }));
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
            const query = publicOnly
                ? client.rpc("get_published_exam_scores", { page_offset: offset, page_limit: batchSize })
                : client.from("exam_scores").select(columns).order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + batchSize - 1);
            const { data, error } = await query;
            if (error) throw error;
            rows.push(...(publicOnly ? (data || []).map(publicRecord) : (data || [])));
            if (!data || data.length < batchSize) break;
        }
        return rows;
    }
    function errorMessage(error, admin = false) {
        if (["42P01", "PGRST205", "PGRST202"].includes(error?.code)) {
            return admin ? "Chưa có bảng điểm thi. Cần chạy migration exam_scores trong Supabase SQL Editor trước khi lưu." : "Mục điểm thi đang được thiết lập. Chưa có thống kê để hiển thị.";
        }
        if (["42703", "PGRST204"].includes(error?.code)) return admin ? "Cần chạy file SQL 20260913203000_exam_score_field_visibility.sql để thiết lập các nút hiện/ẩn thông tin điểm thi." : "Thông tin học sinh đang được cập nhật. Vui lòng quay lại sau.";
        if (error?.code === "42501") return "Chưa có quyền truy cập điểm thi. Vui lòng kiểm tra quyền quản trị và cấu hình dữ liệu.";
        return "Không thể kết nối dữ liệu điểm thi. Vui lòng thử lại.";
    }
    async function signedImageUrl(client, path) {
        if (!path) return "";
        const { data, error } = await client.storage.from("exam-score-evidence").createSignedUrl(path, 300);
        if (error) throw error;
        return data?.signedUrl || "";
    }
    return { get periods() { return options.periods.map(period => ({ ...period })); }, get grades() { return [...options.grades]; }, bands, columns, visibilityFields, visibility, publicRecord, format, label, schoolYear, parseScore, normalizeStudentTag, validate, filter, summarize, fetchAll, signedImageUrl, errorMessage, validPeriodKey, validYear, normalizeOptions, configure, getOptions, observeRecords };
}));
