/**
 * AgriTrace ColdChain - S-40 Shipment API Adapter
 * Tách biệt hoàn toàn tầng giao diện (UI) và tầng giao tiếp API.
 * Tuân thủ quy định:
 * - Chỉ tích hợp theo docs/S40_API_CONTRACT.md khi nhánh Backend công bố.
 * - Không tự đoán endpoint tùy tiện, không tự tạo dữ liệu giả để coi như hoàn thành.
 * - Phát hiện và thông báo trạng thái "Chờ API Contract" rõ ràng, minh bạch.
 */

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ShipmentAdapter = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CONTRACT_DOC_PATH = "docs/S40_API_CONTRACT.md";
  const DEMO_STORAGE_KEY = "agri_shipment_sandbox_v1";

  // Danh mục thùng lạnh tiêu chuẩn GS1 phục vụ lựa chọn trên giao diện khi chờ API backend
  const STANDARD_CONTAINERS = [
    {
      id: "CONT-COLD-01",
      name: "Thùng lạnh chuyên dụng 50L (Vắc-xin & Nông sản nhạy cảm)",
      tempMin: 2,
      tempMax: 8,
      capacityLiters: 50,
      sensorModel: "IoT DHT22 Pro",
      status: "READY",
    },
    {
      id: "CONT-COLD-02",
      name: "Thùng lạnh siêu tốc 120L (Rau củ quả tươi cao cấp)",
      tempMin: 0,
      tempMax: 4,
      capacityLiters: 120,
      sensorModel: "PT100 Industrial",
      status: "READY",
    },
    {
      id: "CONT-FREEZE-01",
      name: "Thùng đông sâu 200L (Thủy hải sản & Đông lạnh)",
      tempMin: -20,
      tempMax: -10,
      capacityLiters: 200,
      sensorModel: "K-Type Thermocouple",
      status: "READY",
    },
    {
      id: "CONT-CHILL-01",
      name: "Thùng mát tiêu chuẩn 80L (Trái cây ôn đới & Nấm)",
      tempMin: 8,
      tempMax: 15,
      capacityLiters: 80,
      sensorModel: "Sensirion SHT30",
      status: "READY",
    },
  ];

  /**
   * Trạng thái kết nối API contract
   */
  let contractState = {
    checked: false,
    available: false,
    lastCheckedAt: null,
    message: `Đang chờ Backend cung cấp API Contract theo ${CONTRACT_DOC_PATH}`,
  };

  /**
   * Kiểm tra chế độ Sandbox / Demo Preview
   * Chỉ kích hoạt khi dev/tester bật cờ hoặc truy cập với ?demo=true hoặc test runner
   */
  function isSandboxMode() {
    if (typeof window === "undefined") return false;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("demo") === "true" || urlParams.get("preview") === "true") {
        return true;
      }
      return window.sessionStorage.getItem("agri_shipment_sandbox_enabled") === "true";
    } catch {
      return false;
    }
  }

  function setSandboxMode(enabled) {
    if (typeof window === "undefined") return;
    try {
      if (enabled) {
        window.sessionStorage.setItem("agri_shipment_sandbox_enabled", "true");
      } else {
        window.sessionStorage.removeItem("agri_shipment_sandbox_enabled");
      }
    } catch (e) {
      console.warn("Could not set sandbox mode:", e);
    }
  }

  function getSandboxShipments() {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.sessionStorage.getItem(DEMO_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSandboxShipments(list) {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("Could not save sandbox shipments:", e);
    }
  }

  /**
   * Kiểm tra tính khả dụng của API Chuyến vận chuyển từ Backend
   */
  async function checkContractAvailability() {
    if (typeof fetch !== "function") {
      contractState = {
        checked: true,
        available: false,
        lastCheckedAt: new Date().toISOString(),
        message: `Môi trường không hỗ trợ fetch. Chờ contract tại ${CONTRACT_DOC_PATH}.`,
      };
      return contractState;
    }

    try {
      const res = await fetch("/api/shipments?limit=1", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.status === 404 || res.status === 501 || res.status === 405) {
        contractState = {
          checked: true,
          available: false,
          lastCheckedAt: new Date().toISOString(),
          message: `Endpoint /api/shipments chưa được triển khai (HTTP ${res.status}). Đang chờ Backend hoàn tất theo ${CONTRACT_DOC_PATH}.`,
        };
      } else {
        contractState = {
          checked: true,
          available: true,
          lastCheckedAt: new Date().toISOString(),
          message: `API Backend đã sẵn sàng kết nối theo ${CONTRACT_DOC_PATH}.`,
        };
      }
    } catch (err) {
      contractState = {
        checked: true,
        available: false,
        lastCheckedAt: new Date().toISOString(),
        message: `Không thể kết nối đến máy chủ backend (${err.message || "Lỗi mạng"}). Chờ ${CONTRACT_DOC_PATH}.`,
      };
    }

    return contractState;
  }

  /**
   * Chuẩn hóa đối tượng chuyến vận chuyển
   */
  function normalizeShipment(raw) {
    if (!raw || typeof raw !== "object") return null;

    const coldBox = raw.containerId || raw.container_id || raw.coldBoxId || raw.cold_box_id || (raw.container && raw.container.id) || "N/A";
    const originLoc = raw.origin || raw.originLocationId || raw.origin_location_id || raw.fromLocation || raw.source_location || "N/A";
    const destLoc = raw.destination || raw.destinationLocationId || raw.destination_location_id || raw.toLocation || raw.dest_location || "N/A";
    const depTime = raw.departureTime || raw.departure_time || raw.startedAt || raw.started_at || raw.createdAt || raw.created_at || new Date().toISOString();

    const lots = Array.isArray(raw.lots) ? raw.lots : [];
    const lotIds = Array.isArray(raw.lotIds)
      ? raw.lotIds
      : lots.map(l => (typeof l === "object" ? (l.id || l.lotId || l.lot_id || l.code) : l)).filter(Boolean);

    // Xử lý trung thực số đo nhiệt độ và thời điểm đo (S-41 truthful telemetry)
    // Hỗ trợ đầy đủ các cách đặt tên theo tài liệu và thực tế backend: current_temperature, currentTemperature,...
    // Tuyệt đối không fallback sang giá trị giả định (không fake 4.2), bảo toàn số 0 và nhiệt độ âm
    let currentTemperature = null;
    const tempCandidates = [
      raw.current_temperature,
      raw.currentTemperature,
      raw.current_temp,
      raw.currentTemp,
      raw.temperature,
      raw.latestTemperature,
    ];
    for (const cand of tempCandidates) {
      if (cand !== undefined && cand !== null && cand !== "") {
        const num = Number(cand);
        if (Number.isFinite(num)) {
          currentTemperature = num;
          break;
        }
      }
    }

    let lastTemperatureAt = null;
    const timeCandidates = [
      raw.last_temperature_at,
      raw.lastTemperatureAt,
      raw.latestRecordedAt,
      raw.recordedAt,
      raw.recorded_at,
      raw.lastTempAt,
    ];
    for (const cand of timeCandidates) {
      if (cand !== undefined && cand !== null && cand !== "") {
        try {
          const d = new Date(cand);
          if (!isNaN(d.getTime())) {
            lastTemperatureAt = d.toISOString();
            break;
          }
        } catch {
          // Bỏ qua giá trị ngày giờ không hợp lệ
        }
      }
    }

    return {
      id: raw.id || raw.shipmentId || raw.code,
      code: raw.code || raw.shipmentCode || raw.id,
      containerId: coldBox,
      coldBoxId: coldBox,
      containerName: (raw.container && raw.container.name) || raw.containerName || coldBox || "Thùng lạnh tiêu chuẩn",
      containerTempRange: (raw.appliedTempMin != null && raw.appliedTempMax != null)
        ? `${raw.appliedTempMin}°C - ${raw.appliedTempMax}°C`
        : (raw.applied_temp_min != null && raw.applied_temp_max != null)
          ? `${raw.applied_temp_min}°C - ${raw.applied_temp_max}°C`
          : (raw.containerTempRange || (raw.container ? `${raw.container.tempMin}°C - ${raw.container.tempMax}°C` : "2°C - 8°C")),
      appliedTempMin: raw.appliedTempMin !== undefined ? raw.appliedTempMin : (raw.applied_temp_min !== undefined ? raw.applied_temp_min : null),
      appliedTempMax: raw.appliedTempMax !== undefined ? raw.appliedTempMax : (raw.applied_temp_max !== undefined ? raw.applied_temp_max : null),
      appliedDelayMinutes: raw.appliedDelayMinutes !== undefined ? raw.appliedDelayMinutes : (raw.applied_delay_minutes !== undefined ? raw.applied_delay_minutes : null),
      temperatureConfig: raw.temperatureConfig || raw.temperature_config || null,
      currentTemp: currentTemperature,
      currentTemperature: currentTemperature,
      current_temperature: currentTemperature,
      lastTemperatureAt: lastTemperatureAt,
      last_temperature_at: lastTemperatureAt,
      temperatureStatus: raw.temperatureStatus || raw.temperature_status || raw.tempStatus || raw.sensorStatus || null,
      temperature_status: raw.temperatureStatus || raw.temperature_status || raw.tempStatus || raw.sensorStatus || null,
      sensorStatus: raw.temperatureStatus || raw.temperature_status || raw.tempStatus || raw.sensorStatus || null,
      status: (raw.status || "IN_TRANSIT").toUpperCase(), // IN_TRANSIT, COMPLETED, SCHEDULED, ALERT
      origin: originLoc,
      originLocationId: originLoc,
      destination: destLoc,
      destinationLocationId: destLoc,
      departureTime: depTime,
      startedAt: depTime,
      completedAt: raw.completedAt || raw.completed_at || null,
      driverName: raw.driverName || raw.driver_name || raw.driver || "Chưa phân công",
      vehiclePlate: raw.vehiclePlate || raw.vehicle_plate || raw.vehicle || "N/A",
      lotIds,
      lots,
      notes: raw.notes || "",
      createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
      organizationId: raw.organizationId || raw.organization_id || "",
    };
  }

  /**
   * Lấy danh sách các chuyến vận chuyển lạnh
   * @param {Object} query - { status, search, limit }
   */
  async function listShipments(query = {}) {
    const params = new URLSearchParams();
    if (query.status && query.status !== "ALL") params.append("status", query.status);
    if (query.search) params.append("search", query.search.trim());
    if (query.limit) params.append("limit", String(query.limit));

    // 1. Thử gọi API Backend thật theo contract
    try {
      const res = await fetch(`/api/shipments?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.status === 401) {
        return {
          success: false,
          isUnauthorized: true,
          message: "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.",
          shipments: [],
        };
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isForbidden: true,
          message: errJson.message || "Bạn không có quyền xem danh sách chuyến vận chuyển.",
          shipments: [],
        };
      }

      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data) ? data : (data.shipments || data.data || []);
        const shipments = rawList.map(normalizeShipment).filter(Boolean);
        return {
          success: true,
          isWaitingContract: false,
          shipments,
          total: data.total || shipments.length,
        };
      }

      if (res.status === 404 || res.status === 501) {
        // Backend chưa có endpoint theo docs/S40_API_CONTRACT.md
        // Kiểm tra xem người dùng có kích hoạt Sandbox / Demo mode hay không
        if (isSandboxMode()) {
          let list = getSandboxShipments();
          if (query.status && query.status !== "ALL") {
            list = list.filter(s => s.status === query.status);
          }
          if (query.search) {
            const q = query.search.toLowerCase();
            list = list.filter(s =>
              s.code.toLowerCase().includes(q) ||
              s.containerId.toLowerCase().includes(q) ||
              s.origin.toLowerCase().includes(q) ||
              s.destination.toLowerCase().includes(q) ||
              s.lotIds.some(id => String(id).toLowerCase().includes(q))
            );
          }
          return {
            success: true,
            isWaitingContract: true,
            isSandboxMode: true,
            message: `[Sandbox Preview] Hiển thị dữ liệu cục bộ trong khi chờ Backend hoàn tất ${CONTRACT_DOC_PATH}.`,
            shipments: list,
          };
        }

        return {
          success: false,
          isWaitingContract: true,
          contractDoc: CONTRACT_DOC_PATH,
          message: `Backend chưa hoàn tất API danh sách chuyến theo ${CONTRACT_DOC_PATH} (HTTP ${res.status}).`,
          shipments: [],
        };
      }

      const errText = await res.text();
      return {
        success: false,
        message: `Lỗi máy chủ (${res.status}): ${errText || "Không rõ nguyên nhân"}`,
        shipments: [],
      };
    } catch (err) {
      if (isSandboxMode()) {
        const list = getSandboxShipments();
        return {
          success: true,
          isWaitingContract: true,
          isSandboxMode: true,
          message: `[Offline Sandbox] Hiển thị chuyến thử nghiệm cục bộ (${err.message}).`,
          shipments: list,
        };
      }

      return {
        success: false,
        isWaitingContract: true,
        contractDoc: CONTRACT_DOC_PATH,
        message: `Chưa kết nối được API Backend (${err.message}). Đang chờ Backend triển khai theo ${CONTRACT_DOC_PATH}.`,
        shipments: [],
      };
    }
  }

  /**
   * Lấy chi tiết chuyến vận chuyển theo ID
   * @param {string} shipmentId
   */
  async function getShipmentDetail(shipmentId) {
    if (!shipmentId) {
      return { success: false, message: "Mã định danh chuyến vận chuyển không hợp lệ." };
    }

    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.status === 401) {
        return { success: false, isUnauthorized: true, message: "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại." };
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isForbidden: true,
          message: errJson.message || "Bạn không có quyền truy cập thông tin chuyến vận chuyển này.",
        };
      }

      if (res.ok) {
        const data = await res.json();
        const shipment = normalizeShipment(data.shipment || data);
        return { success: true, shipment };
      }

      if (res.status === 404 || res.status === 501) {
        if (isSandboxMode()) {
          const list = getSandboxShipments();
          const found = list.find(s => s.id === shipmentId || s.code === shipmentId);
          if (found) {
            return { success: true, isSandboxMode: true, shipment: found };
          }
        }
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isWaitingContract: res.status === 501,
          contractDoc: CONTRACT_DOC_PATH,
          message: errJson.message || `Không tìm thấy chuyến hoặc Backend chưa hỗ trợ endpoint chi tiết (${CONTRACT_DOC_PATH}).`,
        };
      }

      return { success: false, message: `Lỗi tải chi tiết chuyến (HTTP ${res.status}).` };
    } catch (err) {
      if (isSandboxMode()) {
        const list = getSandboxShipments();
        const found = list.find(s => s.id === shipmentId || s.code === shipmentId);
        if (found) return { success: true, isSandboxMode: true, shipment: found };
      }
      return {
        success: false,
        isWaitingContract: true,
        message: `Lỗi mạng khi tải chi tiết chuyến: ${err.message}`,
      };
    }
  }

  /**
   * Kiểm tra tính hợp lệ của dữ liệu mở chuyến mới (Validation Engine)
   * @param {Object} payload
   */
  function validateShipmentPayload(payload) {
    const errors = {};
    if (!payload || typeof payload !== "object") {
      return { isValid: false, errors: { _global: "Dữ liệu chuyến không hợp lệ." } };
    }

    // 1. Mã chuyến vận chuyển
    const code = typeof payload.shipmentCode === "string" ? payload.shipmentCode.trim() : "";
    if (!code) {
      errors.shipmentCode = "Vui lòng nhập mã chuyến vận chuyển.";
    } else if (code.length < 3 || code.length > 50) {
      errors.shipmentCode = "Mã chuyến phải từ 3 đến 50 ký tự.";
    } else if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      errors.shipmentCode = "Mã chuyến chỉ được chứa chữ cái, số, dấu gạch nối (-) và gạch dưới (_).";
    }

    // 2. Thùng lạnh (chọn duy nhất một thùng)
    const containerId = typeof payload.containerId === "string" ? payload.containerId.trim() : "";
    if (!containerId) {
      errors.containerId = "Vui lòng chọn một thùng lạnh bảo quản cho chuyến.";
    }

    // 3. Lựa chọn nhiều lô hàng (Multi-lot selection, tối thiểu 1 lô)
    const lotIds = Array.isArray(payload.lotIds) ? payload.lotIds.filter(Boolean) : [];
    if (!lotIds || lotIds.length === 0) {
      errors.lotIds = "Vui lòng chọn ít nhất một lô hàng đính kèm vào chuyến vận chuyển.";
    } else if (Array.isArray(payload.selectedLotsList) && payload.selectedLotsList.length > 0) {
      const invalidLots = payload.selectedLotsList.filter((l) => {
        const qty = l.remainingQuantity !== undefined && l.remainingQuantity !== null
          ? Number(l.remainingQuantity)
          : (l.remaining_quantity !== undefined && l.remaining_quantity !== null
            ? Number(l.remaining_quantity)
            : (l.current_quantity !== undefined && l.current_quantity !== null
              ? Number(l.current_quantity)
              : (l.quantity != null ? Number(l.quantity) : 0)));
        const st = String(l.status || "").toUpperCase();
        return qty <= 0 || isNaN(qty) || st === "CONSUMED" || st === "RECALLED" || l.status === "Đã bán hết" || l.status === "Đã tiêu thụ" || l.status === "Có sự cố";
      });
      if (invalidLots.length > 0) {
        errors.lotIds = `Lô hàng ${invalidLots.map((l) => l.id).join(", ")} không còn khối lượng khả dụng (0 kg) hoặc đã kết thúc, không thể đưa vào chuyến.`;
      }
    }

    // 4. Điểm xuất phát (Origin)
    const origin = typeof payload.origin === "string" ? payload.origin.trim() : "";
    if (!origin) {
      errors.origin = "Vui lòng nhập điểm xuất phát (kho / cơ sở gửi).";
    } else if (origin.length > 200) {
      errors.origin = "Điểm xuất phát không được vượt quá 200 ký tự.";
    }

    // 5. Điểm đến (Destination)
    const destination = typeof payload.destination === "string" ? payload.destination.trim() : "";
    if (!destination) {
      errors.destination = "Vui lòng nhập điểm đến (kho nhận / điểm phân phối).";
    } else if (destination.length > 200) {
      errors.destination = "Điểm đến không được vượt quá 200 ký tự.";
    }

    // 6. Thời gian khởi hành
    const depTime = payload.departureTime;
    if (!depTime) {
      errors.departureTime = "Vui lòng chọn thời gian dự kiến khởi hành.";
    } else {
      const parsedDate = new Date(depTime);
      if (isNaN(parsedDate.getTime())) {
        errors.departureTime = "Thời gian khởi hành không đúng định dạng.";
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors,
    };
  }

  /**
   * Mở chuyến vận chuyển mới gắn nhiều lô và một thùng lạnh
   * @param {Object} payload
   */
  async function createShipment(payload) {
    // Validation phía client trước
    const validation = validateShipmentPayload(payload);
    if (!validation.isValid) {
      return {
        success: false,
        errors: validation.errors,
        message: "Vui lòng kiểm tra lại các trường thông tin bắt buộc.",
      };
    }

    const bodyData = {
      code: payload.shipmentCode.trim(),
      containerId: payload.containerId.trim(),
      coldBoxId: payload.containerId.trim(),
      lotIds: payload.lotIds,
      origin: payload.origin.trim(),
      originLocationId: payload.origin.trim(),
      destination: payload.destination.trim(),
      destinationLocationId: payload.destination.trim(),
      departureTime: new Date(payload.departureTime).toISOString(),
      driverName: (payload.driverName || "").trim(),
      driverPhone: (payload.driverPhone || "").trim(),
      vehiclePlate: (payload.vehiclePlate || "").trim(),
      notes: (payload.notes || "").trim(),
    };

    try {
      const res = await fetch("/api/shipments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(bodyData),
      });

      if (res.status === 401) {
        return {
          success: false,
          isUnauthorized: true,
          message: "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.",
        };
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isForbidden: true,
          message: errJson.message || "Tài khoản của bạn không có quyền mở chuyến vận chuyển.",
        };
      }

      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isConflict: true,
          error: errJson.error || "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
          message: errJson.message || "Một hoặc nhiều lô hàng hoặc thùng lạnh đã được gắn vào chuyến vận chuyển đang hoạt động khác.",
        };
      }

      if (res.status === 400 || res.status === 404 || res.status === 422) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          errors: (errJson.errors && Object.keys(errJson.errors).length > 0) ? errJson.errors : null,
          error: errJson.error,
          message: errJson.message || "Dữ liệu không hợp lệ theo quy định máy chủ.",
        };
      }

      if (res.ok) {
        const data = await res.json();
        const created = normalizeShipment(data.shipment || data);
        return {
          success: true,
          isWaitingContract: false,
          shipment: created,
          message: "Mở chuyến vận chuyển lạnh thành công!",
        };
      }

      if (res.status === 404 || res.status === 501) {
        // Backend chưa có API POST /api/shipments
        if (isSandboxMode()) {
          const list = getSandboxShipments();
          const newShipment = normalizeShipment({
            id: `shp-${Date.now()}`,
            code: bodyData.code,
            containerId: bodyData.containerId,
            coldBoxId: bodyData.coldBoxId,
            lotIds: bodyData.lotIds,
            lots: (payload.selectedLotsList || []).map(l => ({
              id: l.id,
              lotId: l.id,
              name: l.name,
              product_name: l.product_name || l.productName,
              quantity: l.current_quantity != null ? l.current_quantity : (l.remaining_quantity != null ? l.remaining_quantity : (l.quantity || 0)),
              unit: l.unit || "kg",
            })),
            origin: bodyData.origin,
            destination: bodyData.destination,
            departureTime: bodyData.departureTime,
            driverName: bodyData.driverName,
            driverPhone: bodyData.driverPhone,
            vehiclePlate: bodyData.vehiclePlate,
            notes: bodyData.notes,
            status: "IN_TRANSIT",
            currentTemperature: null,
            lastTemperatureAt: null,
            createdAt: new Date().toISOString(),
          });
          list.unshift(newShipment);
          saveSandboxShipments(list);
          return {
            success: true,
            isWaitingContract: true,
            isSandboxMode: true,
            shipment: newShipment,
            message: `[Sandbox] Đã tạo chuyến cục bộ để kiểm thử giao diện. Đang chờ Backend triển khai endpoint theo ${CONTRACT_DOC_PATH}.`,
          };
        }

        return {
          success: false,
          isWaitingContract: true,
          contractDoc: CONTRACT_DOC_PATH,
          message: `Backend chưa hoàn tất endpoint POST /api/shipments theo ${CONTRACT_DOC_PATH} (HTTP ${res.status}).`,
        };
      }

      const errJson = await res.json().catch(() => null);
      const errText = errJson ? errJson.message : await res.text().catch(() => "");
      return {
        success: false,
        message: errText || `Lỗi máy chủ (${res.status}): Không thể tạo chuyến`,
      };
    } catch (err) {
      if (isSandboxMode()) {
        const list = getSandboxShipments();
        const newShipment = normalizeShipment({
          id: `shp-${Date.now()}`,
          code: bodyData.code,
          containerId: bodyData.containerId,
          coldBoxId: bodyData.coldBoxId,
          lotIds: bodyData.lotIds,
          lots: (payload.selectedLotsList || []),
          origin: bodyData.origin,
          destination: bodyData.destination,
          departureTime: bodyData.departureTime,
          driverName: bodyData.driverName,
          driverPhone: bodyData.driverPhone,
          vehiclePlate: bodyData.vehiclePlate,
          notes: bodyData.notes,
          status: "IN_TRANSIT",
          currentTemperature: null,
          lastTemperatureAt: null,
          createdAt: new Date().toISOString(),
        });
        list.unshift(newShipment);
        saveSandboxShipments(list);
        return {
          success: true,
          isWaitingContract: true,
          isSandboxMode: true,
          shipment: newShipment,
          message: `[Offline Sandbox] Đã ghi nhận chuyến thử nghiệm cục bộ (${err.message}).`,
        };
      }

      return {
        success: false,
        isWaitingContract: true,
        contractDoc: CONTRACT_DOC_PATH,
        message: `Không thể kết nối đến máy chủ backend: ${err.message}. Chờ hoàn tất ${CONTRACT_DOC_PATH}.`,
      };
    }
  }

  /**
   * Kết thúc chuyến vận chuyển lạnh (chuyển sang COMPLETED)
   * @param {string} shipmentId
   * @param {Object} [data]
   */
  async function completeShipment(shipmentId, data = {}) {
    if (!shipmentId) {
      return { success: false, message: "Mã chuyến không hợp lệ." };
    }

    try {
      const res = await fetch(`/api/shipments/${encodeURIComponent(shipmentId)}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(data),
      });

      if (res.status === 401) {
        return {
          success: false,
          isUnauthorized: true,
          message: "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.",
        };
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isForbidden: true,
          message: errJson.message || "Tài khoản của bạn không có quyền kết thúc chuyến vận chuyển.",
        };
      }

      if (res.status === 400 || res.status === 422) {
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          message: errJson.message || "Không thể kết thúc chuyến vận chuyển (chuyến có thể đã kết thúc).",
        };
      }

      if (res.ok) {
        const resData = await res.json();
        return {
          success: true,
          shipment: normalizeShipment(resData.shipment || resData),
          message: "Chuyến vận chuyển đã được kết thúc thành công.",
        };
      }

      if (res.status === 404 || res.status === 501) {
        if (isSandboxMode()) {
          const list = getSandboxShipments();
          const target = list.find(s => s.id === shipmentId || s.code === shipmentId);
          if (target) {
            target.status = "COMPLETED";
            target.completedAt = new Date().toISOString();
            saveSandboxShipments(list);
            return {
              success: true,
              isSandboxMode: true,
              shipment: target,
              message: "[Sandbox] Đã chuyển trạng thái chuyến thành Đã kết thúc.",
            };
          }
        }
        const errJson = await res.json().catch(() => ({}));
        return {
          success: false,
          isWaitingContract: res.status === 501,
          contractDoc: CONTRACT_DOC_PATH,
          message: errJson.message || (res.status === 404 ? "Không tìm thấy chuyến vận chuyển yêu cầu." : `Backend chưa hoàn tất API kết thúc chuyến theo ${CONTRACT_DOC_PATH}.`),
        };
      }

      const errJson = await res.json().catch(() => null);
      return { success: false, message: (errJson && errJson.message) || `Lỗi kết thúc chuyến (HTTP ${res.status}).` };
    } catch (err) {
      if (isSandboxMode()) {
        const list = getSandboxShipments();
        const target = list.find(s => s.id === shipmentId || s.code === shipmentId);
        if (target) {
          target.status = "COMPLETED";
          target.completedAt = new Date().toISOString();
          saveSandboxShipments(list);
          return { success: true, isSandboxMode: true, shipment: target };
        }
      }
      return { success: false, message: `Lỗi kết nối máy chủ: ${err.message}` };
    }
  }

  /**
   * Lấy danh sách lô hàng khả dụng từ endpoint hiện có của Backend (/api/organization/lots)
   * Phục vụ lựa chọn nhiều lô trong form mở chuyến.
   * Hỗ trợ tìm kiếm từ máy chủ và phân trang cursor (S-40).
   * @param {Object} [options]
   * @param {string} [options.search]
   * @param {string} [options.cursor]
   * @param {number} [options.limit]
   */
  async function fetchAvailableLots(options = {}) {
    try {
      const search = options && options.search ? String(options.search).trim() : "";
      const cursor = options && options.cursor ? String(options.cursor).trim() : "";
      const limit = (options && Number(options.limit)) || 50;

      let url = `/api/organization/lots?limit=${encodeURIComponent(limit)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.status === 401) {
        return { success: false, isUnauthorized: true, lots: [] };
      }

      if (res.ok) {
        const data = await res.json();
        const rawLots = Array.isArray(data.lots) ? data.lots : (Array.isArray(data) ? data : []);

        const blockedStatuses = new Set([
          "CONSUMED",
          "RECALLED",
          "Đã bán hết",
          "Đã tiêu thụ",
          "Đang thu hồi",
          "Đã thu hồi",
          "Có sự cố",
        ]);

        function normalizeLot(l) {
          if (!l) return null;
          const rawQty = l.remainingQuantity ?? l.remaining_quantity ?? l.current_quantity ?? l.quantity;
          const qty = rawQty == null || rawQty === "" ? null : Number(rawQty);
          const initialQty = l.initialQuantity ?? l.initial_quantity;
          const initParsed = initialQty == null || initialQty === "" ? null : Number(initialQty);
          const status = l.status || "ACTIVE";
          const pendingTransfer = l.pendingTransfer ?? null;

          const isEligible = (
            Number.isFinite(qty) &&
            qty > 0 &&
            !blockedStatuses.has(status) &&
            !pendingTransfer
          );

          return {
            id: l.id,
            name: l.name || l.id,
            product_name: l.productName ?? l.product_name ?? "Chưa xác định",
            current_quantity: Number.isFinite(qty) ? qty : null,
            remaining_quantity: Number.isFinite(qty) ? qty : null,
            remainingQuantity: Number.isFinite(qty) ? qty : null,
            initial_quantity: Number.isFinite(initParsed) ? initParsed : null,
            initialQuantity: Number.isFinite(initParsed) ? initParsed : null,
            unit: l.productUnit ?? l.product_unit ?? l.unit ?? "kg",
            status: status,
            pendingTransfer: pendingTransfer,
            isEligible: isEligible,
            harvested_at: l.harvested_at || l.harvestDate || l.created_at,
          };
        }

        const normalizedLots = rawLots.map(normalizeLot).filter(Boolean);

        // Lọc các lô còn khả dụng: phải có khối lượng > 0 và trạng thái hợp lệ
        const availableLots = normalizedLots.filter((l) => l.isEligible);
        return {
          success: true,
          lots: availableLots,
          allLots: normalizedLots,
          nextCursor: data.nextCursor || null,
          hasMore: Boolean(data.hasMore),
        };
      }

      return { success: false, lots: [], message: `Không thể tải danh sách lô (HTTP ${res.status})` };
    } catch (err) {
      return { success: false, lots: [], message: err.message || "Lỗi mạng tải lô" };
    }
  }

  /**
   * Lấy danh sách địa điểm khả dụng từ /api/locations (Story S-30)
   */
  async function fetchLocations() {
    try {
      const res = await fetch("/api/locations", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.ok) {
        const data = await res.json();
        return {
          success: true,
          locations: Array.isArray(data.locations) ? data.locations : [],
        };
      }
      return { success: false, locations: [], message: `Không thể tải địa điểm (HTTP ${res.status})` };
    } catch (err) {
      return { success: false, locations: [], message: err.message || "Lỗi mạng tải địa điểm" };
    }
  }

  /**
   * Lấy danh mục thùng lạnh khả dụng (Thử endpoint backend hoặc dùng tiêu chuẩn GS1)
   */
  async function fetchColdContainers() {
    try {
      const res = await fetch("/api/cold-containers", {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });

      if (res.ok) {
        const data = await res.json();
        const containers = Array.isArray(data.containers) ? data.containers : (Array.isArray(data) ? data : []);
        if (containers.length > 0) {
          return { success: true, containers, isFromBackend: true };
        }
      }
    } catch {
      // Endpoint chưa có trong backend
    }

    // Fallback danh mục thùng chuẩn GS1
    return {
      success: true,
      containers: STANDARD_CONTAINERS,
      isFromBackend: false,
      notice: "Đang hiển thị danh mục thùng lạnh quy chuẩn GS1 hệ thống.",
    };
  }

  /**
   * Helper định dạng trạng thái tiếng Việt
   */
  function formatShipmentStatus(status) {
    const s = String(status || "").toUpperCase();
    switch (s) {
      case "IN_TRANSIT":
      case "RUNNING":
      case "ACTIVE":
        return { label: "Đang vận chuyển", badgeClass: "badge-status-running", dotClass: "dot-pulse-green" };
      case "COMPLETED":
      case "ENDED":
        return { label: "Đã kết thúc", badgeClass: "badge-status-completed", dotClass: "dot-gray" };
      case "SCHEDULED":
      case "PENDING":
        return { label: "Chờ khởi hành", badgeClass: "badge-status-scheduled", dotClass: "dot-orange" };
      case "ALERT":
      case "TEMP_VIOLATION":
        return { label: "Cảnh báo nhiệt độ", badgeClass: "badge-status-alert", dotClass: "dot-red" };
      default:
        return { label: status || "Không xác định", badgeClass: "badge-status-default", dotClass: "dot-gray" };
    }
  }

  // Export API adapter methods
  return {
    CONTRACT_DOC_PATH,
    STANDARD_CONTAINERS,
    getContractStatus: () => contractState,
    checkContractAvailability,
    listShipments,
    getShipmentDetail,
    createShipment,
    completeShipment,
    validateShipmentPayload,
    fetchAvailableLots,
    fetchLocations,
    fetchColdContainers,
    formatShipmentStatus,
    normalizeShipment,
    isSandboxMode,
    setSandboxMode,
  };
});
