/**
 * Script giả lập yêu cầu bàn giao quá hạn 49 giờ để kiểm thử S-24
 *
 * Cách sử dụng:
 *   node backend/scripts/simulate_s24_overdue.js
 *
 * Hoạt động:
 * 1. Nếu server đang chạy (http://localhost:3000), gọi POST /api/transfers/simulate-overdue.
 * 2. Nếu có biến môi trường DATABASE_URL, kết nối trực tiếp PostgreSQL để cập nhật created_at thành 49h trước.
 */

const http = require("http");
const { Pool } = require("pg");

async function run() {
  console.log("=== [S-24 Simulator] Khởi tạo dữ liệu giả lập bàn giao quá hạn 49 giờ ===");

  // 1. Thử gọi API nếu server đang chạy
  const apiSuccess = await new Promise((resolve) => {
    const postData = JSON.stringify({ hours: 49 });
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: Number(process.env.PORT || 3000),
        path: "/api/transfers/simulate-overdue",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log("✔ Đã gọi API server thành công:");
            console.log(data);
            resolve(true);
          } else {
            console.log(`Server phản hồi status ${res.statusCode}: ${data}`);
            resolve(false);
          }
        });
      }
    );

    req.on("error", () => {
      resolve(false);
    });
    req.write(postData);
    req.end();
  });

  if (apiSuccess) {
    console.log("\n Hoàn tất! Bạn có thể mở trình duyệt xem nhãn QUÁ HẠN ngay bây giờ.");
    return;
  }

  // 2. Nếu server chưa bật, kiểm tra kết nối trực tiếp PostgreSQL
  if (process.env.DATABASE_URL) {
    console.log("Server chưa chạy, đang cập nhật trực tiếp trong PostgreSQL...");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const res = await pool.query(`
        UPDATE lot_transfers
        SET created_at = NOW() - INTERVAL '49 hours',
            is_overdue = FALSE,
            overdue_at = NULL
        WHERE status = 'PENDING'
        RETURNING id, lot_id, status, created_at
      `);

      if (res.rows.length > 0) {
        console.log(`✔ Đã cập nhật ${res.rows.length} bàn giao thành 49 giờ trước:`, res.rows);
      } else {
        console.log("ℹ Không có bàn giao PENDING nào. Đang tạo mới 1 bàn giao giả lập cho LOT-002...");
        await pool.query(`
          INSERT INTO lot_transfers (
            id, lot_id, from_organization_id, to_organization_id,
            status, is_overdue, notes, created_by_user_id, created_at, updated_at
          ) VALUES (
            'TR-OVERDUE-001', 'LOT-002', 'org-001', 'org-002',
            'PENDING', FALSE, 'Bàn giao mẫu chè Tân Cương sang HTX Bắc Giang (giả lập 49 giờ trước)',
            'usr-orgadmin', NOW() - INTERVAL '49 hours', NOW() - INTERVAL '49 hours'
          ) ON CONFLICT (id) DO UPDATE SET created_at = NOW() - INTERVAL '49 hours', is_overdue = FALSE
        `);
        console.log("✔ Đã tạo bàn giao TR-OVERDUE-001 (49 giờ trước) thành công.");
      }
    } catch (err) {
      console.error("Lỗi khi cập nhật database:", err.message);
    } finally {
      await pool.end();
    }
  } else {
    console.log("\n Chế độ In-Memory: Khi bạn khởi động server bằng lệnh `npm start`,");
    console.log("  server sẽ TỰ ĐỘNG tạo sẵn bàn giao TR-OVERDUE-001 (49 giờ trước) cho LOT-002");
    console.log("  và job rà soát sẽ tự động đánh dấu QUÁ HẠN ngay khi server khởi động!");
  }

  console.log("\n=== HƯỚNG DẪN TEST TRỰC TIẾP TRÊN TRÌNH DUYỆT ===");
  console.log("1. Chạy lệnh: npm start");
  console.log("2. Mở trình duyệt vào: http://localhost:3000/login");
  console.log("3. Đăng nhập bên gửi (org-001): user@example.com / Password@123");
  console.log("   -> Vào trang Danh sách lô: LOT-002 sẽ có nhãn [QUÁ HẠN] màu đỏ.");
  console.log("4. Đăng nhập bên nhận (org-002): user2@example.com / Password@123");
  console.log("   -> Vào tab 'Bàn giao đến': Thấy thẻ bàn giao có nhãn [QUÁ HẠN].");
  console.log("   -> Bấm nút 'Xác nhận tiếp nhận': Tiếp nhận thành công!");
  console.log("   -> Mở chi tiết lô xem Dòng thời gian sự kiện: Thấy 'Xác nhận muộn: Có'.");
}

run();
