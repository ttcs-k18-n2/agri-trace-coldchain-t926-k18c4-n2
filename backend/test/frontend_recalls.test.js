const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../../frontend");

// Helper: load HTML file content
function readFrontendFile(fileName) {
  return fs.readFileSync(path.join(frontendDir, fileName), "utf8");
}

test("S-40 / S-36: recall-form.html contains required form elements and binds app shell", () => {
  const html = readFrontendFile("recall-form.html");

  // Shell header and script integration
  assert.match(html, /<header class=["']app-header["']>/, "Must contain app-header");
  assert.match(html, /<script src=["']\/app-shell\.js["']>/, "Must load app-shell.js");
  assert.match(html, /initAppShell/, "Must initialize app shell");

  // Core form elements
  assert.match(html, /<form[^>]*id=["']recallForm["']/, "Must contain #recallForm");
  assert.match(html, /id=["']recall_id["']/, "Must contain #recall_id input");
  assert.match(html, /id=["']org_name["']/, "Must contain #org_name element");
  assert.match(html, /id=["']note["']/, "Must contain #note textarea");
  assert.match(html, /id=["']btnSubmit["']/, "Must contain #btnSubmit button");

  // Loading & Alert elements
  assert.match(html, /id=["']alertSuccess["']/, "Must contain #alertSuccess container");
  assert.match(html, /id=["']alertError["']/, "Must contain #alertError container");
  assert.match(html, /id=["']pendingAckPrompt["']/, "Must contain #pendingAckPrompt banner");
  assert.match(html, /id=["']alreadyAckBanner["']/, "Must contain #alreadyAckBanner banner");
  assert.match(html, /class=["']spinner["']/, "Must define spinner class for loading state");

  // Navigation to progress page
  assert.match(html, /href=["']\/recall-progress\.html[^"']*["']/, "Must link to recall-progress.html");
});

test("S-40 / S-36: recall-form.html implements contract-compliant submission with loading/error/success states", () => {
  const html = readFrontendFile("recall-form.html");

  // Must call POST /api/recalls/:id/acknowledgments with credentials: same-origin
  assert.match(html, /\/api\/recalls\/["']\s*\+\s*encodeURIComponent\(recallId\)\s*\+\s*["']\/acknowledgments/, "Must target correct API endpoint");
  assert.match(html, /credentials:\s*['"]same-origin['"]/, "Must include same-origin credentials for server session auth");
  assert.match(html, /method:\s*['"]POST['"]/, "Must use POST method");

  // Server derives org from auth, so payload only requires note?
  assert.match(html, /payload\.note\s*=\s*note/, "Must package note in submission payload");

  // Loading state handling: disables submit button and inputs
  assert.match(html, /btnSubmit\.disabled\s*=\s*true/, "Must disable submit button during submission");
  assert.match(html, /btnSubmitText\.innerHTML\s*=\s*.*spinner/, "Must show spinner on submit button during loading");
  assert.match(html, /btnSubmit\.disabled\s*=\s*false/, "Must re-enable submit button in finally block");

  // Success state handling
  assert.match(html, /alertSuccess\.style\.display\s*=\s*['"]flex['"]|alertSuccess\.style\.display\s*=\s*['"]block['"]/, "Must display alertSuccess on 200/201");
  assert.match(html, /alertSuccessMessage/, "Must populate alertSuccessMessage");

  // Error state handling
  assert.match(html, /alertError\.style\.display\s*=\s*['"]flex['"]|alertError\.style\.display\s*=\s*['"]block['"]/, "Must display alertError on failure");
  assert.match(html, /alertErrorMessage/, "Must populate alertErrorMessage");
});

test("S-40 / S-37: recall-progress.html contains progress metrics, progress bar, and named pending list", () => {
  const html = readFrontendFile("recall-progress.html");

  // Shell header and script integration
  assert.match(html, /<header class=["']app-header["']>/, "Must contain app-header");
  assert.match(html, /<script src=["']\/app-shell\.js["']>/, "Must load app-shell.js");
  assert.match(html, /initAppShell/, "Must initialize app shell");

  // Progress UI components
  assert.match(html, /id=["']display_id["']/, "Must have #display_id");
  assert.match(html, /id=["']ack_count["']/, "Must have #ack_count");
  assert.match(html, /id=["']total_expected["']/, "Must have #total_expected");
  assert.match(html, /id=["']pending_count["']/, "Must have #pending_count");
  assert.match(html, /id=["']my_progress_bar["']/, "Must have #my_progress_bar");
  assert.match(html, /id=["']progress_percent_label["']/, "Must have #progress_percent_label");
  assert.match(html, /id=["']pendingOrgsList["']/, "Must have #pendingOrgsList");
  assert.match(html, /id=["']acknowledgedOrgsList["']/, "Must have #acknowledgedOrgsList");

  // Link to recall form
  assert.match(html, /href=["']\/recall-form\.html[^"']*["']/, "Must link to recall-form.html");
});

test("S-40 / S-37: recall-progress.html removes hardcoded mock progress and calls real API", () => {
  const html = readFrontendFile("recall-progress.html");

  // No old fetchMockData hardcoded mock
  assert.doesNotMatch(html, /function\s+fetchMockData/, "Must not contain fetchMockData");
  assert.doesNotMatch(html, /acknowledged_count:\s*35,\s*total_expected:\s*50/, "Must not contain hardcoded 35/50 mock");
  assert.doesNotMatch(html, /DEFAULT_EXPECTED_ORGS/, "Must not contain hardcoded DEFAULT_EXPECTED_ORGS array");

  // Calls real API contract: GET /api/recalls/:id/progress
  assert.match(html, /\/api\/recalls\/["']\s*\+\s*encodeURIComponent\(recallId\)\s*\+\s*["']\/progress/, "Must fetch /api/recalls/:id/progress");
  assert.match(html, /credentials:\s*['"]same-origin['"]/, "Must use same-origin credentials");
});

test("S-40 / S-37: renderProgressData correctly handles contract data with 3/5 and named pending orgs", () => {
  const html = readFrontendFile("recall-progress.html");

  // Create isolated DOM mock environment to test renderProgressData logic
  const mockElements = {
    display_id: { textContent: "" },
    ack_count: { textContent: "" },
    total_expected: { textContent: "" },
    pending_count: { textContent: "" },
    my_progress_bar: { style: { width: "" }, textContent: "" },
    progress_percent_label: { textContent: "" },
    progressSummaryText: { textContent: "" },
    pendingBadgeCount: { textContent: "" },
    ackBadgeCount: { textContent: "" },
    pendingOrgsList: {
      innerHTML: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    },
    acknowledgedOrgsList: {
      innerHTML: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    },
    emptyAckNotice: { style: { display: "none" } },
    pendingAckPrompt: { style: { display: "none" } },
    userPendingOrgName: { textContent: "" },
    userPendingRecallId: { textContent: "" },
    linkSubmitPending: { href: "" },
    recall_id_input: { value: "1" },
  };

  const documentMock = {
    getElementById(id) {
      const el = mockElements[id] || { textContent: "", style: {}, appendChild() {} };
      if (!el.addEventListener) el.addEventListener = () => {};
      return el;
    },
    createElement(tag) {
      return {
        tagName: tag,
        className: "",
        innerHTML: "",
        style: {},
      };
    },
  };

  // Evaluate the render logic extracted or via VM
  const vm = require("node:vm");
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let code = "";
  while ((match = scriptRegex.exec(html)) !== null) {
    code = match[1];
  }

  const context = {
    window: {
      location: { search: "" },
    },
    document: documentMock,
    sessionStorage: { getItem: () => null, setItem: () => null },
    URLSearchParams: class {
      get() { return null; }
    },
    fetch: async () => ({ ok: false }),
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context);

  assert.equal(typeof context.window.renderProgressData, "function", "renderProgressData must be exposed");

  // Test data representing 3/5 progress with 2 named pending organizations
  const testContractData = {
    recall_id: 1,
    acknowledged_count: 3,
    expected_count: 5,
    pending_organizations: [
      { id: "org-trans", name: "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu" },
      { id: "org-dist", name: "Tổng Công ty Phân phối Nông sản & Bán lẻ" },
    ],
    status: "IN_PROGRESS",
  };

  const testAcksData = [
    { org_name: "Nông trại Thái Nguyên", status: "ACTION_TAKEN", note: "Đã niêm phong hàng" },
    { org_name: "Hợp tác xã Rau Sạch Bắc Giang", status: "IN_PROGRESS", note: "Đang thu hồi" },
    { org_name: "Cục Kiểm tra An toàn Nông sản", status: "RECEIVED", note: "Đã giám sát" },
  ];

  const userOrgMock = {
    organizationId: "org-trans",
    organizationName: "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu",
  };

  context.window.renderProgressData(testContractData, testAcksData, userOrgMock);

  // Assert metrics
  assert.equal(mockElements.display_id.textContent, 1);
  assert.equal(mockElements.ack_count.textContent, 3);
  assert.equal(mockElements.total_expected.textContent, 5);
  assert.equal(mockElements.pending_count.textContent, 2);
  assert.equal(mockElements.progress_percent_label.textContent, "60%");
  assert.equal(mockElements.my_progress_bar.style.width, "60%");
  assert.match(mockElements.my_progress_bar.textContent, /60%\s*\(3\/5\)/);

  // Assert named pending orgs rendered
  assert.equal(mockElements.pendingOrgsList.children.length, 2);
  assert.match(mockElements.pendingOrgsList.children[0].innerHTML, /Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu/);
  assert.match(mockElements.pendingOrgsList.children[1].innerHTML, /Tổng Công ty Phân phối Nông sản (&amp;|&) Bán lẻ/);

  // Assert user org pending prompt is triggered because user is in pending list
  assert.equal(mockElements.pendingAckPrompt.style.display, "flex");
  assert.equal(mockElements.userPendingOrgName.textContent, "Công ty Cổ phần Vận chuyển Chuỗi Lạnh Á Châu");
});

test("S-40: app-shell.js exports pending recall methods and setupActiveNav supports recall paths", () => {
  const appShell = require("../../frontend/app-shell.js");

  assert.equal(typeof appShell.fetchPendingRecalls, "function");
  assert.equal(typeof appShell.renderPendingRecallsAlert, "function");
  assert.equal(typeof appShell.checkPendingRecalls, "function");

  // NAV_PERMISSIONS should include recall modules
  assert.ok(appShell.NAV_PERMISSIONS.navRecallProgress);
  assert.ok(appShell.NAV_PERMISSIONS.navRecallForm);
  assert.equal(appShell.NAV_PERMISSIONS.navRecallProgress.includes("producer"), true);
  assert.equal(appShell.NAV_PERMISSIONS.navRecallForm.includes("transporter"), true);
});

test("S-40: app-shell.js renderPendingRecallsAlert mounts prominent alert when pending recalls exist", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  // Mock DOM
  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        const el = {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
        return el;
      },
      querySelector() {
        return mockContainer;
      },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: 101,
        reason: "Hàm lượng thuốc BVTV vượt ngưỡng cho phép",
        created_at: "2026-10-17T00:00:00.000Z",
        pending_organizations_count: 3,
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl, "Must return alert element");
    assert.equal(alertEl.id, "shellPendingRecallsAlert");
    assert.equal(alertEl.style.display, "block");
    assert.match(alertEl.innerHTML, /CẢNH BÁO THU HỒI KHẨN CẤP/);
    assert.match(alertEl.innerHTML, /#101/);
    assert.match(alertEl.innerHTML, /Hàm lượng thuốc BVTV vượt ngưỡng cho phép/);
    assert.match(alertEl.innerHTML, /3 đơn vị chưa phản hồi/);
    assert.match(alertEl.innerHTML, /href="\/recall-form\.html\?recall_id=101"/);
    assert.match(alertEl.innerHTML, /href="\/recall-progress\.html\?recall_id=101"/);

    // When empty array passed, alert should be hidden/cleared
    renderPendingRecallsAlert([], mockContainer);
    assert.equal(alertEl.style.display, "none");
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / S-34: recall-form.html supports canonical string IDs and handles duplicate 409 without claiming note updates", () => {
  const html = readFrontendFile("recall-form.html");

  // Input supports text/string format for canonical S-34 IDs (e.g. REC-20261016-A1B2C3, RO-001)
  assert.match(html, /<input[^>]*type=["']text["'][^>]*id=["']recall_id["']|<input[^>]*id=["']recall_id["'][^>]*type=["']text["']/, "Must support string IDs with type='text'");
  assert.doesNotMatch(html, /<input[^>]*type=["']number["'][^>]*id=["']recall_id["']/, "Must not restrict recall_id to number type");
  assert.doesNotMatch(html, /isNaN\(recallId\)/, "Must not reject non-numeric string recall IDs");

  // Duplicate ack 409 handling: immutable acknowledgment per S-36 NFR
  assert.match(html, /status === 409/, "Must handle 409 Conflict status explicitly");
  assert.match(html, /bất biến/i, "Must indicate acknowledgments are immutable events");
  assert.doesNotMatch(html, /Gửi Lại \/ Cập Nhật Ghi Chú/, "Must not claim note updates or editable acknowledgments");

  // When existing acknowledgment found, disable re-submission
  assert.match(html, /btnSubmitText\.textContent\s*=\s*['"]Đã Xác Nhận \(Bất biến\)['"]|btnSubmitText\.textContent\s*=\s*['"]Đã Xác Nhận \(409 Conflict\)['"]/, "Must reflect immutable status on submit button");
});

test("S-36 / S-37: frontend handles authenticated API errors (401, 403, 404) gracefully without fake fallback", () => {
  const formHtml = readFrontendFile("recall-form.html");
  const progressHtml = readFrontendFile("recall-progress.html");

  // Form error states
  assert.match(formHtml, /status === 401/, "Form must handle 401 Unauthorized");
  assert.match(formHtml, /status === 403/, "Form must handle 403 Forbidden");
  assert.match(formHtml, /status === 404/, "Form must handle 404 Not Found");

  // Progress error states
  assert.match(progressHtml, /status === 401/, "Progress must handle 401 Unauthorized");
  assert.match(progressHtml, /status === 403/, "Progress must handle 403 Forbidden");
  assert.match(progressHtml, /status === 404/, "Progress must handle 404 Not Found");

  // Real requests, no hardcoded stubs or fake fallback data
  assert.doesNotMatch(formHtml, /const\s+DEFAULT_ORGS\s*=/, "Must not contain hardcoded DEFAULT_ORGS mock data");
});

test("S-37: recall-progress.html correctly computes 3/5 progress dynamically from acked and named pending orgs", () => {
  const html = readFrontendFile("recall-progress.html");

  // String recall ID input in progress page
  assert.match(html, /<input[^>]*type=["']text["'][^>]*id=["']recall_id_input["']|<input[^>]*id=["']recall_id_input["'][^>]*type=["']text["']/, "Progress filter input must accept string IDs");

  // Test dynamic calculation: backend returns acknowledged_count: 3 and 2 pending orgs without explicit expected_count
  const mockElements = {
    display_id: { textContent: "" },
    ack_count: { textContent: "" },
    total_expected: { textContent: "" },
    pending_count: { textContent: "" },
    my_progress_bar: { style: { width: "" }, textContent: "" },
    progress_percent_label: { textContent: "" },
    progressSummaryText: { textContent: "" },
    pendingBadgeCount: { textContent: "" },
    ackBadgeCount: { textContent: "" },
    pendingOrgsList: {
      innerHTML: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    },
    acknowledgedOrgsList: {
      innerHTML: "",
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    },
    emptyAckNotice: { style: { display: "none" } },
    pendingAckPrompt: { style: { display: "none" } },
    userPendingOrgName: { textContent: "" },
    userPendingRecallId: { textContent: "" },
    linkSubmitPending: { href: "" },
    recall_id_input: { value: "REC-20261016-A1B2C3" },
  };

  const documentMock = {
    getElementById(id) {
      const el = mockElements[id] || { textContent: "", style: {}, appendChild() {} };
      if (!el.addEventListener) el.addEventListener = () => {};
      return el;
    },
    createElement(tag) {
      return {
        tagName: tag,
        className: "",
        innerHTML: "",
        style: {},
      };
    },
  };

  const vm = require("node:vm");
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let code = "";
  while ((match = scriptRegex.exec(html)) !== null) {
    code = match[1];
  }

  const context = {
    window: { location: { search: "" } },
    document: documentMock,
    sessionStorage: { getItem: () => null, setItem: () => null },
    URLSearchParams: class { get() { return null; } },
    fetch: async () => ({ ok: false }),
    console: { log: () => {}, warn: () => {}, error: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(code, context);

  // Canonical S-34 string ID with 3 acked and 2 pending orgs (expected_count omitted or 0)
  const dynamicContractData = {
    recall_id: "REC-20261016-A1B2C3",
    acknowledged_count: 3,
    pending_organizations: [
      { id: "org-trans", name: "Đơn vị vận chuyển Alpha" },
      { id: "org-retail", name: "Chuỗi siêu thị Beta" },
    ],
  };

  context.window.renderProgressData(dynamicContractData, [{}, {}, {}], null);

  // Total should be dynamically computed as 3 + 2 = 5, displaying 3/5 (60%)
  assert.equal(mockElements.display_id.textContent, "REC-20261016-A1B2C3");
  assert.equal(mockElements.ack_count.textContent, 3);
  assert.equal(mockElements.total_expected.textContent, 5);
  assert.equal(mockElements.pending_count.textContent, 2);
  assert.equal(mockElements.progress_percent_label.textContent, "60%");
  assert.match(mockElements.my_progress_bar.textContent, /60%\s*\(3\/5\)/);
  assert.equal(mockElements.pendingOrgsList.children.length, 2);
});

test("S-40 / S-34: app-shell.js supports canonical string IDs (e.g. REC-20261016-A1B2C3)", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: "REC-20261016-A1B2C3",
        reason: "Lô hàng phát hiện dư lượng hoạt chất cấm",
        pending_organizations_count: 2,
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);
    assert.match(alertEl.innerHTML, /#REC-20261016-A1B2C3/);
    assert.match(alertEl.innerHTML, /href="\/recall-form\.html\?recall_id=REC-20261016-A1B2C3"/);
    assert.match(alertEl.innerHTML, /href="\/recall-progress\.html\?recall_id=REC-20261016-A1B2C3"/);
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / N2-107: renderPendingRecallsAlert renders multiple own affected lots with encoded links and code/id labels", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: "REC-20261016-001",
        reason: "Dư lượng thuốc BVTV vượt ngưỡng cho phép",
        pending_organizations_count: 2,
        affected_lots: [
          { id: "LOT-001", code: "LOT-001" },
          { id: "LOT-002", code: "CODE-MANGO-2026" },
          { id: "LOT-003" }, // code fallback to id
        ],
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);
    assert.match(alertEl.innerHTML, /Lô hàng trực thuộc bị ảnh hưởng \(3\)/);
    // LOT-001 has same code and id -> displays LOT-001
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT-001"/);
    assert.match(alertEl.innerHTML, />LOT-001<\/a>/);
    // LOT-002 has different code and id -> displays CODE-MANGO-2026 (LOT-002)
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT-002"/);
    assert.match(alertEl.innerHTML, /CODE-MANGO-2026 \(LOT-002\)/);
    // LOT-003 has no code -> fallback to id LOT-003
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT-003"/);
    assert.match(alertEl.innerHTML, />LOT-003<\/a>/);
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / N2-107: renderPendingRecallsAlert prevents XSS in labels and encodes special characters in lot IDs", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: "<script>alert('recall-id')</script>",
        reason: "<img src=x onerror=alert('reason')>",
        affected_lots: [
          {
            id: "LOT/SPECIAL?a=1&b=2#frag",
            code: "<script>alert('lot-code')</script>",
          },
          {
            id: "<b onfocus=alert(1)>XSS-LOT</b>",
            code: "LOT-SAFE",
          },
        ],
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);

    // No raw unescaped script or img tag in innerHTML
    assert.doesNotMatch(alertEl.innerHTML, /<script>/i);
    assert.doesNotMatch(alertEl.innerHTML, /<img\s+src=x/i);
    assert.doesNotMatch(alertEl.innerHTML, /<b\s+onfocus/i);

    // HTML-escaped output present
    assert.match(alertEl.innerHTML, /&lt;script&gt;alert\(&#039;recall-id&#039;\)&lt;\/script&gt;/);
    assert.match(alertEl.innerHTML, /&lt;img src=x onerror=alert\(&#039;reason&#039;\)&gt;/);
    assert.match(alertEl.innerHTML, /&lt;script&gt;alert\(&#039;lot-code&#039;\)&lt;\/script&gt;/);
    assert.match(alertEl.innerHTML, /&lt;b onfocus=alert\(1\)&gt;XSS-LOT&lt;\/b&gt;/);

    // URL-encoded lot detail link
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT%2FSPECIAL%3Fa%3D1%26b%3D2%23frag"/);
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=%3Cb%20onfocus%3Dalert\(1\)%3EXSS-LOT%3C%2Fb%3E"/);
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / N2-107: renderPendingRecallsAlert handles missing affected_lots (old API) with explicit details-unavailable notice", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    // Old API omits affected_lots field
    const pendingRecalls = [
      {
        recall_id: "REC-LEGACY-001",
        reason: "Thu hồi cũ từ backend chưa nâng cấp",
        pending_organizations_count: 2,
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);
    assert.match(alertEl.innerHTML, /class="pending-recall-lots-unavailable"/);
    assert.match(alertEl.innerHTML, /Chi tiết lô hàng chưa khả dụng/);
    assert.doesNotMatch(alertEl.innerHTML, /Không có lô hàng trực thuộc bị ảnh hưởng/, "Must not fake empty list");
    assert.doesNotMatch(alertEl.innerHTML, /class="pending-recall-no-lots"/);
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / N2-107: renderPendingRecallsAlert handles empty affected_lots with explicit empty-list notice", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: "REC-EMPTY-001",
        reason: "Tổ chức này không sở hữu lô nào bị ảnh hưởng",
        pending_organizations_count: 1,
        affected_lots: [],
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);
    assert.match(alertEl.innerHTML, /class="pending-recall-no-lots"/);
    assert.match(alertEl.innerHTML, /Không có lô hàng trực thuộc bị ảnh hưởng/);
    assert.doesNotMatch(alertEl.innerHTML, /pending-recall-lots-unavailable/, "Must not mark as unavailable when empty array");
  } finally {
    global.document = originalDocument;
  }
});

test("S-36 / N2-107: fetchPendingRecalls handles network errors and HTTP error statuses (401, 403, 500) gracefully", async () => {
  const { fetchPendingRecalls } = require("../../frontend/app-shell.js");

  const originalFetch = global.fetch;
  try {
    // 1. Network failure
    global.fetch = async () => {
      throw new Error("Network connection refused");
    };
    const resNetworkError = await fetchPendingRecalls();
    assert.deepEqual(resNetworkError, [], "Must return empty array on network rejection");

    // 2. HTTP 401 Unauthorized
    global.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "Unauthorized" }),
    });
    const res401 = await fetchPendingRecalls();
    assert.deepEqual(res401, [], "Must return empty array on 401");

    // 3. HTTP 403 Forbidden
    global.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });
    const res403 = await fetchPendingRecalls();
    assert.deepEqual(res403, [], "Must return empty array on 403");

    // 4. HTTP 500 Server Error
    global.fetch = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Server Error" }),
    });
    const res500 = await fetchPendingRecalls();
    assert.deepEqual(res500, [], "Must return empty array on 500");

    // 5. Success with server-scoped affected_lots
    const mockData = [
      {
        recall_id: "REC-20261016-A1B2C3",
        reason: "Test reason",
        pending_organizations_count: 1,
        affected_lots: [{ id: "LOT-001", code: "LOT-001" }],
      },
    ];
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => mockData,
    });
    const res200 = await fetchPendingRecalls();
    assert.deepEqual(res200, mockData, "Must return server payload when ok");
  } finally {
    global.fetch = originalFetch;
  }
});

test("S-36 / N2-107: regression test for pending count tag and action links across multiple recalls", () => {
  const { renderPendingRecallsAlert } = require("../../frontend/app-shell.js");

  let insertedElement = null;
  const mockContainer = {
    children: [],
    appendChild(el) {
      this.children.push(el);
      insertedElement = el;
    },
  };

  const originalDocument = global.document;
  try {
    global.document = {
      getElementById(id) {
        if (id === "shellPendingRecallsAlert") return insertedElement;
        return null;
      },
      createElement(tag) {
        return {
          tagName: tag,
          id: "",
          className: "",
          innerHTML: "",
          style: {},
          attributes: {},
          setAttribute(k, v) { this.attributes[k] = v; },
          getAttribute(k) { return this.attributes[k]; },
          closest() { return this; },
          parentNode: mockContainer,
        };
      },
      querySelector() { return mockContainer; },
      head: { appendChild() {} },
    };

    const pendingRecalls = [
      {
        recall_id: "REC-ONE",
        reason: "Lý do đợt 1",
        pending_organizations_count: 4,
        affected_lots: [{ id: "LOT-A", code: "LOT-A" }],
      },
      {
        recall_id: "REC-TWO",
        reason: "Lý do đợt 2",
        // pending_organizations_count omitted
        affected_lots: [{ id: "LOT-B", code: "LOT-B" }],
      },
    ];

    const alertEl = renderPendingRecallsAlert(pendingRecalls, mockContainer);
    assert.ok(alertEl);
    assert.match(alertEl.innerHTML, /có <strong>2<\/strong> đợt thu hồi/);
    assert.match(alertEl.innerHTML, /4 đơn vị chưa phản hồi/);
    assert.match(alertEl.innerHTML, /href="\/recall-form\.html\?recall_id=REC-ONE"/);
    assert.match(alertEl.innerHTML, /href="\/recall-progress\.html\?recall_id=REC-ONE"/);
    assert.match(alertEl.innerHTML, /href="\/recall-form\.html\?recall_id=REC-TWO"/);
    assert.match(alertEl.innerHTML, /href="\/recall-progress\.html\?recall_id=REC-TWO"/);
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT-A"/);
    assert.match(alertEl.innerHTML, /href="\/lot-detail\.html\?id=LOT-B"/);
  } finally {
    global.document = originalDocument;
  }
});

