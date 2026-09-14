(() => {
    "use strict";
    const dialog = document.getElementById("contactQrDialog");
    if (!dialog) return;
    const code = document.getElementById("contactQrCode");
    const status = document.getElementById("contactQrStatus");
    const link = document.getElementById("contactQrLink");
    const download = document.getElementById("contactQrDownload");
    const retry = document.getElementById("contactQrRetry");
    const channels = { facebook: { source: "contactFacebook", label: "Facebook" }, zalo: { source: "contactZalo", label: "Zalo" } };
    let generation = 0, selected = "", trigger = null;

    async function render() {
        const current = ++generation, channel = channels[selected];
        const source = document.getElementById(channel.source);
        code.replaceChildren();
        code.setAttribute("aria-busy", "true");
        code.setAttribute("aria-label", `Mã QR ${channel.label}`);
        status.textContent = "Đang tạo mã QR...";
        download.disabled = true;
        retry.hidden = true;
        link.hidden = true;
        link.removeAttribute("href");
        let url;
        try {
            url = new URL(source?.getAttribute("href") || "");
            if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid contact link");
        } catch {
            status.textContent = "Liên kết chưa hợp lệ. Vui lòng kiểm tra thông tin liên hệ trong admin.";
            code.setAttribute("aria-busy", "false");
            return;
        }
        link.href = url.href;
        link.textContent = source.querySelector("strong")?.textContent.trim() || `Mở ${channel.label}`;
        link.hidden = false;
        try {
            await window.ensureQrCodeJs();
            if (!dialog.open || current !== generation) return;
            const buffer = document.createElement("div");
            new window.QRCode(buffer, { text: url.href, width: 224, height: 224, colorDark: "#081224", colorLight: "#ffffff", correctLevel: window.QRCode.CorrectLevel.M });
            const raw = buffer.querySelector("canvas");
            if (!raw) throw new Error("QR rendering failed");
            // Include the quiet zone in the downloadable image, not only its CSS.
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 320;
            const context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, 320, 320);
            context.drawImage(raw, 48, 48);
            code.append(canvas);
            download.disabled = false;
            status.textContent = `Quét mã để mở ${channel.label}, hoặc bấm liên kết bên dưới.`;
        } catch {
            if (!dialog.open || current !== generation) return;
            status.textContent = "Chưa tải được mã QR. Bạn có thể mở liên kết bên dưới hoặc thử lại.";
            retry.hidden = false;
        } finally {
            if (current === generation) code.setAttribute("aria-busy", "false");
        }
    }

    document.querySelectorAll("[data-contact-qr]").forEach(button => button.addEventListener("click", () => {
        if (!channels[button.dataset.contactQr]) return;
        selected = button.dataset.contactQr;
        trigger = button;
        document.getElementById("contactQrTitle").textContent = `QR ${channels[selected].label}`;
        dialog.showModal();
        document.documentElement.classList.add("contact-qr-open");
        render();
    }));
    document.getElementById("contactQrClose").addEventListener("click", () => dialog.close());
    let backdropStart = false;
    const outside = event => {
        const rect = dialog.getBoundingClientRect();
        return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    dialog.addEventListener("pointerdown", event => { backdropStart = event.target === dialog && outside(event); });
    dialog.addEventListener("click", event => { if (backdropStart && event.target === dialog && outside(event)) dialog.close(); backdropStart = false; });
    dialog.addEventListener("close", () => {
        if (dialog.open) return;
        generation++;
        document.documentElement.classList.remove("contact-qr-open");
        trigger?.focus({ preventScroll: true });
    });
    retry.addEventListener("click", render);
    download.addEventListener("click", () => {
        const canvas = code.querySelector("canvas");
        if (download.disabled || !canvas) return;
        const save = document.createElement("a");
        save.href = canvas.toDataURL("image/png");
        save.download = `${selected}-ThanhChi-QR.png`;
        save.click();
    });
    document.addEventListener("site-appearance-change", () => { if (dialog.open) render(); });
})();
