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
  };

  function hasPermission(roleId, action) {
    if (!roleId || !action) return false;
    const allowed = APP_PERMISSIONS[action];
    return Array.isArray(allowed) && allowed.includes(roleId);
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
    };

    let targetId = navMap[activeKey];
    if (!targetId) {
      if (path.includes("lots")) targetId = "navLots";
      else if (path.includes("farms")) targetId = "navFarms";
      else if (path.includes("products")) targetId = "navProducts";
      else if (path.includes("harvest")) targetId = "navHarvest";
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

  // Export to global scope & module
  if (typeof window !== "undefined") {
    window.initAppShell = initAppShell;
    window.handleLogout = handleLogout;
    window.setupLogout = setupLogout;
    window.setAgriUserCache = setCachedUser;
    window.getAgriUserCache = getCachedUser;
    window.formatRole = formatRole;
    window.APP_PERMISSIONS = APP_PERMISSIONS;
    window.hasPermission = hasPermission;
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
      hasPermission,
    };
  }
})();
