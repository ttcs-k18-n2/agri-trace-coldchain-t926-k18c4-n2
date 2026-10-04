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

  function formatRole(role) {
    const map = {
      admin: "Quản trị viên",
      producer: "Nông dân / Sản xuất",
      cooperative: "Hợp tác xã",
      inspector: "Cán bộ kiểm tra",
      transporter: "Đơn vị vận chuyển",
      distributor: "Nhà phân phối",
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

  function setupLogout() {
    const logoutBtn = document.getElementById("logout") || document.getElementById("logoutBtn");
    if (!logoutBtn || logoutBtn._appShellBound) return;

    logoutBtn._appShellBound = true;
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
      } catch (err) {
        console.warn("Logout error:", err);
      } finally {
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.href = "/login";
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
        window.location.href = `/login?returnTo=${returnTo}`;
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
      // If we already had cached credentials, permit graceful usage
      if (cachedUser) {
        if (typeof options.onUserLoaded === "function") {
          options.onUserLoaded(cachedUser);
        }
        return cachedUser;
      }
      return null;
    }
  }

  // Auto-render cache on immediate script evaluation before DOM ready
  const preCache = getCachedUser();
  if (preCache) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => renderUserHeader(preCache));
    } else {
      renderUserHeader(preCache);
    }
  }

  // Export to global scope
  window.initAppShell = initAppShell;
  window.setAgriUserCache = setCachedUser;
  window.getAgriUserCache = getCachedUser;
  window.formatRole = formatRole;
})();
