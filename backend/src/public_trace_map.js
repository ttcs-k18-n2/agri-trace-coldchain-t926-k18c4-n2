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
    latitude: 21.5645,
    longitude: 105.6789,
    keywords: ["la bằng", "la bang", "đồi chè", "doi che", "labang"],
    description: "Tâm xã La Bằng, vùng chỉ dẫn địa lý chè Đại Từ",
  },
  {
    id: "AREA-HUNG-SON",
    name: "Vùng trồng rau củ an toàn Hùng Sơn",
    commune: "Hùng Sơn",
    district: "Đại Từ",
    province: "Thái Nguyên",
    latitude: 21.5712,
    longitude: 105.6841,
    keywords: ["hùng sơn", "hung son", "cà chua", "ca chua", "hungson"],
    description: "Khu vực sản xuất nông nghiệp công nghệ cao Hùng Sơn",
  },
  {
    id: "AREA-TAN-CUONG",
    name: "Vùng chỉ dẫn địa lý Chè Tân Cương",
    commune: "Tân Cương",
    district: "TP Thái Nguyên",
    province: "Thái Nguyên",
    latitude: 21.545,
    longitude: 105.772,
    keywords: ["tân cương", "tan cuong", "chè tân cương", "che tan cuong"],
    description: "Vùng chè đặc sản Tân Cương Thái Nguyên",
  },
  {
    id: "AREA-YEN-DUNG",
    name: "Vùng chuyên canh rau sạch Yên Dũng",
    commune: "Nham Biền",
    district: "Yên Dũng",
    province: "Bắc Giang",
    latitude: 21.2341,
    longitude: 106.1892,
    keywords: ["yên dũng", "yen dung", "nham biền", "nham bien", "rau cải", "yendung"],
    description: "Khu vực cánh đồng mẫu lớn huyện Yên Dũng",
  },
  {
    id: "AREA-HIEP-HOA",
    name: "Vùng trồng nông sản Hiệp Hòa",
    commune: "Hiệp Hòa",
    district: "Hiệp Hòa",
    province: "Bắc Giang",
    latitude: 21.3415,
    longitude: 105.981,
    keywords: ["hiệp hòa", "hiep hoa", "dưa chuột", "dua chuot", "hiephoa"],
    description: "Vùng trồng dưa và rau quả sạch Hiệp Hòa",
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
  if (typeof raw === "object" && raw.lat !== undefined && raw.lng !== undefined) {
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      return { lat, lng };
    }
    return null;
  }
  if (typeof raw === "string") {
    const parts = raw.split(",").map((p) => Number(p.trim()));
    if (parts.length === 2 && !Number.isNaN(parts[0]) && !Number.isNaN(parts[1])) {
      return { lat: parts[0], lng: parts[1] };
    }
  }
  return null;
}

/**
 * Tìm tọa độ đại diện cấp xã / khu vực cho vùng trồng (S-06 / N2-290)
 * Tuyệt đối không trả về tọa độ thửa gốc chi tiết nhằm bảo vệ vị trí đất riêng tư của nông dân.
 */
