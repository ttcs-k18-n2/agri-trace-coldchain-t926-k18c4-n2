/**
 * AgriTrace ColdChain - S-40 Shipments Controller
 * Quản lý giao diện chuyến vận chuyển lạnh, form tạo chuyến với nhiều lô và một thùng lạnh,
 * danh sách chuyến, chi tiết, trạng thái, validation và tích hợp qua ShipmentAdapter.
 */

(function () {
  "use strict";

  // State Management
  let currentUser = null;
  let currentFilter = "ALL";
  let currentSearch = "";
  let availableLots = [];
  let availableContainers = [];
  let selectedLotIds = new Set();
  let currentShipments = [];
  let formErrorHandler = null;
  let isSubmitting = false;

  // DOM Elements cache
  const elements = {};

  function cacheDomElements() {
    elements.btnOpenCreateModal = document.getElementById("btnOpenCreateModal");
    elements.btnRefreshShipments = document.getElementById("btnRefreshShipments");
    elements.btnAutoGenerateCode = document.getElementById("btnAutoGenerateCode");
    elements.btnToggleSandbox = document.getElementById("btnToggleSandbox");
    elements.contractNoticeBanner = document.getElementById("contractNoticeBanner");
    elements.alertBanner = document.getElementById("alertBanner");

    // KPI Summary
    elements.kpiTotal = document.getElementById("kpiTotal");
    elements.kpiRunning = document.getElementById("kpiRunning");
    elements.kpiCompleted = document.getElementById("kpiCompleted");
    elements.kpiContainers = document.getElementById("kpiContainers");

    // Filter & Search
    elements.searchInput = document.getElementById("searchShipmentsInput");
    elements.filterButtons = document.querySelectorAll(".filter-pill-btn");

    // List & States
    elements.shipmentsContainer = document.getElementById("shipmentsContainer");
    elements.emptyState = document.getElementById("emptyState");
    elements.loadingState = document.getElementById("loadingState");

    // Create Modal
    elements.modalCreateShipment = document.getElementById("modalCreateShipment");
    elements.formCreateShipment = document.getElementById("formCreateShipment");
    elements.btnCloseCreateModal = document.getElementById("btnCloseCreateModal");
    elements.btnCancelCreate = document.getElementById("btnCancelCreate");
    elements.btnSubmitShipment = document.getElementById("btnSubmitShipment");

    // Form Inputs
    elements.inputShipmentCode = document.getElementById("input-shipment-code");
    elements.selectContainer = document.getElementById("select-container");
    elements.containerInfoBox = document.getElementById("container-info-box");
    elements.lotSearchInput = document.getElementById("lotSearchInput");
    elements.btnSelectAllLots = document.getElementById("btnSelectAllLots");
    elements.btnClearAllLots = document.getElementById("btnClearAllLots");
    elements.lotsTableBody = document.getElementById("lotsTableBody");
    elements.selectedLotsSummary = document.getElementById("selectedLotsSummary");
    elements.selectedLotsCount = document.getElementById("selectedLotsCount");
    elements.selectedLotsWeight = document.getElementById("selectedLotsWeight");
    elements.selectedLotsChips = document.getElementById("selectedLotsChips");
    elements.inputOrigin = document.getElementById("input-origin");
    elements.inputDestination = document.getElementById("input-destination");
    elements.inputDepartureTime = document.getElementById("input-departure-time");
    elements.inputDriver = document.getElementById("input-driver");
    elements.inputVehicle = document.getElementById("input-vehicle");
    elements.inputNotes = document.getElementById("input-notes");

    // Detail Modal
    elements.modalShipmentDetail = document.getElementById("modalShipmentDetail");
    elements.btnCloseDetailModal = document.getElementById("btnCloseDetailModal");
    elements.btnDismissDetail = document.getElementById("btnDismissDetail");
    elements.detailContentArea = document.getElementById("detailContentArea");
  }

  /**
   * Khởi tạo Form Validation Handler bằng createFormErrorHandler từ app-shell.js
   */
  function initFormValidation() {
    if (typeof window.createFormErrorHandler === "function") {
      formErrorHandler = window.createFormErrorHandler({
        scope: elements.formCreateShipment,
        globalAlert: elements.alertBanner,
        fields: {
          shipmentCode: { input: elements.inputShipmentCode, error: document.getElementById("error-shipment-code") },
          containerId: { input: elements.selectContainer, error: document.getElementById("error-container") },
          lotIds: { input: elements.lotsTableBody, error: document.getElementById("error-lots") },
          origin: { input: elements.inputOrigin, error: document.getElementById("error-origin") },
          destination: { input: elements.inputDestination, error: document.getElementById("error-destination") },
          departureTime: { input: elements.inputDepartureTime, error: document.getElementById("error-departure-time") },
        },
      });
      formErrorHandler.bindAutoClear();
    }
  }

  /**
   * Cập nhật quyền hạn giao diện theo vai trò (Role-based UI Guards)
   */
  function applyPermissions(user) {
    if (!user) return;
    currentUser = user;

    const canCreate = window.hasPermission ? window.hasPermission(user.roleId, "shipment.create") : true;

    if (elements.btnOpenCreateModal) {
      elements.btnOpenCreateModal.style.display = canCreate ? "inline-flex" : "none";
    }

    const emptyCreateBtn = document.getElementById("emptyCreateBtn");
    if (emptyCreateBtn) {
      emptyCreateBtn.style.display = canCreate ? "inline-flex" : "none";
    }
  }

  /**
   * Tự động sinh mã chuyến vận chuyển chuẩn GS1/HACCP
   */
  function autoGenerateShipmentCode() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    const generated = `SHP-${yyyy}${mm}${dd}-${rand}`;

    if (elements.inputShipmentCode) {
      elements.inputShipmentCode.value = generated;
      if (formErrorHandler) formErrorHandler.clearFieldError("shipmentCode");
    }
  }

  /**
   * Hiển thị banner trạng thái API Contract
   */
  function renderContractNotice(statusInfo) {
    if (!elements.contractNoticeBanner) return;

    const isSandbox = window.ShipmentAdapter.isSandboxMode();

    if (isSandbox) {
      elements.contractNoticeBanner.style.display = "flex";
      elements.contractNoticeBanner.className = "contract-notice-banner sandbox-active";
      elements.contractNoticeBanner.innerHTML = `
        <div class="notice-icon">🧪</div>
        <div class="notice-body">
          <div class="notice-title">Đang chạy ở Chế độ Thử nghiệm Giao diện (Sandbox Preview)</div>
          <div class="notice-desc">Dữ liệu được lưu trữ an toàn trong sessionStorage trình duyệt để kiểm thử toàn diện quy trình mở chuyến và giao diện mà không ảnh hưởng CSDL backend.</div>
        </div>
        <button type="button" class="btn-notice-action" id="btnDisableSandbox">Tắt Sandbox</button>
      `;
      const btnDisable = document.getElementById("btnDisableSandbox");
      if (btnDisable) {
        btnDisable.onclick = () => {
          window.ShipmentAdapter.setSandboxMode(false);
          loadShipments();
        };
      }
      return;
    }

    if (statusInfo && statusInfo.isWaitingContract) {
      elements.contractNoticeBanner.style.display = "flex";
      elements.contractNoticeBanner.className = "contract-notice-banner waiting-contract";
      elements.contractNoticeBanner.innerHTML = `
        <div class="notice-icon">⏱️</div>
        <div class="notice-body">
          <div class="notice-title">Frontend Adapter: Chờ API Contract (${window.ShipmentAdapter.CONTRACT_DOC_PATH})</div>
          <div class="notice-desc">Giao diện đã hoàn thành và tách lớp API Adapter độc lập. Backend đang trong quá trình hoàn thiện endpoint. Bạn có thể bật Chế độ Thử nghiệm để kiểm tra trải nghiệm người dùng ngay lập tức.</div>
        </div>
        <button type="button" class="btn-notice-action" id="btnEnableSandbox">Bật Thử nghiệm (Sandbox)</button>
      `;
      const btnEnable = document.getElementById("btnEnableSandbox");
      if (btnEnable) {
        btnEnable.onclick = () => {
          window.ShipmentAdapter.setSandboxMode(true);
          loadShipments();
        };
      }
    } else {
      elements.contractNoticeBanner.style.display = "none";
    }
  }

  /**
   * Cập nhật các thẻ KPI tóm tắt
   */
  function updateKpiCards(shipments) {
    const total = shipments.length;
    let running = 0;
    let completed = 0;
    const containersSet = new Set();

    shipments.forEach((s) => {
      if (s.status === "IN_TRANSIT" || s.status === "RUNNING") running++;
      else if (s.status === "COMPLETED" || s.status === "ENDED") completed++;
      if (s.containerId) containersSet.add(s.containerId);
    });

    if (elements.kpiTotal) elements.kpiTotal.textContent = total;
    if (elements.kpiRunning) elements.kpiRunning.textContent = running;
    if (elements.kpiCompleted) elements.kpiCompleted.textContent = completed;
    if (elements.kpiContainers) elements.kpiContainers.textContent = containersSet.size;
  }

  /**
   * Hiển thị danh sách chuyến vận chuyển
   */
  async function loadShipments() {
    if (elements.loadingState) elements.loadingState.style.display = "grid";
    if (elements.shipmentsContainer) elements.shipmentsContainer.style.display = "none";
    if (elements.emptyState) elements.emptyState.style.display = "none";

    try {
      const res = await window.ShipmentAdapter.listShipments({
        status: currentFilter,
        search: currentSearch,
      });

      renderContractNotice(res);

      if (elements.loadingState) elements.loadingState.style.display = "none";

      if (!res.success && !res.isWaitingContract) {
        showAlert(res.message || "Không thể tải danh sách chuyến vận chuyển.", "error");
        if (elements.emptyState) elements.emptyState.style.display = "block";
        return;
      }

      currentShipments = res.shipments || [];
      updateKpiCards(currentShipments);

      if (currentShipments.length === 0) {
        if (elements.shipmentsContainer) elements.shipmentsContainer.style.display = "none";
        if (elements.emptyState) {
          elements.emptyState.style.display = "block";
          const emptyTitle = document.getElementById("emptyStateTitle");
          const emptyDesc = document.getElementById("emptyStateDesc");
          if (currentSearch || currentFilter !== "ALL") {
            if (emptyTitle) emptyTitle.textContent = "Không tìm thấy chuyến vận chuyển";
            if (emptyDesc) emptyDesc.textContent = "Không có chuyến nào khớp với tiêu chí tìm kiếm hoặc bộ lọc hiện tại. Thử đổi bộ lọc khác.";
          } else {
            if (emptyTitle) emptyTitle.textContent = "Chưa có chuyến vận chuyển lạnh nào";
            if (emptyDesc) emptyDesc.textContent = "Mở chuyến vận chuyển mới để liên kết các lô thu hoạch với thùng lạnh và theo dõi nhiệt độ bảo quản trong suốt hành trình.";
          }
        }
        return;
      }

      if (elements.emptyState) elements.emptyState.style.display = "none";
      if (elements.shipmentsContainer) {
        elements.shipmentsContainer.style.display = "grid";
        renderShipmentsGrid(currentShipments);
      }
    } catch (err) {
      if (elements.loadingState) elements.loadingState.style.display = "none";
      showAlert("Lỗi khi tải danh sách chuyến: " + err.message, "error");
      if (elements.emptyState) elements.emptyState.style.display = "block";
    }
  }

  /**
   * Render các thẻ chuyến vào grid
   */
  function renderShipmentsGrid(shipments) {
    if (!elements.shipmentsContainer) return;
    elements.shipmentsContainer.innerHTML = "";

    shipments.forEach((s) => {
      const statusMeta = window.ShipmentAdapter.formatShipmentStatus(s.status);
      const isRunning = s.status === "IN_TRANSIT" || s.status === "RUNNING";
      const canComplete = window.hasPermission
        ? window.hasPermission(currentUser ? currentUser.roleId : null, "shipment.complete")
        : true;

      const card = document.createElement("div");
      card.className = "shipment-card";
      card.setAttribute("data-id", s.id);

      const lotBadgeCount = s.lotIds ? s.lotIds.length : 0;
      const lotsDisplay = (s.lotIds || []).slice(0, 3).map(id => `<span class="lot-pill-tag">${escapeHtml(id)}</span>`).join(" ");
      const moreLots = lotBadgeCount > 3 ? `<span class="lot-pill-more">+${lotBadgeCount - 3}</span>` : "";

      const formattedDepTime = s.departureTime ? formatDateTime(s.departureTime) : "N/A";
      const formattedEndTime = s.completedAt ? formatDateTime(s.completedAt) : (isRunning ? "Đang di chuyển..." : "N/A");

      card.innerHTML = `
        <div class="shipment-card-header">
          <div class="shipment-code-group">
            <span class="shipment-code-badge">${escapeHtml(s.code)}</span>
            <span class="status-badge ${statusMeta.badgeClass}">
              <span class="status-dot ${statusMeta.dotClass}"></span>
              ${escapeHtml(statusMeta.label)}
            </span>
          </div>
          <button type="button" class="btn-icon-subtle btn-detail-trigger" data-id="${escapeHtml(s.id)}" title="Xem chi tiết">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </button>
        </div>

        <div class="shipment-card-body">
          <!-- Thông tin thùng lạnh gắn kèm -->
          <div class="shipment-container-row">
            <div class="container-badge-capsule">
              <span class="cold-icon">❄️</span>
              <div class="container-meta">
                <span class="container-id">${escapeHtml(s.containerId)}</span>
                <span class="container-temp-range">${escapeHtml(s.containerTempRange)}</span>
              </div>
            </div>
            <div class="temp-display ${getTempStatusClass(s.currentTemp)}">
              <span class="temp-val">${s.currentTemp != null ? s.currentTemp.toFixed(1) + "°C" : "--"}</span>
              <span class="temp-label">Nhiệt độ đo</span>
            </div>
          </div>

          <!-- Lộ trình vận chuyển -->
          <div class="shipment-route-timeline">
            <div class="route-point origin">
              <span class="point-dot origin-dot"></span>
              <span class="point-name" title="${escapeHtml(s.origin)}">${escapeHtml(s.origin)}</span>
            </div>
            <div class="route-line-connector">
              <span class="route-arrow">➔</span>
            </div>
            <div class="route-point destination">
              <span class="point-dot dest-dot"></span>
              <span class="point-name" title="${escapeHtml(s.destination)}">${escapeHtml(s.destination)}</span>
            </div>
          </div>

          <!-- Các lô hàng gắn kèm (Multi-lot) -->
          <div class="shipment-lots-attached">
            <div class="lots-attached-header">
              <span class="lots-label">Lô hàng đính kèm (${lotBadgeCount} lô):</span>
            </div>
            <div class="lots-tags-container">
              ${lotsDisplay}
              ${moreLots}
            </div>
          </div>

          <!-- Thời gian & Tài xế -->
          <div class="shipment-meta-grid">
            <div class="meta-item">
              <span class="meta-label">Khởi hành</span>
              <span class="meta-value">${formattedDepTime}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">${isRunning ? "Dự kiến đến" : "Hoàn thành"}</span>
              <span class="meta-value">${formattedEndTime}</span>
            </div>
          </div>
        </div>

        <div class="shipment-card-footer">
          <button type="button" class="btn-card-action btn-view-detail" data-id="${escapeHtml(s.id)}">
            Chi tiết chuyến
          </button>
          ${isRunning && canComplete ? `
            <button type="button" class="btn-card-action btn-complete-shipment" data-id="${escapeHtml(s.id)}">
              Kết thúc chuyến
            </button>
          ` : isRunning ? `
            <span class="status-readonly-hint" style="font-size:12px; color:var(--color-text-muted); padding:6px 10px;">Chỉ xem (Đang vận chuyển)</span>
          ` : `
            <span class="completed-text">Đã lưu trữ an toàn</span>
          `}
        </div>
      `;

      elements.shipmentsContainer.appendChild(card);
    });

    // Bind event listeners for dynamically created cards
    elements.shipmentsContainer.querySelectorAll(".btn-view-detail, .btn-detail-trigger").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        openDetailModal(id);
      });
    });

    elements.shipmentsContainer.querySelectorAll(".btn-complete-shipment").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        handleCompleteShipment(id);
      });
    });
  }

  function getTempStatusClass(temp) {
    if (temp == null) return "temp-unknown";
    if (temp < 0 || temp > 10) return "temp-warning";
    return "temp-normal";
  }

  /**
   * Tải danh mục thùng lạnh và điền vào ô chọn trong form
   */
  async function loadContainersForForm() {
    if (!elements.selectContainer) return;
    elements.selectContainer.innerHTML = '<option value="">-- Đang tải danh sách thùng lạnh... --</option>';

    try {
      const res = await window.ShipmentAdapter.fetchColdContainers();
      availableContainers = res.containers || [];

      elements.selectContainer.innerHTML = '<option value="">-- Chọn một thùng lạnh bảo quản --</option>';
      availableContainers.forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = `${c.id} - ${c.name} (${c.tempMin}°C đến ${c.tempMax}°C)`;
        elements.selectContainer.appendChild(opt);
      });
    } catch {
      elements.selectContainer.innerHTML = '<option value="">-- Không thể tải danh sách thùng lạnh --</option>';
    }
  }

  /**
   * Cập nhật hộp thông số thùng lạnh khi chọn
   */
  function handleContainerChange() {
    const selectedId = elements.selectContainer.value;
    if (!elements.containerInfoBox) return;

    if (!selectedId) {
      elements.containerInfoBox.style.display = "none";
      return;
    }

    const container = availableContainers.find(c => c.id === selectedId);
    if (!container) {
      elements.containerInfoBox.style.display = "none";
      return;
    }

    elements.containerInfoBox.style.display = "block";
    elements.containerInfoBox.innerHTML = `
      <div class="container-spec-grid">
        <div class="spec-item"><span class="spec-label">Dung tích:</span> <strong>${container.capacityLiters || 50} Lít</strong></div>
        <div class="spec-item"><span class="spec-label">Dải nhiệt chuẩn:</span> <strong class="badge-temp-range">${container.tempMin}°C ~ ${container.tempMax}°C</strong></div>
        <div class="spec-item"><span class="spec-label">Cảm biến nhiệt:</span> <span>${escapeHtml(container.sensorModel || "IoT Standard")}</span></div>
        <div class="spec-item"><span class="spec-label">Trạng thái:</span> <span class="badge-status-running" style="font-size:11px; padding:2px 8px;">Sẵn sàng hoạt động</span></div>
      </div>
    `;

    if (formErrorHandler) formErrorHandler.clearFieldError("containerId");
  }

  /**
   * Tải danh sách lô hàng khả dụng từ /api/organization/lots
   */
  async function loadLotsForForm() {
    if (!elements.lotsTableBody) return;
    elements.lotsTableBody.innerHTML = '<tr><td colspan="5" class="table-loading">Đang tải danh sách lô hàng khả dụng...</td></tr>';

    try {
      const res = await window.ShipmentAdapter.fetchAvailableLots();
      availableLots = res.lots || [];

      if (availableLots.length === 0) {
        elements.lotsTableBody.innerHTML = '<tr><td colspan="5" class="table-empty">Không có lô hàng khả dụng nào để thêm vào chuyến.</td></tr>';
        return;
      }

      renderLotsTable(availableLots);
    } catch (err) {
      elements.lotsTableBody.innerHTML = `<tr><td colspan="5" class="table-error">Lỗi khi tải lô: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /**
   * Render bảng chọn lô với ô tìm kiếm và checkbox
   */
  function renderLotsTable(lotsToRender) {
    if (!elements.lotsTableBody) return;
    elements.lotsTableBody.innerHTML = "";

    if (lotsToRender.length === 0) {
      elements.lotsTableBody.innerHTML = '<tr><td colspan="5" class="table-empty">Không tìm thấy lô hàng nào phù hợp với từ khóa.</td></tr>';
      return;
    }

    lotsToRender.forEach((lot) => {
      const tr = document.createElement("tr");
      tr.className = selectedLotIds.has(lot.id) ? "row-selected" : "";

      const isChecked = selectedLotIds.has(lot.id);

      tr.innerHTML = `
        <td style="text-align: center; width: 40px;">
          <input type="checkbox" class="lot-checkbox" data-id="${escapeHtml(lot.id)}" ${isChecked ? "checked" : ""}>
        </td>
        <td>
          <strong class="lot-code-label">${escapeHtml(lot.id)}</strong>
          ${lot.name && lot.name !== lot.id ? `<div class="lot-subname">${escapeHtml(lot.name)}</div>` : ""}
        </td>
        <td>${escapeHtml(lot.product_name)}</td>
        <td style="text-align: right; font-weight: 600;">
          ${Number(lot.current_quantity).toLocaleString("vi-VN")} ${escapeHtml(lot.unit)}
        </td>
        <td>
          <span class="badge-status-completed" style="font-size: 11px; padding: 2px 7px;">${escapeHtml(lot.status)}</span>
        </td>
      `;

      // Click row toggles checkbox
      tr.addEventListener("click", (e) => {
        if (e.target.type !== "checkbox") {
          const cb = tr.querySelector(".lot-checkbox");
          if (cb) {
            cb.checked = !cb.checked;
            handleLotCheckToggle(lot.id, cb.checked, tr);
          }
        }
      });

      const cb = tr.querySelector(".lot-checkbox");
      if (cb) {
        cb.addEventListener("change", () => {
          handleLotCheckToggle(lot.id, cb.checked, tr);
        });
      }

      elements.lotsTableBody.appendChild(tr);
    });

    updateSelectedLotsSummary();
  }

  function handleLotCheckToggle(lotId, checked, rowEl) {
    if (checked) {
      selectedLotIds.add(lotId);
      if (rowEl) rowEl.classList.add("row-selected");
    } else {
      selectedLotIds.delete(lotId);
      if (rowEl) rowEl.classList.remove("row-selected");
    }

    updateSelectedLotsSummary();

    if (selectedLotIds.size > 0 && formErrorHandler) {
      formErrorHandler.clearFieldError("lotIds");
    }
  }

  /**
   * Cập nhật thông tin tóm tắt các lô đã chọn (Số lượng & Khối lượng & Chip thẻ)
   */
  function updateSelectedLotsSummary() {
    const count = selectedLotIds.size;
    let totalWeight = 0;
    const chips = [];

    selectedLotIds.forEach((id) => {
      const lot = availableLots.find(l => l.id === id);
      if (lot) {
        const qty = Number(lot.current_quantity) || 0;
        totalWeight += qty;
        chips.push({ id: lot.id, name: lot.name, product: lot.product_name, qty, unit: lot.unit });
      } else {
        chips.push({ id, name: id, product: "Lô hàng", qty: 0, unit: "kg" });
      }
    });

    if (elements.selectedLotsCount) elements.selectedLotsCount.textContent = count;
    if (elements.selectedLotsWeight) elements.selectedLotsWeight.textContent = totalWeight.toLocaleString("vi-VN");

    if (elements.selectedLotsChips) {
      if (count === 0) {
        elements.selectedLotsChips.innerHTML = '<span class="empty-chips-hint">Chưa chọn lô nào. Vui lòng tích chọn các lô bên trên.</span>';
      } else {
        elements.selectedLotsChips.innerHTML = "";
        chips.forEach((c) => {
          const chip = document.createElement("span");
          chip.className = "selected-lot-chip";
          chip.innerHTML = `
            <strong>${escapeHtml(c.id)}</strong>
            <span class="chip-qty">(${c.qty} ${escapeHtml(c.unit)})</span>
            <button type="button" class="btn-remove-chip" data-id="${escapeHtml(c.id)}" title="Bỏ chọn">&times;</button>
          `;
          chip.querySelector(".btn-remove-chip").addEventListener("click", (e) => {
            e.stopPropagation();
            selectedLotIds.delete(c.id);
            // Cập nhật lại checkbox trong bảng nếu đang hiển thị
            const cb = elements.lotsTableBody ? elements.lotsTableBody.querySelector(`.lot-checkbox[data-id="${c.id}"]`) : null;
            if (cb) {
              cb.checked = false;
              const tr = cb.closest("tr");
              if (tr) tr.classList.remove("row-selected");
            }
            updateSelectedLotsSummary();
          });
          elements.selectedLotsChips.appendChild(chip);
        });
      }
    }
  }

  /**
   * Mở modal tạo chuyến mới
   */
  function openCreateModal() {
    if (!elements.modalCreateShipment) return;

    if (formErrorHandler) formErrorHandler.clear();
    selectedLotIds.clear();

    if (elements.formCreateShipment) {
      elements.formCreateShipment.reset();
    }

    autoGenerateShipmentCode();

    // Đặt thời gian khởi hành mặc định là hiện tại
    if (elements.inputDepartureTime) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      elements.inputDepartureTime.value = now.toISOString().slice(0, 16);
    }

    loadContainersForForm();
    loadLotsForForm();
    updateSelectedLotsSummary();

    elements.modalCreateShipment.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  function closeCreateModal() {
    if (!elements.modalCreateShipment) return;
    elements.modalCreateShipment.style.display = "none";
    document.body.style.overflow = "";
    if (formErrorHandler) formErrorHandler.clear();
  }

  /**
   * Xử lý Submit Mở chuyến mới
   */
  async function handleSubmitCreateShipment(e) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (isSubmitting) return;

    if (window.hasPermission && currentUser && !window.hasPermission(currentUser.roleId, "shipment.create")) {
      showAlert("Tài khoản của bạn không có quyền mở chuyến vận chuyển.", "error");
      return;
    }

    if (formErrorHandler) formErrorHandler.clear();

    const shipmentCode = elements.inputShipmentCode ? elements.inputShipmentCode.value.trim() : "";
    const containerId = elements.selectContainer ? elements.selectContainer.value.trim() : "";
    const lotIds = Array.from(selectedLotIds);
    const origin = elements.inputOrigin ? elements.inputOrigin.value.trim() : "";
    const destination = elements.inputDestination ? elements.inputDestination.value.trim() : "";
    const departureTime = elements.inputDepartureTime ? elements.inputDepartureTime.value : "";
    const driverName = elements.inputDriver ? elements.inputDriver.value.trim() : "";
    const vehiclePlate = elements.inputVehicle ? elements.inputVehicle.value.trim() : "";
    const notes = elements.inputNotes ? elements.inputNotes.value.trim() : "";

    const payload = {
      shipmentCode,
      containerId,
      lotIds,
      origin,
      destination,
      departureTime,
      driverName,
      vehiclePlate,
      notes,
      selectedLotsList: availableLots.filter(l => selectedLotIds.has(l.id)),
    };

    // Client-side validation qua Adapter
    const validation = window.ShipmentAdapter.validateShipmentPayload(payload);
    if (!validation.isValid) {
      if (formErrorHandler) {
        formErrorHandler.showErrors(validation.errors);
      }
      return;
    }

    setSubmitting(true);

    try {
      const res = await window.ShipmentAdapter.createShipment(payload);

      if (res.success) {
        showAlert(res.message || "Mở chuyến vận chuyển lạnh thành công!", "success");
        closeCreateModal();
        await loadShipments();
      } else {
        if (res.isForbidden) {
          showAlert(res.message || "Tài khoản của bạn không có quyền mở chuyến vận chuyển.", "error");
        } else if (res.isConflict) {
          showAlert(res.message || "Một hoặc nhiều lô hàng đã được gắn vào chuyến vận chuyển khác.", "error");
        } else if (res.errors && formErrorHandler) {
          formErrorHandler.showErrors(res.errors);
        } else {
          showAlert(res.message || "Không thể tạo chuyến vận chuyển.", "error");
        }
      }
    } catch (err) {
      showAlert("Lỗi không mong muốn: " + err.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  function setSubmitting(submitting) {
    isSubmitting = submitting;
    if (elements.btnSubmitShipment) {
      elements.btnSubmitShipment.disabled = submitting;
      elements.btnSubmitShipment.innerHTML = submitting
        ? '<span class="spinner-sm"></span> Đang mở chuyến...'
        : '🚚 Xác nhận mở chuyến';
    }
  }

  /**
   * Kết thúc chuyến vận chuyển
   */
  async function handleCompleteShipment(shipmentId) {
    if (!shipmentId) return;

    if (window.hasPermission && currentUser && !window.hasPermission(currentUser.roleId, "shipment.complete")) {
      showAlert("Tài khoản của bạn không có quyền kết thúc chuyến vận chuyển.", "error");
      return;
    }

    const confirmed = window.confirm("Bạn có chắc chắn muốn kết thúc chuyến vận chuyển này không? Trạng thái sẽ được chuyển sang 'Đã kết thúc'.");
    if (!confirmed) return;

    try {
      const res = await window.ShipmentAdapter.completeShipment(shipmentId, {
        completedAt: new Date().toISOString(),
      });

      if (res.success) {
        showAlert(res.message || "Chuyến vận chuyển đã được kết thúc thành công.", "success");
        await loadShipments();
        if (elements.modalShipmentDetail && elements.modalShipmentDetail.style.display === "flex") {
          closeDetailModal();
        }
      } else {
        showAlert(res.message || "Không thể kết thúc chuyến.", "error");
      }
    } catch (err) {
      showAlert("Lỗi khi kết thúc chuyến: " + err.message, "error");
    }
  }

  /**
   * Mở modal chi tiết chuyến
   */
  async function openDetailModal(shipmentId) {
    if (!elements.modalShipmentDetail || !elements.detailContentArea) return;

    elements.detailContentArea.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Đang tải chi tiết chuyến...</div>';
    elements.modalShipmentDetail.style.display = "flex";
    document.body.style.overflow = "hidden";

    try {
      const res = await window.ShipmentAdapter.getShipmentDetail(shipmentId);
      if (!res.success) {
        elements.detailContentArea.innerHTML = `
          <div class="alert-box alert-error" style="margin: 20px;">
            ${escapeHtml(res.message || "Không thể tải chi tiết chuyến.")}
          </div>
        `;
        return;
      }

      const s = res.shipment;
      const statusMeta = window.ShipmentAdapter.formatShipmentStatus(s.status);
      const isRunning = s.status === "IN_TRANSIT" || s.status === "RUNNING";
      const canComplete = window.hasPermission
        ? window.hasPermission(currentUser ? currentUser.roleId : null, "shipment.complete")
        : true;

      const lotsListHtml = (s.lots && s.lots.length > 0)
        ? s.lots.map(l => {
            const lotId = l.id || l.lotId || l.code;
            const lotName = l.product_name || l.name || l.lotName || "Nông sản sạch";
            const lotQty = l.quantity != null ? l.quantity : (l.current_quantity != null ? l.current_quantity : (l.remaining_quantity != null ? l.remaining_quantity : "--"));
            const lotUnit = l.unit || "kg";
            return `
            <tr>
              <td><strong><a href="/lot-detail.html?id=${encodeURIComponent(lotId)}" target="_blank" class="table-link">${escapeHtml(lotId)}</a></strong></td>
              <td>${escapeHtml(lotName)}</td>
              <td style="text-align: right; font-weight: 600;">${lotQty} ${escapeHtml(lotUnit)}</td>
            </tr>
          `;
          }).join("")
        : (s.lotIds || []).map(id => `
            <tr>
              <td><strong><a href="/lot-detail.html?id=${encodeURIComponent(id)}" target="_blank" class="table-link">${escapeHtml(id)}</a></strong></td>
              <td>Lô hàng nông sản</td>
              <td style="text-align: right;">--</td>
            </tr>
          `).join("");

      elements.detailContentArea.innerHTML = `
        <div class="detail-overview-header">
          <div class="detail-title-group">
            <span class="detail-code">${escapeHtml(s.code)}</span>
            <span class="status-badge ${statusMeta.badgeClass}">
              <span class="status-dot ${statusMeta.dotClass}"></span>
              ${escapeHtml(statusMeta.label)}
            </span>
          </div>
          ${isRunning && canComplete ? `
            <button type="button" class="btn btn-warning btn-sm" id="btnDetailCompleteAction" data-id="${escapeHtml(s.id)}">
              Kết thúc chuyến vận chuyển
            </button>
          ` : ""}
        </div>

        <!-- Thùng lạnh -->
        <div class="detail-section-card">
          <h4 class="section-title">❄️ Thùng lạnh bảo quản</h4>
          <div class="detail-grid">
            <div class="detail-field"><span class="df-label">Mã thùng:</span> <strong class="df-val">${escapeHtml(s.containerId)}</strong></div>
            <div class="detail-field"><span class="df-label">Dải nhiệt chuẩn:</span> <strong class="df-val badge-temp-range">${escapeHtml(s.containerTempRange)}</strong></div>
            <div class="detail-field"><span class="df-label">Nhiệt độ hiện tại:</span> <strong class="df-val ${getTempStatusClass(s.currentTemp)}">${s.currentTemp != null ? s.currentTemp.toFixed(1) + "°C" : "--"}</strong></div>
            <div class="detail-field"><span class="df-label">Tình trạng cảm biến:</span> <span class="df-val" style="color: var(--color-success); font-weight:600;">Bình thường</span></div>
          </div>
        </div>

        <!-- Lộ trình & Phương tiện -->
        <div class="detail-section-card">
          <h4 class="section-title">📍 Lộ trình & Vận hành</h4>
          <div class="detail-grid">
            <div class="detail-field"><span class="df-label">Điểm xuất phát:</span> <span class="df-val">${escapeHtml(s.origin)}</span></div>
            <div class="detail-field"><span class="df-label">Điểm đến:</span> <span class="df-val">${escapeHtml(s.destination)}</span></div>
            <div class="detail-field"><span class="df-label">Thời gian bắt đầu:</span> <span class="df-val">${formatDateTime(s.departureTime)}</span></div>
            <div class="detail-field"><span class="df-label">Thời gian kết thúc:</span> <span class="df-val">${s.completedAt ? formatDateTime(s.completedAt) : "Chưa hoàn tất"}</span></div>
            <div class="detail-field"><span class="df-label">Tài xế:</span> <span class="df-val">${escapeHtml(s.driverName || "Chưa phân công")}</span></div>
            <div class="detail-field"><span class="df-label">Biển số phương tiện:</span> <span class="df-val">${escapeHtml(s.vehiclePlate || "N/A")}</span></div>
          </div>
          ${s.notes ? `<div style="margin-top:12px; font-size:13px; color:var(--color-text-muted);"><strong>Ghi chú:</strong> ${escapeHtml(s.notes)}</div>` : ""}
        </div>

        <!-- Danh sách lô trong chuyến -->
        <div class="detail-section-card">
          <h4 class="section-title">📦 Danh sách lô hàng trong chuyến (${(s.lotIds || []).length} lô)</h4>
          <div class="table-responsive" style="max-height: 220px; overflow-y: auto;">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>Mã lô</th>
                  <th>Sản phẩm</th>
                  <th style="text-align: right;">Khối lượng</th>
                </tr>
              </thead>
              <tbody>
                ${lotsListHtml || '<tr><td colspan="3" class="table-empty">Chưa có thông tin lô.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      const btnDetailComplete = document.getElementById("btnDetailCompleteAction");
      if (btnDetailComplete) {
        btnDetailComplete.onclick = () => handleCompleteShipment(s.id);
      }
    } catch (err) {
      elements.detailContentArea.innerHTML = `<div class="alert-box alert-error" style="margin:20px;">Lỗi: ${escapeHtml(err.message)}</div>`;
    }
  }

  function closeDetailModal() {
    if (!elements.modalShipmentDetail) return;
    elements.modalShipmentDetail.style.display = "none";
    document.body.style.overflow = "";
  }

  /**
   * Alert Banner Helper
   */
  function showAlert(msg, type = "info") {
    if (!elements.alertBanner) return;
    elements.alertBanner.className = `alert-box alert-${type}`;
    elements.alertBanner.textContent = msg;
    elements.alertBanner.style.display = "block";
    elements.alertBanner.scrollIntoView({ behavior: "smooth", block: "nearest" });

    if (type === "success") {
      setTimeout(() => {
        if (elements.alertBanner) elements.alertBanner.style.display = "none";
      }, 5000);
    }
  }

  function escapeHtml(str) {
    if (window.escapeHtml) return window.escapeHtml(str);
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return "N/A";
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return String(isoStr);
      return d.toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return String(isoStr);
    }
  }

  /**
   * Lọc lô hàng trong form mở chuyến khi gõ vào ô tìm kiếm
   */
  function handleLotSearchInput() {
    if (!elements.lotSearchInput) return;
    const query = elements.lotSearchInput.value.toLowerCase().trim();
    if (!query) {
      renderLotsTable(availableLots);
      return;
    }
    const filtered = availableLots.filter(l =>
      l.id.toLowerCase().includes(query) ||
      (l.name && l.name.toLowerCase().includes(query)) ||
      (l.product_name && l.product_name.toLowerCase().includes(query))
    );
    renderLotsTable(filtered);
  }

  /**
   * Chọn tất cả hoặc bỏ chọn tất cả lô
   */
  function selectAllLots() {
    availableLots.forEach(l => selectedLotIds.add(l.id));
    if (elements.lotsTableBody) {
      elements.lotsTableBody.querySelectorAll("tr").forEach(tr => tr.classList.add("row-selected"));
      elements.lotsTableBody.querySelectorAll(".lot-checkbox").forEach(cb => { cb.checked = true; });
    }
    updateSelectedLotsSummary();
    if (formErrorHandler) formErrorHandler.clearFieldError("lotIds");
  }

  function clearAllLots() {
    selectedLotIds.clear();
    if (elements.lotsTableBody) {
      elements.lotsTableBody.querySelectorAll("tr").forEach(tr => tr.classList.remove("row-selected"));
      elements.lotsTableBody.querySelectorAll(".lot-checkbox").forEach(cb => { cb.checked = false; });
    }
    updateSelectedLotsSummary();
  }

  /**
   * Khởi tạo và gắn các sự kiện
   */
  function initEventListeners() {
    if (elements.btnOpenCreateModal) {
      elements.btnOpenCreateModal.addEventListener("click", openCreateModal);
    }
    const emptyCreateBtn = document.getElementById("emptyCreateBtn");
    if (emptyCreateBtn) {
      emptyCreateBtn.addEventListener("click", openCreateModal);
    }

    if (elements.btnCloseCreateModal) {
      elements.btnCloseCreateModal.addEventListener("click", closeCreateModal);
    }
    if (elements.btnCancelCreate) {
      elements.btnCancelCreate.addEventListener("click", closeCreateModal);
    }

    if (elements.btnAutoGenerateCode) {
      elements.btnAutoGenerateCode.addEventListener("click", autoGenerateShipmentCode);
    }

    if (elements.btnRefreshShipments) {
      elements.btnRefreshShipments.addEventListener("click", () => loadShipments());
    }

    if (elements.selectContainer) {
      elements.selectContainer.addEventListener("change", handleContainerChange);
    }

    if (elements.lotSearchInput) {
      elements.lotSearchInput.addEventListener("input", handleLotSearchInput);
    }

    if (elements.btnSelectAllLots) {
      elements.btnSelectAllLots.addEventListener("click", selectAllLots);
    }
    if (elements.btnClearAllLots) {
      elements.btnClearAllLots.addEventListener("click", clearAllLots);
    }

    if (elements.formCreateShipment) {
      elements.formCreateShipment.addEventListener("submit", handleSubmitCreateShipment);
    }

    // Modal Detail Close
    if (elements.btnCloseDetailModal) {
      elements.btnCloseDetailModal.addEventListener("click", closeDetailModal);
    }
    if (elements.btnDismissDetail) {
      elements.btnDismissDetail.addEventListener("click", closeDetailModal);
    }

    // Modal backdrop dismiss
    window.addEventListener("click", (e) => {
      if (e.target === elements.modalCreateShipment) closeCreateModal();
      if (e.target === elements.modalShipmentDetail) closeDetailModal();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeCreateModal();
        closeDetailModal();
      }
    });

    // Filter Buttons
    elements.filterButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        elements.filterButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        currentFilter = btn.getAttribute("data-filter") || "ALL";
        loadShipments();
      });
    });

    // Search Input
    let searchDebounceTimer = null;
    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          currentSearch = e.target.value.trim();
          loadShipments();
        }, 300);
      });
    }
  }

  // Lifecycle Entry Point
  document.addEventListener("DOMContentLoaded", async () => {
    cacheDomElements();
    initFormValidation();
    initEventListeners();

    if (typeof window.initAppShell === "function") {
      currentUser = await window.initAppShell({
        activeNav: "shipments",
        onUserLoaded: (user) => {
          applyPermissions(user);
        },
      });
      applyPermissions(currentUser);
    }

    await loadShipments();
  });
})();
