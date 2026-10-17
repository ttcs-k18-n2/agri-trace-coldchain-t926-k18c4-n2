/**
 * Module tổng hợp bản đồ hành trình truy xuất công khai (Story S-60 / N2-131 / N2-290)
 * Tích hợp:
 * - S-06: Tái sử dụng tọa độ vùng trồng với cơ chế bảo vệ quyền riêng tư (danh mục tọa độ đại diện cấp xã)
 * - S-21: Truy vết nguồn gốc đa tầng (traceLotOrigins), hỗ trợ cả lô đơn và lô gộp (Diamond DAG)
 * - S-30: Quản lý địa điểm, kho bãi, điểm phân phối đã xác minh
 * - S-15 / S-16: Đọc lịch sử TRANSFER_CONFIRMED và LOCATION_CHANGED theo trình tự thời gian thực tế
 * - Lọc an toàn dữ liệu công khai (Whitelisting): tuyệt đối không tiết lộ số điện thoại, mã nội bộ hay tọa độ thửa đất gốc
 */

const { traceLotOrigins } = require("./lot_genealogy");
const { getLocationById } = require("./location_service");
const { checkLotRecallStatus } = require("./recall_service");

/**
 * Danh mục tọa độ đại diện cấp xã / khu vực mặc định (In-memory fallback & seed mapping)
 * Đại diện tâm khu vực hành chính, bảo vệ tọa độ riêng tư của nông hộ theo S-06.
 */
const DEFAULT_MAP_AREAS = [
  {
    id: "AREA-LA-BANG",
    name: "Vùng chè an toàn La Bằng",
    commune: "La Bằng",
    district: "Đại Từ",
    province: "Thái Nguyên",
    latitude: 21.5580,
    longitude: 105.6720,
    keywords: ["la bằng", "la bang", "labang", "đại từ", "daitu"],
    description: "Tâm hành chính xã La Bằng, vùng chỉ dẫn địa lý chè Đại Từ",
  },
  {
    id: "AREA-HUNG-SON",
    name: "Vùng trồng nông sản an toàn Hùng Sơn",
    commune: "Hùng Sơn",
    district: "Đại Từ",
    province: "Thái Nguyên",
    latitude: 21.5750,
    longitude: 105.6905,
    keywords: ["hùng sơn", "hung son", "hungson", "đại từ", "daitu"],
    description: "Khu vực trung tâm thị trấn Hùng Sơn",
  },
  {
    id: "AREA-TAN-CUONG",
    name: "Vùng chỉ dẫn địa lý Tân Cương",
    commune: "Tân Cương",
    district: "TP Thái Nguyên",
    province: "Thái Nguyên",
    latitude: 21.5450,
    longitude: 105.7720,
    keywords: ["tân cương", "tan cuong", "tancuong", "thái nguyên", "thai nguyen"],
    description: "Vùng đặc sản Tân Cương Thái Nguyên",
  },
  {
    id: "AREA-YEN-DUNG",
    name: "Vùng chuyên canh nông sản Yên Dũng",
    commune: "Nham Biền",
    district: "Yên Dũng",
    province: "Bắc Giang",
    latitude: 21.2290,
    longitude: 106.1820,
    keywords: ["yên dũng", "yen dung", "nham biền", "nham bien", "yendung"],
    description: "Khu vực trung tâm huyện Yên Dũng",
  },
  {
    id: "AREA-HIEP-HOA",
    name: "Vùng trồng nông sản Hiệp Hòa",
    commune: "Hiệp Hòa",
    district: "Hiệp Hòa",
    province: "Bắc Giang",
    latitude: 21.3415,
    longitude: 105.9810,
    keywords: ["hiệp hòa", "hiep hoa", "hiephoa"],
    description: "Vùng trồng nông sản sạch Hiệp Hòa",
  },
  {
    id: "AREA-DAI-TU",
    name: "Khu vực sản xuất nông nghiệp Đại Từ",
    commune: "Đại Từ",
    district: "Đại Từ",
    province: "Thái Nguyên",
    latitude: 21.63,
    longitude: 105.64,
    keywords: ["đại từ", "dai tu", "thái nguyên", "thai nguyen", "daitu"],
    description: "Khu vực sản xuất Đại Từ",
  },
  {
    id: "AREA-LONG-BIEN",
    name: "Cụm logistics phân phối Long Biên",
    commune: "Phúc Đồng",
    district: "Long Biên",
    province: "Hà Nội",
    latitude: 21.0356,
    longitude: 105.9012,
    keywords: ["đài tư", "dai tu", "long biên", "long bien", "kcn đài tư", "longbien"],
    description: "Trung tâm logistics và kho lạnh tiêu chuẩn",
  },
  {
    id: "AREA-CAU-GIAY",
    name: "Khu vực phân phối Cầu Giấy",
    commune: "Dịch Vọng",
    district: "Cầu Giấy",
    province: "Hà Nội",
    latitude: 21.0333,
    longitude: 105.7989,
    keywords: ["cầu giấy", "cau giay", "caugiay"],
    description: "Trung tâm bán lẻ và phân phối tiêu dùng",
  },
  {
    id: "AREA-THANH-XUAN",
    name: "Khu vực phân phối Thanh Xuân",
    commune: "Thanh Xuân Trung",
    district: "Thanh Xuân",
    province: "Hà Nội",
    latitude: 20.9981,
    longitude: 105.8152,
    keywords: ["nguyễn trãi", "nguyen trai", "thanh xuân", "thanh xuan", "thanhxuan"],
    description: "Điểm phân phối và chuỗi cửa hàng tiện ích",
  },
];

/**
 * Phân tích chuỗi tọa độ (VD: "21.5645, 105.6789" hoặc { lat, lng })
 */
