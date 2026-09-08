(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.ExamScoreImportParser = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";
    const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().replace(/[^a-z0-9]/g, "");
    const text = value => String(value ?? "").trim().replace(/\s+/g, " ");
    function period(value) {
        const key = normalize(value).replace(/^diem(?:thi)?/, "").replace(/hocki|hocky/g, "ky").replace(/(giua|cuoi)ki/g, "$1ky");
        const aliases = { gk1: "gk1", gki: "gk1", giuaky1: "gk1", giuakyi: "gk1", ck1: "ck1", cki: "ck1", cuoiky1: "ck1", cuoikyi: "ck1", gk2: "gk2", gkii: "gk2", giuaky2: "gk2", giuakyii: "gk2", ck2: "ck2", ckii: "ck2", cuoiky2: "ck2", cuoikyii: "ck2" };
        return aliases[key] || "";
    }
    function header(value) {
        const key = normalize(value);
        if (["hoten", "hovaten", "hotenhocsinh", "hovatenhocsinh", "tenhocsinh", "hocsinh", "studentname", "name"].includes(key)) return "student_name";
        if (["lop", "lophoc", "lopkhoahoc", "khoahoc", "class", "classname"].includes(key)) return "class_name";
        if (["diem", "diemthi", "diemtoan", "diemmontoan", "diemmonthitoan", "diemdatduoc", "score", "ketqua"].includes(key)) return "score";
        if (["kythi", "ky", "dotthi", "period"].includes(key)) return "period";
        if (["khoi", "khoilop", "grade"].includes(key)) return "grade";
        if (["namhoc", "schoolyear"].includes(key)) return "school_year";
        const term = period(value);
        return term ? `term:${term}` : "";
    }
    function makeRow(values, defaults, source, sourceLine) {
        const className = text(values.class_name || defaults.class_name).replace(/^lớp\s+/i, "");
        const inferredGrade = className.match(/^(10|11|12)(?:\D|$)/)?.[1];
        return {
            student_name: text(values.student_name), class_name: className,
            score: text(values.score).replace(/\s*\/\s*10$/, ""),
            period: values.period ? (period(values.period) || text(values.period)) : defaults.period || "gk1",
            grade: text(values.grade || inferredGrade || defaults.grade || "12"),
            school_year: text(values.school_year || defaults.school_year),
            source, sourceLine, raw: values.raw || ""
        };
    }
    function fromRows(grid, defaults = {}, source = "Tệp nhập") {
        const result = { rows: [], warnings: [] };
        const rows = grid.map(row => row.map(text));
        const index = rows.slice(0, 30).findIndex(row => {
            const keys = row.map(header).filter(Boolean);
            return keys.length >= 2 && (keys.includes("student_name") || keys.includes("score") || keys.some(key => key.startsWith("term:")));
        });
        if (index < 0) {
            result.warnings.push("Không tìm thấy tiêu đề cột rõ ràng. Các dòng được phân tích thử; hãy kiểm tra lại tên, lớp và điểm.");
            rows.forEach((row, line) => {
                const raw = row.join(" ").trim();
                if (!raw) return;
                result.rows.push(makeRow(guessLine(raw), defaults, source, line + 1));
            });
            return result;
        }
        const keys = rows[index].map(header);
        rows.slice(index + 1).forEach((cells, offset) => {
            if (!cells.some(Boolean)) return;
            if (cells.filter((cell, column) => header(cell) && header(cell) === keys[column]).length >= 2) return;
            const values = { raw: cells.join(" | ") }, terms = [];
            keys.forEach((key, column) => {
                if (key.startsWith("term:") && cells[column] !== "" && cells[column] != null) terms.push({ period: key.slice(5), score: cells[column] });
                else if (key && !key.startsWith("term:")) values[key] = cells[column] ?? "";
            });
            // Keep incomplete named rows for review, while skipping separators/totals without data.
            if (!values.student_name && !values.score && !terms.length && !values.class_name) return;
            if (terms.length) terms.forEach(term => result.rows.push(makeRow({ ...values, ...term }, defaults, source, index + offset + 2)));
            else result.rows.push(makeRow(values, defaults, source, index + offset + 2));
        });
        return result;
    }
    function delimiterFor(content) {
        const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).slice(0, 5);
        const candidates = ["\t", ";", ",", "|"];
        let chosen = "", best = 0;
        for (const delimiter of candidates) {
            const score = lines.reduce((sum, line) => sum + line.split(delimiter).map(header).filter(Boolean).length, 0);
            if (score > best) { chosen = delimiter; best = score; }
        }
        if (best >= 2) return chosen;
        return candidates.find(delimiter => lines[0]?.includes(delimiter) && delimiter !== ",") || "";
    }
    function parseDelimited(content, delimiter = delimiterFor(content)) {
        if (!delimiter) return content.split(/\r?\n/).map(line => [line]);
        const rows = [], row = [];
        let value = "", quoted = false;
        const input = content.replace(/^\uFEFF/, "");
        for (let i = 0; i < input.length; i++) {
            const character = input[i];
            if (character === '"') {
                if (quoted && input[i + 1] === '"') { value += '"'; i++; }
                else if (quoted || value === "") quoted = !quoted;
                else value += character;
            } else if (character === delimiter && !quoted) { row.push(value); value = ""; }
            else if ((character === "\n" || character === "\r") && !quoted) {
                if (character === "\r" && input[i + 1] === "\n") i++;
                row.push(value); rows.push(row.splice(0)); value = "";
            } else value += character;
        }
        if (value || row.length) { row.push(value); rows.push(row); }
        return rows;
    }
    function guessLine(input) {
        let raw = input.trim().replace(/^\d+[.)]?\s+/, "");
        const classMatch = raw.match(/\b(?:10|11|12)[A-Za-zÀ-ỹ][A-Za-z0-9.-]*\b/);
        const scoreMatch = raw.match(/(?:^|\s)(\d{1,2}(?:[.,]\d{1,2})?)(?:\s*\/\s*10)?\s*(?:điểm)?$/i);
        const result = { student_name: "", score: "", class_name: classMatch?.[0] || "", raw: input };
        if (scoreMatch) {
            result.score = scoreMatch[1];
            raw = raw.slice(0, scoreMatch.index).trim();
        }
        if (classMatch) raw = raw.replace(classMatch[0], "").replace(/lớp\s*$/i, "").trim();
        // Multiple unexplained numbers are ambiguous OCR columns: leave the score for review.
        if (/\d/.test(raw)) result.score = "";
        else if (/\p{L}/u.test(raw)) result.student_name = raw.replace(/^họ(?:\s+và)?\s+tên\s*[:：]\s*/i, "");
        return result;
    }
    function fromText(content, defaults = {}, source = "Tệp nhập") {
        const delimiter = delimiterFor(content);
        if (delimiter) return fromRows(parseDelimited(content, delimiter), defaults, source);
        const lines = content.split(/\r?\n/);
        const labeled = lines.map(line => {
            const match = line.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
            return match ? [header(match[1]), match[2]] : ["", line];
        });
        if (labeled.filter(([key]) => key).length >= 2) {
            const rows = [];
            let values = {}, terms = [], first = 1;
            const flush = () => {
                if (Object.keys(values).length || terms.length) {
                    if (terms.length) terms.forEach(term => rows.push(makeRow({ ...values, ...term }, defaults, source, first)));
                    else rows.push(makeRow(values, defaults, source, first));
                }
                values = {}; terms = [];
            };
            labeled.forEach(([key, value], index) => {
                if (!key) return;
                if (key === "student_name" && Object.prototype.hasOwnProperty.call(values, key)) { flush(); first = index + 1; }
                if (key.startsWith("term:")) terms.push({ period: key.slice(5), score: value });
                else values[key] = value;
            });
            flush();
            return { rows, warnings: ["Văn bản được nhận diện theo nhãn. Hãy đối chiếu lại với tệp gốc trước khi lưu."] };
        }
        return fromRows(lines.map(line => [line]), defaults, source);
    }
    return { normalize, period, header, fromRows, fromText, parseDelimited };
}));
