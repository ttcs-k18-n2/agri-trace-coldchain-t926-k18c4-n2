const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../../frontend");

function readFrontendFile(fileName) {
  return fs.readFileSync(path.join(frontendDir, fileName), "utf8");
}

// Helper: Setup DOM mock environment and execute renderTraceForwardResults from lot-detail.html
function setupMockEnv() {
  const elements = {};

  function getOrCreateElement(id) {
    if (!elements[id]) {
      elements[id] = {
        id,
        textContent: "",
        innerHTML: "",
        value: "",
        disabled: false,
        style: {},
        children: [],
        dataset: {},
        appendChild(child) {
          this.children.push(child);
          if (child.tagName === "OPTION" || child.tagName === "option") {
            this.innerHTML += `<option value="${child.value}">${child.textContent}</option>`;
          }
        },
        focus() {},
        querySelectorAll(selector) {
          if (selector === ".org-group-row") {
            if (!this._cachedRows || this._cachedForHtml !== this.innerHTML) {
              this._cachedForHtml = this.innerHTML;
              this._cachedRows = [];
              const regex = /<tr[^>]*class=["'][^"']*org-group-row[^"']*["'][^>]*data-org-key=["']([^"']*)["'][^>]*>/g;
              let m;
              while ((m = regex.exec(this.innerHTML)) !== null) {
                this._cachedRows.push({
                  dataset: { orgKey: m[1] },
                  style: {},
                });
              }
            }
            return this._cachedRows;
          }
          return [];
        },
      };
    }
    return elements[id];
  }

  // Pre-seed known elements in lot-detail.html
  const knownIds = [
    "statTotalDescendants",
    "statTotalLevels",
    "statTotalOrgs",
    "statTotalLocations",
    "statTotalRemaining",
    "statTotalDescendantsCount",
    "statTotalRecallable",
    "statRecallablePercent",
    "statTotalConsumed",
    "statConsumedPercent",
    "recallStatusBarCard",
    "barFillRecallable",
    "barFillConsumed",
    "barTextRecallable",
    "barTextConsumed",
    "locationSummaryCard",
    "locationSummaryList",
    "lineageTreeContainer",
    "recallTableBody",
    "recallOrgFilter",
    "cycleDangerBanner",
    "cycleBannerTitle",
    "cycleBannerDesc",
    "traceLoadingState",
    "traceResultContainer",
    "traceExecutionBadge",
    "traceExecutionTime",
    "btnExecuteTraceForward",
    "openRecallModal",
    "openRecallForm",
    "recallReason",
    "recallSeverity",
    "btnSubmitRecall",
    "btnCloseRecallModal",
    "btnCancelRecall",
    "recallModalAlert",
    "recallModalLotTitle",
    "recallModalLotId",
    "transferModal",
    "transferModalAlert",
    "transferToOrg",
    "transferNotes",
    "transferLotTitle",
    "transferLotId",
    "transferLotIdInput",
    "btnSubmitTransfer",
    "btnCloseTransferModal",
    "btnCancelTransfer",
    "rejectTransferModal",
    "rejectModalAlert",
    "rejectReason",
    "rejectLotTitle",
    "rejectLotId",
    "rejectTransferIdInput",
    "btnSubmitReject",
    "confirmTransferModal",
    "confirmModalAlert",
    "confirmLotTitle",
    "confirmLotId",
    "btnConfirmTransfer",
    "genealogyStatusNote",
    "genealogyTreeContainer",
  ];

  knownIds.forEach(getOrCreateElement);

  const documentMock = {
    getElementById(id) {
      return getOrCreateElement(id);
    },
    createElement(tag) {
      return {
        tagName: tag,
        style: {},
        textContent: "",
        innerHTML: "",
        value: "",
        children: [],
        appendChild(child) {
          this.children.push(child);
        },
      };
    },
  };

  const html = readFrontendFile("lot-detail.html");

  // Extract renderTraceForwardResults function from script
  const startPattern = "function renderTraceForwardResults(data) {";
  const startIdx = html.indexOf(startPattern);
  assert.ok(startIdx !== -1, "renderTraceForwardResults function must exist in lot-detail.html");

  const endPattern = "let genealogyLots = {};";
  const endIdx = html.indexOf(endPattern, startIdx);
  assert.ok(endIdx !== -1, "genealogyLots must follow renderTraceForwardResults");

  const funcSource = html.substring(startIdx, endIdx);

  // Helper escapeHtml
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const factory = new Function("document", "escapeHtml", `
    ${funcSource}
    return renderTraceForwardResults;
  `);

  const renderTraceForwardResults = factory(documentMock, escapeHtml);

  // Extract openDetailTransferModal
  const tStart = html.indexOf("async function openDetailTransferModal(lotId, lotName) {");
  const tEnd = html.indexOf("function closeDetailTransferModal() {", tStart);
  assert.ok(tStart !== -1 && tEnd !== -1, "openDetailTransferModal must exist");
  const transferFuncSource = html.substring(tStart, tEnd);

  // Extract openDetailRejectModal
  const rStart = html.indexOf("function openDetailRejectModal(transferId, lotId, lotName) {");
  const rEnd = html.indexOf("function closeDetailRejectModal() {", rStart);
  assert.ok(rStart !== -1 && rEnd !== -1, "openDetailRejectModal must exist");
  const rejectFuncSource = html.substring(rStart, rEnd);

  // Extract openRecallModalHandler
  const rcStart = html.indexOf("function openRecallModalHandler(lot) {");
  const rcEnd = html.indexOf("function closeRecallModal() {", rcStart);
  assert.ok(rcStart !== -1 && rcEnd !== -1, "openRecallModalHandler must exist");
  const recallFuncSource = html.substring(rcStart, rcEnd);

  const transferFactory = new Function("document", "loadOrgsForDetail", "currentUser", `
    ${transferFuncSource}
    return openDetailTransferModal;
  `);

  const rejectFactory = new Function("document", `
    ${rejectFuncSource}
    return openDetailRejectModal;
  `);

  let targetRecallLot = null;
  const recallFactory = new Function("document", "targetRecallLot", `
    ${recallFuncSource}
    return openRecallModalHandler;
  `);

  return {
    elements,
    documentMock,
    renderTraceForwardResults,
    openDetailTransferModal: (lotId, lotName, loadOrgs, user) => transferFactory(documentMock, loadOrgs, user)(lotId, lotName),
    openDetailRejectModal: (tId, lId, lName) => rejectFactory(documentMock)(tId, lId, lName),
    openRecallModalHandler: (lot) => recallFactory(documentMock, targetRecallLot)(lot),
  };
}

