const { logSecurityEvent, getRecentSecurityLogs } = require('./security_logger');

async function runTest() {
    console.log("=== BẮT ĐẦU TEST S-31 ===");

    // 1. Ghi thử 1 log cảnh báo bảo mật
    await logSecurityEvent("UNAUTHORIZED_ACCESS", {
        userId: "user_123",
        userEmail: "hacker@example.com",
        userOrgId: "ORG_A",
        targetOrgId: "ORG_B",
        resourceType: "Lô hàng",
        resourceId: "LOT_999",
        ip: "192.168.1.100"
    });

    // 2. Kiểm tra xem log đã vào bộ nhớ tạm chưa
    const logs = getRecentSecurityLogs();
    console.log("\n=== KIỂM TRA BỘ NHỚ TẠM ===");
    console.log(`Số lượng log hiện có: ${logs.length}`);
    console.log("Chi tiết:", logs);

    console.log("\n=== HOÀN THÀNH TEST! (Kiểm tra Database để xem log đã được lưu chưa) ===");
}

runTest();