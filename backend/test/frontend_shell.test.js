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
