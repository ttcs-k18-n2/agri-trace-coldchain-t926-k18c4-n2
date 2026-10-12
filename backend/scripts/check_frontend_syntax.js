/**
 * Script kiểm tra cú pháp JavaScript bên trong toàn bộ các tệp HTML ở frontend
 */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const frontendDir = path.resolve(__dirname, "../../frontend");
if (!fs.existsSync(frontendDir)) {
  console.log("Không tìm thấy thư mục frontend, bỏ qua kiểm tra cú pháp HTML.");
  process.exit(0);
}

const htmlFiles = fs.readdirSync(frontendDir).filter((f) => f.endsWith(".html"));
let hasError = false;

console.log(`🔍 Đang kiểm tra cú pháp JavaScript trên ${htmlFiles.length} tệp frontend HTML...`);

htmlFiles.forEach((file) => {
  const filePath = path.join(frontendDir, file);
  const content = fs.readFileSync(filePath, "utf8");
  const scriptRegex = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  let scriptIndex = 0;

  while ((match = scriptRegex.exec(content)) !== null) {
    scriptIndex++;
    const code = match[1];
    if (!code || !code.trim()) continue;

    try {
      new vm.Script(code, { filename: `${file}:<script#${scriptIndex}>` });
    } catch (err) {
      hasError = true;
      console.error(`❌ [Syntax Error] ${file} (Script #${scriptIndex}):`, err.message);
    }
  }
});

if (hasError) {
  console.error("❌ Phát hiện lỗi cú pháp JavaScript trong tệp HTML frontend! Dừng CI.");
  process.exit(1);
} else {
  console.log("✔ [Frontend Syntax Passed] Toàn bộ mã JavaScript trong các tệp HTML frontend đều hợp lệ!");
}
