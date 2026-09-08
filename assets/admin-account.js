(function () {
    "use strict";
    const byId = id => document.getElementById(id);
    const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    const recoveryMessage = "Nếu email này có tài khoản, bạn sẽ nhận được liên kết đặt lại mật khẩu. Hãy kiểm tra hộp thư và thư rác.";
    const recoveryUrl = () => location.protocol === "file:" ? "https://thanhchi113.github.io/reset-password.html" : new URL("reset-password.html", location.href).href;
    const passwordControls = new WeakMap();
    const passwordForms = new WeakSet();
    const passwordLabels = {
        loginPassword: "mật khẩu đăng nhập",
        accountCurrentPassword: "mật khẩu hiện tại",
        accountNewPassword: "mật khẩu mới",
        accountConfirmPassword: "mật khẩu xác nhận",
        recoveryPassword: "mật khẩu mới",
        recoveryConfirmation: "mật khẩu xác nhận"
    };
    function hidePasswords(scope = document) {
        scope.querySelectorAll("input[data-password-visibility]").forEach(input => passwordControls.get(input)?.hide());
    }
    function enhancePasswordInputs(scope = document) {
        scope.querySelectorAll('input[type="password"]').forEach(input => {
            if (!passwordLabels[input.id] || passwordControls.has(input)) return;
            const wrapper = document.createElement("div");
            wrapper.className = "account-password-control";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "account-password-toggle";
            button.dataset.passwordToggle = input.id;
            button.setAttribute("aria-controls", input.id);
            button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="account-password-slash" d="m3 3 18 18"/></svg>';
            input.before(wrapper);
            wrapper.append(input, button);
            input.dataset.passwordVisibility = "true";
            function setVisible(visible) {
                input.type = visible ? "text" : "password";
                button.setAttribute("aria-pressed", String(visible));
                const label = `${visible ? "Ẩn" : "Hiện"} ${passwordLabels[input.id]}`;
                button.setAttribute("aria-label", label);
                button.title = label;
                button.classList.toggle("is-visible", visible);
            }
            button.addEventListener("click", () => {
                if (!input.matches(":disabled")) setVisible(input.type === "password");
            });
            passwordControls.set(input, { hide: () => setVisible(false) });
            setVisible(false);
            const form = input.form;
            if (form && !passwordForms.has(form)) {
                // Mask before existing submit handlers run, including failed attempts and form resets.
                form.addEventListener("submit", () => hidePasswords(form), true);
                form.addEventListener("reset", () => hidePasswords(form), true);
                passwordForms.add(form);
            }
        });
    }
    function status(id, message, success = false) {
        const element = byId(id);
        if (!element) return;
        element.textContent = message;
        element.dataset.success = String(success);
    }
    function passwordError(error) {
        if (["weak_password", "password_too_short"].includes(error?.code)) return "Mật khẩu chưa đáp ứng yêu cầu. Hãy dùng ít nhất 8 ký tự gồm chữ, số và ký hiệu.";
        if (error?.code === "same_password") return "Mật khẩu mới cần khác mật khẩu hiện tại.";
        if (["reauthentication_needed", "reauthentication_not_valid"].includes(error?.code)) return "Cần xác minh lại tài khoản. Hãy đăng nhập lại rồi thử đổi mật khẩu.";
        if (["session_not_found", "refresh_token_not_found", "refresh_token_already_used", "bad_jwt"].includes(error?.code)) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
        if (error?.status === 429 || /rate_limit/.test(error?.code || "")) return "Bạn thao tác quá nhanh. Hãy chờ một lúc rồi thử lại.";
        return "Chưa thể đổi mật khẩu. Hãy kiểm tra kết nối và thử lại.";
    }
    function validPassword(password, confirmation) {
        if (password.length < 8) return "Mật khẩu mới cần ít nhất 8 ký tự.";
        if (password !== confirmation) return "Hai mật khẩu mới chưa trùng nhau.";
        return "";
    }
    function init(client) {
        if (window.adminAccount) return window.adminAccount;
        const recoveryMount = byId("accountRecoveryRequest");
        const workspace = byId("accountWorkspace");
        let accounts = [], currentUserId = null, loading = false, changing = false, revoking = false, targetAccount = null, loadVersion = 0;
        if (recoveryMount) {
            recoveryMount.innerHTML = `<details class="account-recovery-request"><summary>Quên mật khẩu?</summary><form id="accountForgotForm" class="account-form"><p>Nhập email đăng nhập để nhận liên kết đặt lại mật khẩu.</p><label for="accountForgotEmail">Email tài khoản</label><input id="accountForgotEmail" type="email" required autocomplete="email" maxlength="254"><button id="accountForgotSubmit" class="account-button" type="submit">Gửi liên kết đặt lại</button><p id="accountForgotStatus" class="account-status" role="status" aria-live="polite"></p></form></details>`;
            let sending = false;
            recoveryMount.querySelector("details").addEventListener("toggle", () => {
                if (!byId("accountForgotEmail").value) byId("accountForgotEmail").value = byId("loginEmail")?.value || "";
            });
            byId("accountForgotForm").addEventListener("submit", async event => {
                event.preventDefault();
                if (sending || !event.currentTarget.reportValidity()) return;
                sending = true;
                byId("accountForgotSubmit").disabled = true;
                status("accountForgotStatus", "Đang gửi yêu cầu...");
                try {
                    const { error } = await client.auth.resetPasswordForEmail(byId("accountForgotEmail").value.trim(), { redirectTo: recoveryUrl() });
                    if (error) throw error;
                    status("accountForgotStatus", recoveryMessage, true);
                } catch (error) {
                    status("accountForgotStatus", error?.status === 429 || /rate_limit/.test(error?.code || "") ? "Đã đạt giới hạn gửi email. Hãy chờ một lúc rồi thử lại." : "Chưa gửi được yêu cầu. Hãy kiểm tra kết nối và thử lại.");
                } finally { sending = false; byId("accountForgotSubmit").disabled = false; }
            });
        }
        if (workspace) {
            workspace.innerHTML = `<div class="account-workspace-heading"><div><h1>Tài khoản & bảo mật</h1><p>Quản lý mật khẩu và quyền truy cập trang quản trị.</p></div></div>
                <div class="account-layout"><section class="account-card"><h2>Đổi mật khẩu</h2><p id="accountSignedEmail" class="account-muted"></p>
                    <form id="accountPasswordForm" class="account-form"><fieldset id="accountPasswordFields">
                        <label for="accountCurrentPassword">Mật khẩu hiện tại</label><input id="accountCurrentPassword" type="password" required autocomplete="current-password" maxlength="256">
                        <label for="accountNewPassword">Mật khẩu mới</label><input id="accountNewPassword" type="password" required autocomplete="new-password" minlength="8" maxlength="256" aria-describedby="accountPasswordHelp">
                        <p id="accountPasswordHelp" class="account-muted">Ít nhất 8 ký tự. Nên kết hợp chữ, số và ký hiệu.</p>
                        <label for="accountConfirmPassword">Nhập lại mật khẩu mới</label><input id="accountConfirmPassword" type="password" required autocomplete="new-password" minlength="8" maxlength="256">
                        <button class="account-button" type="submit">Cập nhật mật khẩu</button>
                    </fieldset><p id="accountPasswordStatus" class="account-status" role="status" aria-live="polite"></p></form>
                </section><section class="account-card"><div class="account-heading-row"><h2>Quản trị viên</h2><button id="accountRefresh" class="account-button secondary" type="button">Làm mới</button></div><p class="account-muted">Thu hồi quyền sẽ ngừng quyền quản trị website của tài khoản đó. Tài khoản đăng nhập vẫn được giữ lại.</p><p id="accountListStatus" class="account-status" role="status" aria-live="polite"></p><div id="accountList" class="account-list"></div></section></div>
                <dialog id="accountRevokeDialog" class="account-dialog" aria-labelledby="accountRevokeTitle" aria-describedby="accountRevokeDescription"><form id="accountRevokeForm" class="account-form"><h2 id="accountRevokeTitle">Thu hồi quyền quản trị</h2><p id="accountRevokeDescription">Bạn đang thu hồi quyền quản trị của tài khoản:</p><strong id="accountRevokeEmail"></strong><code id="accountRevokeId"></code><p class="account-muted">Tài khoản này sẽ không thể sửa nội dung website. Thao tác không xóa tài khoản đăng nhập.</p><p id="accountRevokeStatus" class="account-status" role="status" aria-live="polite"></p><div class="account-dialog-actions"><button id="accountRevokeCancel" class="account-button secondary" type="button">Hủy</button><button id="accountRevokeConfirm" class="account-button danger" type="submit">Thu hồi quyền</button></div></form></dialog>`;
            byId("accountPasswordForm").addEventListener("submit", async event => {
                event.preventDefault();
                if (changing || !event.currentTarget.reportValidity()) return;
                const password = byId("accountNewPassword").value;
                const currentPassword = byId("accountCurrentPassword").value;
                const problem = validPassword(password, byId("accountConfirmPassword").value);
                if (problem) { status("accountPasswordStatus", problem); return; }
                if (password === currentPassword) { status("accountPasswordStatus", "Mật khẩu mới cần khác mật khẩu hiện tại."); return; }
                changing = true;
                byId("accountPasswordFields").disabled = true;
                status("accountPasswordStatus", "Đang xác minh tài khoản...");
                try {
                    const { data: userData, error: userError } = await client.auth.getUser();
                    if (userError || !userData?.user?.email) { status("accountPasswordStatus", "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại."); return; }
                    const { data: isAdmin, error: roleError } = await client.rpc("current_user_is_admin");
                    if (roleError || isAdmin !== true) { status("accountPasswordStatus", "Tài khoản này không còn quyền quản trị."); return; }
                    const { data: reauthData, error: reauthError } = await client.auth.signInWithPassword({ email: userData.user.email, password: currentPassword });
                    if (reauthError || reauthData?.user?.id !== userData.user.id) { status("accountPasswordStatus", "Không xác minh được mật khẩu hiện tại. Hãy kiểm tra và thử lại."); return; }
                    const { error } = await client.auth.updateUser({ password });
                    if (error) throw error;
                    byId("accountPasswordForm").reset();
                    status("accountPasswordStatus", "Đã cập nhật mật khẩu.", true);
                } catch (error) { status("accountPasswordStatus", passwordError(error)); }
                finally { changing = false; byId("accountPasswordFields").disabled = false; byId("accountCurrentPassword").value = ""; }
            });
            byId("accountRefresh").addEventListener("click", load);
            byId("accountList").addEventListener("click", event => {
                const button = event.target.closest("[data-revoke-account]");
                if (!button || loading || revoking) return;
                const row = accounts.find(account => account.id === button.dataset.revokeAccount);
                if (!row || row.is_current || row.id === currentUserId || accounts.length < 2) return;
                targetAccount = row;
                byId("accountRevokeEmail").textContent = row.email || "Tài khoản chưa có email";
                byId("accountRevokeId").textContent = row.id;
                status("accountRevokeStatus", "");
                byId("accountRevokeDialog").showModal();
                byId("accountRevokeCancel").focus();
            });
            byId("accountRevokeCancel").addEventListener("click", () => { if (!revoking) byId("accountRevokeDialog").close(); });
            byId("accountRevokeDialog").addEventListener("cancel", event => { if (revoking) event.preventDefault(); });
            byId("accountRevokeDialog").addEventListener("close", () => { targetAccount = null; });
            byId("accountRevokeForm").addEventListener("submit", async event => {
                event.preventDefault();
                if (revoking || !targetAccount || targetAccount.id === currentUserId || targetAccount.is_current || accounts.length < 2) return;
                revoking = true;
                byId("accountRevokeConfirm").disabled = true;
                byId("accountRevokeCancel").disabled = true;
                status("accountRevokeStatus", "Đang thu hồi quyền...");
                try {
                    const { error } = await client.rpc("revoke_admin_access", { target_user_id: targetAccount.id });
                    if (error) throw error;
                    byId("accountRevokeDialog").close();
                    const refreshed = await load();
                    if (refreshed) status("accountListStatus", "Đã thu hồi quyền quản trị của tài khoản đã chọn.", true);
                } catch (error) {
                    status("accountRevokeStatus", ["42883", "PGRST202"].includes(error?.code) ? "Chức năng thu hồi quyền chưa được kích hoạt trong cơ sở dữ liệu." : "Không thể thu hồi quyền. Quyền của bạn hoặc danh sách quản trị viên có thể đã thay đổi; hãy làm mới danh sách.");
                } finally { revoking = false; byId("accountRevokeConfirm").disabled = false; byId("accountRevokeCancel").disabled = false; }
            });
        }
        function renderAccounts() {
            byId("accountList").innerHTML = accounts.map(account => {
                const self = account.is_current || account.id === currentUserId;
                const blocked = self || accounts.length < 2;
                return `<article class="account-member"><div><strong>${escapeHtml(account.email || "Tài khoản chưa có email")}</strong><span>${self ? "Tài khoản của bạn" : "Quản trị viên"}</span></div><button class="account-button danger" type="button" data-revoke-account="${escapeHtml(account.id)}" ${blocked ? 'disabled title="Giữ lại tài khoản hiện tại và ít nhất một quản trị viên"' : ""}>Thu hồi quyền</button></article>`;
            }).join("");
        }
        async function load() {
            if (!workspace || loading || byId("adminPanel")?.classList.contains("hidden")) return;
            loading = true;
            const version = ++loadVersion;
            byId("accountRefresh").disabled = true;
            status("accountListStatus", "Đang tải tài khoản...");
            try {
                const { data: userData, error: userError } = await client.auth.getUser();
                if (userError || !userData?.user) throw userError || new Error("Missing user");
                const { data, error } = await client.rpc("list_admin_accounts");
                if (error) throw error;
                if (version !== loadVersion) return;
                currentUserId = userData.user.id;
                byId("accountSignedEmail").textContent = userData.user.email || "Đã đăng nhập";
                accounts = Array.isArray(data) ? data : [];
                renderAccounts();
                status("accountListStatus", `${accounts.length} quản trị viên. Không thể thu hồi quyền của chính bạn.`);
                return true;
            } catch (error) {
                if (version !== loadVersion) return;
                accounts = [];
                byId("accountList").replaceChildren();
                status("accountListStatus", ["42883", "PGRST202"].includes(error?.code) ? "Danh sách quản trị viên chưa được kích hoạt trong cơ sở dữ liệu." : "Không tải được tài khoản. Hãy kiểm tra quyền truy cập và thử lại.");
                return false;
            } finally { loading = false; byId("accountRefresh").disabled = false; }
        }
        function clear() {
            ++loadVersion;
            accounts = [];
            currentUserId = null;
            hidePasswords();
            if (!workspace) return;
            byId("accountPasswordForm").reset();
            byId("accountList").replaceChildren();
            byId("accountSignedEmail").textContent = "";
            status("accountPasswordStatus", "");
            status("accountListStatus", "");
            byId("accountRevokeDialog").close();
        }
        enhancePasswordInputs();
        window.adminAccount = { load, clear };
        if (workspace?.classList.contains("active")) load();
        return window.adminAccount;
    }
    window.AdminAccount = { init, validPassword, passwordError, enhancePasswordInputs, hidePasswords };
    enhancePasswordInputs();
    window.addEventListener("pagehide", () => hidePasswords());
}());
