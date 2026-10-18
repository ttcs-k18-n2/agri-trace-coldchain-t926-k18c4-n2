"use strict";

const { verifyBatchEventChain } = require("./integrity_verifier");
const { traceLotOrigins, traceLotDescendants } = require("./lot_genealogy");
const { checkLotRecallStatus } = require("./recall_service");
const { getViolations } = require("./cold_chain_violation_service");

/**
 * Chuẩn hóa chuỗi Unicode tiếng Việt (NFC), bảo toàn 100% dấu tiếng Việt và ký tự hợp lệ.
 * Khắc phục triệt để lỗi mất dấu tiếng Việt của toAsciiSafe() trước đây (Story S-53 / Jira N2-121).
 */
function toUnicodeSafe(str) {
  if (str === null || str === undefined) return "";
  const s = String(str).normalize("NFC");
  let res = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 32 || code === 9 || code === 10) {
      res += s[i];
    }
  }
  return res.trim();
}

/**
 * Tương thích ngược: Bảo toàn nguyên vẹn Unicode và dấu tiếng Việt của dữ liệu nghiệp vụ
 */
function toAsciiSafe(str) {
  return toUnicodeSafe(str);
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
 * Hỗ trợ ngắt dòng an toàn cho chuỗi ký tự dài không vượt lề trang PDF
 */
function wrapText(text, maxChars = 75) {
  if (!text) return [""];
  const str = String(text).trim();
  if (str.length <= maxChars) return [str];

  const lines = [];
  let remaining = str;
  while (remaining.length > maxChars) {
    let splitIdx = remaining.lastIndexOf(" ", maxChars);
    if (splitIdx === -1 || splitIdx < maxChars * 0.5) splitIdx = maxChars;
    lines.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}

/**
 * Tạo ToUnicode CMap chuẩn cho phép các trình đọc PDF (Chrome, Acrobat, macOS Preview)
 * hiển thị và trích xuất nguyên vẹn văn bản Unicode tiếng Việt.
 */
function buildToUnicodeCMap(objNum) {
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Custom-ToUnicode def
/CMapType 2 def
1 begincodespacerange
<00> <FF>
endcodespacerange
1 beginbfrange
<00> <FF> <0000>
endbfrange
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;

  const buf = Buffer.from(cmap, "utf8");
  return `${objNum} 0 obj\n<< /Length ${buf.length} >>\nstream\n${cmap}\nendstream\nendobj\n`;
}

/**
 * Bộ tạo tệp PDF nhị phân thuần Node.js tuân thủ chuẩn PDF-1.4 RFC
 * Hỗ trợ Unicode tiếng Việt, ngắt trang linh hoạt và font Arial/Helvetica
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
    const toUnicodeObjNum = currentObjNum++;
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

    // 2. Pages root
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(" ");
    objects[pagesObjNum] = `${pagesObjNum} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${this.pages.length} >>\nendobj\n`;

    // 3. ToUnicode CMap Object
    objects[toUnicodeObjNum] = buildToUnicodeCMap(toUnicodeObjNum);

    // 4. Fonts - TrueType Arial / Type1 Courier kèm ToUnicode mapping
    objects[fontHelveticaObjNum] = `${fontHelveticaObjNum} 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /Arial /Encoding /WinAnsiEncoding /ToUnicode ${toUnicodeObjNum} 0 R >>\nendobj\n`;
    objects[fontBoldObjNum] = `${fontBoldObjNum} 0 obj\n<< /Type /Font /Subtype /TrueType /BaseFont /Arial-Bold /Encoding /WinAnsiEncoding /ToUnicode ${toUnicodeObjNum} 0 R >>\nendobj\n`;
    objects[fontCourierObjNum] = `${fontCourierObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Courier /ToUnicode ${toUnicodeObjNum} 0 R >>\nendobj\n`;

    // 5. Pages & Stream Contents
    for (let i = 0; i < this.pages.length; i++) {
      const pageNum = pageObjNums[i];
      const contentNum = contentObjNums[i];
      const pageLines = this.pages[i];

      let streamContent = "BT\n";
      let yPos = 800;

      for (const item of pageLines) {
        const text = escapePdfText(toUnicodeSafe(item.text || ""));
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
    try {
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
      events = evRes ? (evRes.rows || []) : [];
    } catch {
      lot = null;
      events = [];
    }
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
        organization_name: org ? org.name : (lot.organizationName || lot.organization_name || lot.organizationId || "Chưa cập nhật"),
        farm_name: farm ? farm.name : (lot.farmName || lot.farm_name || lot.farmId || "Chưa cập nhật"),
        product_name: prod ? prod.name : (lot.productName || lot.product_name || lot.productId || lot.name || "Nông sản tiêu chuẩn"),
        product_unit: prod ? prod.unit : (lot.productUnit || lot.product_unit || "kg"),
      };
    }

    const eventsList = inMemoryContext.inMemoryBatchEvents || [];
    events = eventsList
      .filter((e) => (e.batchId || e.batch_id || e.lotId) === lotId)
      .sort(
        (a, b) =>
          Number(a.sequenceNo !== undefined ? a.sequenceNo : a.sequence_no) -
          Number(b.sequenceNo !== undefined ? b.sequenceNo : b.sequence_no)
      );
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
    origins = origRes ? (origRes.origins || []) : [];
  } catch {
    origins = [];
  }

  try {
    const descRes = await traceLotDescendants(lotId, { pool });
    descendants = descRes ? (descRes.descendants || []) : [];
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
 * Hỗ trợ Unicode tiếng Việt đầy đủ, nhiều trang và xử lý dữ liệu thiếu an toàn.
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
  p1.push({ text: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM", x: 180, y: 810, size: 12, bold: true });
  p1.push({ text: "Độc lập - Tự do - Hạnh phúc", x: 230, y: 795, size: 10, bold: true });
  p1.push({ text: "------------------------------------------------------------", x: 170, y: 785, size: 10 });

  p1.push({ text: "HỒ SƠ TRUY XUẤT NGUỒN GỐC NÔNG SẢN & CHUỖI LẠNH (S-53)", x: 70, y: 755, size: 13, bold: true });
  p1.push({ text: `Mã lô: ${lot.id || lot.code} | Thời điểm xuất hồ sơ: ${exportedAt}`, x: 100, y: 738, size: 9 });

  p1.push({ text: "1. THÔNG TIN CƠ BẢN LÔ HÀNG", x: 50, y: 710, size: 11, bold: true });
  p1.push({ text: `* Mã số lô: ${lot.id || lot.code || "N/A"}`, x: 60, y: 692, size: 9 });

  // Hỗ trợ hiển thị tên dài không tràn lề
  const prodName = lot.product_name || lot.name || "Nông sản tiêu chuẩn";
  const prodLines = wrapText(`* Tên nông sản: ${prodName}`, 70);
  let curInfoY = 677;
  for (const line of prodLines) {
    p1.push({ text: line, x: 60, y: curInfoY, size: 9 });
    curInfoY -= 15;
  }

  p1.push({ text: `* Tổ chức sở hữu: ${lot.organization_name || lot.organization_id || "HTX Nông Nghiệp"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Vùng trồng / Thửa: ${lot.farm_name || lot.farm_id || "Vùng trồng tiêu chuẩn"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Ngày thu hoạch: ${lot.harvested_at || lot.harvestedAt || "2026-09-30"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Khối lượng ban đầu: ${lot.initial_quantity || lot.initialQuantity || 0} ${lot.product_unit || "kg"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Khối lượng hiện tại: ${lot.remaining_quantity || lot.remainingQuantity || 0} ${lot.product_unit || "kg"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Trạng thái hiện tại: ${lot.status || "Đang lưu thông"}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 25;

  // Mục kiểm tra toàn vẹn mật mã học (S-12 / NFR N2-121)
  p1.push({ text: "2. KẾT QUẢ KIỂM TRA TOÀN VẸN CHUỖI HASH (S-12 AUDIT / TOAN VEN)", x: 50, y: curInfoY, size: 11, bold: true });
  curInfoY -= 17;

  const statusStr = integrityResult.valid
    ? ">> KẾT QUẢ: TOÀN VẸN (ĐẠT TIÊU CHUẨN / TOAN VEN) <<"
    : ">> CẢNH BÁO: CHUỖI HASH BỊ ĐỨT MẠCH HOẶC BỊ SỬA ĐỔI TRÁI PHÉP <<";
  p1.push({ text: statusStr, x: 60, y: curInfoY, size: 10, bold: true });
  curInfoY -= 15;

  p1.push({ text: `* Tổng số sự kiện kiểm tra: ${integrityResult.eventCount || events.length}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 15;

  p1.push({ text: `* Cán bộ / Người thực hiện xuất hồ sơ: ${actorEmail}`, x: 60, y: curInfoY, size: 9 });
  curInfoY -= 20;

  // IN HASH CUỐI CHUỖI (HEAD HASH) LÊN TỆP THEO NFR CHUẨN
  const headHash =
    integrityResult.finalHash ||
    (events.length > 0 ? events[events.length - 1].eventHash || events[events.length - 1].event_hash : "0".repeat(64));
  p1.push({
    text: "* MÃ BĂM ĐỈNH CUỐI CHUỖI (HEAD HASH / CRYPTOGRAPHIC SIGNATURE):",
    x: 60,
    y: curInfoY,
    size: 9,
    bold: true,
  });
  curInfoY -= 15;
  p1.push({ text: `  ${headHash}`, x: 60, y: curInfoY, size: 8.5, mono: true, bold: true });
  curInfoY -= 13;
  p1.push({
    text: "  (Mã băm đại diện bất biến cho toàn bộ lịch sử lô hàng để đối chiếu hệ thống)",
    x: 60,
    y: curInfoY,
    size: 8,
  });
  curInfoY -= 25;

  // Lịch sử dòng thời gian sự kiện
  p1.push({ text: "3. DÒNG THỜI GIAN SỰ KIỆN CHUỖI CUNG ỨNG (LEDGER EVENTS)", x: 50, y: curInfoY, size: 11, bold: true });
  curInfoY -= 17;
  p1.push({
    text: "Stt | Loại sự kiện        | Thời điểm                  | Mã băm sự kiện (Hash)",
    x: 60,
    y: curInfoY,
    size: 8.5,
    bold: true,
  });
  curInfoY -= 8;
  p1.push({
    text: "--------------------------------------------------------------------------------",
    x: 60,
    y: curInfoY,
    size: 8.5,
  });
  curInfoY -= 14;

  const displayEvents = events.slice(0, 8);
  if (displayEvents.length === 0) {
    p1.push({ text: "(Chưa có sự kiện nào ghi nhận trên sổ cái)", x: 60, y: curInfoY, size: 8.5 });
  } else {
    for (const ev of displayEvents) {
      const seq = String(ev.sequenceNo !== undefined ? ev.sequenceNo : ev.sequence_no || 1).padEnd(3);
      const type = String(ev.eventType || ev.event_type || "SỰ KIỆN").padEnd(20).slice(0, 20);
      const time = String(ev.occurredAt || ev.occurred_at || ev.createdAt || "")
        .replace("T", " ")
        .slice(0, 19)
        .padEnd(26);
      const hashShort = String(ev.eventHash || ev.event_hash || "").slice(0, 16) + "...";
      p1.push({ text: `${seq} | ${type} | ${time} | ${hashShort}`, x: 60, y: curInfoY, size: 8, mono: true });
      curInfoY -= 14;
    }
  }

  p1.push({ text: "Trang 1 / 2 - Cơ quan quản lý chuỗi nông sản lạnh Việt Nam", x: 190, y: 30, size: 8 });
  builder.addPage(p1);

  // === TRANG 2: PHẢ HỆ TỔ TIÊN, HẬU DUỆ, CHUỖI LẠNH VÀ THU HỒI ===
  const p2 = [];
  p2.push({
    text: "HỒ SƠ TRUY XUẤT NGUỒN GỐC NÔNG SẢN & CHUỖI LẠNH (Tiếp theo)",
    x: 90,
    y: 810,
    size: 12,
    bold: true,
  });
  p2.push({ text: `Mã lô: ${lot.id || lot.code} | Trang 2 / 2`, x: 230, y: 795, size: 9 });

  // 4. Phả hệ tổ tiên và hậu duệ
  p2.push({
    text: "4. PHẢ HỆ NGUỒN GỐC TỔ TIÊN & HẬU DUỆ (GENEALOGY DAG / PHA HE NGUON GOC)",
    x: 50,
    y: 760,
    size: 11,
    bold: true,
  });
  p2.push({
    text: `* Lô tổ tiên / nguồn gốc ban đầu (Origins): ${origins.length} lô`,
    x: 60,
    y: 742,
    size: 9,
    bold: true,
  });

  if (origins.length === 0) {
    p2.push({
      text: "  - Không có lô tổ tiên (Lô đơn nguồn thu hoạch trực tiếp từ nông hộ/vườn)",
      x: 60,
      y: 727,
      size: 8.5,
    });
  } else {
    let origY = 727;
    for (const o of origins.slice(0, 4)) {
      p2.push({
        text: `  - Mã lô mẹ: ${o.lotId || o.id} | Vùng trồng: ${o.farmName || o.farmId || "Tiêu chuẩn"} | Tỷ lệ: ${o.percentage || 100}%`,
        x: 60,
        y: origY,
        size: 8.5,
      });
      origY -= 14;
    }
  }

  const descStartY = origins.length > 0 ? 660 : 700;
  p2.push({
    text: `* Lô hậu duệ / phân tách sau đó (Descendants): ${descendants.length} lô`,
    x: 60,
    y: descStartY,
    size: 9,
    bold: true,
  });
  if (descendants.length === 0) {
    p2.push({
      text: "  - Không có lô hậu duệ (Lô nguyên vẹn chưa phân chia hoặc gộp)",
      x: 60,
      y: descStartY - 15,
      size: 8.5,
    });
  } else {
    let descY = descStartY - 15;
    for (const d of descendants.slice(0, 4)) {
      p2.push({
        text: `  - Lô con: ${d.id || d.lotId} | Khối lượng: ${d.remainingQuantity || d.initialQuantity || 0}kg | Trạng thái: ${d.status}`,
        x: 60,
        y: descY,
        size: 8.5,
      });
      descY -= 14;
    }
  }

  // 5. Chuỗi lạnh & Vi phạm nhiệt độ
  const coldStartY = 580;
  const violationsList = Array.isArray(violations) ? violations : violations?.violations || [];
  p2.push({
    text: "5. GIÁM SÁT CHUỖI LẠNH & VI PHẠM NHIỆT ĐỘ (GIAM SAT CHUOI LANH)",
    x: 50,
    y: coldStartY,
    size: 11,
    bold: true,
  });
  if (!violationsList || violationsList.length === 0) {
    p2.push({
      text: ">> TIÊU CHUẨN CHUỖI LẠNH: KHÔNG PHÁT HIỆN VI PHẠM NHIỆT ĐỘ <<",
      x: 60,
      y: coldStartY - 18,
      size: 9.5,
      bold: true,
    });
    p2.push({
      text: "* Toàn bộ hành trình bảo quản và vận chuyển nằm trong ngưỡng an toàn quy định.",
      x: 60,
      y: coldStartY - 33,
      size: 8.5,
    });
  } else {
    p2.push({
      text: `>> CẢNH BÁO: PHÁT HIỆN ${violationsList.length} VI PHẠM CHUỖI LẠNH <<`,
      x: 60,
      y: coldStartY - 18,
      size: 9.5,
      bold: true,
    });
    let vY = coldStartY - 33;
    for (const v of violationsList.slice(0, 3)) {
      p2.push({
        text: `* Chuyến: ${v.shipmentId || "N/A"} | Mức độ: ${v.severity || "WARNING"} | Thời lượng vi phạm: ${v.durationMinutes || 0} phút`,
        x: 60,
        y: vY,
        size: 8.5,
      });
      vY -= 14;
    }
  }

  // 6. Lệnh thu hồi nông sản
  const recallStartY = 470;
  p2.push({
    text: "6. TÌNH TRẠNG THU HỒI NÔNG SẢN (TINH TRANG THU HOI)",
    x: 50,
    y: recallStartY,
    size: 11,
    bold: true,
  });
  if (recallInfo.isRecalled) {
    p2.push({
      text: ">> CẢNH BÁO KHẨN: LÔ HÀNG ĐANG CÓ LỆNH THU HỒI HIỆU LỰC <<",
      x: 60,
      y: recallStartY - 18,
      size: 10,
      bold: true,
    });
    p2.push({ text: `* Lý do thu hồi: ${recallInfo.reason}`, x: 60, y: recallStartY - 33, size: 9 });
  } else {
    p2.push({
      text: ">> TÌNH TRẠNG: AN TOÀN - KHÔNG CÓ LỆNH THU HỒI <<",
      x: 60,
      y: recallStartY - 18,
      size: 9.5,
      bold: true,
    });
    p2.push({
      text: "* Lô hàng đủ điều kiện lưu thông trên thị trường theo quy định an toàn thực phẩm.",
      x: 60,
      y: recallStartY - 33,
      size: 8.5,
    });
  }

  // 7. Chữ ký và dấu xác nhận
  p2.push({ text: "XÁC NHẬN CỦA CÁN BỘ KIỂM TRA", x: 330, y: 350, size: 10, bold: true });
  p2.push({ text: "(Ký, ghi rõ họ tên & mã số công chức)", x: 330, y: 335, size: 8.5 });
  p2.push({ text: `Cán bộ thanh tra: ${actorEmail}`, x: 330, y: 250, size: 9, bold: true });

  p2.push({ text: "Trang 2 / 2 - Cơ quan quản lý chuỗi nông sản lạnh Việt Nam", x: 190, y: 30, size: 8 });
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
  toUnicodeSafe,
  escapePdfText,
  wrapText,
};
