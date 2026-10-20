/**
 * AgriTrace ColdChain - Shared App Shell
 * Handles:
 * - Immediate cached user profile rendering via sessionStorage (zero "Đang tải..." flash)
 * - Background session revalidation (/api/me)
 * - Standardized header IDs (userAvatar, userEmail, userOrg, userRole, logout)
 * - Active navigation styling
 * - Unified logout flow
 */

(function () {
  const STORAGE_KEY = "agriUser";

  const APP_PERMISSIONS = {
    "farm.write": ["producer", "cooperative", "org_admin", "admin"],
    "harvest.create": ["producer", "cooperative", "org_admin", "admin"],
    "shipment.create": ["producer", "cooperative", "transporter", "distributor", "warehouse", "org_admin", "admin"],
    "shipment.complete": ["producer", "cooperative", "transporter", "distributor", "warehouse", "org_admin", "admin"],
    "product.write": ["admin"],
    "global.read": ["inspector", "admin"],
    "integrity.check": ["inspector", "admin"],
  };

  const NAV_PERMISSIONS = {
    navLots: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navFarms: ["producer", "cooperative", "inspector", "org_admin", "admin"],
    navProducts: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navHarvest: ["producer", "cooperative", "org_admin", "admin"],
    navShipments: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navColdShipments: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navIntegrity: ["inspector", "admin"],
    navAuditLogs: ["inspector", "admin"],
    navAudit: ["inspector", "admin"],
    navPublicTrace: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navColdChain: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navRecallProgress: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navRecallForm: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
  };

  function hasPermission(roleId, action) {
    if (!roleId || !action) return false;
    const allowed = APP_PERMISSIONS[action];
    return Array.isArray(allowed) && allowed.includes(roleId);
  }

  function applyRoleNavigation(roleId) {
    if (!roleId) return;

    Object.entries(NAV_PERMISSIONS).forEach(([navId, allowedRoles]) => {
      const el = document.getElementById(navId);
      if (el) {
        el.style.display = allowedRoles.includes(roleId) ? "" : "none";
      }
    });

    const canHarvest = hasPermission(roleId, "harvest.create");
    document.querySelectorAll("#btnGoHarvest, .btn-go-harvest").forEach((btn) => {
      btn.style.display = canHarvest ? "" : "none";
    });
  }

  function formatRole(role) {
    const map = {
      admin: "Quản trị viên",
      org_admin: "Quản trị tổ chức",
      producer: "Nông dân / Sản xuất",
      cooperative: "Hợp tác xã",
      inspector: "Cán bộ kiểm tra",
      transporter: "Đơn vị vận chuyển",
      distributor: "Nhà phân phối",
      warehouse: "Kho lạnh",
      processing: "Sơ chế",
      retailer: "Bán lẻ",
    };
    return map[role] || role || "Thành viên";
  }

  function getCachedUser() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setCachedUser(user) {
    if (!user) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          id: user.id || user.userId,
          email: user.email,
          organizationId: user.organizationId,
          roleId: user.roleId,
        })
      );
    } catch (e) {
      console.warn("Could not save user to sessionStorage", e);
    }
  }

  function renderUserHeader(user) {
    if (!user) return;

    const emailEl = document.getElementById("userEmail") || document.getElementById("headerUserEmail");
    const avatarEl = document.getElementById("userAvatar") || document.getElementById("avatarLetter");
    const orgEl = document.getElementById("userOrg") || document.getElementById("headerOrg");
    const roleEl = document.getElementById("userRole") || document.getElementById("headerRole");

    if (emailEl && user.email) {
      emailEl.textContent = user.email;
    }
    if (avatarEl && user.email) {
      avatarEl.textContent = user.email.charAt(0).toUpperCase();
    }
    if (orgEl) {
      orgEl.textContent = user.organizationId || "Chưa có tổ chức";
    }
    if (roleEl) {
      roleEl.textContent = formatRole(user.roleId);
    }

    applyRoleNavigation(user.roleId);
  }

  async function handleLogout(e) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.clear();
    } catch (_) { }

    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
      });
    } catch (err) {
      console.warn("Logout error:", err);
    } finally {
      window.location.href = "/index.html";
    }
  }

  function setupLogout() {
    const buttons = [
      document.getElementById("logout"),
      document.getElementById("logoutBtn"),
      ...document.querySelectorAll(".btn-logout"),
    ].filter(Boolean);

    buttons.forEach((btn) => {
      btn.onclick = handleLogout;
      if (!btn._appShellBound) {
        btn._appShellBound = true;
        btn.addEventListener("click", handleLogout);
      }
    });
  }

  function setupActiveNav(activeKey) {
    const path = window.location.pathname;
    const navMap = {
      lots: "navLots",
      farms: "navFarms",
      products: "navProducts",
      harvest: "navHarvest",
      integrity: "navIntegrity",
      audit: "navAuditLogs",
      auditLogs: "navAuditLogs",
      recallProgress: "navRecallProgress",
      recallForm: "navRecallForm",
      shipments: "navShipments",
      coldShipments: "navShipments",
    };

    let targetId = navMap[activeKey];
    if (!targetId) {
      if (path.includes("lots")) targetId = "navLots";
      else if (path.includes("farms")) targetId = "navFarms";
      else if (path.includes("products")) targetId = "navProducts";
      else if (path.includes("harvest")) targetId = "navHarvest";
      else if (path.includes("integrity")) targetId = "navIntegrity";
      else if (path.includes("audit")) targetId = "navAuditLogs";
      else if (path.includes("recall-progress")) targetId = "navRecallProgress";
      else if (path.includes("recall-form")) targetId = "navRecallForm";
      else if (path.includes("shipment")) targetId = "navShipments";
    }

    if (targetId) {
      document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("active");
      });
      const activeEl = document.getElementById(targetId);
      if (activeEl) {
        activeEl.classList.add("active");
      }
    }
  }

  // Global dismiss listener for dropdown menus
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-menu-wrapper")) {
        document.querySelectorAll(".dropdown-popover.active").forEach((p) => p.classList.remove("active"));
        document.querySelectorAll(".btn-icon-kebab.active").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll(".has-dropdown-open").forEach((el) => el.classList.remove("has-dropdown-open"));
      }
    });
  }

  /**
   * Initializes the shared App Shell
   * @param {Object} options - { activeNav: 'lots'|'farms'|'products'|'harvest', onUserLoaded: function(user) }
   * @returns {Promise<Object|null>} authenticated user object
   */
  async function initAppShell(options = {}) {
    // 1. Immediately render cached user from sessionStorage (zero latency / no flash)
    const cachedUser = getCachedUser();
    if (cachedUser) {
      renderUserHeader(cachedUser);
    }

    // 2. Set up active nav link & logout handler
    setupActiveNav(options.activeNav);
    setupLogout();

    // Ngoại lệ (whitelist) cho trang lot-detail.html: xem công khai không yêu cầu xác thực
    if (typeof window !== "undefined" && window.location && window.location.pathname && window.location.pathname.includes("lot-detail")) {
      return cachedUser || { roleId: "guest", isPublic: true };
    }

    // 3. Silent revalidation against server (/api/me)
    try {
      const res = await fetch("/api/me", { credentials: "same-origin" });
      if (res.status === 401) {
        sessionStorage.removeItem(STORAGE_KEY);
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/index.html?returnTo=${returnTo}`;
        return null;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const verifiedUser = data.user;
      setCachedUser(verifiedUser);
      renderUserHeader(verifiedUser);

      if (typeof options.onUserLoaded === "function") {
        options.onUserLoaded(verifiedUser);
      }

      // Check for pending recalls to display prominent alert banner
      if (options.checkPendingRecalls !== false) {
        checkPendingRecalls({ onPendingRecallsLoaded: options.onPendingRecallsLoaded }).catch((e) => {
          console.warn("Could not check pending recalls:", e);
        });
      }

      return verifiedUser;
    } catch (err) {
      console.warn("Session background revalidation failed:", err);
      // Nếu không có cả cache lẫn xác thực server, điều hướng về login
      if (!cachedUser) {
        const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/index.html?returnTo=${returnTo}`;
      }
      return cachedUser || null;
    }
  }

  // Auto-render cache and bind logout immediately
  if (typeof document !== "undefined") {
    const preCache = getCachedUser();
    if (preCache) {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => renderUserHeader(preCache));
      } else {
        renderUserHeader(preCache);
      }
    }

    // Ensure logout is bound as soon as DOM is ready or immediately if already loaded
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", setupLogout);
    } else {
      setupLogout();
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function copyTextToClipboard(text) {
    if (!text) return false;
    let copied = false;
    try {
      if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      // Fallback khi Clipboard API bị chặn trên HTTP
    }

    if (!copied && typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "-9999px";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand("copy");
        textarea.remove();
      } catch (err) {
        console.error("Không thể sao chép bằng fallback:", err);
      }
    }
    return copied;
  }

  /**
   * Helper quản lý hiển thị lỗi biểu mẫu dùng chung (T-22)
   * Đồng bộ trải nghiệm hiển thị lỗi validation ngay dưới ô nhập liệu và xóa lỗi khi sửa.
   *
   * @param {Object} options
   * @param {HTMLElement|string} [options.scope] Biểu mẫu hoặc container bao ngoài
   * @param {HTMLElement|string|Function} [options.globalAlert] Element hoặc selector hiển thị banner lỗi chung
   * @param {Object} [options.fields] Ánh xạ từng trường: { [fieldName]: { input: ..., error: ... } }
   */
  function createFormErrorHandler(options = {}) {
    function getScope() {
      if (typeof document === "undefined") return null;
      if (typeof options.scope === "string") {
        return document.querySelector(options.scope);
      }
      return options.scope || document;
    }

    function getGlobalAlert() {
      if (typeof options.globalAlert === "function") return options.globalAlert;
      if (typeof options.globalAlert === "object" && options.globalAlert !== null) return options.globalAlert;
      if (typeof document === "undefined") return null;
      if (typeof options.globalAlert === "string") {
        return document.querySelector(options.globalAlert);
      }
      return null;
    }

    const fieldsConfig = options.fields || {};

    function resolveFieldElements(fieldName) {
      const scopeEl = getScope() || (typeof document !== "undefined" ? document : null);
      const cfg = fieldsConfig[fieldName] || {};
      let inputEl = null;
      let errorEl = null;

      if (cfg.input) {
        inputEl = typeof cfg.input === "string"
          ? ((scopeEl && scopeEl.querySelector ? scopeEl.querySelector(cfg.input) : null) || (typeof document !== "undefined" ? document.querySelector(cfg.input) : null))
          : cfg.input;
      }
      if (cfg.error) {
        errorEl = typeof cfg.error === "string"
          ? ((scopeEl && scopeEl.querySelector ? scopeEl.querySelector(cfg.error) : null) || (typeof document !== "undefined" ? document.querySelector(cfg.error) : null))
          : cfg.error;
      }

      // Fallback tự động tìm theo ID hoặc name
      if (!inputEl && scopeEl && scopeEl.querySelector) {
        inputEl = scopeEl.querySelector(`#input-${fieldName}`) ||
          scopeEl.querySelector(`#select-${fieldName}`) ||
          scopeEl.querySelector(`#${fieldName}`) ||
          scopeEl.querySelector(`[name="${fieldName}"]`);
      }
      if (!errorEl && scopeEl && scopeEl.querySelector) {
        errorEl = scopeEl.querySelector(`#error-${fieldName}`) ||
          scopeEl.querySelector(`#${fieldName}Error`) ||
          scopeEl.querySelector(`[data-error-for="${fieldName}"]`);
      }

      return { inputEl, errorEl };
    }

    function clearFieldError(fieldName) {
      const { inputEl, errorEl } = resolveFieldElements(fieldName);
      if (inputEl) {
        if (inputEl.classList && inputEl.classList.remove) {
          inputEl.classList.remove("input-error");
        }
        if (inputEl.removeAttribute) {
          inputEl.removeAttribute("aria-invalid");
        }
      }
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.display = "none";
      }
    }

    function setFieldError(fieldName, message) {
      const { inputEl, errorEl } = resolveFieldElements(fieldName);
      if (inputEl) {
        if (inputEl.classList && inputEl.classList.add) {
          inputEl.classList.add("input-error");
        }
        if (inputEl.setAttribute) {
          inputEl.setAttribute("aria-invalid", "true");
        }
      }
      if (errorEl) {
        errorEl.textContent = message || "";
        errorEl.style.display = message ? "block" : "none";
        return true;
      }
      return false;
    }

    function clear() {
      // 1. Xóa các trường đã cấu hình
      Object.keys(fieldsConfig).forEach(clearFieldError);

      // 2. Xóa các phần tử lỗi còn sót lại trong phạm vi
      const scopeEl = getScope();
      if (scopeEl && scopeEl.querySelectorAll) {
        scopeEl.querySelectorAll(".input-error").forEach((el) => {
          if (el.classList && el.classList.remove) {
            el.classList.remove("input-error");
          }
          if (el.removeAttribute) {
            el.removeAttribute("aria-invalid");
          }
        });
        scopeEl.querySelectorAll(".error-msg").forEach((el) => {
          el.textContent = "";
          el.style.display = "none";
        });
      }

      // 3. Xóa alert banner chung
      const alertTarget = getGlobalAlert();
      if (alertTarget) {
        if (typeof alertTarget === "function") {
          alertTarget(null);
        } else {
          alertTarget.textContent = "";
          alertTarget.style.display = "none";
          if (alertTarget.classList && alertTarget.classList.contains("alert-box")) {
            alertTarget.className = "alert-box";
          }
        }
      }
    }

    function showErrors(errors) {
      if (!errors) return;

      const unhandled = [];

      if (typeof errors === "string") {
        unhandled.push(errors);
      } else if (typeof errors === "object") {
        const errorEntries = errors.errors && typeof errors.errors === "object"
          ? errors.errors
          : errors;

        Object.entries(errorEntries).forEach(([field, msg]) => {
          if (!msg) return;
          if (field === "_global" || field === "general" || field === "message") {
            unhandled.push(msg);
            return;
          }
          const handled = setFieldError(field, msg);
          if (!handled) {
            unhandled.push(msg);
          }
        });
      }

      if (unhandled.length > 0) {
        const alertTarget = getGlobalAlert();
        if (alertTarget) {
          const combinedMsg = unhandled.join(" ");
          if (typeof alertTarget === "function") {
            alertTarget(combinedMsg);
          } else {
            alertTarget.textContent = combinedMsg;
            alertTarget.style.display = "block";
            if (alertTarget.classList && alertTarget.classList.contains("alert-box")) {
              alertTarget.className = "alert-box alert-error";
            }
          }
        }
      }
    }

    function bindAutoClear() {
      Object.keys(fieldsConfig).forEach((field) => {
        const { inputEl } = resolveFieldElements(field);
        if (inputEl && typeof inputEl.addEventListener === "function") {
          const onInput = () => clearFieldError(field);
          inputEl.addEventListener("input", onInput);
          inputEl.addEventListener("change", onInput);
        }
      });
    }

    return {
      clear,
      showErrors,
      setFieldError,
      clearFieldError,
      resolveFieldElements,
      bindAutoClear,
    };
  }

  function showFieldErrors(errors, options) {
    const handler = createFormErrorHandler(options);
    handler.showErrors(errors);
    return handler;
  }

  function clearFieldErrors(options) {
    const handler = createFormErrorHandler(options);
    handler.clear();
    return handler;
  }

  /**
   * Pending Recalls Alert Component (S-36 / S-37 / S-40)
   * Fetches pending recalls from GET /api/recalls/pending for current authenticated organization.
   * Renders prominent alert banner in global shell when pending recalls exist.
   */
  async function fetchPendingRecalls() {
    try {
      const res = await fetch("/api/recalls/pending", { credentials: "same-origin" });
      if (!res.ok) {
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn("fetchPendingRecalls error:", err);
      return [];
    }
  }

  function ensureShellAlertStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById("shellPendingRecallStyles")) return;
    const style = document.createElement("style");
    style.id = "shellPendingRecallStyles";
    style.textContent = `
      .shell-pending-recall-alert {
        background: #fffbeb;
        border-bottom: 2px solid #f59e0b;
        color: #92400e;
        padding: 12px 20px;
        box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13.5px;
        z-index: 999;
        position: relative;
        animation: shellAlertFade 0.25s ease-out;
      }
      @keyframes shellAlertFade {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .shell-pending-recall-container {
        max-width: 1200px;
        margin: 0 auto;
      }
      .shell-pending-recall-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      .shell-pending-recall-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        color: #b45309;
      }
      .shell-pending-icon {
        flex-shrink: 0;
        color: #dc2626;
      }
      .shell-pending-dismiss-btn {
        background: transparent;
        border: none;
        font-size: 16px;
        line-height: 1;
        cursor: pointer;
        color: #b45309;
        padding: 4px 8px;
        border-radius: 4px;
      }
      .shell-pending-dismiss-btn:hover {
        background: rgba(180, 83, 9, 0.1);
      }
      .shell-pending-recall-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .pending-recall-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        background: #ffffff;
        border: 1px solid #fde68a;
        border-radius: 6px;
        padding: 10px 14px;
      }
      .pending-recall-main {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1 1 500px;
      }
      .pending-recall-details {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 8px;
        color: #1e293b;
      }
      .pending-recall-lots {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
        font-size: 12.5px;
        color: #475569;
      }
      .pending-recall-lots-label {
        font-weight: 600;
        color: #92400e;
        font-size: 12px;
      }
      .pending-recall-lots-list {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 6px;
      }
      .pending-recall-lot-link {
        display: inline-flex;
        align-items: center;
        background: #fef3c7;
        color: #92400e;
        border: 1px solid #fcd34d;
        padding: 2px 8px;
        border-radius: 4px;
        font-weight: 600;
        font-size: 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        text-decoration: none;
        transition: background 0.15s, border-color 0.15s;
      }
      .pending-recall-lot-link:hover {
        background: #fde68a;
        border-color: #f59e0b;
        color: #78350f;
        text-decoration: underline;
      }
      .pending-recall-lots-unavailable {
        font-style: italic;
        color: #94a3b8;
        font-size: 12px;
      }
      .pending-recall-no-lots {
        color: #64748b;
        font-size: 12px;
      }
      .pending-recall-badge {
        background: #fef2f2;
        color: #dc2626;
        border: 1px solid #fca5a5;
        font-weight: 700;
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 4px;
      }
      .pending-recall-reason {
        font-weight: 500;
        color: #334155;
      }
      .pending-recall-count-tag {
        font-size: 12px;
        color: #64748b;
        background: #f1f5f9;
        padding: 2px 6px;
        border-radius: 4px;
      }
      .pending-recall-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .btn-shell-recall-ack {
        display: inline-flex;
        align-items: center;
        background: #dc2626;
        color: #ffffff;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12.5px;
        font-weight: 600;
        text-decoration: none;
        transition: background 0.15s;
      }
      .btn-shell-recall-ack:hover {
        background: #b91c1c;
      }
      .btn-shell-recall-progress {
        display: inline-flex;
        align-items: center;
        background: #f1f5f9;
        color: #334155;
        border: 1px solid #cbd5e1;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        text-decoration: none;
      }
      .btn-shell-recall-progress:hover {
        background: #e2e8f0;
      }
    `;
    if (document.head && document.head.appendChild) {
      document.head.appendChild(style);
    }
  }

  function renderPendingRecallsAlert(pendingRecalls, targetContainer) {
    if (typeof document === "undefined") return null;

    let alertEl = document.getElementById("shellPendingRecallsAlert");

    if (!Array.isArray(pendingRecalls) || pendingRecalls.length === 0) {
      if (alertEl) {
        alertEl.style.display = "none";
        if (typeof alertEl.remove === "function") {
          alertEl.remove();
        } else if (alertEl.parentNode && alertEl.parentNode.removeChild) {
          alertEl.parentNode.removeChild(alertEl);
        }
      }
      return null;
    }

    ensureShellAlertStyles();

    if (!alertEl) {
      alertEl = document.createElement("aside");
      alertEl.id = "shellPendingRecallsAlert";
      alertEl.className = "shell-pending-recall-alert";
      alertEl.setAttribute("role", "alert");
      alertEl.setAttribute("aria-live", "assertive");

      let container = targetContainer;
      if (!container) {
        const header = document.querySelector(".app-header") || document.querySelector("header");
        if (header && header.parentNode && header.insertAdjacentElement) {
          header.insertAdjacentElement("afterend", alertEl);
        } else {
          const main = document.querySelector("main") || document.body;
          if (main) {
            if (main.firstChild && main.insertBefore) {
              main.insertBefore(alertEl, main.firstChild);
            } else if (main.appendChild) {
              main.appendChild(alertEl);
            }
          }
        }
      } else if (container.appendChild) {
        container.appendChild(alertEl);
      }
    }

    alertEl.style.display = "block";

    const count = pendingRecalls.length;
    const itemsHtml = pendingRecalls
      .map((item) => {
        const rawRecallId = item.recall_id !== undefined ? item.recall_id : (item.id || "");
        const rId = escapeHtml(String(rawRecallId));
        const reason = escapeHtml(item.reason || "Yêu cầu thu hồi từ đơn vị điều phối");
        const pendingCount = typeof item.pending_organizations_count === "number"
          ? `<span class="pending-recall-count-tag">${item.pending_organizations_count} đơn vị chưa phản hồi</span>`
          : "";

        let lotsHtml = "";
        if (!Array.isArray(item.affected_lots)) {
          lotsHtml = `
            <div class="pending-recall-lots">
              <span class="pending-recall-lots-label">Lô hàng bị ảnh hưởng:</span>
              <span class="pending-recall-lots-unavailable">Chi tiết lô hàng chưa khả dụng</span>
            </div>
          `;
        } else if (item.affected_lots.length === 0) {
          lotsHtml = `
            <div class="pending-recall-lots">
              <span class="pending-recall-lots-label">Lô hàng bị ảnh hưởng:</span>
              <span class="pending-recall-no-lots">Không có lô hàng trực thuộc bị ảnh hưởng</span>
            </div>
          `;
        } else {
          const lotLinksHtml = item.affected_lots
            .map((lot) => {
              if (!lot) return "";
              const rawLotId = lot.id !== undefined && lot.id !== null ? lot.id : "";
              const rawLotCode = lot.code !== undefined && lot.code !== null && lot.code !== "" ? lot.code : rawLotId;
              const encodedLotId = encodeURIComponent(String(rawLotId));
              const escapedLotCode = escapeHtml(String(rawLotCode));
              const escapedLotId = escapeHtml(String(rawLotId));
              const label = (rawLotCode && rawLotId && String(rawLotCode) !== String(rawLotId))
                ? `${escapedLotCode} (${escapedLotId})`
                : escapedLotCode;
              return `<a href="/lot-detail.html?id=${encodedLotId}" class="pending-recall-lot-link" title="Xem chi tiết lô hàng ${escapedLotCode}">${label}</a>`;
            })
            .filter(Boolean)
            .join(" ");
          lotsHtml = `
            <div class="pending-recall-lots">
              <span class="pending-recall-lots-label">Lô hàng trực thuộc bị ảnh hưởng (${item.affected_lots.length}):</span>
              <div class="pending-recall-lots-list">${lotLinksHtml}</div>
            </div>
          `;
        }

        return `
          <div class="pending-recall-row">
            <div class="pending-recall-main">
              <div class="pending-recall-details">
                <span class="pending-recall-badge">Đợt thu hồi #${rId}</span>
                <span class="pending-recall-reason">${reason}</span>
                ${pendingCount}
              </div>
              ${lotsHtml}
            </div>
            <div class="pending-recall-actions">
              <a href="/recall-form.html?recall_id=${encodeURIComponent(String(rawRecallId))}" class="btn-shell-recall-ack">Gửi xác nhận ngay →</a>
              <a href="/recall-progress.html?recall_id=${encodeURIComponent(String(rawRecallId))}" class="btn-shell-recall-progress">Xem tiến độ</a>
            </div>
          </div>
        `;
      })
      .join("");

    alertEl.innerHTML = `
      <div class="shell-pending-recall-container">
        <div class="shell-pending-recall-header">
          <div class="shell-pending-recall-title">
            <svg class="shell-pending-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <strong>CẢNH BÁO THU HỒI KHẨN CẤP:</strong>
            <span>Đơn vị của bạn có <strong>${count}</strong> đợt thu hồi đang chờ phản hồi xác nhận</span>
          </div>
          <button type="button" class="shell-pending-dismiss-btn" title="Đóng cảnh báo" onclick="this.closest('#shellPendingRecallsAlert').style.display='none'">✕</button>
        </div>
        <div class="shell-pending-recall-list">
          ${itemsHtml}
        </div>
      </div>
    `;

    return alertEl;
  }

  async function checkPendingRecalls(options = {}) {
    const pendingRecalls = await fetchPendingRecalls();
    let alertEl = null;
    if (typeof document !== "undefined") {
      alertEl = renderPendingRecallsAlert(pendingRecalls, options.targetContainer);
    }
    if (typeof options.onPendingRecallsLoaded === "function") {
      options.onPendingRecallsLoaded(pendingRecalls);
    }
    return { pendingRecalls, alertEl };
  }

  // Export to global scope & module
  if (typeof window !== "undefined") {
    window.initAppShell = initAppShell;
    window.handleLogout = handleLogout;
    window.setupLogout = setupLogout;
    window.setAgriUserCache = setCachedUser;
    window.getAgriUserCache = getCachedUser;
    window.formatRole = formatRole;
    window.APP_PERMISSIONS = APP_PERMISSIONS;
    window.NAV_PERMISSIONS = NAV_PERMISSIONS;
    window.hasPermission = hasPermission;
    window.applyRoleNavigation = applyRoleNavigation;
    window.escapeHtml = escapeHtml;
    window.copyTextToClipboard = copyTextToClipboard;
    window.createFormErrorHandler = createFormErrorHandler;
    window.showFieldErrors = showFieldErrors;
    window.clearFieldErrors = clearFieldErrors;
    window.fetchPendingRecalls = fetchPendingRecalls;
    window.renderPendingRecallsAlert = renderPendingRecallsAlert;
    window.checkPendingRecalls = checkPendingRecalls;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      initAppShell,
      handleLogout,
      setupLogout,
      setCachedUser,
      getCachedUser,
      formatRole,
      APP_PERMISSIONS,
      NAV_PERMISSIONS,
      hasPermission,
      applyRoleNavigation,
      escapeHtml,
      copyTextToClipboard,
      createFormErrorHandler,
      showFieldErrors,
      clearFieldErrors,
      fetchPendingRecalls,
      renderPendingRecallsAlert,
      checkPendingRecalls,
    };
  }
})();