// ============================================================================
// Test 1: Syntax & Single Clean Document Verification
// ============================================================================
test("S-35 / N2-103: lot-detail.html syntax and single HTML document structure", () => {
  const html = readFrontendFile("lot-detail.html");

  // 1. Verify exactly one DOCTYPE, html, head, and body tags (no duplicate merge artifacts)
  const doctypes = html.match(/<!DOCTYPE html>/gi) || [];
  assert.equal(doctypes.length, 1, "Must contain exactly 1 <!DOCTYPE html>");

  const htmlOpenTags = html.match(/<html(\s|>)/gi) || [];
  assert.equal(htmlOpenTags.length, 1, "Must contain exactly 1 <html> opening tag");

  const closingHtmls = html.match(/<\/html>/gi) || [];
  assert.equal(closingHtmls.length, 1, "Must contain exactly 1 </html> tag");

  const headOpenTags = html.match(/<head(\s|>)/gi) || [];
  assert.equal(headOpenTags.length, 1, "Must contain exactly 1 <head> opening tag");

  const headCloseTags = html.match(/<\/head>/gi) || [];
  assert.equal(headCloseTags.length, 1, "Must contain exactly 1 </head> closing tag");

  const bodyOpenTags = html.match(/<body(\s|>)/gi) || [];
  assert.equal(bodyOpenTags.length, 1, "Must contain exactly 1 <body> opening tag");

  const bodyCloseTags = html.match(/<\/body>/gi) || [];
  assert.equal(bodyCloseTags.length, 1, "Must contain exactly 1 </body> closing tag");

  // 2. Strict ID uniqueness across all static HTML tags
  const idMatches = [...html.matchAll(/\sid=[\x22']([^'\x22]+)[\x22']/gi)].map((m) => m[1]);
  const counts = {};
  idMatches.forEach((id) => {
    counts[id] = (counts[id] || 0) + 1;
  });
  const duplicates = Object.entries(counts).filter(([id, count]) => count > 1);
  assert.equal(
    duplicates.length,
    0,
    `All static HTML tag IDs must be strictly unique. Found duplicates: ${JSON.stringify(duplicates)}`
  );

  // 3. Verify all S-35 summary stat element IDs exist including restored statTotalLevels
  assert.match(html, /id=["']statTotalDescendants["']/, "Must contain #statTotalDescendants");
  assert.match(html, /id=["']statTotalLevels["']/, "Must contain #statTotalLevels");
  assert.match(html, /Số tầng phân nhánh/, "Must contain 'Số tầng phân nhánh' label");
  assert.match(html, /id=["']statTotalRecallable["']/, "Must contain #statTotalRecallable");
  assert.match(html, /id=["']statRecallablePercent["']/, "Must contain #statRecallablePercent");
  assert.match(html, /id=["']statTotalConsumed["']/, "Must contain #statTotalConsumed");
  assert.match(html, /id=["']statConsumedPercent["']/, "Must contain #statConsumedPercent");
  assert.match(html, /id=["']statTotalRemaining["']/, "Must contain #statTotalRemaining");
  assert.match(html, /id=["']statTotalOrgs["']/, "Must contain #statTotalOrgs");
  assert.match(html, /id=["']statTotalLocations["']/, "Must contain #statTotalLocations");

  // 4. Verify S-35 progress bar elements
  assert.match(html, /id=["']recallStatusBarCard["']/, "Must contain #recallStatusBarCard");
  assert.match(html, /id=["']barFillRecallable["']/, "Must contain #barFillRecallable");
  assert.match(html, /id=["']barFillConsumed["']/, "Must contain #barFillConsumed");
  assert.match(html, /id=["']barTextRecallable["']/, "Must contain #barTextRecallable");
  assert.match(html, /id=["']barTextConsumed["']/, "Must contain #barTextConsumed");

  // 5. Verify S-35 organization grouping filter & table
  assert.match(html, /id=["']recallOrgFilter["']/, "Must contain #recallOrgFilter");
  assert.match(html, /id=["']recallTableBody["']/, "Must contain #recallTableBody");

  // 6. Verify table columns
  assert.match(html, /Khối lượng ban đầu/, "Must have 'Khối lượng ban đầu' table column");
  assert.match(html, /Còn thu hồi được/, "Must have 'Còn thu hồi được' table column");
  assert.match(html, /Đã bán \/ Tiêu thụ/, "Must have 'Đã bán / Tiêu thụ' table column");

  // 7. Verify S-34 UI controls and pre-existing key action forms are preserved
  assert.match(html, /id=["']openRecallModal["']/, "Must preserve S-34 #openRecallModal");
  assert.match(html, /id=["']openRecallForm["']/, "Must preserve S-34 #openRecallForm");
  assert.match(html, /id=["']btnOpenRecallHero["']/, "Must preserve S-34 #btnOpenRecallHero");
  assert.match(html, /id=["']btnOpenRecallFromDropdown["']/, "Must preserve S-34 #btnOpenRecallFromDropdown");
  assert.match(html, /id=["']transferModal["']/, "Must preserve #transferModal");
  assert.match(html, /id=["']transferForm["']/, "Must preserve #transferForm");
  assert.match(html, /id=["']rejectTransferModal["']/, "Must preserve #rejectTransferModal");
  assert.match(html, /id=["']rejectTransferForm["']/, "Must preserve #rejectTransferForm");
  assert.match(html, /id=["']confirmTransferModal["']/, "Must preserve #confirmTransferModal");
  assert.match(html, /id=["']genealogyTreeContainer["']/, "Must preserve #genealogyTreeContainer");
  assert.match(html, /id=["']traceForwardSection["']/, "Must preserve #traceForwardSection");
});

// ============================================================================
// Test 2: AC1 & AC2 20-lot Recall Scenario with Quantities & Status Separation
// ============================================================================
test("S-35 / N2-103 AC1 & AC2: 20-lot scenario separates recallable vs marketed and groups by organization", () => {
  const { elements, renderTraceForwardResults } = setupMockEnv();

  // Create 20 descendants matching Jira N2-103 acceptance criteria
  const descendants = [];

  // 5 lots at ORG-DIST-NORTH, LOC-WH-HN-01 (400 kg remaining, 100 kg consumed)
  for (let i = 1; i <= 5; i++) {
    const id = `LOT-CHILD-2026-${String(i).padStart(2, "0")}`;
    descendants.push({
      id,
      name: `Sản phẩm ${id}`,
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-DIST-NORTH",
      organizationName: "Công ty Phân phối Miền Bắc",
      locationId: "LOC-WH-HN-01",
      locationName: "Tổng kho Lạnh Hà Nội",
      locationAddress: "Cụm Công nghiệp Quang Minh, Hà Nội",
      status: "Đang lưu kho",
      initialQuantity: 500,
      remainingQuantity: 400,
      consumedQuantity: 100,
      productUnit: "kg",
    });
  }

  // 5 lots at ORG-DIST-SOUTH, LOC-WH-SG-01 (350 kg remaining, 150 kg consumed)
  for (let i = 6; i <= 10; i++) {
    const id = `LOT-CHILD-2026-${String(i).padStart(2, "0")}`;
    descendants.push({
      id,
      name: `Sản phẩm ${id}`,
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-DIST-SOUTH",
      organizationName: "Công ty Phân phối Miền Nam",
      locationId: "LOC-WH-SG-01",
      locationName: "Tổng kho Lạnh Sài Gòn",
      locationAddress: "KCN Tân Bình, TP.HCM",
      status: "Đang lưu kho",
      initialQuantity: 500,
      remainingQuantity: 350,
      consumedQuantity: 150,
      productUnit: "kg",
    });
  }

  // 5 lots at ORG-RETAIL-CHAIN, LOC-STORE-D1 (0 kg remaining, 500 kg consumed - Đã bán hết)
  for (let i = 11; i <= 15; i++) {
    const id = `LOT-CHILD-2026-${String(i).padStart(2, "0")}`;
    descendants.push({
      id,
      name: `Sản phẩm ${id}`,
      relationType: "SPLIT",
      distance: 2,
      organizationId: "ORG-RETAIL-CHAIN",
      organizationName: "Chuỗi Bán lẻ FreshMart",
      locationId: "LOC-STORE-D1",
      locationName: "FreshMart Quận 1",
      locationAddress: "123 Lê Lợi, Quận 1, TP.HCM",
      status: "Đã bán hết",
      initialQuantity: 500,
      remainingQuantity: 0,
      consumedQuantity: 500,
      productUnit: "kg",
    });
  }

  // 5 lots at ORG-RETAIL-CHAIN, LOC-STORE-CG (500 kg remaining, 0 kg consumed - Còn nguyên tại cửa hàng)
  for (let i = 16; i <= 20; i++) {
    const id = `LOT-CHILD-2026-${String(i).padStart(2, "0")}`;
    descendants.push({
      id,
      name: `Sản phẩm ${id}`,
      relationType: "MERGE",
      isMultiSourceMerge: true,
      mergedSources: [{ parentBatchId: "LOT-F0-01", quantity: 250 }, { parentBatchId: "LOT-F0-02", quantity: 250 }],
      sourcesCount: 2,
      distance: 2,
      organizationId: "ORG-RETAIL-CHAIN",
      organizationName: "Chuỗi Bán lẻ FreshMart",
      locationId: "LOC-STORE-CG",
      locationName: "FreshMart Cầu Giấy",
      locationAddress: "45 Cầu Giấy, Hà Nội",
      status: "Đang lưu kho",
      initialQuantity: 500,
      remainingQuantity: 500,
      consumedQuantity: 0,
      productUnit: "kg",
    });
  }

  const payload = {
    descendants,
    levels: [{ level: 0 }, { level: 1 }, { level: 2 }],
    recallSummary: {
      totalLots: 20,
      totalRecallableQuantity: 6250,
      totalConsumedQuantity: 3750,
      totalInitialQuantity: 10000,
      recallablePercentage: 62.5,
      consumedPercentage: 37.5,
    },
    locationSummary: [
      { locationId: "LOC-WH-HN-01", locationName: "Tổng kho Lạnh Hà Nội", lotsCount: 5, totalRemainingQuantity: 2000, totalConsumedQuantity: 500, unit: "kg" },
      { locationId: "LOC-WH-SG-01", locationName: "Tổng kho Lạnh Sài Gòn", lotsCount: 5, totalRemainingQuantity: 1750, totalConsumedQuantity: 750, unit: "kg" },
      { locationId: "LOC-STORE-D1", locationName: "FreshMart Quận 1", lotsCount: 5, totalRemainingQuantity: 0, totalConsumedQuantity: 2500, unit: "kg" },
      { locationId: "LOC-STORE-CG", locationName: "FreshMart Cầu Giấy", lotsCount: 5, totalRemainingQuantity: 2500, totalConsumedQuantity: 0, unit: "kg" },
    ],
  };

  renderTraceForwardResults(payload);

  // 1. Thống kê tóm tắt
  assert.equal(elements.statTotalDescendants.textContent, 20);
  assert.equal(elements.statTotalLevels.textContent, 3, "Có 3 tầng phân nhánh trong phả hệ");
  assert.equal(elements.statTotalOrgs.textContent, 3, "Có 3 tổ chức khác nhau nắm giữ");
  assert.equal(elements.statTotalLocations.textContent, 4, "Có 4 địa điểm kho bãi/cửa hàng");
  assert.equal(elements.statTotalRecallable.textContent, "6250.00 kg", "Còn thu hồi được phải là 6250.00 kg");
  assert.equal(elements.statRecallablePercent.textContent, "62.5% thu hồi được");
  assert.equal(elements.statTotalConsumed.textContent, "3750.00 kg", "Đã ra thị trường phải là 3750.00 kg");
  assert.equal(elements.statConsumedPercent.textContent, "37.5% ra thị trường");
  assert.equal(elements.statTotalRemaining.textContent, "10000.00 kg");

  // 2. Thanh tiến độ đối soát S-35
  assert.equal(elements.recallStatusBarCard.style.display, "block");
  assert.equal(elements.barFillRecallable.style.width, "62.5%");
  assert.equal(elements.barFillConsumed.style.width, "37.5%");
  assert.match(elements.barTextRecallable.textContent, /6250\.00 kg.*62\.5%/);
  assert.match(elements.barTextConsumed.textContent, /3750\.00 kg.*37\.5%/);

  // 3. Phân bổ theo địa điểm lưu kho (S-27 & S-35)
  assert.equal(elements.locationSummaryCard.style.display, "block");
  assert.match(elements.locationSummaryList.innerHTML, /Tổng kho Lạnh Hà Nội/);
  assert.match(elements.locationSummaryList.innerHTML, /Còn: 2000\.00 kg/);
  assert.match(elements.locationSummaryList.innerHTML, /Đã bán: 500\.00 kg/);
  assert.match(elements.locationSummaryList.innerHTML, /FreshMart Quận 1/);
  assert.match(elements.locationSummaryList.innerHTML, /Còn: 0\.00 kg/);
  assert.match(elements.locationSummaryList.innerHTML, /Đã bán: 2500\.00 kg/);

  // 4. Nhóm theo tổ chức (NFR: mỗi bên xem được phần của mình)
  assert.equal(elements.recallOrgFilter.disabled, false);
  assert.match(elements.recallOrgFilter.innerHTML, /Tất cả tổ chức \(20 lô\)/);
  assert.match(elements.recallOrgFilter.innerHTML, /Công ty Phân phối Miền Bắc \(5 lô\)/);
  assert.match(elements.recallOrgFilter.innerHTML, /Công ty Phân phối Miền Nam \(5 lô\)/);
  assert.match(elements.recallOrgFilter.innerHTML, /Chuỗi Bán lẻ FreshMart \(10 lô\)/);

  // 5. Kiểm tra các hàng tiêu đề nhóm tổ chức trong bảng thu hồi
  const tableHtml = elements.recallTableBody.innerHTML;
  assert.match(tableHtml, /Tổ chức: Công ty Phân phối Miền Bắc/);
  assert.match(tableHtml, /5 lô liên đới/);
  assert.match(tableHtml, /Còn thu hồi: <strong[^>]*>2000\.00 kg<\/strong>/);
  assert.match(tableHtml, /Đã ra thị trường: <strong[^>]*>500\.00 kg<\/strong>/);

  assert.match(tableHtml, /Tổ chức: Công ty Phân phối Miền Nam/);
  assert.match(tableHtml, /5 lô liên đới/);
  assert.match(tableHtml, /Còn thu hồi: <strong[^>]*>1750\.00 kg<\/strong>/);
  assert.match(tableHtml, /Đã ra thị trường: <strong[^>]*>750\.00 kg<\/strong>/);

  assert.match(tableHtml, /Tổ chức: Chuỗi Bán lẻ FreshMart/);
  assert.match(tableHtml, /10 lô liên đới/);
  assert.match(tableHtml, /Còn thu hồi: <strong[^>]*>2500\.00 kg<\/strong>/);
  assert.match(tableHtml, /Đã ra thị trường: <strong[^>]*>2500\.00 kg<\/strong>/);

  // 6. Kiểm tra từng dòng lô hàng có đầy đủ thông tin: tổ chức, địa điểm, khối lượng còn lại, đã tiêu thụ
  assert.match(tableHtml, /LOT-CHILD-2026-01/);
  assert.match(tableHtml, /400\.00 kg/);
  assert.match(tableHtml, /100\.00 kg/);
  assert.match(tableHtml, /LOT-CHILD-2026-11/);
  assert.match(tableHtml, /0\.00 kg/);
  assert.match(tableHtml, /500\.00 kg/);
  assert.match(tableHtml, /Đã bán hết/);

  // Kiểm tra đủ cả 20 mã lô liên đới xuất hiện trong bảng thu hồi
  for (let i = 1; i <= 20; i++) {
    const lotId = `LOT-CHILD-2026-${String(i).padStart(2, "0")}`;
    assert.match(tableHtml, new RegExp(lotId), `Bảng phải hiển thị lô ${lotId}`);
  }

  // 6b. Kiểm tra cấu trúc phân nhóm 20 lô và tính năng lọc theo tổ chức
  const orgRows = elements.recallTableBody.querySelectorAll(".org-group-row");
  assert.equal(orgRows.length, 23, "Phải có 3 hàng tiêu đề nhóm tổ chức + 20 hàng lô = 23 hàng");

  // Lọc theo Công ty Phân phối Miền Bắc (5 lô)
  elements.recallOrgFilter.value = "ORG-DIST-NORTH";
  elements.recallOrgFilter.onchange();
  const northVisible = orgRows.filter((r) => r.style.display !== "none");
  const northHidden = orgRows.filter((r) => r.style.display === "none");
  assert.equal(northVisible.length, 6, "1 header + 5 lô của ORG-DIST-NORTH phải hiển thị");
  assert.equal(northHidden.length, 17, "Các lô và header thuộc tổ chức khác phải bị ẩn");

  // Lọc theo Chuỗi Bán lẻ FreshMart (10 lô)
  elements.recallOrgFilter.value = "ORG-RETAIL-CHAIN";
  elements.recallOrgFilter.onchange();
  const retailVisible = orgRows.filter((r) => r.style.display !== "none");
  assert.equal(retailVisible.length, 11, "1 header + 10 lô của FreshMart phải hiển thị");

  // Quay lại Tất cả tổ chức (20 lô)
  elements.recallOrgFilter.value = "ALL";
  elements.recallOrgFilter.onchange();
  assert.ok(orgRows.every((r) => r.style.display === ""), "Tất cả 23 hàng phải hiển thị khi chọn ALL");

  // 7. S-34: Kiểm tra lô gộp đa nguồn hiển thị badge đúng
  assert.match(tableHtml, /LOT-CHILD-2026-16/);
  assert.match(tableHtml, /Gộp đa nguồn \(2\)/);
  assert.match(tableHtml, /Lô gộp từ các nguồn: LOT-F0-01 \(250kg\), LOT-F0-02 \(250kg\)/);
});

// ============================================================================
// Test 3: Explicit Unknown for Null/Missing Data (No fake zero / fake success)
// ============================================================================
test("S-35 / N2-103: keeps null/missing data explicitly unknown instead of fake zero/success", () => {
  const { elements, renderTraceForwardResults } = setupMockEnv();

  const descendants = [
    {
      id: "LOT-NULL-01",
      name: "Lô hàng thiếu dữ liệu",
      relationType: "SPLIT",
      distance: 1,
      organizationId: null,
      organizationName: null,
      locationId: null,
      locationName: null,
      locationAddress: null,
      status: null,
      initialQuantity: null,
      remainingQuantity: null,
      consumedQuantity: null,
      productUnit: "kg",
    },
  ];

  const payload = {
    descendants,
    locationSummary: [
      {
        locationId: null,
        locationName: null,
        lotsCount: 1,
        totalRemainingQuantity: null,
        totalConsumedQuantity: null,
        unit: "kg",
      },
    ],
  };

  renderTraceForwardResults(payload);

  // Phải giữ nguyên không xác định (--) thay vì tự bịa số 0.00 kg
  assert.equal(elements.statTotalRemaining.textContent, "--");
  assert.equal(elements.statTotalRecallable.textContent, "--");
  assert.equal(elements.statTotalConsumed.textContent, "--");
  assert.equal(elements.statRecallablePercent.textContent, "--");
  assert.equal(elements.statConsumedPercent.textContent, "--");

  // Không hiển thị thanh tiến độ khi dữ liệu không xác định
  assert.equal(elements.recallStatusBarCard.style.display, "none");

  // Kiểm tra bảng thu hồi: lô hiển thị "--" cho các số lượng
  const tableHtml = elements.recallTableBody.innerHTML;
  assert.match(tableHtml, /LOT-NULL-01/);
  assert.match(tableHtml, /Chưa xác định/);
  assert.match(tableHtml, /--/);

  // Kiểm tra location summary không bịa 0.00 kg
  const locHtml = elements.locationSummaryList.innerHTML;
  assert.match(locHtml, /Còn: -- kg/);
  assert.match(locHtml, /Đã bán: -- kg/);
});

// ============================================================================
// Test 4: Empty Descendants State (Leaf Lot)
// ============================================================================
test("S-35 / N2-103: handles empty descendants gracefully", () => {
  const { elements, renderTraceForwardResults } = setupMockEnv();

  const payload = {
    descendants: [],
    levels: [],
    locationSummary: [],
  };

  renderTraceForwardResults(payload);

  assert.equal(elements.statTotalDescendants.textContent, 0);
  assert.equal(elements.statTotalLevels.textContent, 0);
  assert.equal(elements.statTotalOrgs.textContent, 0);
  assert.equal(elements.statTotalLocations.textContent, 0);
  assert.equal(elements.recallStatusBarCard.style.display, "none");
  assert.equal(elements.locationSummaryCard.style.display, "none");

  assert.match(elements.recallTableBody.innerHTML, /Không có lô hậu duệ nào cần khoanh vùng thu hồi/);
  assert.equal(elements.recallOrgFilter.disabled, true);
});

// ============================================================================
// Test 5: Error State & Cycle Detection Handling
// ============================================================================
test("S-35 / N2-103: lot-detail.html defines error and cycle handling logic", () => {
  const html = readFrontendFile("lot-detail.html");

  // Cycle detection handler
  assert.match(html, /CYCLE_DETECTED/, "Must handle CYCLE_DETECTED error");
  assert.match(html, /cycleDangerBanner/, "Must toggle #cycleDangerBanner");
  assert.match(html, /cycleBannerTitle/, "Must update #cycleBannerTitle");
  assert.match(html, /cycleBannerDesc/, "Must update #cycleBannerDesc");

  // Error alert handler
  assert.match(html, /Không thể truy xuất hậu duệ của lô hàng/, "Must notify on failed trace forward response");
});

// ============================================================================
// Test 6: Working Pre-existing UI Handlers & Action Forms
// ============================================================================
test("S-40 Regression: Pre-existing UI handlers (transfer, reject, genealogy, recall) are fully wired and functional", async () => {
  const env = setupMockEnv();
  const html = readFrontendFile("lot-detail.html");

  // 1. Transfer Modal Handler Execution
  const mockOrgs = [
    { id: "ORG-DIST-01", name: "Công ty Phân phối 1" },
    { id: "ORG-COOP-01", name: "Hợp tác xã 1" },
    { id: "org-inspector", name: "Thanh tra" },
    { id: "ORG-PRODUCER-MINE", name: "Trang trại của tôi" },
  ];
  const mockUser = { organizationId: "ORG-PRODUCER-MINE" };

  await env.openDetailTransferModal("LOT-2026-TEST", "Lô Chè Shan Tuyết", async () => mockOrgs, mockUser);

  assert.equal(env.elements.transferModal.style.display, "flex");
  assert.equal(env.elements.transferLotTitle.textContent, "Lô Chè Shan Tuyết");
  assert.equal(env.elements.transferLotId.textContent, "LOT-2026-TEST");
  assert.equal(env.elements.transferLotIdInput.value, "LOT-2026-TEST");
  // Ensure filtered org list does not contain myOrgId or org-inspector
  assert.match(env.elements.transferToOrg.innerHTML, /ORG-DIST-01/);
  assert.match(env.elements.transferToOrg.innerHTML, /ORG-COOP-01/);
  assert.doesNotMatch(env.elements.transferToOrg.innerHTML, /org-inspector/);

  // 2. Reject Modal Handler Execution
  env.openDetailRejectModal("TR-TEST-888", "LOT-2026-TEST", "Lô Chè Shan Tuyết");
  assert.equal(env.elements.rejectTransferModal.style.display, "flex");
  assert.equal(env.elements.rejectLotTitle.textContent, "Lô Chè Shan Tuyết");
  assert.equal(env.elements.rejectLotId.textContent, "LOT-2026-TEST");
  assert.equal(env.elements.rejectTransferIdInput.value, "TR-TEST-888");
  assert.equal(env.elements.rejectReason.value, "");

  // 3. Recall Modal Handler Execution
  env.openRecallModalHandler({ id: "LOT-2026-TEST", name: "Lô Chè Shan Tuyết" });
  assert.equal(env.elements.openRecallModal.style.display, "flex");
  assert.equal(env.elements.recallModalLotTitle.textContent, "Lô Chè Shan Tuyết");
  assert.equal(env.elements.recallModalLotId.textContent, "LOT-2026-TEST");
  assert.equal(env.elements.recallReason.value, "");
  assert.equal(env.elements.recallSeverity.value, "HIGH");

  // 4. Verify Action Form submissions target contract-compliant endpoints
  assert.match(html, /fetch\(\s*`\/api\/transfers\/\$\{encodeURIComponent\(transferId\)\}\/reject`/, "Reject must target /api/transfers/:id/reject");
  assert.match(html, /fetch\(\s*`\/api\/transfers\/\$\{encodeURIComponent\(transferId\)\}\/confirm`/, "Confirm must target /api/transfers/:id/confirm");
  assert.match(html, /fetch\(\s*[`'"]\/api\/recalls[`'"]\s*,\s*\{\s*method:\s*[`'"]POST[`'"]/, "Open recall must target POST /api/recalls");
  assert.match(html, /fetch\(\s*`\/api\/lots\/\$\{encodeURIComponent\(targetId\)\}\/genealogy`/, "Genealogy must target /api/lots/:id/genealogy");
  assert.match(html, /fetch\(\s*`\/api\/lots\/\$\{encodeURIComponent\(lotId\)\}\/descendants`/, "Trace forward must target /api/lots/:id/descendants");
});

// ============================================================================
// Test 7: Contract Compliance Against 110912f & No Fake Backend S35 Claim
// ============================================================================
test("S-40 Contract Compliance against 110912f: Actual request URLs, permissions/error states, and canonical string recall IDs", () => {
  const html = readFrontendFile("lot-detail.html");

  // 1. Verify credentials: same-origin across all critical network calls
  assert.match(html, /fetch\(\s*[`'"]\/api\/lots\/merge[`'"][\s\S]*?credentials:\s*['"]same-origin['"]/, "Merge must send same-origin credentials");
  assert.match(html, /fetch\(\s*[`'"]\/api\/recalls[`'"][\s\S]*?credentials:\s*['"]same-origin['"]/, "Recall creation must send same-origin credentials");
  assert.match(html, /fetch\(\s*`\/api\/lots\/\$\{encodeURIComponent\(targetId\)\}\/genealogy`[\s\S]*?credentials:\s*['"]same-origin['"]/, "Genealogy must send same-origin credentials");
  assert.match(html, /fetch\(\s*`\/api\/lots\/\$\{encodeURIComponent\(lotId\)\}\/descendants`[\s\S]*?credentials:\s*['"]same-origin['"]/, "Descendants must send same-origin credentials");
  assert.match(html, /fetch\(\s*`\/api\/transfers\/\$\{encodeURIComponent\(transferId\)\}\/reject`[\s\S]*?credentials:\s*['"]same-origin['"]/, "Reject must send same-origin credentials");
  assert.match(html, /fetch\(\s*`\/api\/transfers\/\$\{encodeURIComponent\(transferId\)\}\/confirm`[\s\S]*?credentials:\s*['"]same-origin['"]/, "Confirm must send same-origin credentials");

  // 2. Canonical string recall IDs (e.g., REC-20261017-ABC999)
  // Verify recallOrder ID handling supports string IDs (no parseInt truncation)
  assert.match(html, /data\.recallOrder\s*\?\s*data\.recallOrder\.id\s*:\s*''/, "Must treat recallOrder.id as canonical string without parseInt coercion");

  // 3. UI handles server error responses directly without claiming Backend S-35 API
  // Frontend trace forward grouping and reconciliation is self-contained client logic
  assert.match(html, /data\.recallSummary/, "Consumes optional backend recallSummary if present");
  assert.match(html, /data\.descendants/, "Safely handles direct descendants array when backend recallSummary is absent");

  // 4. Permissions & error states
  assert.match(html, /throw new Error\(data\.message\s*\|\|\s*data\.error/, "Propagates server error messages verbatim");
  assert.match(html, /res\.status\s*===\s*422\s*\|\|\s*data\.error\s*===\s*["']CYCLE_DETECTED["']/, "Recognizes 422 CYCLE_DETECTED status code");
});

// ============================================================================
// Test 8: S-35 Example: 100kg lot with 20kg purchased and 80kg moved into child lot
// ============================================================================
test("S-35: 100kg lot with 20kg purchased and 80kg moved into child lot displays exact API quantities and avoids multi-level initial total", () => {
  const { elements, renderTraceForwardResults } = setupMockEnv();

  // Specification example:
  // "Example: a 100kg lot has 20kg purchased and 80kg moved into a child lot;
  // show 20kg purchased and 80kg available in the child."
  const descendants = [
    {
      id: "LOT-F0-100",
      name: "Lô nguyên liệu ban đầu",
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-PROD",
      organizationName: "Nông trường Chè",
      locationId: "LOC-WH-FARM",
      locationName: "Kho Nông trường",
      status: "Đang lưu kho",
      initialQuantity: 100,
      remainingQuantity: 0, // 80kg moved into child lot, 0kg left in parent
      consumedQuantity: 20, // 20kg purchased by customers
      productUnit: "kg",
    },
    {
      id: "LOT-F1-080",
      name: "Lô thành phẩm tách từ F0",
      relationType: "SPLIT",
      distance: 2,
      organizationId: "ORG-DIST",
      organizationName: "Kho Phân phối",
      locationId: "LOC-WH-DIST",
      locationName: "Kho Lạnh Phân Phối",
      status: "Đang lưu kho",
      initialQuantity: 80,
      remainingQuantity: 80, // 80kg available in child
      consumedQuantity: 0,  // 0kg purchased from child yet
      productUnit: "kg",
    },
  ];

  const levels = [
    { level: 1, lots: [descendants[0]] },
    { level: 2, lots: [descendants[1]] },
  ];

  // Case A: When server recallSummary is ABSENT
  renderTraceForwardResults({ descendants, levels });

  const tableHtml = elements.recallTableBody.innerHTML;
  const treeHtml = elements.lineageTreeContainer.innerHTML;

  // 1. Table assertions:
  // Parent LOT-F0-100 must show 20.00 kg consumed (purchased), NOT 100.00 kg (from 100 - 0)
  assert.match(tableHtml, /LOT-F0-100/);
  assert.match(tableHtml, /LOT-F1-080/);

  // 2. Tree assertions:
  assert.match(treeHtml, /LOT-F0-100[\s\S]*?Đã bán:<\/strong> <span[^>]*>20\.00 kg<\/span>/);
  assert.match(treeHtml, /LOT-F0-100[\s\S]*?Còn thu hồi:<\/strong> <span[^>]*>0\.00 kg<\/span>/);
  assert.match(treeHtml, /LOT-F1-080[\s\S]*?Đã bán:<\/strong> <span[^>]*>0\.00 kg<\/span>/);
  assert.match(treeHtml, /LOT-F1-080[\s\S]*?Còn thu hồi:<\/strong> <span[^>]*>80\.00 kg<\/span>/);

  // 3. Summary stats:
  // When recallSummary is absent, statTotalRemaining MUST NOT calculate misleading grand total (100 + 80 = 180kg)
  assert.equal(elements.statTotalRemaining.textContent, "--");
  // Total recallable is 0 + 80 = 80.00 kg
  assert.equal(elements.statTotalRecallable.textContent, "80.00 kg");
  // Total consumed is 20 + 0 = 20.00 kg
  assert.equal(elements.statTotalConsumed.textContent, "20.00 kg");
  assert.equal(elements.statRecallablePercent.textContent, "80.0% thu hồi được");
  assert.equal(elements.statConsumedPercent.textContent, "20.0% ra thị trường");

  // Case B: When server recallSummary IS present with canonical totals
  renderTraceForwardResults({
    descendants,
    levels,
    recallSummary: {
      totalLots: 2,
      totalRecallableQuantity: 80,
      totalConsumedQuantity: 20,
      totalInitialQuantity: 100,
      recallablePercentage: 80.0,
      consumedPercentage: 20.0,
    },
  });

  assert.equal(elements.statTotalRemaining.textContent, "100.00 kg");
  assert.equal(elements.statTotalRecallable.textContent, "80.00 kg");
  assert.equal(elements.statTotalConsumed.textContent, "20.00 kg");
  assert.equal(elements.statRecallablePercent.textContent, "80.0% thu hồi được");
  assert.equal(elements.statConsumedPercent.textContent, "20.0% ra thị trường");
});

// ============================================================================
// Test 9: S-35 Absent Values: Missing numeric data shows unavailable label (--), not fabricated 0
// ============================================================================
test("S-35: missing numeric data displays unavailable label (--) instead of fabricated 0 or derived values", () => {
  const { elements, renderTraceForwardResults } = setupMockEnv();

  const descendants = [
    {
      id: "LOT-ABSENT-REM",
      name: "Lô khuyết remainingQuantity",
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-A",
      organizationName: "Tổ chức A",
      locationId: "LOC-A",
      locationName: "Kho A",
      status: "Đang lưu kho",
      initialQuantity: 100,
      remainingQuantity: null, // missing remainingQuantity
      consumedQuantity: 25,
      productUnit: "kg",
    },
    {
      id: "LOT-ABSENT-CONS",
      name: "Lô khuyết consumedQuantity",
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-B",
      organizationName: "Tổ chức B",
      locationId: "LOC-B",
      locationName: "Kho B",
      status: "Đang lưu kho",
      initialQuantity: 100,
      remainingQuantity: 100,
      consumedQuantity: null, // missing consumedQuantity: must NOT calculate (100 - 100) = 0.00 kg!
      productUnit: "kg",
    },
    {
      id: "LOT-ABSENT-ALL",
      name: "Lô khuyết toàn bộ số lượng",
      relationType: "SPLIT",
      distance: 1,
      organizationId: "ORG-C",
      organizationName: "Tổ chức C",
      locationId: "LOC-C",
      locationName: "Kho C",
      status: null,
      initialQuantity: null,
      remainingQuantity: null,
      consumedQuantity: null,
      productUnit: "kg",
    },
  ];

  const levels = [{ level: 1, lots: descendants }];

  renderTraceForwardResults({ descendants, levels });

  const tableHtml = elements.recallTableBody.innerHTML;
  const treeHtml = elements.lineageTreeContainer.innerHTML;

  // LOT-ABSENT-REM: remaining is "--", consumed is "25.00 kg"
  assert.match(treeHtml, /LOT-ABSENT-REM[\s\S]*?Còn thu hồi:<\/strong> <span[^>]*>--<\/span>/);
  assert.match(treeHtml, /LOT-ABSENT-REM[\s\S]*?Đã bán:<\/strong> <span[^>]*>25\.00 kg<\/span>/);

  // LOT-ABSENT-CONS: remaining is "100.00 kg", consumed is "--" (NOT fabricated 0.00 kg)
  assert.match(treeHtml, /LOT-ABSENT-CONS[\s\S]*?Còn thu hồi:<\/strong> <span[^>]*>100\.00 kg<\/span>/);
  assert.match(treeHtml, /LOT-ABSENT-CONS[\s\S]*?Đã bán:<\/strong> <span[^>]*>--<\/span>/);

  // LOT-ABSENT-ALL: both are "--"
  assert.match(treeHtml, /LOT-ABSENT-ALL[\s\S]*?Còn thu hồi:<\/strong> <span[^>]*>--<\/span>/);
  assert.match(treeHtml, /LOT-ABSENT-ALL[\s\S]*?Đã bán:<\/strong> <span[^>]*>--<\/span>/);

  // In table view, verify "--" is rendered for absent fields
  assert.match(tableHtml, /LOT-ABSENT-CONS/);
  assert.doesNotMatch(tableHtml, /<tr[^>]*data-org-key="ORG-B"[^>]*>[\s\S]*?<td[^>]*>\s*0\.00 kg\s*<\/td>/);

  // Grand total initial quantity without server recallSummary must be "--"
  assert.equal(elements.statTotalRemaining.textContent, "--");
});