function parseCoordinates(raw) {
  if (!raw) return null;
  let lat = null;
  let lng = null;

  if (typeof raw === "object" && raw.lat !== undefined && raw.lng !== undefined) {
    lat = Number(raw.lat);
    lng = Number(raw.lng);
  } else if (typeof raw === "string") {
    const parts = raw.split(",").map((p) => Number(p.trim()));
    if (parts.length === 2) {
      lat = parts[0];
      lng = parts[1];
    }
  }

  // Chặn Infinity, NaN và kiểm tra dải vĩ độ [-90, 90], kinh độ [-180, 180]
  if (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  ) {
    return { lat, lng };
  }
  return null;
}

/**
 * Tìm tọa độ đại diện cấp xã / khu vực cho vùng trồng (S-06 / N2-290)
 * Tuyệt đối không trả về tọa độ thửa gốc chi tiết nhằm bảo vệ vị trí đất riêng tư của nông dân.
 */
async function resolveRepresentativeArea(pool, farm, customAreas = DEFAULT_MAP_AREAS, cachedDbAreas = null) {
  if (!farm) {
    return {
      regionName: "Vùng trồng chưa định vị",
      coordinates: null,
      hasCoordinates: false,
      verified: false,
      adminLevel: null,
    };
  }

  const farmName = (farm.name || farm.farm_name || "").toLowerCase();
  const farmAddress = (farm.address || "").toLowerCase();
  const searchTarget = `${farmName} ${farmAddress}`.trim();

  // 1. Đối chiếu danh mục cấp xã/khu vực từ PostgreSQL
  let dbRows = cachedDbAreas;
  if (!dbRows && pool && typeof pool.query === "function") {
    try {
      const dbAreasRes = await pool.query(
        "SELECT id, name, admin_level, commune, district, province, latitude, longitude, keywords FROM public_map_areas"
      );
      dbRows = dbAreasRes ? dbAreasRes.rows : [];
    } catch (dbErr) {
      console.error("[resolveRepresentativeArea DB error]:", dbErr.message);
    }
  }

  if (dbRows && dbRows.length > 0) {
    for (const row of dbRows) {
      const kws = (row.keywords || "")
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length >= 2);
      const matchKeyword = kws.some((k) => searchTarget.includes(k));
      const matchName = searchTarget.includes(row.name.toLowerCase());
      if (matchKeyword || matchName) {
        const coords = parseCoordinates({ lat: row.latitude, lng: row.longitude });
        if (coords) {
          return {
            regionName: row.name,
            commune: row.commune,
            district: row.district,
            province: row.province,
            coordinates: coords,
            hasCoordinates: true,
            verified: true,
            adminLevel: row.admin_level || "commune",
          };
        }
      }
    }
  }

  // 2. Tra cứu trong danh mục đại diện cấp xã in-memory
  for (const area of customAreas) {
    const kws = (area.keywords || []).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 2);
    const matchKeyword = kws.some((kw) => searchTarget.includes(kw));
    const matchName = searchTarget.includes(area.name.toLowerCase());
    if (matchKeyword || matchName) {
      const coords = parseCoordinates({ lat: area.latitude, lng: area.longitude });
      if (coords) {
        return {
          regionName: area.name,
          commune: area.commune,
          district: area.district,
          province: area.province,
          coordinates: coords,
          hasCoordinates: true,
          verified: true,
          adminLevel: area.adminLevel || "commune",
        };
      }
    }
  }

  // 3. Nếu không khớp danh mục:
  // Tuyệt đối không làm tròn hay suy đoán tọa độ thửa đất riêng tư (S-06 / N2-290).
  // Đánh dấu rõ ràng là mốc văn bản chưa định vị tọa độ.
  return {
    regionName: farm.name || "Khu vực sản xuất nông nghiệp",
    commune: null,
    district: null,
    province: null,
    coordinates: null,
    hasCoordinates: false,
    verified: false,
    adminLevel: null,
  };
}

/**
 * Chuẩn hóa nhãn loại địa điểm hiển thị cho người tiêu dùng
 */
function getLocationTypeLabel(type) {
  switch (type) {
    case "cold_storage":
      return "Kho bảo quản lạnh";
    case "warehouse":
      return "Kho trung chuyển & lưu trữ";
    case "store":
      return "Cửa hàng bán lẻ / Điểm tiêu thụ";
    case "distribution_center":
      return "Trung tâm phân phối";
    case "farm":
      return "Vùng trồng nông sản";
    case "transit":
      return "Bàn giao vận chuyển chuỗi lạnh";
    default:
      return "Điểm lưu kho & trung chuyển";
  }
}

function getSafePublicOrgName(orgName, orgId, orgMap, fallback = "Đối tác chuỗi cung ứng") {
  if (orgName && typeof orgName === "string" && !orgName.toLowerCase().startsWith("org-")) {
    return orgName;
  }
  if (orgId && orgMap && orgMap.has(orgId)) {
    const mapped = orgMap.get(orgId);
    if (mapped && typeof mapped === "string" && !mapped.toLowerCase().startsWith("org-")) {
      return mapped;
    }
  }
  return fallback;
}

/**
 * Xây dựng dữ liệu bản đồ công khai hoàn chỉnh cho một lô hàng (S-60 / N2-290)
 *
 * @param {object} options
 * @param {object|null} options.pool - PostgreSQL pool
 * @param {string} options.lotCode - Mã lô cần truy xuất bản đồ
 * @param {Array} options.inMemoryLots
 * @param {Array} options.inMemoryBatchRelations
 * @param {Array} options.inMemoryBatchEvents
 * @param {Array} options.inMemoryOrgs
 * @param {Array} options.inMemoryProducts
 * @param {Array} options.inMemoryFarms
 * @param {Array} options.inMemoryLocations
 * @param {Array} options.inMemoryTransfers
 * @returns {Promise<object>} Dữ liệu JSON bản đồ công khai
 */
