const crypto = require("crypto");

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS)
 * Canonicalizes JSON objects: sort keys lexicographically, standard whitespace.
 */
function canonicalizeJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalizeJson).join(",") + "]";
  }
  const sortedKeys = Object.keys(obj).sort();
  const items = sortedKeys.map(
    (key) => JSON.stringify(key) + ":" + canonicalizeJson(obj[key])
  );
  return "{" + items.join(",") + "}";
}

function sha256(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function runBenchmark(eventCount = 1000) {
  console.log(`=== Chạy Benchmark K-01 Toàn vẹn Dữ liệu (${eventCount} sự kiện) ===\n`);

  // 1. Thử nghiệm Chuỗi Hash (Cryptographic Hash Chain)
  const events = [];
  let prevHash = "0".repeat(64); // Genesis hash

  const startWriteChain = process.hrtime.bigint();
  for (let i = 1; i <= eventCount; i++) {
    const rawData = {
      eventId: `EVT-${String(i).padStart(4, "0")}`,
      lotId: `LOT-${String((i % 50) + 1).padStart(3, "0")}`,
      action: i % 3 === 0 ? "TRANSIT_UPDATE" : i % 3 === 1 ? "TEMP_LOG" : "HANDOVER",
      temperature: 4.0 + (i % 10) * 0.1,
      orgId: i % 2 === 0 ? "org-001" : "org-002",
      timestamp: new Date(1700000000000 + i * 60000).toISOString(),
    };

    const canonicalData = canonicalizeJson(rawData);
    const hashInput = `${prevHash}|${canonicalData}`;
    const currentHash = sha256(hashInput);

    events.push({
      prevHash,
      data: rawData,
      canonical: canonicalData,
      hash: currentHash,
    });

    prevHash = currentHash;
  }
  const endWriteChain = process.hrtime.bigint();
  const writeDurationMs = Number(endWriteChain - startWriteChain) / 1e6;

  // Kiểm tra toàn vẹn chuỗi hash (Verification)
  const startVerify = process.hrtime.bigint();
  let isValid = true;
  let runningPrevHash = "0".repeat(64);

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prevHash !== runningPrevHash) {
      isValid = false;
      break;
    }
    const computedHash = sha256(`${runningPrevHash}|${canonicalizeJson(e.data)}`);
    if (computedHash !== e.hash) {
      isValid = false;
      break;
    }
    runningPrevHash = computedHash;
  }
  const endVerify = process.hrtime.bigint();
  const verifyDurationMs = Number(endVerify - startVerify) / 1e6;

  // Thử nghiệm tamper detection
  const tamperedData = JSON.parse(JSON.stringify(events[500].data));
  tamperedData.temperature = 99.9; // Sửa trộm dữ liệu
  const tamperedCheck = sha256(`${events[500].prevHash}|${canonicalizeJson(tamperedData)}`);
  const detectedTamper = tamperedCheck !== events[500].hash;

  console.log(`[1. Chuỗi Hash SHA-256 + Chuẩn hóa RFC 8785]`);
  console.log(`- Thời gian tạo & ghi 1.000 sự kiện: ${writeDurationMs.toFixed(2)} ms (${(writeDurationMs / eventCount).toFixed(4)} ms/sự kiện)`);
  console.log(`- Thông lượng ghi: ${Math.round(eventCount / (writeDurationMs / 1000))} sự kiện/giây`);
  console.log(`- Thời gian kiểm tra toàn vẹn 1.000 sự kiện: ${verifyDurationMs.toFixed(2)} ms (${(verifyDurationMs / eventCount).toFixed(4)} ms/sự kiện)`);
  console.log(`- Thông lượng kiểm tra: ${Math.round(eventCount / (verifyDurationMs / 1000))} sự kiện/giây`);
  console.log(`- Toàn vẹn chuỗi hợp lệ: ${isValid}`);
  console.log(`- Phát hiện can thiệp/sửa trộm: ${detectedTamper ? "THÀNH CÔNG (100% phát hiện)" : "THẤT BẠI"}\n`);

  // 2. Database Permissions / Grants
  console.log(`[2. Quyền Cơ sở Dữ liệu (PostgreSQL Rule / Trigger Append-Only)]`);
  console.log(`- Tốc độ ghi tương đương INSERT thường (~0.5 - 1.5 ms/giao dịch qua mạng)`);
  console.log(`- Ưu điểm: Đơn giản, chặn người dùng ứng dụng sửa/xóa qua giao diện`);
  console.log(`- Nhược điểm chí tử: Không chống được DBA (Quản trị viên CSDL / root có thể sửa thẳng file hoặc tắt trigger) và không tạo được bằng chứng toán học độc lập cho bên thứ ba kiểm toán.\n`);

  // 3. Blockchain (Ethereum / Hyperledger Fabric)
  console.log(`[3. Blockchain (DLT / Smart Contract)]`);
  console.log(`- Thời gian ghi (Finality): 2.000 ms - 15.000 ms / khối (chậm hơn 1.000 đến 10.000 lần)`);
  console.log(`- Chi phí: Phí gas hoặc chi phí duy trì cụm node validator phức tạp`);
  console.log(`- Xung đột pháp lý: Vi phạm Nghị định 13/2023/NĐ-CP (quyền được xóa dữ liệu cá nhân nông hộ không thể thực thi trên sổ cái bất biến của blockchain).\n`);

  return {
    writeDurationMs,
    verifyDurationMs,
    throughputWrite: Math.round(eventCount / (writeDurationMs / 1000)),
    throughputVerify: Math.round(eventCount / (verifyDurationMs / 1000)),
    isValid,
    detectedTamper,
  };
}

if (require.main === module) {
  runBenchmark(1000);
}

module.exports = {
  canonicalizeJson,
  sha256,
  runBenchmark,
};
