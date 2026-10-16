const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const frontendDir = path.join(__dirname, "../../frontend");
const primaryLinks = ["/lots.html", "/farms.html", "/products.html", "/harvest.html"];

test("authenticated frontend pages expose all four primary modules", () => {
  for (const file of ["lots.html", "farms.html", "products.html", "harvest.html"]) {
    const html = fs.readFileSync(path.join(frontendDir, file), "utf8");
    for (const href of primaryLinks) {
      assert.match(html, new RegExp(`href=["']${href.replace(".", "\\.")}["']`), `${file} is missing ${href}`);
    }
  }
});

test("lots page keeps harvest as the primary contextual action", () => {
  const html = fs.readFileSync(path.join(frontendDir, "lots.html"), "utf8");
  assert.match(html, /id="btnGoHarvest"/);
  assert.match(html, /href="\/harvest\.html"[^>]*class="btn-primary"|class="btn-primary"[^>]*id="btnGoHarvest"/);
  assert.match(html, />\s*Ghi nhận thu hoạch\s*</);
});

test("shared design system has laptop and tablet navigation breakpoints", () => {
  const css = fs.readFileSync(path.join(frontendDir, "styles.css"), "utf8");
  assert.match(css, /@media\s*\(max-width:\s*1180px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test("all frontend pages with copy functionality implement fallback for non-secure HTTP contexts", () => {
  for (const file of ["lot-detail.html", "lots.html", "products.html", "harvest.html"]) {
    const html = fs.readFileSync(path.join(frontendDir, file), "utf8");
    assert.match(html, /execCommand\(["']copy["']\)/, `${file} is missing execCommand fallback`);
    assert.match(html, /createElement\(["']textarea["']\)/, `${file} is missing textarea fallback element`);
  }
});

test("app-shell.js exports copyTextToClipboard with fallback support", () => {
  const { copyTextToClipboard } = require("../../frontend/app-shell");
  assert.equal(typeof copyTextToClipboard, "function");
});

test("T-22: app-shell.js exports form error helpers and manages field errors correctly", () => {
  const { createFormErrorHandler, showFieldErrors, clearFieldErrors } = require("../../frontend/app-shell");
  assert.equal(typeof createFormErrorHandler, "function");
  assert.equal(typeof showFieldErrors, "function");
  assert.equal(typeof clearFieldErrors, "function");

  // Mock DOM elements
  const mockInput = {
    classList: {
      classes: new Set(),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); },
    },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    listeners: {},
    addEventListener(evt, fn) { this.listeners[evt] = fn; },
  };

  const mockError = {
    textContent: "",
    style: { display: "none" },
  };

  let globalAlertMsg = null;
  const mockGlobalAlert = (msg) => { globalAlertMsg = msg; };

  const handler = createFormErrorHandler({
    globalAlert: mockGlobalAlert,
    fields: {
      quantity: { input: mockInput, error: mockError },
    },
  });

  // Test setFieldError
  handler.setFieldError("quantity", "Khối lượng phải là số dương lớn hơn 0.");
  assert.equal(mockError.textContent, "Khối lượng phải là số dương lớn hơn 0.");
  assert.equal(mockError.style.display, "block");
  assert.ok(mockInput.classList.contains("input-error"));
  assert.equal(mockInput.attrs["aria-invalid"], "true");

  // Test clearFieldError
  handler.clearFieldError("quantity");
  assert.equal(mockError.textContent, "");
  assert.equal(mockError.style.display, "none");
  assert.ok(!mockInput.classList.contains("input-error"));
  assert.equal(mockInput.attrs["aria-invalid"], undefined);

  // Test showErrors with field mapping
  handler.showErrors({ quantity: "Khối lượng không hợp lệ." });
  assert.equal(mockError.textContent, "Khối lượng không hợp lệ.");
  assert.equal(mockError.style.display, "block");

  // Test unhandled / global error
  handler.showErrors({ general: "Lỗi kết nối máy chủ." });
  assert.equal(globalAlertMsg, "Lỗi kết nối máy chủ.");

  // Test clear
  handler.clear();
  assert.equal(mockError.textContent, "");
  assert.equal(mockError.style.display, "none");
  assert.equal(globalAlertMsg, null);
});