async function getPublicLotMapData(options = {}) {
  const {
    pool,
    lotCode,
    inMemoryLots = [],
    inMemoryBatchRelations = [],
    inMemoryBatchEvents = [],
    inMemoryOrgs = [],
    inMemoryProducts = [],
    inMemoryFarms = [],
    inMemoryLocations = [],
    inMemoryRecallOrders = [],
  } = options;

  if (!lotCode || typeof lotCode !== "string" || !lotCode.trim()) {
    const err = new Error("Mã lô hàng không hợp lệ.");
    err.statusCode = 400;
    err.code = "INVALID_LOT_CODE";
    throw err;
  }

  const normalizedCode = lotCode.trim();

  // 1. Tìm thông tin lô hàng
  let lotRecord = null;
  const orgMap = new Map();
  for (const o of inMemoryOrgs) {
    orgMap.set(o.id, o.name || o.id);
  }

  if (pool && typeof pool.query === "function") {
    const lotRes = await pool.query(
      `SELECT 
        l.id, l.name, l.status, l.organization_id, l.farm_id, l.product_id,
        l.initial_quantity, l.remaining_quantity, l.harvested_at, l.parent_lot_id, l.location_id, l.created_at,
        l.custom_coordinates,
        f.name AS farm_name, f.coordinates AS farm_coordinates, f.area AS farm_area,
        p.name AS product_name, p.unit AS product_unit,
        o.name AS organization_name,
        loc.name AS location_name, loc.address AS location_address, loc.location_type AS location_type, loc.coordinates AS location_coordinates
      FROM lots l
      LEFT JOIN farms f ON l.farm_id = f.id
      LEFT JOIN products p ON l.product_id = p.id
      LEFT JOIN organizations o ON l.organization_id = o.id
      LEFT JOIN locations loc ON l.location_id = loc.id
      WHERE UPPER(l.id) = UPPER($1)`,
      [normalizedCode]
    );

    if (lotRes.rows.length > 0) {
      const r = lotRes.rows[0];
      let parsedCustomCoords = null;
      if (r.custom_coordinates) {
        if (typeof r.custom_coordinates === "string") {
          try {
            parsedCustomCoords = JSON.parse(r.custom_coordinates);
          } catch {
            parsedCustomCoords = null;
          }
        } else if (typeof r.custom_coordinates === "object") {
          parsedCustomCoords = r.custom_coordinates;
        }
      }
      lotRecord = {
        id: r.id,
        code: r.id,
        name: r.name,
        status: r.status,
        organizationId: r.organization_id,
        organizationName: getSafePublicOrgName(r.organization_name, r.organization_id, orgMap, "Đơn vị sản xuất"),
        farmId: r.farm_id,
        farmName: r.farm_name,
        farmArea: r.farm_area !== null ? Number(r.farm_area) : null,
        farmCoordinates: r.farm_coordinates,
        productId: r.product_id,
        productName: r.product_name,
        productUnit: r.product_unit || "kg",
        initialQuantity: r.initial_quantity !== null ? Number(r.initial_quantity) : null,
        remainingQuantity: r.remaining_quantity !== null ? Number(r.remaining_quantity) : null,
        harvestedAt: r.harvested_at,
        parentLotId: r.parent_lot_id,
        locationId: r.location_id,
        locationName: r.location_name,
        locationAddress: r.location_address,
        locationType: r.location_type,
        locationCoordinates: r.location_coordinates,
        createdAt: r.created_at,
        customCoordinates: parsedCustomCoords,
      };
    } else {
      // Khi đã kết nối DB PostgreSQL thật, không tìm thấy thì báo 404, không tìm trong mock in-memory
      const notFoundErr = new Error(`Không tìm thấy lô hàng ${normalizedCode}`);
      notFoundErr.statusCode = 404;
      notFoundErr.code = "LOT_NOT_FOUND";
      throw notFoundErr;
    }
  } else {
    // Chỉ fallback in-memory khi không có kết nối DB (môi trường test in-memory / unit test)
    const foundLot = inMemoryLots.find(
      (l) => l.id && l.id.toUpperCase() === normalizedCode.toUpperCase()
    );
    if (foundLot) {
      const farmObj = inMemoryFarms.find(
        (f) => f.id === (foundLot.farmId || foundLot.farm_id)
      );
      const prodObj = inMemoryProducts.find(
        (p) => p.id === (foundLot.productId || foundLot.product_id)
      );
      const locObj = inMemoryLocations.find(
        (loc) => loc.id === (foundLot.locationId || foundLot.location_id)
      );
      const orgId = foundLot.organizationId || foundLot.organization_id;

      lotRecord = {
        id: foundLot.id,
        code: foundLot.id,
        name: foundLot.name,
        status: foundLot.status || "Đã thu hoạch",
        organizationId: orgId,
        organizationName: getSafePublicOrgName(null, orgId, orgMap, "Đơn vị sản xuất"),
        farmId: farmObj ? farmObj.id : null,
        farmName: farmObj ? farmObj.name : null,
        farmArea: farmObj && farmObj.area !== undefined ? Number(farmObj.area) : null,
        farmCoordinates: farmObj ? farmObj.coordinates : null,
        productId: prodObj ? prodObj.id : foundLot.productId,
        productName: prodObj ? prodObj.name : (foundLot.productName || foundLot.name),
        productUnit: prodObj ? prodObj.unit : (foundLot.productUnit || "kg"),
        initialQuantity: foundLot.initialQuantity !== undefined ? Number(foundLot.initialQuantity) : (foundLot.initial_quantity ? Number(foundLot.initial_quantity) : null),
        remainingQuantity: foundLot.remainingQuantity !== undefined ? Number(foundLot.remainingQuantity) : (foundLot.remaining_quantity ? Number(foundLot.remaining_quantity) : null),
        harvestedAt: foundLot.harvestedAt || foundLot.harvested_at || null,
        parentLotId: foundLot.parentLotId || foundLot.parent_lot_id || null,
        locationId: locObj ? locObj.id : (foundLot.locationId || foundLot.location_id || null),
        locationName: locObj ? locObj.name : null,
        locationAddress: locObj ? locObj.address : null,
        locationType: locObj ? locObj.locationType : null,
        locationCoordinates: locObj ? locObj.coordinates : null,
        createdAt: foundLot.createdAt || foundLot.created_at || null,
        customCoordinates: foundLot.customCoordinates || foundLot.custom_coordinates || null,
      };
    }
  }

  if (!lotRecord) {
    const notFoundErr = new Error(`Không tìm thấy lô hàng ${normalizedCode}`);
    notFoundErr.statusCode = 404;
    notFoundErr.code = "LOT_NOT_FOUND";
    throw notFoundErr;
  }

  // 2. Tái sử dụng traceLotOrigins để truy xuất toàn bộ các vùng trồng gốc (S-21)
  const originsTrace = await traceLotOrigins(pool, lotRecord.id, {
    inMemoryLots,
    inMemoryBatchRelations,
    inMemoryFarms,
  });

  const rootLots = originsTrace.rootLots || [];
  const isMerged = !originsTrace.isRoot && rootLots.length > 1;

  // 3. Tải trước danh mục public_map_areas theo nhóm để chống lỗi N+1 query
  let preloadedAreas = null;
  if (pool && typeof pool.query === "function") {
    try {
      const areasRes = await pool.query(
        "SELECT id, name, admin_level, commune, district, province, latitude, longitude, keywords FROM public_map_areas"
      );
      preloadedAreas = areasRes ? areasRes.rows : [];
    } catch (areaErr) {
      console.error("[getPublicLotMapData Preload Areas Error]:", areaErr.message);
    }
  }

  // Xây dựng danh sách Vùng trồng gốc an toàn (Origins)
  const origins = [];
  const seenFarms = new Set();

  for (const root of rootLots) {
    const farmId = root.farmId || (root.farm ? root.farm.id : null);
    const farmObj = root.farm || inMemoryFarms.find((f) => f.id === farmId) || null;
    const farmKey = farmId || root.id;

    if (!seenFarms.has(farmKey)) {
      seenFarms.add(farmKey);
      const representativeArea = await resolveRepresentativeArea(pool, farmObj, DEFAULT_MAP_AREAS, preloadedAreas);

      origins.push({
        farmName: farmObj ? farmObj.name : (root.farmName || "Vùng canh tác ban đầu"),
        area: farmObj && farmObj.area !== undefined && farmObj.area !== null ? Number(farmObj.area) : null,
        organizationName: getSafePublicOrgName(root.organizationName, root.organizationId, orgMap, "Hợp tác xã sản xuất"),
        regionName: representativeArea.regionName,
        commune: representativeArea.commune || null,
        district: representativeArea.district || null,
        province: representativeArea.province || null,
        coordinates: representativeArea.coordinates, // Tọa độ đại diện cấp xã, KHÔNG PHẢI tọa độ thửa gốc
        hasCoordinates: representativeArea.hasCoordinates,
        verified: representativeArea.verified,
        harvestedAt: root.harvestedAt || root.harvested_at || root.createdAt || null,
      });
    }
  }

  // Nếu lô gốc không gắn farm hoặc danh sách rỗng, tạo mốc mặc định an toàn
  if (origins.length === 0) {
    origins.push({
      farmName: lotRecord.farmName || "Khu vực sản xuất ban đầu",
      area: lotRecord.farmArea || null,
      organizationName: lotRecord.organizationName,
      regionName: "Vùng trồng chưa định vị tọa độ",
      coordinates: null,
      hasCoordinates: false,
      verified: false,
      harvestedAt: lotRecord.harvestedAt || lotRecord.createdAt,
    });
  }

  // 4. Đọc lịch sử di chuyển và sự kiện vi phạm nhiệt độ (S-15, S-16, S-30, S-45, S-49)
  // Lấy danh sách ID của lô hiện tại và các lô tổ tiên trực tiếp để thu thập lịch sử
  const relevantLotIds = [lotRecord.id, ...(originsTrace.ancestorIds || [])];

  let allLoadedEvents = [];
  if (pool && typeof pool.query === "function") {
    const eventsRes = await pool.query(
      `SELECT 
        id, batch_id, sequence_no, event_type, payload, organization_id, occurred_at
      FROM batch_events
      WHERE batch_id = ANY($1) 
        AND event_type IN ('LOCATION_CHANGED', 'TRANSFER_CONFIRMED', 'TEMPERATURE_VIOLATION')
      ORDER BY occurred_at ASC, sequence_no ASC`,
      [relevantLotIds]
    );
    allLoadedEvents = eventsRes.rows.map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      sequenceNo: r.sequence_no,
      eventType: r.event_type,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      organizationId: r.organization_id,
      occurredAt: r.occurred_at,
    }));
  } else {
    allLoadedEvents = inMemoryBatchEvents
      .filter(
        (e) =>
          relevantLotIds.includes(e.batchId || e.batch_id) &&
          ["LOCATION_CHANGED", "TRANSFER_CONFIRMED", "TEMPERATURE_VIOLATION"].includes(e.eventType || e.event_type)
      )
      .map((e) => ({
        id: e.id,
        batchId: e.batchId || e.batch_id,
        sequenceNo: e.sequenceNo || e.sequence_no,
        eventType: e.eventType || e.event_type,
        payload: e.payload,
        organizationId: e.organizationId || e.organization_id,
        occurredAt: e.occurredAt || e.created_at || new Date().toISOString(),
      }))
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  }

  const rawEvents = allLoadedEvents.filter((e) => e.eventType !== "TEMPERATURE_VIOLATION");
  const violationEvents = allLoadedEvents.filter((e) => e.eventType === "TEMPERATURE_VIOLATION");

  // Kiểm tra thêm bảng temperature_violations trên PostgreSQL nếu có
  let dbViolations = [];
  if (pool && typeof pool.query === "function") {
    try {
      const tvRes = await pool.query(
        `SELECT tv.id, tv.shipment_id, tv.threshold, tv.start_time, tv.end_time, 
                tv.duration_minutes, tv.peak_temperature, tv.rule, tv.status
         FROM temperature_violations tv
         JOIN shipment_lots sl ON tv.shipment_id = sl.shipment_id
         WHERE sl.lot_id = ANY($1)
         ORDER BY tv.start_time ASC`,
        [relevantLotIds]
      );
      dbViolations = tvRes.rows || [];
    } catch {
      dbViolations = [];
    }
  }

  // 4a. Tổng hợp thông tin vi phạm chuỗi lạnh (Story S-49 / N2-114)
  const allViolationItems = [];
  const seenViolationKeys = new Set();

  for (const ve of violationEvents) {
    const p = ve.payload || {};
    const vId = p.violationId || ve.id;
    if (!seenViolationKeys.has(vId)) {
      seenViolationKeys.add(vId);
      allViolationItems.push({
        id: vId,
        occurredAt: ve.occurredAt || p.startTime || p.endTime,
        peakTemperature: p.peakTemperature !== undefined ? Number(p.peakTemperature) : null,
        threshold: p.threshold !== undefined ? Number(p.threshold) : null,
        durationMinutes: p.durationMinutes !== undefined ? Number(p.durationMinutes) : (p.durationSeconds ? Number((p.durationSeconds / 60).toFixed(1)) : null),
        rule: p.rule || "Vượt ngưỡng nhiệt độ bảo quản",
        shipmentId: p.shipmentId || null,
      });
    }
  }

  for (const tv of dbViolations) {
    if (!seenViolationKeys.has(tv.id)) {
      seenViolationKeys.add(tv.id);
      allViolationItems.push({
        id: tv.id,
        occurredAt: tv.start_time || tv.end_time,
        peakTemperature: tv.peak_temperature !== null && tv.peak_temperature !== undefined ? Number(tv.peak_temperature) : null,
        threshold: tv.threshold !== null && tv.threshold !== undefined ? Number(tv.threshold) : null,
        durationMinutes: tv.duration_minutes !== null && tv.duration_minutes !== undefined ? Number(tv.duration_minutes) : null,
        rule: tv.rule || "Vượt ngưỡng nhiệt độ bảo quản",
        shipmentId: tv.shipment_id || null,
      });
    }
  }

  let coldChainInfo = {
    hasViolation: false,
    violationCount: 0,
    firstViolationAt: null,
    lastViolationAt: null,
    peakTemperature: null,
    rule: null,
    durationMinutes: null,
    message: null,
  };

  if (allViolationItems.length > 0) {
    const count = allViolationItems.length;
    allViolationItems.sort((a, b) => new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime());
    const firstAt = allViolationItems[0].occurredAt;
    const lastAt = allViolationItems[allViolationItems.length - 1].occurredAt;

    let maxPeak = null;
    let maxDur = 0;
    for (const v of allViolationItems) {
      if (v.peakTemperature !== null && (maxPeak === null || v.peakTemperature > maxPeak)) {
        maxPeak = v.peakTemperature;
      }
      if (v.durationMinutes && v.durationMinutes > maxDur) {
        maxDur = v.durationMinutes;
      }
    }

    const peakMsg = maxPeak !== null
      ? ` (nhiệt độ đỉnh: ${maxPeak}°C${maxDur > 0 ? `, kéo dài ${maxDur} phút` : ""})`
      : "";

    coldChainInfo = {
      hasViolation: true,
      violationCount: count,
      firstViolationAt: firstAt,
      lastViolationAt: lastAt,
      peakTemperature: maxPeak,
      rule: allViolationItems[0].rule || "Vượt ngưỡng nhiệt độ bảo quản",
      durationMinutes: maxDur,
      message: `Lô hàng từng ghi nhận ${count} lần vi phạm nhiệt độ bảo quản trong quá trình vận chuyển chuỗi lạnh${peakMsg}.`,
    };
  }

  // 4b. Kiểm tra trạng thái thu hồi của lô hàng (Story S-49 / N2-114)
  let recallInfo = {
    isRecalled: false,
    status: "NONE",
    reason: null,
    recallOrderId: null,
  };

  try {
    const recallCheck = await checkLotRecallStatus({
      lotId: lotRecord.id,
      lot: lotRecord,
      pool,
      inMemoryRecallOrders,
      inMemoryLots,
    });

    const isProblemLot = Boolean(
      recallCheck.isBlocked ||
      lotRecord.status === "Có sự cố" ||
      lotRecord.status === "Đang thu hồi" ||
      lotRecord.status === "Đã thu hồi"
    );

    if (isProblemLot) {
      recallInfo = {
        isRecalled: true,
        status: recallCheck.status || lotRecord.status || "RECALLED",
        reason: recallCheck.message || `Lô nông sản ${lotRecord.code} đang thuộc diện thu hồi do cảnh báo sự cố chất lượng.`,
        recallOrderId: recallCheck.recallOrderId || null,
      };
    } else {
      // Kiểm tra các lô nguồn gốc / tổ tiên trực tiếp
      for (const aId of relevantLotIds) {
        if (aId === lotRecord.id) continue;
        const aCheck = await checkLotRecallStatus({
          lotId: aId,
          pool,
          inMemoryRecallOrders,
          inMemoryLots,
        });
        if (aCheck.isBlocked) {
          recallInfo = {
            isRecalled: true,
            status: aCheck.status || "RECALLED",
            reason: `Lô nguồn gốc ${aId} của sản phẩm này đang thuộc diện thu hồi: ${aCheck.message || aCheck.blockReason}`,
            recallOrderId: aCheck.recallOrderId || null,
          };
          break;
        }
      }
    }
  } catch (recErr) {
    console.error("[getPublicLotMapData recall check error]:", recErr.message);
  }

  let safetyStatus = "VERIFIED_SAFE";
  if (recallInfo.isRecalled) {
    safetyStatus = "RECALLED";
  } else if (coldChainInfo.hasViolation) {
    safetyStatus = "TEMPERATURE_VIOLATED";
  }

  // 5. Chuẩn bị danh sách các mốc hành trình (Journey Milestones) theo thứ tự
  const journey = [];
  let currentStep = 1;

  // Thêm mốc (hoặc các mốc) vùng trồng gốc vào đầu hành trình
  for (const origin of origins) {
    journey.push({
      step: currentStep++,
      type: "farm",
      typeLabel: "Vùng trồng nông sản",
      title: origin.farmName,
      locationName: origin.farmName,
      organizationName: origin.organizationName,
      address: [origin.commune, origin.district, origin.province].filter(Boolean).join(", ") || origin.regionName,
      coordinates: origin.coordinates,
      hasCoordinates: origin.hasCoordinates,
      verified: origin.verified,
      occurredAt: origin.harvestedAt,
      description: `Thu hoạch nông sản an toàn tại ${origin.regionName}`,
      isOrigin: true,
    });
  }

  // Duyệt qua các sự kiện di chuyển và lưu kho thực tế
  const seenLocationStops = new Set();

  for (const ev of rawEvents) {
    if (ev.eventType === "LOCATION_CHANGED") {
      const locId = ev.payload.newLocationId || ev.payload.locationId;
      let locObj = null;

      if (locId) {
        locObj = await getLocationById(pool, inMemoryLocations, locId);
      }

      const locName = locObj ? locObj.name : (ev.payload.locationName || "Điểm lưu kho bảo quản");
      const locAddress = locObj ? locObj.address : (ev.payload.address || null);
      const locType = locObj ? locObj.locationType : (ev.payload.locationType || "warehouse");
      const locCoords = locObj ? parseCoordinates(locObj.coordinates) : parseCoordinates(ev.payload.coordinates);

      const stopKey = `${locId || locName}::${ev.occurredAt}`;
      if (!seenLocationStops.has(stopKey)) {
        seenLocationStops.add(stopKey);
        journey.push({
          step: currentStep++,
          type: locType,
          typeLabel: getLocationTypeLabel(locType),
          title: locName,
          locationName: locName,
          organizationName: getSafePublicOrgName(null, ev.organizationId, orgMap, "Đơn vị lưu kho chuỗi lạnh"),
          address: locAddress,
          coordinates: locCoords,
          hasCoordinates: Boolean(locCoords),
          verified: Boolean(locCoords),
          occurredAt: ev.occurredAt,
          description: `Lưu kho bảo quản tại ${locName}`,
          isOrigin: false,
        });
      }
    } else if (ev.eventType === "TRANSFER_CONFIRMED") {
      const fromOrg = getSafePublicOrgName(ev.payload.fromOrganizationName, ev.payload.fromOrganizationId, orgMap, "Bên giao");
      const toOrg = getSafePublicOrgName(ev.payload.toOrganizationName, ev.payload.toOrganizationId, orgMap, "Bên nhận");
      const stepHasViolation = coldChainInfo.hasViolation && (
        ev.payload.hasViolation ||
        allViolationItems.some((v) => v.shipmentId && (v.shipmentId === ev.payload?.shipmentId || v.shipmentId === ev.payload?.transferId))
      );
      journey.push({
        step: currentStep++,
        type: "transit",
        typeLabel: "Bàn giao vận chuyển chuỗi lạnh",
        title: `Bàn giao vận chuyển: ${fromOrg} ➔ ${toOrg}`,
        locationName: "Điểm bàn giao chuỗi lạnh",
        organizationName: toOrg,
        address: "Hành trình vận chuyển chuyên dụng giữa các đối tác",
        coordinates: null,
        hasCoordinates: false,
        verified: false,
        occurredAt: ev.occurredAt,
        description: stepHasViolation ? "Bàn giao vận chuyển chuỗi lạnh (từng ghi nhận sự cố nhiệt độ)" : "Xác nhận bàn giao lô hàng qua chuỗi lạnh an toàn",
        isOrigin: false,
        isTransfer: true,
        hasViolation: Boolean(stepHasViolation),
        warning: stepHasViolation ? "Ghi nhận vi phạm nhiệt độ bảo quản trong chặng vận chuyển này" : null,
      });
    }
  }

  // Nếu lô hiện tại có vị trí hiện tại (location_id) mà chưa từng xuất hiện trong toàn bộ hành trình
  if (lotRecord.locationId) {
    const alreadyVisited = journey.some((s) => s.locationName === lotRecord.locationName || s.title === lotRecord.locationName);

    if (!alreadyVisited) {
      let curLoc = null;
      if (pool && typeof pool.query === "function") {
        curLoc = await getLocationById(pool, inMemoryLocations, lotRecord.locationId);
      } else {
        curLoc = inMemoryLocations.find((l) => l.id === lotRecord.locationId);
      }

      const curCoords = curLoc ? parseCoordinates(curLoc.coordinates) : parseCoordinates(lotRecord.locationCoordinates);
      const locType = curLoc ? curLoc.locationType : (lotRecord.locationType || "store");
      const locName = curLoc ? curLoc.name : (lotRecord.locationName || "Điểm lưu kho bảo quản");

      // Lấy thời gian từ sự kiện chuyển kho thực tế thay vì lấy ngày tạo lô (Issue 11)
      const locEvent = [...rawEvents].reverse().find(
        (e) => (e.payload && (e.payload.newLocationId === lotRecord.locationId || e.payload.locationId === lotRecord.locationId))
      );
      const arrivalTime = locEvent ? locEvent.occurredAt : null;

      journey.push({
        step: currentStep++,
        type: locType,
        typeLabel: getLocationTypeLabel(locType),
        title: locName,
        locationName: locName,
        organizationName: lotRecord.organizationName,
        address: curLoc ? curLoc.address : (lotRecord.locationAddress || null),
        coordinates: curCoords,
        hasCoordinates: Boolean(curCoords),
        verified: Boolean(curCoords),
        occurredAt: arrivalTime,
        description: `Vị trí hiện tại của lô hàng: ${locName}`,
        isOrigin: false,
        isCurrentLocation: true,
      });
    }
  }

  // Hỗ trợ tọa độ gán thủ công / tùy chỉnh (Choice A - Story S-60)
  if (lotRecord.customCoordinates) {
    const rawCoords = lotRecord.customCoordinates.coordinates || lotRecord.customCoordinates;
    const customCoords = parseCoordinates(rawCoords);
    if (customCoords) {
      const customTitle = lotRecord.customCoordinates.name || (lotRecord.name ? `Vùng trồng ${lotRecord.name}` : "Vùng trồng đã định vị");
      const customType = lotRecord.customCoordinates.type || "farm";

      if (origins.length > 0 && !origins[0].hasCoordinates) {
        origins[0].coordinates = customCoords;
        origins[0].hasCoordinates = true;
        origins[0].verified = true;
        origins[0].farmName = customTitle;
        origins[0].regionName = customTitle;
      } else if (origins.length === 0) {
        origins.push({
          farmName: customTitle,
          regionName: customTitle,
          coordinates: customCoords,
          hasCoordinates: true,
          verified: true,
          harvestedAt: lotRecord.harvestedAt || new Date().toISOString(),
        });
      }

      const unlocatedOrigin = journey.find((s) => s.isOrigin && !s.hasCoordinates);
      if (unlocatedOrigin) {
        unlocatedOrigin.coordinates = customCoords;
        unlocatedOrigin.hasCoordinates = true;
        unlocatedOrigin.verified = true;
        unlocatedOrigin.title = customTitle;
        unlocatedOrigin.locationName = customTitle;
        unlocatedOrigin.type = customType;
        unlocatedOrigin.typeLabel = getLocationTypeLabel(customType);
        unlocatedOrigin.address = lotRecord.customCoordinates.address || unlocatedOrigin.address || `${customCoords.lat.toFixed(4)}, ${customCoords.lng.toFixed(4)}`;
      } else {
        const alreadyHas = journey.some((s) => s.coordinates && Math.abs(s.coordinates.lat - customCoords.lat) < 0.0001 && Math.abs(s.coordinates.lng - customCoords.lng) < 0.0001);
        if (!alreadyHas) {
          journey.push({
            step: currentStep++,
            type: customType,
            typeLabel: getLocationTypeLabel(customType),
            title: customTitle,
            locationName: customTitle,
            organizationName: lotRecord.organizationName,
            address: lotRecord.customCoordinates.address || `${customCoords.lat.toFixed(4)}, ${customCoords.lng.toFixed(4)}`,
            coordinates: customCoords,
            hasCoordinates: true,
            verified: true,
            occurredAt: lotRecord.harvestedAt || new Date().toISOString(),
            description: `Định vị tọa độ: ${customCoords.lat.toFixed(4)}, ${customCoords.lng.toFixed(4)}`,
            isOrigin: customType === "farm",
            isCurrentLocation: true,
          });
        }
      }
    }
  }

  // Bổ sung các mốc sự kiện vi phạm nhiệt độ chuỗi lạnh vào dòng thời gian (Story S-49 / N2-114)
  for (const vItem of allViolationItems) {
    journey.push({
      step: currentStep++,
      type: "transit",
      typeLabel: "Cảnh báo vi phạm chuỗi lạnh",
      title: "Sự cố vi phạm nhiệt độ chuỗi lạnh",
      locationName: "Chặng vận chuyển chuỗi lạnh",
      organizationName: lotRecord.organizationName,
      address: "Hành trình vận chuyển chuyên dụng",
      coordinates: null,
      hasCoordinates: false,
      verified: false,
      occurredAt: vItem.occurredAt,
      description: `Nhiệt độ đạt đỉnh ${vItem.peakTemperature !== null ? vItem.peakTemperature : "---"}°C${vItem.threshold !== null ? ` (ngưỡng quy định: ${vItem.threshold}°C)` : ""}${vItem.durationMinutes ? `, kéo dài ${vItem.durationMinutes} phút` : ""}.`,
      isOrigin: false,
      hasViolation: true,
      warning: "Vi phạm nhiệt độ chuỗi lạnh",
    });
  }

  // Đánh lại số thứ tự bước hành trình chuẩn xác
  journey.forEach((item, idx) => {
    item.step = idx + 1;
  });

  // 6. Xây dựng các đoạn đường nối sơ đồ hóa (Schematic Routes)
  // Chỉ nối các điểm đã được xác minh tọa độ (verified). Không nối trực tiếp các nhánh độc lập trước khi gộp.
  const routes = [];
  const locatedStops = journey.filter((s) => s.hasCoordinates && s.coordinates && s.verified);

  if (locatedStops.length >= 2) {
    const originLocatedStops = locatedStops.filter((s) => s.isOrigin);
    const nonOriginLocatedStops = locatedStops.filter((s) => !s.isOrigin);

    if (originLocatedStops.length > 1 && nonOriginLocatedStops.length > 0) {
      // Đối với lô gộp đa nguồn:
      // Từng vùng trồng gốc nối vào điểm dừng trung chuyển/chế biến đầu tiên đã xác minh
      const firstCommonStop = nonOriginLocatedStops[0];
      for (const orig of originLocatedStops) {
        routes.push({
          fromStep: orig.step,
          toStep: firstCommonStop.step,
          fromTitle: orig.title,
          toTitle: firstCommonStop.title,
          isSchematic: true,
          coordinates: [
            [orig.coordinates.lng, orig.coordinates.lat],
            [firstCommonStop.coordinates.lng, firstCommonStop.coordinates.lat],
          ],
        });
      }

      // Nối tiếp các điểm dừng tiếp theo theo thứ tự tuyến tính
      for (let i = 0; i < nonOriginLocatedStops.length - 1; i++) {
        const from = nonOriginLocatedStops[i];
        const to = nonOriginLocatedStops[i + 1];
        routes.push({
          fromStep: from.step,
          toStep: to.step,
          fromTitle: from.title,
          toTitle: to.title,
          isSchematic: true,
          coordinates: [
            [from.coordinates.lng, from.coordinates.lat],
            [to.coordinates.lng, to.coordinates.lat],
          ],
        });
      }
    } else if (originLocatedStops.length <= 1) {
      // Trường hợp tuyến tính thông thường
      for (let i = 0; i < locatedStops.length - 1; i++) {
        const from = locatedStops[i];
        const to = locatedStops[i + 1];
        routes.push({
          fromStep: from.step,
          toStep: to.step,
          fromTitle: from.title,
          toTitle: to.title,
          isSchematic: true,
          coordinates: [
            [from.coordinates.lng, from.coordinates.lat],
            [to.coordinates.lng, to.coordinates.lat],
          ],
        });
      }
    }
  }

  // 7. Thống kê tổng hợp & kiểm tra an toàn dữ liệu
  const verifiedCount = journey.filter((s) => s.hasCoordinates && s.verified).length;
  const unlocatedCount = journey.length - verifiedCount;

  const rawData = {
    lot: {
      code: lotRecord.code || lotRecord.id,
      name: lotRecord.name,
      status: lotRecord.status,
      productName: lotRecord.productName,
      productUnit: lotRecord.productUnit,
      organizationName: lotRecord.organizationName,
      harvestedAt: lotRecord.harvestedAt,
      isMerged,
      recall: recallInfo,
      coldChain: coldChainInfo,
      safetyStatus,
    },
    origins,
    journey,
    routes,
    summary: {
      totalOrigins: origins.length,
      totalStops: journey.length,
      verifiedStops: verifiedCount,
      unverifiedStops: unlocatedCount,
      hasUnlocatedStops: unlocatedCount > 0,
      isSchematic: true,
      disclaimer: "Tọa độ vùng trồng hiển thị theo tâm khu vực hành chính (xã/phường) nhằm bảo vệ quyền riêng tư nông hộ. Các tuyến đường trên bản đồ mang tính chất sơ đồ hóa chuỗi cung ứng, không phải định vị GPS thời gian thực.",
    },
  };

  return sanitizePublicTracePayload(rawData);
}

