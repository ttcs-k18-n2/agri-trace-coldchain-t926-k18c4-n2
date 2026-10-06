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
    "product.write": ["admin"],
    "global.read": ["inspector", "admin"],
    "integrity.check": ["inspector", "admin"],
  };

  const NAV_PERMISSIONS = {
    navLots: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navFarms: ["producer", "cooperative", "inspector", "org_admin", "admin"],
    navProducts: ["producer", "cooperative", "transporter", "distributor", "inspector", "org_admin", "admin", "warehouse", "processing", "retailer"],
    navHarvest: ["producer", "cooperative", "org_admin", "admin"],
    navIntegrity: ["inspector", "admin"],
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
    } catch (_) {}

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
    };

    let targetId = navMap[activeKey];
    if (!targetId) {
      if (path.includes("lots")) targetId = "navLots";
      else if (path.includes("farms")) targetId = "navFarms";
      else if (path.includes("products")) targetId = "navProducts";
      else if (path.includes("harvest")) targetId = "navHarvest";
      else if (path.includes("integrity")) targetId = "navIntegrity";
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
    };
  }
})();
