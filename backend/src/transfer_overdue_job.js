/**
 * S-24 / T-56: Job quét rà soát và đánh dấu các yêu cầu bàn giao quá hạn (Overdue Transfers Job)
 *
 * Nhiệm vụ:
 * 1. Định kỳ quét các yêu cầu bàn giao ở trạng thái PENDING.
 * 2. Nếu thời gian chờ vượt quá ngưỡng cấu hình (TRANSFER_OVERDUE_HOURS, mặc định 48 giờ):
 *    - Đánh dấu is_overdue = TRUE và lưu thời điểm quá hạn overdue_at.
 *    - KHÔNG tự động hủy/cancel hoặc đổi status (vẫn giữ status = 'PENDING' để bên nhận vẫn xác nhận được).
 * 3. Ghi log chuẩn định dạng: [transfer-overdue-job] checked=<N> marked_overdue=<M> overdue_hours=<H>.
 * 4. Đảm bảo tính Idempotent: chạy nhiều lần không làm sai lệch hay nhân bản dữ liệu.
 */

async function markOverdueTransfers({ pool = null, inMemoryTransfers = null, hours = undefined } = {}) {
  const configuredHours = Number(
    hours !== undefined ? hours : process.env.TRANSFER_OVERDUE_HOURS
  );
  const overdueHours = Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 48;

  let checkedCount = 0;
  let markedCount = 0;
  let markedTransfers = [];

  if (pool && typeof pool.query === "function") {
    try {
      // 1. Đếm tổng số bàn giao đang PENDING đã được kiểm tra
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS total FROM lot_transfers WHERE status = 'PENDING'"
      );
      checkedCount = (countRes.rows[0] && countRes.rows[0].total) || 0;

      // 2. Cập nhật các yêu cầu bàn giao PENDING đã vượt quá ngưỡng thời gian
      const updateRes = await pool.query(
        `UPDATE lot_transfers
         SET is_overdue = TRUE, overdue_at = COALESCE(overdue_at, NOW())
         WHERE status = 'PENDING'
           AND is_overdue = FALSE
           AND created_at <= NOW() - ($1 || ' hours')::INTERVAL
         RETURNING id, lot_id, from_organization_id, to_organization_id, created_at, overdue_at`,
        [overdueHours]
      );

      markedTransfers = updateRes.rows;
      markedCount = updateRes.rowCount || updateRes.rows.length;
    } catch (err) {
      console.error("[transfer-overdue-job] Lỗi khi quét bàn giao quá hạn trong database:", err.message);
      throw err;
    }
  } else if (Array.isArray(inMemoryTransfers)) {
    // Fallback in-memory cho môi trường test và không có PostgreSQL
    const now = Date.now();
    const cutoffTime = new Date(now - overdueHours * 3600 * 1000);

    const pendingList = inMemoryTransfers.filter((t) => t && t.status === "PENDING");
    checkedCount = pendingList.length;

    for (const t of pendingList) {
      const createdAt = new Date(t.createdAt);
      if (!t.isOverdue && !t.is_overdue && createdAt <= cutoffTime) {
        t.isOverdue = true;
        t.is_overdue = true;
        t.overdueAt = t.overdueAt || new Date(now).toISOString();
        t.overdue_at = t.overdue_at || t.overdueAt;
        markedTransfers.push(t);
        markedCount++;
      }
    }
  }

  console.log(
    `[transfer-overdue-job] checked=${checkedCount} marked_overdue=${markedCount} overdue_hours=${overdueHours}`
  );

  return {
    checked: checkedCount,
    marked: markedCount,
    hours: overdueHours,
    markedTransfers,
  };
}

function startTransferOverdueJob({
  pool = null,
  inMemoryTransfers = null,
  intervalMs = 3600000,
  hours = undefined,
} = {}) {
  // Chạy ngay 1 lần khi kích hoạt
  markOverdueTransfers({ pool, inMemoryTransfers, hours }).catch((err) => {
    console.error("[transfer-overdue-job] Khởi chạy thất bại:", err.message);
  });

  const timer = setInterval(() => {
    markOverdueTransfers({ pool, inMemoryTransfers, hours }).catch((err) => {
      console.error("[transfer-overdue-job] Lỗi chu kỳ định kỳ:", err.message);
    });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return timer;
}

module.exports = {
  markOverdueTransfers,
  startTransferOverdueJob,
};
