/**
 * Module quản lý địa điểm, kho bãi, cửa hàng phân phối & bán lẻ (Story S-30)
 * Hỗ trợ lưu trữ cả PostgreSQL và In-Memory cho môi trường kiểm thử.
 */

const inMemoryLocations = [
  {
    id: "LOC-WH-TN-01",
    name: "Kho lạnh Nông trại Thái Nguyên",
    address: "Xã La Bằng, Huyện Đại Từ, Thái Nguyên",
    organizationId: "org-001",
    locationType: "cold_storage",
    contactPerson: "Nguyễn Văn Nông",
    phone: "0912345678",
    coordinates: { lat: 21.5645, lng: 105.6789 },
    createdAt: "2026-09-20T08:00:00.000Z",
  },
  {
    id: "LOC-WH-BG-01",
    name: "Kho trung chuyển HTX Bắc Giang",
    address: "Thị trấn Nham Biền, Huyện Yên Dũng, Bắc Giang",
    organizationId: "org-002",
    locationType: "warehouse",
    contactPerson: "Trần Thị Xã",
    phone: "0923456789",
    coordinates: { lat: 21.2341, lng: 106.1892 },
    createdAt: "2026-09-21T08:00:00.000Z",
  },
  {
    id: "LOC-HUB-HN-01",
    name: "Tổng kho lạnh Logistics Hà Nội",
    address: "KCN Đài Tư, Quận Long Biên, Hà Nội",
    organizationId: "org-trans",
    locationType: "cold_storage",
    contactPerson: "Lê Vận Chuyển",
    phone: "0934567890",
    coordinates: { lat: 21.0356, lng: 105.9012 },
    createdAt: "2026-09-22T08:00:00.000Z",
  },
  {
    id: "LOC-STORE-HN-01",
    name: "Trung tâm Phân phối & Bán lẻ Cầu Giấy",
    address: "123 Đường Cầu Giấy, Quận Cầu Giấy, Hà Nội",
    organizationId: "org-dist",
    locationType: "store",
    contactPerson: "Phạm Phân Phối",
    phone: "0945678901",
    coordinates: { lat: 21.0333, lng: 105.7989 },
    createdAt: "2026-09-23T08:00:00.000Z",
  },
  {
    id: "LOC-STORE-HN-02",
    name: "Điểm bán lẻ Nông sản Sạch Thanh Xuân",
    address: "45 Đường Nguyễn Trãi, Quận Thanh Xuân, Hà Nội",
    organizationId: "org-dist",
    locationType: "store",
    contactPerson: "Hoàng Bán Lẻ",
    phone: "0956789012",
    coordinates: { lat: 20.9981, lng: 105.8152 },
    createdAt: "2026-09-24T08:00:00.000Z",
  },
];

/**
 * Lấy danh sách địa điểm theo quyền tổ chức (S-30)
 */
async function fetchLocations(pool, inMemoryList = inMemoryLocations, organizationId = null) {
  if (pool && typeof pool.query === "function") {
    try {
      let query = `
        SELECT id, name, address, organization_id, location_type, contact_person, phone, coordinates, created_at, updated_at
        FROM locations
      `;
      const values = [];
      if (organizationId) {
        query += " WHERE organization_id = $1";
        values.push(organizationId);
      }
      query += " ORDER BY created_at DESC";

      const res = await pool.query(query, values);
      return res.rows.map((r) => ({
        id: r.id,
        name: r.name,
        address: r.address,
        organizationId: r.organization_id,
        locationType: r.location_type,
        contactPerson: r.contact_person,
        phone: r.phone,
        coordinates: r.coordinates,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    } catch {
      // fallback in-memory
    }
  }

  if (organizationId) {
    return inMemoryList.filter((loc) => loc.organizationId === organizationId);
  }
  return [...inMemoryList];
}

/**
 * Lấy chi tiết một địa điểm theo ID (S-30)
 */
async function getLocationById(pool, inMemoryList = inMemoryLocations, id) {
  if (!id) return null;
  if (pool && typeof pool.query === "function") {
    try {
      const res = await pool.query(
        "SELECT id, name, address, organization_id, location_type, contact_person, phone, coordinates, created_at FROM locations WHERE id = $1",
        [id]
      );
      if (res.rows.length > 0) {
        const r = res.rows[0];
        return {
          id: r.id,
          name: r.name,
          address: r.address,
          organizationId: r.organization_id,
          locationType: r.location_type,
          contactPerson: r.contact_person,
          phone: r.phone,
          coordinates: r.coordinates,
          createdAt: r.created_at,
        };
      }
    } catch {
      // ignore
    }
  }
  return inMemoryList.find((loc) => loc.id === id) || null;
}

/**
 * Tạo địa điểm mới (S-30)
 */
async function createLocation(pool, inMemoryList = inMemoryLocations, data) {
  const id = data.id || `LOC-${Date.now().toString(36).toUpperCase()}`;
  const newLocation = {
    id,
    name: data.name,
    address: data.address || null,
    organizationId: data.organizationId,
    locationType: data.locationType || "warehouse",
    contactPerson: data.contactPerson || null,
    phone: data.phone || null,
    coordinates: data.coordinates || null,
    createdAt: new Date().toISOString(),
  };

  if (pool && typeof pool.query === "function") {
    await pool.query(
      `INSERT INTO locations (
        id, name, address, organization_id, location_type, contact_person, phone, coordinates, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
      [
        newLocation.id,
        newLocation.name,
        newLocation.address,
        newLocation.organizationId,
        newLocation.locationType,
        newLocation.contactPerson,
        newLocation.phone,
        newLocation.coordinates ? JSON.stringify(newLocation.coordinates) : null,
      ]
    );
  }

  inMemoryList.unshift(newLocation);
  return newLocation;
}

/**
 * Gán hoặc cập nhật vị trí lưu kho/điểm bán của lô hàng (S-27 & S-30)
 */
async function updateLotLocation(pool, inMemoryLots = [], lotId, locationId, organizationId = null) {
  if (pool && typeof pool.query === "function") {
    let result;
    if (organizationId) {
      result = await pool.query(
        "UPDATE lots SET location_id = $1 WHERE id = $2 AND organization_id = $3",
        [locationId, lotId, organizationId]
      );
    } else {
      result = await pool.query(
        "UPDATE lots SET location_id = $1 WHERE id = $2 AND ($3::text IS NULL OR organization_id = $3)",
        [locationId, lotId, organizationId]
      );
    }
    if (!result || result.rowCount === 0) {
      return false;
    }
  }

  const lot = inMemoryLots.find((l) => l.id === lotId);
  if (!lot) {
    if (!pool) return false;
  } else {
    if (organizationId && (lot.organizationId || lot.organization_id) !== organizationId) {
      return false;
    }
    lot.locationId = locationId;
  }
  return true;
}

module.exports = {
  inMemoryLocations,
  fetchLocations,
  getLocationById,
  createLocation,
  updateLotLocation,
};
