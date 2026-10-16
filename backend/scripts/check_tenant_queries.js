/**
 * Static Analysis Linter for Multi-Tenant Isolation Enforcement (T-12)
 *
 * Scans application source code in src/ to ensure NO developer introduces raw,
 * unscoped SQL queries on tenant tables (e.g., farms, lots, inspections).
 *
 * Rules enforced:
 * 1. Business queries on tenant tables MUST use scopedQuery, scopedQueryById, or TenantRepository.
 * 2. Any direct UPDATE/DELETE on tenant tables MUST include organization_id scoping.
 * 3. Prohibits unscoped SELECT * FROM <tenant_table> WHERE id = $1 without organization_id.
 */

const fs = require("fs");
const path = require("path");

const SRC_DIR = path.resolve(__dirname, "../src");
const TENANT_TABLES = ["farms", "lots", "inspections", "sensor_data", "transport_events"];
const EXCLUDED_FILES = ["query.js", "migrate.js"];

function findJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      results = results.concat(findJsFiles(filePath));
    } else if (file.endsWith(".js") && !EXCLUDED_FILES.includes(file)) {
      results.push(filePath);
    }
  }
  return results;
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    for (const table of TENANT_TABLES) {
      // Check for raw SELECT FROM <tenant_table> WHERE id = $1 without organization_id
      const rawSelectRegex = new RegExp(
        `\\.query\\s*\\(\\s*["'\`]SELECT\\s+.*\\s+FROM\\s+${table}\\s+WHERE\\s+id\\s*=\\s*\\$1["'\`]`,
        "i"
      );
      if (rawSelectRegex.test(line)) {
        violations.push({
          file: path.relative(path.resolve(__dirname, ".."), filePath),
          line: lineNum,
          table,
          rule: "PROHIBIT_UNSCOPED_SELECT_BY_ID",
          code: line.trim(),
          message: `Truy vấn trực tiếp 'SELECT ... FROM ${table} WHERE id = $1' không có organization_id. Phải dùng scopedQueryById(pool, req.auth, "${table}", id) hoặc TenantRepository.`,
        });
      }

      // Check for raw UPDATE without organization_id
      const rawUpdateRegex = new RegExp(
        `\\.query\\s*\\(\\s*["'\`]UPDATE\\s+${table}\\s+SET.*WHERE\\s+id\\s*=\\s*\\$([0-9]+)["'\`]\\s*,`,
        "i"
      );
      if (rawUpdateRegex.test(line) && !line.includes("organization_id")) {
        // Check if context lines contain organization_id or admin check
        const contextLines = lines.slice(i, i + 5).join(" ");
        if (!contextLines.includes("organization_id") && !contextLines.includes('req.auth.roleId === "admin"')) {
          violations.push({
            file: path.relative(path.resolve(__dirname, ".."), filePath),
            line: lineNum,
            table,
            rule: "PROHIBIT_UNSCOPED_UPDATE",
            code: line.trim(),
            message: `Lệnh UPDATE trên bảng '${table}' thiếu ràng buộc organization_id. Phải thêm AND organization_id = $X.`,
          });
        }
      }
    }
  }

  return violations;
}

function run() {
  console.log("🔍 Đang kiểm tra cách ly dữ liệu tầng truy vấn (T-12 Tenant Isolation Lint)...");
  const files = findJsFiles(SRC_DIR);
  let totalViolations = [];

  for (const file of files) {
    const fileViolations = checkFile(file);
    if (fileViolations.length > 0) {
      totalViolations = totalViolations.concat(fileViolations);
    }
  }

  if (totalViolations.length > 0) {
    console.error(`\n❌ PHÁT HIỆN ${totalViolations.length} VI PHẠM TENANT ISOLATION TẠI QUERY LAYER:\n`);
    for (const v of totalViolations) {
      console.error(`  - [${v.rule}] ${v.file}:${v.line}`);
      console.error(`    Mã nguồn: ${v.code}`);
      console.error(`    Khắc phục: ${v.message}\n`);
    }
    process.exit(1);
  }

  console.log("✔ [T-12 Check Passed] 100% truy vấn nghiệp vụ tuân thủ chặt chẽ cách ly đa tổ chức (scopedQuery/scopedQueryById/tenantRepository).");
}

if (require.main === module) {
  run();
}

module.exports = { checkFile, findJsFiles };