/**
 * Hàm lọc an toàn dữ liệu công khai theo cơ chế Whitelisting nghiêm ngặt (Story S-48)
 * Loại bỏ toàn bộ các trường nội bộ, số điện thoại, thông tin định danh người dùng, biển số xe,
 * và các thông tin nhạy cảm khác trước khi trả về cho người tiêu dùng.
 */
function sanitizePublicTracePayload(data) {
  if (!data || typeof data !== "object") return data;

  const sanitizeObject = (obj, allowedKeys) => {
    if (!obj || typeof obj !== "object") return null;
    const sanitized = {};
    for (const key of allowedKeys) {
      if (obj[key] !== undefined) {
        sanitized[key] = obj[key];
      }
    }
    return sanitized;
  };

  const sanitizeCoords = (coords) => {
    if (!coords || typeof coords !== "object") return null;
    const lat = Number(coords.lat);
    const lng = Number(coords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  };

  const lot = sanitizeObject(data.lot, [
    "code",
    "name",
    "status",
    "productName",
    "productUnit",
    "organizationName",
    "harvestedAt",
    "isMerged",
    "recall",
    "coldChain",
    "safetyStatus",
  ]);

  if (lot && lot.recall) {
    lot.recall = sanitizeObject(lot.recall, [
      "isRecalled",
      "status",
      "reason",
      "recallOrderId",
    ]);
  }

  if (lot && lot.coldChain) {
    lot.coldChain = sanitizeObject(lot.coldChain, [
      "hasViolation",
      "violationCount",
      "firstViolationAt",
      "lastViolationAt",
      "peakTemperature",
      "rule",
      "durationMinutes",
      "message",
    ]);
  }

  const origins = Array.isArray(data.origins)
    ? data.origins.map((orig) => {
        const item = sanitizeObject(orig, [
          "farmName",
          "area",
          "organizationName",
          "regionName",
          "commune",
          "district",
          "province",
          "coordinates",
          "hasCoordinates",
          "verified",
          "harvestedAt",
        ]);
        if (item && item.coordinates) {
          item.coordinates = sanitizeCoords(item.coordinates);
        }
        return item;
      })
    : [];

  const journey = Array.isArray(data.journey)
    ? data.journey.map((stop) => {
        const item = sanitizeObject(stop, [
          "step",
          "type",
          "typeLabel",
          "title",
          "locationName",
          "organizationName",
          "address",
          "coordinates",
          "hasCoordinates",
          "verified",
          "occurredAt",
          "description",
          "isOrigin",
          "isTransfer",
          "isCurrentLocation",
          "hasViolation",
          "warning",
        ]);
        if (item && item.coordinates) {
          item.coordinates = sanitizeCoords(item.coordinates);
        }
        return item;
      })
    : [];

  const routes = Array.isArray(data.routes)
    ? data.routes.map((rt) => {
        const item = sanitizeObject(rt, [
          "fromStep",
          "toStep",
          "fromTitle",
          "toTitle",
          "isSchematic",
          "coordinates",
        ]);
        if (item && Array.isArray(item.coordinates)) {
          item.coordinates = item.coordinates
            .filter((pair) => Array.isArray(pair) && pair.length === 2)
            .map(([lng, lat]) => [Number(lng), Number(lat)]);
        }
        return item;
      })
    : [];

  const summary = sanitizeObject(data.summary, [
    "totalOrigins",
    "totalStops",
    "verifiedStops",
    "unverifiedStops",
    "hasUnlocatedStops",
    "isSchematic",
    "disclaimer",
  ]);

  return {
    lot,
    origins,
    journey,
    routes,
    summary,
  };
}

module.exports = {
  getPublicLotMapData,
  resolveRepresentativeArea,
  parseCoordinates,
  sanitizePublicTracePayload,
  DEFAULT_MAP_AREAS,
};
