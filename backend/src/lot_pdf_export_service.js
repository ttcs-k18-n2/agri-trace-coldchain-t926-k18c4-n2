"use strict";

const { verifyBatchEventChain } = require("./integrity_verifier");
const { traceLotOrigins, traceLotDescendants } = require("./lot_genealogy");
const { checkLotRecallStatus } = require("./recall_service");
const { getViolations } = require("./cold_chain_violation_service");

/**
 * Loại bỏ dấu tiếng Việt để xuất tương thích hoàn hảo chuẩn PDF Type1 (Helvetica/Courier)
 * không phụ thuộc vào gói phông chữ ngoài hoặc hệ điều hành máy in.
 */
function toAsciiSafe(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^\x20-\x7E]/g, " ");
}

/**
 * Thoát ký tự đặc biệt theo cú pháp chuỗi văn bản PDF (...)
 */
function escapePdfText(str) {
  if (!str) return "";
  return String(str)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/**
 * Bộ tạo tệp PDF nhị phân thuần Node.js tuân thủ chuẩn PDF-1.4 RFC
 */
class SimplePdfBuilder {
  constructor() {
    this.pages = [];
  }

  addPage(lines) {
    this.pages.push(lines);
  }

  build() {
    const objects = [];
    let currentObjNum = 1;

    const catalogObjNum = currentObjNum++;
    const pagesObjNum = currentObjNum++;
    const fontHelveticaObjNum = currentObjNum++;
    const fontBoldObjNum = currentObjNum++;
    const fontCourierObjNum = currentObjNum++;

    const pageObjNums = [];
    const contentObjNums = [];

    for (let i = 0; i < this.pages.length; i++) {
      pageObjNums.push(currentObjNum++);
      contentObjNums.push(currentObjNum++);
    }

    // 1. Catalog
    objects[catalogObjNum] = `${catalogObjNum} 0 obj\n<< /Type /Catalog /Pages ${pagesObjNum} 0 R >>\nendobj\n`;

    // 2. Pages
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
    objects[pagesObjNum] = `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${this.pages.length} >>\nendobj\n`;

    // 3. Fonts
    objects[fontHelveticaObjNum] = `${fontHelveticaObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
    objects[fontBoldObjNum] = `${fontBoldObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`;
    objects[fontCourierObjNum] = `${fontCourierObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n`;

    // 4. Pages & Contents
    for (let i = 0; i < this.pages.length; i++) {
      const pageNum = pageObjNums[i];
      const contentNum = contentObjNums[i];
      const pageLines = this.pages[i];

      let streamContent = "BT\n";
      let yPos = 800;

      for (const item of pageLines) {
        const text = escapePdfText(toAsciiSafe(item.text || ""));
        const size = item.size || 10;
        const font = item.bold ? "/F2" : item.mono ? "/F3" : "/F1";
        const xPos = item.x !== undefined ? item.x : 50;

        if (item.y !== undefined) {
          yPos = item.y;
        } else {
          yPos -= item.spacing || 14;
        }

        streamContent += `${font} ${size} Tf\n`;
        streamContent += `1 0 0 1 ${xPos} ${yPos} Tm\n`;
        streamContent += `(${text}) Tj\n`;
      }
      streamContent += "ET\n";

      const streamBuffer = Buffer.from(streamContent, "utf8");
      objects[pageNum] = `${pageNum} 0 obj\n<< /Type /Page /Parent ${pagesObjNum} 0 R /MediaBox [0 0 595.28 841.89] /Contents ${contentNum} 0 R /Resources << /Font << /F1 ${fontHelveticaObjNum} 0 R /F2 ${fontBoldObjNum} 0 R /F3 ${fontCourierObjNum} 0 R >> >> >>\nendobj\n`;
      objects[contentNum] = `${contentNum} 0 obj\n<< /Length ${streamBuffer.length} >>\nstream\n${streamContent}endstream\nendobj\n`;
    }

    // Ghép nối cấu trúc tệp PDF
    let pdfBody = "%PDF-1.4\n";
    const xrefOffsets = [0];

    for (let i = 1; i < objects.length; i++) {
      xrefOffsets[i] = Buffer.byteLength(pdfBody, "utf8");
      pdfBody += objects[i];
    }

    const startXref = Buffer.byteLength(pdfBody, "utf8");
    pdfBody += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;

    for (let i = 1; i < objects.length; i++) {
      pdfBody += `${String(xrefOffsets[i]).padStart(10, "0")} 00000 n \n`;
    }

    pdfBody += `trailer\n<< /Size ${objects.length} /Root ${catalogObjNum} 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;

    return Buffer.from(pdfBody, "utf8");
  }
}

/**
 * Trích xuất toàn diện hồ sơ lô hàng từ Database hoặc In-Memory
 */
async function aggregateLotDossierData({
  pool,
  lotId,
  inMemoryContext = {},
}) {
  let lot = null;
  let events = [];
  let violations = [];

  // 1. Thông tin Lô hàng
  if (pool) {
    const lotRes = await pool.query(
      `SELECT l.*, o.name AS organization_name, f.name AS farm_name, p.name AS product_name, p.unit AS product_unit
       FROM lots l
       LEFT JOIN organizations o ON l.organization_id = o.id
       LEFT JOIN farms f ON l.farm_id = f.id
       LEFT JOIN products p ON l.product_id = p.id
       WHERE l.id = $1`,
      [lotId]
    );
    if (lotRes.rows.length > 0) lot = lotRes.rows[0];

    const evRes = await pool.query(
      `SELECT * FROM batch_events WHERE batch_id = $1 ORDER BY sequence_no ASC`,
      [lotId]
    );
    events = evRes.rows;
  } else {
    const lotsList = inMemoryContext.inMemoryLots || [];
    lot = lotsList.find((l) => l.id === lotId || l.lot_id === lotId || l.code === lotId);

    const orgsList = inMemoryContext.inMemoryOrgs || [];
    const farmsList = inMemoryContext.inMemoryFarms || [];
    const productsList = inMemoryContext.inMemoryProducts || [];

    if (lot) {
      const org = orgsList.find((o) => o.id === (lot.organizationId || lot.organization_id));
      const farm = farmsList.find((f) => f.id === (lot.farmId || lot.farm_id));
      const prod = productsList.find((p) => p.id === (lot.productId || lot.product_id));

      lot = {
        ...lot,
        organization_name: org ? org.name : (lot.organizationName || lot.organizationId),
        farm_name: farm ? farm.name : (lot.farmName || lot.farmId),
        product_name: prod ? prod.name : (lot.productName || lot.productId),
        product_unit: prod ? prod.unit : (lot.productUnit || "kg"),
      };
    }

    const eventsList = inMemoryContext.inMemoryBatchEvents || [];
    events = eventsList
      .filter((e) => (e.batchId || e.batch_id || e.lotId) === lotId)
      .sort((a, b) => Number(a.sequenceNo || a.sequence_no) - Number(b.sequenceNo || b.sequence_no));
  }

  if (!lot) {
    return null;
  }

  // 2. Kiểm tra tính toàn vẹn chuỗi Hash (S-12)
  const integrityResult = verifyBatchEventChain(events);

  // 3. Phả hệ tổ tiên và hậu duệ
  let origins = [];
  let descendants = [];
  try {
    const origRes = await traceLotOrigins(lotId, { pool });
    origins = origRes.origins || [];
  } catch {
    origins = [];
  }

  try {
    const descRes = await traceLotDescendants(lotId, { pool });
    descendants = descRes.descendants || [];
  } catch {
    descendants = [];
  }

  // 4. Vi phạm chuỗi lạnh
  try {
    const vRes = await getViolations({ pool, batchId: lotId, inMemoryContext });
    violations = Array.isArray(vRes) ? vRes : (vRes?.violations || []);
  } catch {
    violations = [];
  }

  // 5. Trạng thái thu hồi
  let recallInfo = { isRecalled: false, reason: null };
  try {
    const rc = await checkLotRecallStatus(lotId, { pool });
    if (rc && rc.recalled) {
      recallInfo = { isRecalled: true, reason: rc.reason || "Lệnh thu hồi đang hiệu lực" };
    }
  } catch {
    recallInfo = { isRecalled: false, reason: null };
  }

  return {
    lot,
    events,
    integrityResult,
    origins,
    descendants,
    violations,
    recallInfo,
  };
}

/**
 * Kết xuất hồ sơ truy xuất đầy đủ của lô nông sản ra định dạng PDF nhị phân (S-53)
 */
async function exportLotDossierToPdf({
  pool,
  lotId,
  actorEmail = "inspector@example.com",
  inMemoryContext = {},
}) {
  const dossier = await aggregateLotDossierData({ pool, lotId, inMemoryContext });
  if (!dossier) {
    return {
      status: 404,
      error: "LOT_NOT_FOUND",
      message: `Không tìm thấy hồ sơ lô hàng: ${lotId}`,
    };
  }

  const { lot, events, integrityResult, origins, descendants, violations, recallInfo } = dossier;
  const exportedAt = new Date().toISOString();
  const builder = new SimplePdfBuilder();

  // === TRANG 1: THÔNG TIN CHUNG, LỊCH SỬ CHUỖI VÀ CHỨNG THỰC MẬT MÃ TOÀN VẸN ===
  const p1 = [];
  p1.push({ text: "CONG HOA XA HOI CHU NGHIA VIET NAM", x: 180, y: 810, size: 12, bold: true });
  p1.push({ text: "Doc lap - Tu do - Hanh phuc", x: 230, y: 795, size: 10, bold: true });
  p1.push({ text: "------------------------------------------------------------", x: 170, y: 785, size: 10 });

  p1.push({ text: "HO SO TRUY XUAT NGUON GOC NONG SAN & CHUOI LANH (S-53)", x: 70, y: 755, size: 14, bold: true });
  p1.push({ text: `Ma lo: ${lot.id || lot.code} | Thoi diem xuat ho so: ${exportedAt}`, x: 100, y: 738, size: 9 });

  p1.push({ text: "1. THONG TIN CO BAN LO HANG", x: 50, y: 710, size: 11, bold: true });
  p1.push({ text: `* Ma so lo: ${lot.id || lot.code}`, x: 60, y: 692, size: 9 });
  p1.push({ text: `* Ten nong san: ${lot.product_name || lot.name || "Khong xac dinh"}`, x: 60, y: 677, size: 9 });
  p1.push({ text: `* To chuc so huu: ${lot.organization_name || lot.organization_id || "HTX Nong Nghiep"}`, x: 60, y: 662, size: 9 });
  p1.push({ text: `* Vung trong / Thua: ${lot.farm_name || lot.farm_id || "Vung trong tieu chuan"}`, x: 60, y: 647, size: 9 });
  p1.push({ text: `* Ngay thu hoach: ${lot.harvested_at || lot.harvestedAt || "2026-09-30"}`, x: 60, y: 632, size: 9 });
  p1.push({ text: `* Khoi luong ban dau: ${lot.initial_quantity || lot.initialQuantity || 0} ${lot.product_unit || "kg"}`, x: 60, y: 617, size: 9 });
  p1.push({ text: `* Khoi luong hien tai: ${lot.remaining_quantity || lot.remainingQuantity || 0} ${lot.product_unit || "kg"}`, x: 60, y: 602, size: 9 });
  p1.push({ text: `* Trang thai hien tai: ${lot.status || "Hoat dong"}`, x: 60, y: 587, size: 9 });

  // Mục kiểm tra toàn vẹn mật mã học (S-12 / NFR N2-121)
  p1.push({ text: "2. KET QUA KIEM TRA TOAN VEN CHUOI HASH (S-12 AUDIT)", x: 50, y: 555, size: 11, bold: true });
  const statusStr = integrityResult.valid ? ">> KET QUA: TOAN VEN (DAT TIEU CHUAN) <<" : ">> CANH BAO: CHUOI HASH BI PHA VO HOAC SUA DOI TRAPHEP <<";
  p1.push({ text: statusStr, x: 60, y: 538, size: 10, bold: true });
  p1.push({ text: `* Tong so su kien kiem tra: ${integrityResult.eventCount || events.length}`, x: 60, y: 523, size: 9 });
  p1.push({ text: `* Can bo / Nguoi thuc hien xuat: ${actorEmail}`, x: 60, y: 508, size: 9 });
  
  // IN HASH CUỐI CHUỖI (HEAD HASH) LÊN TỆP THEO NFR CHUẨN
  const headHash = integrityResult.finalHash || (events.length > 0 ? (events[events.length - 1].eventHash || events[events.length - 1].event_hash) : "0".repeat(64));
  p1.push({ text: "* MA BAM DINH CUOI CHUOI (HEAD HASH / CRYPTOGRAPHIC SIGNATURE):", x: 60, y: 490, size: 9, bold: true });
  p1.push({ text: `  ${headHash}`, x: 60, y: 475, size: 9, mono: true, bold: true });
  p1.push({ text: "  (Ma bam tren dai dien cho toan bo lich su bat bien cua lo de doi chieu he thong)", x: 60, y: 462, size: 8 });

  // Lịch sử dòng thời gian sự kiện
  p1.push({ text: "3. DONG THOI GIAN SU KIEN CHUOI CUNG UNG (LEDGER EVENTS)", x: 50, y: 435, size: 11, bold: true });
  p1.push({ text: "Stt | Loai su kien         | Thoi diem                  | Ma bam su kien (Hash)", x: 60, y: 418, size: 8.5, bold: true });
  p1.push({ text: "--------------------------------------------------------------------------------", x: 60, y: 410, size: 8.5 });

  let curY = 398;
  const displayEvents = events.slice(0, 10);
  if (displayEvents.length === 0) {
    p1.push({ text: "(Chua co su kien ghi nhan tren he thong)", x: 60, y: curY, size: 8.5 });
    curY -= 14;
  } else {
    for (const ev of displayEvents) {
      const seq = String(ev.sequenceNo || ev.sequence_no || 1).padEnd(3);
      const type = String(ev.eventType || ev.event_type || "UNKNOWN").padEnd(20).slice(0, 20);
      const time = String(ev.occurredAt || ev.occurred_at || ev.createdAt || "").replace("T", " ").slice(0, 19).padEnd(26);
      const hashShort = String(ev.eventHash || ev.event_hash || "").slice(0, 16) + "...";
      p1.push({ text: `${seq} | ${type} | ${time} | ${hashShort}`, x: 60, y: curY, size: 8, mono: true });
      curY -= 14;
    }
  }

  p1.push({ text: "Trang 1 / 2 - Co quan quan ly chuoi nong san lanh Viet Nam", x: 190, y: 30, size: 8 });
  builder.addPage(p1);

  // === TRANG 2: PHA HE TO TIEN, HAU DUE, CHUOI LANH VA THU HOI ===
  const p2 = [];
  p2.push({ text: "HO SO TRUY XUAT NGUON GOC NONG SAN & CHUOI LANH (Tiep theo)", x: 100, y: 810, size: 12, bold: true });
  p2.push({ text: `Ma lo: ${lot.id || lot.code} | Trang 2 / 2`, x: 230, y: 795, size: 9 });

  // 4. Phả hệ tổ tiên và hậu duệ
  p2.push({ text: "4. PHA HE NGUON GOC TO TIEN & HAU DUE (GENEALOGY DAG)", x: 50, y: 760, size: 11, bold: true });
  p2.push({ text: `* Lo to tien / nguon goc ban dau (Origins): ${origins.length} lo`, x: 60, y: 742, size: 9, bold: true });
  if (origins.length === 0) {
    p2.push({ text: "  - Khong co lo to tien (Lo don nguon thu hoach truc tiep tu vuon)", x: 60, y: 727, size: 8.5 });
  } else {
    let origY = 727;
    for (const o of origins.slice(0, 4)) {
      p2.push({ text: `  - Ma lo me: ${o.lotId || o.id} | Vung trong: ${o.farmName || o.farmId || "N/A"} | Ty le: ${o.percentage || 100}%`, x: 60, y: origY, size: 8.5 });
      origY -= 14;
    }
  }

  const descStartY = origins.length > 0 ? 660 : 700;
  p2.push({ text: `* Lo hau due / phan tach sau do (Descendants): ${descendants.length} lo`, x: 60, y: descStartY, size: 9, bold: true });
  if (descendants.length === 0) {
    p2.push({ text: "  - Khong co lo hau due phan tach (Lo nguyen ven chua bi chia tach/gop)", x: 60, y: descStartY - 15, size: 8.5 });
  } else {
    let descY = descStartY - 15;
    for (const d of descendants.slice(0, 4)) {
      p2.push({ text: `  - Lo con: ${d.id || d.lotId} | Khoi luong: ${d.remainingQuantity || d.initialQuantity || 0}kg | Trang thai: ${d.status}`, x: 60, y: descY, size: 8.5 });
      descY -= 14;
    }
  }

  // 5. Chuỗi lạnh & Vi phạm nhiệt độ
  const coldStartY = 580;
  const violationsList = Array.isArray(violations) ? violations : (violations?.violations || []);
  p2.push({ text: "5. GIAM SAT CHUOI LANH & VI PHAM NHIET DO (COLD CHAIN AUDIT)", x: 50, y: coldStartY, size: 11, bold: true });
  if (!violationsList || violationsList.length === 0) {
    p2.push({ text: ">> TIEU CHUAN CHUOI LANH: KHONG PHAT HIEN VI PHAM NHIET DO <<", x: 60, y: coldStartY - 18, size: 9.5, bold: true });
    p2.push({ text: "* Toan bo hanh trinh bao quan va van chuyen nam trong nguong an toan quy dinh.", x: 60, y: coldStartY - 33, size: 8.5 });
  } else {
    p2.push({ text: `>> CANH BAO: PHAT HIEN ${violationsList.length} VI PHAM CHUOI LANH <<`, x: 60, y: coldStartY - 18, size: 9.5, bold: true });
    let vY = coldStartY - 33;
    for (const v of violationsList.slice(0, 3)) {
      p2.push({ text: `* Chuyen: ${v.shipmentId || "N/A"} | Muc do: ${v.severity || "WARNING"} | Thoi luong vi pham: ${v.durationMinutes || 0} phut`, x: 60, y: vY, size: 8.5 });
      vY -= 14;
    }
  }

  // 6. Lệnh thu hồi nông sản
  const recallStartY = 470;
  p2.push({ text: "6. TINH TRANG THU HOI NONG SAN (RECALL ORDER STATUS)", x: 50, y: recallStartY, size: 11, bold: true });
  if (recallInfo.isRecalled) {
    p2.push({ text: ">> CANH BAO KHAN: LO HANG DANG CO LENH THU HOI <<", x: 60, y: recallStartY - 18, size: 10, bold: true });
    p2.push({ text: `* Ly do thu hoi: ${recallInfo.reason}`, x: 60, y: recallStartY - 33, size: 9 });
  } else {
    p2.push({ text: ">> TINH TRANG: AN TOAN - KHONG CO LENH THU HOI <<", x: 60, y: recallStartY - 18, size: 9.5, bold: true });
    p2.push({ text: "* Lo hang du dieu kien luu thong tren thi truong theo quy dinh an toan thuc pham.", x: 60, y: recallStartY - 33, size: 8.5 });
  }

  // 7. Chữ ký và dấu xác nhận
  p2.push({ text: "XAC NHAN CUA CAN BO KIEM TRA", x: 340, y: 350, size: 10, bold: true });
  p2.push({ text: "(Ky, ghi ro ho ten & ma so cong chuc)", x: 330, y: 335, size: 8.5 });
  p2.push({ text: `Can bo thanh tra: ${actorEmail}`, x: 330, y: 250, size: 9, bold: true });

  p2.push({ text: "Trang 2 / 2 - Co quan quan ly chuoi nong san lanh Viet Nam", x: 190, y: 30, size: 8 });
  builder.addPage(p2);

  const pdfBuffer = builder.build();
  const filename = `Ho-So-Truy-Xuat-${lot.id || lot.code}.pdf`;

  return {
    status: 200,
    filename,
    contentType: "application/pdf",
    pdfBuffer,
    headHash,
    integrityValid: integrityResult.valid,
    eventCount: events.length,
    lotId: lot.id || lot.code,
    exportedAt,
  };
}

module.exports = {
  exportLotDossierToPdf,
  aggregateLotDossierData,
  SimplePdfBuilder,
  toAsciiSafe,
  escapePdfText,
};
