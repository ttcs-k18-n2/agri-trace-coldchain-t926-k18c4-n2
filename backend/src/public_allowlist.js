/**
 * Danh mục Cho Phép (Allowlist) các trường dữ liệu công khai (Story S-48 / Jira N2-117)
 * 
 * NGUYÊN TẮC BẢO MẬT & PHÂN LOẠI DỮ LIỆU:
 * 1. Default-Deny (Mặc định từ chối): Mọi dữ liệu mặc định là nội bộ.
 *    Chỉ những trường nằm trong danh mục này mới được phép trả về cho người tiêu dùng công khai.
 * 2. Bảo vệ quyền riêng tư & bí mật kinh doanh:
 *    - Tuyệt đối KHÔNG xuất khối lượng hàng hóa (initialQuantity, remainingQuantity, weight, volume).
 *    - Tuyệt đối KHÔNG xuất giá bán, giá nhập (price, importPrice, exportPrice).
 *    - Tên đối tác kinh doanh trung gian CHỈ hiển thị theo loại (Hợp tác xã, Đơn vị vận chuyển, Nhà phân phối, Kho bảo quản).
 *      Ngoại lệ: Tên cơ sở sản xuất / HTX ban đầu tại vùng trồng gốc được công khai theo yêu cầu minh bạch nông sản.
 *    - Tuyệt đối KHÔNG xuất mã định danh nội bộ (UUIDs, user IDs, actor IDs, tokens, emails, phone numbers, driver phones, vehicle plates).
 *    - Tọa độ vùng trồng chỉ dùng tọa độ đại diện cấp xã (S-06 / N2-290), không lộ tọa độ thửa đất riêng tư của nông hộ.
 */

const PUBLIC_LOT_ALLOWLIST = Object.freeze([
  "code",
  "name",
  "status",
  "productName",
  "productUnit",
  "organizationName",       // Tên HTX/Đơn vị sản xuất ban đầu (ngoại lệ vùng trồng theo Jira)
  "organizationType",
  "harvestedAt",
  "isMerged",
  "recall",                 // Story S-49
  "coldChain",              // Story S-49
  "safetyStatus",           // Story S-49
]);

const PUBLIC_ORIGIN_ALLOWLIST = Object.freeze([
  "farmName",
  "organizationName",
  "organizationType",
  "regionName",
  "commune",
  "district",
  "province",
  "coordinates",
  "hasCoordinates",
  "verified",
  "harvestedAt",
]);

const PUBLIC_JOURNEY_ALLOWLIST = Object.freeze([
  "step",
  "type",
  "typeLabel",
  "title",
  "locationName",
  "organizationName",       // Chỉ hiển thị loại đối tác đối với các chặng trung gian
  "partnerType",
  "address",
  "coordinates",
  "hasCoordinates",
  "verified",
  "occurredAt",
  "description",
  "isOrigin",
  "isTransfer",
  "isCurrentLocation",
  "hasViolation",           // Story S-49
  "warning",                // Story S-49
]);

const PUBLIC_ROUTE_ALLOWLIST = Object.freeze([
  "fromStep",
  "toStep",
  "fromTitle",
  "toTitle",
  "isSchematic",
  "coordinates",
]);

const PUBLIC_SUMMARY_ALLOWLIST = Object.freeze([
  "totalOrigins",
  "totalStops",
  "verifiedStops",
  "unverifiedStops",
  "hasUnlocatedStops",
  "isSchematic",
  "disclaimer",
]);

const PUBLIC_RECALL_ALLOWLIST = Object.freeze([
  "isRecalled",
  "status",
  "reason",
  "notice",
  "instructions",
]);

const PUBLIC_COLDCHAIN_ALLOWLIST = Object.freeze([
  "hasViolation",
  "violationCount",
  "firstViolationAt",
  "lastViolationAt",
  "message",
  "status",
]);

module.exports = {
  PUBLIC_LOT_ALLOWLIST,
  PUBLIC_ORIGIN_ALLOWLIST,
  PUBLIC_JOURNEY_ALLOWLIST,
  PUBLIC_ROUTE_ALLOWLIST,
  PUBLIC_SUMMARY_ALLOWLIST,
  PUBLIC_RECALL_ALLOWLIST,
  PUBLIC_COLDCHAIN_ALLOWLIST,
};
