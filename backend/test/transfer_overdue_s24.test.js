const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  inMemoryTransfers,
  inMemoryLots,
  inMemoryBatchEvents,
  seedDemoUser,
  markOverdueTransfers,
  startTransferOverdueJob,
} = require("../src/server");

function request(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function loginUser(server, email, password) {
  const res = await request(
    server,
    {
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/login",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    },
    { email, password }
  );
  return res.headers["set-cookie"] ? res.headers["set-cookie"][0].split(";")[0] : null;
}

test("S-24 (N2-85): Bàn giao quá hạn chưa xác nhận bị đánh dấu cho cả hai bên", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const cookieSender = await loginUser(server, "user@example.com", "Password@123");     // org-001
  const cookieReceiver = await loginUser(server, "user2@example.com", "Password@123");   // org-002

  // Dọn dẹp in-memory trước test
  inMemoryTransfers.length = 0;

  // Đảm bảo LOT-001 thuộc org-001
  const lot1 = inMemoryLots.find((l) => l.id === "LOT-001");
  if (lot1) {
    lot1.organizationId = "org-001";
  }

  const now = Date.now();
  const time47hAgo = new Date(now - 47 * 3600 * 1000).toISOString();
  const time49hAgo = new Date(now - 49 * 3600 * 1000).toISOString();

  // Tạo transfer 1: cách đây 47 giờ (chưa quá hạn)
  const transfer47 = {
    id: "TR-47H",
    lotId: "LOT-001",
    fromOrganizationId: "org-001",
    fromOrganizationName: "Hợp tác xã Nông nghiệp Số 1",
    toOrganizationId: "org-002",
    toOrganizationName: "Công ty Phân phối Thực phẩm Sạch",
    status: "PENDING",
    isOverdue: false,
    overdueAt: null,
    notes: "Bàn giao 47h trước",
    createdByUserId: "user-001",
    createdAt: time47hAgo,
    updatedAt: time47hAgo,
  };

  // Tạo transfer 2: cách đây 49 giờ (đã quá hạn)
  const transfer49 = {
    id: "TR-49H",
    lotId: "LOT-002",
    fromOrganizationId: "org-001",
    fromOrganizationName: "Hợp tác xã Nông nghiệp Số 1",
    toOrganizationId: "org-002",
    toOrganizationName: "Công ty Phân phối Thực phẩm Sạch",
    status: "PENDING",
    isOverdue: false,
    overdueAt: null,
    notes: "Bàn giao 49h trước",
    createdByUserId: "user-001",
    createdAt: time49hAgo,
    updatedAt: time49hAgo,
  };

  // Đảm bảo LOT-002 thuộc org-001
  const lot2 = inMemoryLots.find((l) => l.id === "LOT-002");
  if (lot2) {
    lot2.organizationId = "org-001";
  }

  inMemoryTransfers.push(transfer47, transfer49);

  await t.test("T-56: Job quét rà soát bàn giao quá hạn theo ngưỡng 48 giờ", async () => {
    const jobResult = await markOverdueTransfers({
      inMemoryTransfers,
      hours: 48,
    });

    assert.equal(jobResult.checked, 2);
    assert.equal(jobResult.marked, 1);
    assert.equal(jobResult.hours, 48);

    // Transfer 47h: vẫn chưa quá hạn
    assert.equal(transfer47.isOverdue, false);
    assert.equal(transfer47.overdueAt, null);
    assert.equal(transfer47.status, "PENDING");

    // Transfer 49h: bị đánh dấu quá hạn nhưng status VẪN LÀ PENDING
    assert.equal(transfer49.isOverdue, true);
    assert.ok(transfer49.overdueAt);
    assert.equal(transfer49.status, "PENDING", "Bàn giao quá hạn KHÔNG được tự động hủy/cancel");
  });

  await t.test("T-56 Idempotency: Chạy job lần 2 không lặp lại đánh dấu hay làm thay đổi dữ liệu", async () => {
    const originalOverdueAt = transfer49.overdueAt;
    const jobResult2 = await markOverdueTransfers({
      inMemoryTransfers,
      hours: 48,
    });

    assert.equal(jobResult2.checked, 2);
    assert.equal(jobResult2.marked, 0, "Không đánh dấu thêm transfer nào vì đã được đánh dấu rồi");
    assert.equal(transfer49.overdueAt, originalOverdueAt, "Thời điểm overdueAt giữ nguyên");
  });

  await t.test("T-57 AC1: Cả bên gửi và bên nhận đều nhìn thấy isOverdue = true trong danh sách bàn giao", async () => {
    // 1. Bên gửi kiểm tra (outgoing)
    const senderRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/transfers?type=outgoing",
      method: "GET",
      headers: { Cookie: cookieSender },
    });
    assert.equal(senderRes.status, 200);
    const senderT49 = senderRes.body.transfers.find((tr) => tr.id === "TR-49H");
    assert.ok(senderT49, "Bên gửi thấy TR-49H");
    assert.equal(senderT49.isOverdue, true);
    assert.ok(senderT49.overdueAt);

    const senderT47 = senderRes.body.transfers.find((tr) => tr.id === "TR-47H");
    assert.ok(senderT47);
    assert.equal(senderT47.isOverdue, false);

    // 2. Bên nhận kiểm tra (incoming)
    const receiverRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/transfers?type=incoming",
      method: "GET",
      headers: { Cookie: cookieReceiver },
    });
    assert.equal(receiverRes.status, 200);
    const receiverT49 = receiverRes.body.transfers.find((tr) => tr.id === "TR-49H");
    assert.ok(receiverT49, "Bên nhận thấy TR-49H");
    assert.equal(receiverT49.isOverdue, true);
    assert.ok(receiverT49.overdueAt);
  });

  await t.test("T-57 AC1: pendingTransfer trong danh sách lô và chi tiết lô có isOverdue", async () => {
    // GET /api/lots
    const lotsRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots",
      method: "GET",
      headers: { Cookie: cookieSender },
    });
    assert.equal(lotsRes.status, 200);
    const lot2Res = lotsRes.body.lots.find((l) => l.id === "LOT-002");
    assert.ok(lot2Res);
    assert.ok(lot2Res.pendingTransfer);
    assert.equal(lot2Res.pendingTransfer.isOverdue, true);

    // GET /api/lots/:id
    const lotDetailRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-002",
      method: "GET",
      headers: { Cookie: cookieSender },
    });
    assert.equal(lotDetailRes.status, 200);
    assert.ok(lotDetailRes.body.lot.pendingTransfer);
    assert.equal(lotDetailRes.body.lot.pendingTransfer.isOverdue, true);
  });

  await t.test("T-57 AC2: Bên nhận vẫn xác nhận được bàn giao quá hạn và event ghi rõ lateConfirmation = true", async () => {
    // Bên nhận confirm transfer quá hạn TR-49H
    const confirmRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/TR-49H/confirm",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieReceiver },
      },
      {}
    );

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.transfer.status, "CONFIRMED");
    assert.equal(confirmRes.body.transfer.isOverdue, true);
    assert.equal(confirmRes.body.transfer.lateConfirmation, true);

    // Quyền sở hữu lô hàng chuyển sang bên nhận (org-002)
    assert.equal(lot2.organizationId, "org-002");

    // Sự kiện TRANSFER_CONFIRMED trong chuỗi sự kiện có lateConfirmation: true
    const events = inMemoryBatchEvents.filter(
      (e) => e.batchId === "LOT-002" && e.eventType === "TRANSFER_CONFIRMED"
    );
    assert.ok(events.length > 0);
    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.payload.status, "CONFIRMED");
    assert.equal(lastEvent.payload.lateConfirmation, true);
  });

  await t.test("T-57 AC2: Xác nhận bàn giao chưa quá hạn thì lateConfirmation = false", async () => {
    // Bên nhận confirm transfer TR-47H (chưa quá hạn)
    const confirmRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/transfers/TR-47H/confirm",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieReceiver },
      },
      {}
    );

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.transfer.status, "CONFIRMED");
    assert.equal(confirmRes.body.transfer.isOverdue, false);
    assert.equal(confirmRes.body.transfer.lateConfirmation, false);

    // Quyền sở hữu lô hàng chuyển sang org-002
    assert.equal(lot1.organizationId, "org-002");

    // Sự kiện TRANSFER_CONFIRMED có lateConfirmation: false
    const events = inMemoryBatchEvents.filter(
      (e) => e.batchId === "LOT-001" && e.eventType === "TRANSFER_CONFIRMED"
    );
    assert.ok(events.length > 0);
    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.payload.lateConfirmation, false);
  });

  await t.test("T-56: startTransferOverdueJob khởi tạo timer định kỳ và dọn dẹp an toàn", async () => {
    const timer = startTransferOverdueJob({
      inMemoryTransfers,
      intervalMs: 100000,
      hours: 48,
    });
    assert.ok(timer);
    clearInterval(timer);
  });
});