async function resolveRepresentativeArea(pool, farm, customAreas = DEFAULT_MAP_AREAS) {
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
  const searchTarget = `${farmName} ${farmAddress}`;

  // 1. Thử tìm trong bảng public_map_areas nếu kết nối PostgreSQL
  if (pool && typeof pool.query === "function") {
    try {
      const dbAreasRes = await pool.query(
        "SELECT id, name, admin_level, commune, district, province, latitude, longitude, keywords FROM public_map_areas"
      );
      if (dbAreasRes && dbAreasRes.rows.length > 0) {
        for (const row of dbAreasRes.rows) {
          const kws = (row.keywords || "").split(",").map((k) => k.trim().toLowerCase());
          const matchKeyword = kws.some((k) => k && searchTarget.includes(k));
          const matchName = searchTarget.includes(row.name.toLowerCase());
          if (matchKeyword || matchName) {
            return {
              regionName: row.name,
              commune: row.commune,
              district: row.district,
              province: row.province,
              coordinates: {
                lat: Number(row.latitude),
                lng: Number(row.longitude),
              },
              hasCoordinates: true,
              verified: true,
              adminLevel: row.admin_level || "commune",
            };
          }
        }
      }
    } catch {
      // Fallback in-memory nếu bảng chưa sẵn sàng
    }
  }

  // 2. Tra cứu trong danh mục default in-memory areas
  for (const area of customAreas) {
    const matchKeyword = (area.keywords || []).some((kw) => searchTarget.includes(kw.toLowerCase()));
    const matchName = searchTarget.includes(area.name.toLowerCase());
    if (matchKeyword || matchName) {
      return {
        regionName: area.name,
        commune: area.commune,
        district: area.district,
        province: area.province,
        coordinates: {
          lat: Number(area.latitude),
          lng: Number(area.longitude),
        },
        hasCoordinates: true,
        verified: true,
        adminLevel: area.adminLevel || "commune",
      };
    }
  }

  // 3. Nếu không khớp danh mục nhưng có tọa độ thửa đất:
  // Làm mờ tọa độ về cấp xã (làm tròn 2 chữ số thập phân ~1.1km) để bảo vệ quyền riêng tư
  const rawCoords = parseCoordinates(farm.coordinates);
  if (rawCoords) {
    const blurredLat = Number(rawCoords.lat.toFixed(2));
    const blurredLng = Number(rawCoords.lng.toFixed(2));
    return {
      regionName: `Khu vực sản xuất ${farm.name || "Nông trại"}`,
      commune: null,
      district: null,
      province: null,
      coordinates: {
        lat: blurredLat,
        lng: blurredLng,
      },
      hasCoordinates: true,
      verified: true,
      adminLevel: "commune_centroid",
    };
  }

  return {
    regionName: farm.name || "Khu vực sản xuất nông sản",
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
      lotRecord = {
        id: r.id,
        code: r.id,
        name: r.name,
        status: r.status,
        organizationId: r.organization_id,
        organizationName: r.organization_name || r.organization_id,
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
      };
    }
  }

  // Fallback in-memory nếu không dùng PostgreSQL hoặc không thấy trong DB
  if (!lotRecord) {
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
        organizationName: orgMap.get(orgId) || orgId,
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

  // 3. Xây dựng danh sách Vùng trồng gốc an toàn (Origins)
  const origins = [];
  const seenFarms = new Set();

  for (const root of rootLots) {
    const farmId = root.farmId || (root.farm ? root.farm.id : null);
    const farmObj = root.farm || inMemoryFarms.find((f) => f.id === farmId) || null;
    const farmKey = farmId || root.id;

    if (!seenFarms.has(farmKey)) {
      seenFarms.add(farmKey);
      const representativeArea = await resolveRepresentativeArea(pool, farmObj);

      origins.push({
        originLotId: root.id,
        farmName: farmObj ? farmObj.name : (root.farmName || "Vùng canh tác ban đầu"),
        area: farmObj && farmObj.area !== undefined && farmObj.area !== null ? Number(farmObj.area) : null,
        organizationName: root.organizationName || orgMap.get(root.organizationId) || root.organizationId || null,
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
      originLotId: lotRecord.id,
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

  // 4. Đọc lịch sử di chuyển thực tế từ TRANSFER_CONFIRMED và LOCATION_CHANGED (S-15, S-16, S-30)
  // Lấy danh sách ID của lô hiện tại và các lô tổ tiên trực tiếp để thu thập lịch sử
  const relevantLotIds = [lotRecord.id, ...(originsTrace.ancestorIds || [])];

  let rawEvents = [];
  if (pool && typeof pool.query === "function") {
    const eventsRes = await pool.query(
      `SELECT 
        id, batch_id, sequence_no, event_type, payload, organization_id, occurred_at
      FROM batch_events
      WHERE batch_id = ANY($1) 
        AND event_type IN ('LOCATION_CHANGED', 'TRANSFER_CONFIRMED')
      ORDER BY occurred_at ASC, sequence_no ASC`,
      [relevantLotIds]
    );
    rawEvents = eventsRes.rows.map((r) => ({
      id: r.id,
      batchId: r.batch_id,
      sequenceNo: r.sequence_no,
      eventType: r.event_type,
      payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload,
      organizationId: r.organization_id,
      occurredAt: r.occurred_at,
    }));
  } else {
    rawEvents = inMemoryBatchEvents
      .filter(
        (e) =>
          relevantLotIds.includes(e.batchId || e.batch_id) &&
          ["LOCATION_CHANGED", "TRANSFER_CONFIRMED"].includes(e.eventType || e.event_type)
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
      originLotId: origin.originLotId,
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

      const locName = locObj ? locObj.name : (ev.payload.locationName || `Kho #${locId}`);
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
          organizationName: orgMap.get(ev.organizationId) || ev.organizationId,
          address: locAddress,
          coordinates: locCoords,
          hasCoordinates: Boolean(locCoords),
          verified: Boolean(locCoords),
          occurredAt: ev.occurredAt,
          description: ev.payload.step || `Lưu kho bảo quản tại ${locName}`,
          isOrigin: false,
        });
      }
    } else if (ev.eventType === "TRANSFER_CONFIRMED") {
      journey.push({
        step: currentStep++,
        type: "transit",
        typeLabel: "Bàn giao vận chuyển chuỗi lạnh",
        title: `Tiếp nhận bàn giao: ${ev.payload.fromOrganizationName || "Bên gửi"} ➔ ${ev.payload.toOrganizationName || "Bên nhận"}`,
        locationName: "Điểm bàn giao chuỗi lạnh",
        organizationName: ev.payload.toOrganizationName || orgMap.get(ev.organizationId) || ev.organizationId,
        address: "Hành trình vận chuyển giữa các tổ chức đối tác",
        coordinates: null,
        hasCoordinates: false,
        verified: false,
        occurredAt: ev.occurredAt,
        description: ev.payload.notes ? `Ghi chú bàn giao: ${ev.payload.notes}` : "Xác nhận tiếp nhận lô hàng thành công qua hệ thống",
        isOrigin: false,
        isTransfer: true,
      });
    }
  }

  // Nếu lô hiện tại có vị trí hiện tại (location_id) mà chưa xuất hiện ở bước cuối
  if (lotRecord.locationId) {
    const lastStop = journey[journey.length - 1];
    const isAlreadyLast = lastStop && (lastStop.locationName === lotRecord.locationName || lastStop.title === lotRecord.locationName);

    if (!isAlreadyLast) {
      let curLoc = null;
      if (pool && typeof pool.query === "function") {
        curLoc = await getLocationById(pool, inMemoryLocations, lotRecord.locationId);
      } else {
        curLoc = inMemoryLocations.find((l) => l.id === lotRecord.locationId);
      }

      const curCoords = curLoc ? parseCoordinates(curLoc.coordinates) : parseCoordinates(lotRecord.locationCoordinates);
      const locType = curLoc ? curLoc.locationType : (lotRecord.locationType || "store");
      const locName = curLoc ? curLoc.name : (lotRecord.locationName || `Kho #${lotRecord.locationId}`);

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
        occurredAt: lotRecord.createdAt,
        description: `Vị trí hiện tại của lô hàng: ${locName}`,
        isOrigin: false,
        isCurrentLocation: true,
      });
    }
  }

  // 6. Xây dựng các đoạn đường nối (Routes) cho MapLibre GL JS
  // Quy tắc: Chỉ nối các điểm có tọa độ xác minh; đối với lô gộp, các nguồn gộp cùng nối vào điểm kế tiếp, KHÔNG nối trực tiếp với nhau!
  const routes = [];
  const locatedStops = journey.filter((s) => s.hasCoordinates && s.coordinates);

  if (locatedStops.length >= 2) {
    const originLocatedStops = locatedStops.filter((s) => s.isOrigin);
    const nonOriginLocatedStops = locatedStops.filter((s) => !s.isOrigin);

    if (originLocatedStops.length > 1 && nonOriginLocatedStops.length > 0) {
      // Trường hợp lô gộp (Merged Lot):
      // Nối từng vùng trồng gốc vào điểm dừng đầu tiên (thường là kho sơ chế/trung chuyển)
      const firstCommonStop = nonOriginLocatedStops[0];
      for (const orig of originLocatedStops) {
        routes.push({
          fromStep: orig.step,
          toStep: firstCommonStop.step,
          fromTitle: orig.title,
          toTitle: firstCommonStop.title,
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
          coordinates: [
            [from.coordinates.lng, from.coordinates.lat],
            [to.coordinates.lng, to.coordinates.lat],
          ],
        });
      }
    } else {
      // Trường hợp tuyến tính đơn nguồn thông thường
      for (let i = 0; i < locatedStops.length - 1; i++) {
        const from = locatedStops[i];
        const to = locatedStops[i + 1];
        routes.push({
          fromStep: from.step,
          toStep: to.step,
          fromTitle: from.title,
          toTitle: to.title,
          coordinates: [
            [from.coordinates.lng, from.coordinates.lat],
            [to.coordinates.lng, to.coordinates.lat],
          ],
        });
      }
    }
  }

  // 7. Thống kê tổng hợp & kiểm tra an toàn dữ liệu
  const verifiedCount = journey.filter((s) => s.hasCoordinates).length;
  const unlocatedCount = journey.length - verifiedCount;

  return {
    lot: {
      code: lotRecord.code || lotRecord.id,
      name: lotRecord.name,
      status: lotRecord.status,
      productName: lotRecord.productName,
      productUnit: lotRecord.productUnit,
      organizationName: lotRecord.organizationName,
      harvestedAt: lotRecord.harvestedAt,
      isMerged,
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
      disclaimer: "Tọa độ vùng trồng hiển thị theo tâm khu vực hành chính (xã/phường) nhằm bảo vệ quyền riêng tư và vùng sản xuất của nông hộ.",
    },
  };
}

module.exports = {
  getPublicLotMapData,
  resolveRepresentativeArea,
  parseCoordinates,
  DEFAULT_MAP_AREAS,
};
