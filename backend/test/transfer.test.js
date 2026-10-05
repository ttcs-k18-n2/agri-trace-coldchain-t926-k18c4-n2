const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  inMemoryTransfers,
  seedDemoUser,
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

test("S-15: Quy trình bàn giao lô sang tổ chức khác ở trạng thái chờ xác nhận (PENDING)", async (t) => {
  await seedDemoUser();

  // Reset in-memory transfers trước khi test
  inMemoryTransfers.length = 0;

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const cookieOrg1 = await loginUser(server, "user@example.com", "Password@123");
  const cookieOrg2 = await loginUser(server, "user2@example.com", "Password@123");
  const cookieInspector = await loginUser(server, "inspector@example.com", "Password@123");

  await t.test("1. GET /api/organizations trả về danh mục các tổ chức", async () => {
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/organizations",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.organizations));
    assert.ok(res.body.organizations.length >= 2);
    const orgIds = res.body.organizations.map((o) => o.id);
    assert.ok(orgIds.includes("org-001"));
    assert.ok(orgIds.includes("org-002"));
  });

  let createdTransferId = null;

  await t.test("2. S-15 AC1: Bên gửi tạo yêu cầu bàn giao lô sang tổ chức khác thành công ở trạng thái PENDING", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-001/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
      },
      {
        toOrganizationId: "org-002",
        notes: "Bàn giao cà chua sang HTX Bắc Giang đóng gói",
      }
    );

    assert.equal(res.status, 201);
    assert.ok(res.body.transfer);
    assert.equal(res.body.transfer.lotId, "LOT-001");
    assert.equal(res.body.transfer.fromOrganizationId, "org-001");
    assert.equal(res.body.transfer.toOrganizationId, "org-002");
    assert.equal(res.body.transfer.status, "PENDING");
    assert.equal(res.body.transfer.notes, "Bàn giao cà chua sang HTX Bắc Giang đóng gói");

    createdTransferId = res.body.transfer.id;
    assert.ok(createdTransferId.startsWith("trf-"));
  });

  await t.test("3. S-15 AC2: Lô vẫn thuộc tổ chức gửi trong thời gian chờ (lots.organization_id KHÔNG ĐỔI)", async () => {
    const res = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(res.status, 200);
    assert.ok(res.body.lot);
    assert.equal(res.body.lot.organizationId, "org-001", "Quyền sở hữu lô vẫn thuộc org-001");
    assert.ok(res.body.lot.pendingTransfer, "Lô phải có thông tin pendingTransfer");
    assert.equal(res.body.lot.pendingTransfer.status, "PENDING");
    assert.equal(res.body.lot.pendingTransfer.toOrganizationId, "org-002");
  });

  await t.test("4. S-15 AC3: Hệ thống CHẶN tạo 2 yêu cầu pending cho cùng một lô (409 ALREADY_PENDING_TRANSFER)", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-001/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
      },
      {
        toOrganizationId: "org-trans",
        notes: "Cố tạo thêm yêu cầu bàn giao thứ hai cho cùng 1 lô",
      }
    );

    assert.equal(res.status, 409);
    assert.equal(res.body.error, "ALREADY_PENDING_TRANSFER");
    assert.ok(res.body.message.includes("PENDING"));
  });

  await t.test("5. S-15 AC4: Chặn tự bàn giao lô hàng cho chính tổ chức mình (400 SAME_ORGANIZATION_TRANSFER)", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-002/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
      },
      {
        toOrganizationId: "org-001",
        notes: "Tự gửi cho chính mình",
      }
    );

    assert.equal(res.status, 400);
    assert.equal(res.body.error, "SAME_ORGANIZATION_TRANSFER");
  });

  await t.test("6. S-15 AC5: Chặn người dùng không sở hữu lô gửi bàn giao (403 Forbidden)", async () => {
    // user2 thuộc org-002, cố tình bàn giao LOT-002 thuộc org-001
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-002/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      {
        toOrganizationId: "org-trans",
      }
    );

    assert.equal(res.status, 403);
  });

  await t.test("7. S-15 AC6: Cán bộ kiểm tra (Inspector) chỉ có quyền đọc, bị chặn khi gọi POST bàn giao (403)", async () => {
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-002/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieInspector },
      },
      {
        toOrganizationId: "org-002",
      }
    );

    assert.equal(res.status, 403);
  });

  await t.test("8. S-15 AC7: Sự kiện TRANSFER_INITIATED được ghi vào chuỗi hash SHA-256 bảo chứng toàn vẹn", async () => {
    // 8.1 Kiểm tra sự kiện mới nhất trong timeline
    const eventsRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/events",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(eventsRes.status, 200);
    assert.ok(Array.isArray(eventsRes.body.events));
    const lastEvent = eventsRes.body.events[eventsRes.body.events.length - 1];
    assert.equal(lastEvent.eventType, "TRANSFER_INITIATED");
    assert.equal(lastEvent.payload.transferId, createdTransferId);
    assert.equal(lastEvent.payload.status, "PENDING");
    assert.equal(lastEvent.payload.fromOrganizationId, "org-001");
    assert.equal(lastEvent.payload.toOrganizationId, "org-002");

    // 8.2 Kiểm tra tính toàn vẹn chuỗi hash SHA-256 của lô vẫn hoàn toàn hợp lệ (valid)
    const integrityRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/integrity",
      method: "GET",
      headers: { Cookie: cookieInspector },
    });

    assert.equal(integrityRes.status, 200);
    assert.ok(integrityRes.body.integrity);
    assert.equal(integrityRes.body.integrity.valid, true);
    assert.ok(integrityRes.body.integrity.eventCount >= 1);
    assert.ok(integrityRes.body.integrity.finalHash);
  });

  await t.test("9. S-15 AC8: Danh sách transfers (GET /api/transfers) theo outgoing / incoming", async () => {
    // 9.1 Bên gửi (org-001) xem outgoing
    const outgoingRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/transfers?type=outgoing&status=PENDING",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(outgoingRes.status, 200);
    assert.ok(Array.isArray(outgoingRes.body.transfers));
    assert.ok(outgoingRes.body.transfers.some((t) => t.id === createdTransferId));

    // 9.2 Bên nhận (org-002) xem incoming
    const incomingRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/transfers?type=incoming&status=PENDING",
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });

    assert.equal(incomingRes.status, 200);
    assert.ok(Array.isArray(incomingRes.body.transfers));
    assert.ok(incomingRes.body.transfers.some((t) => t.id === createdTransferId));

    // 9.3 Lấy lịch sử bàn giao của riêng lô hàng LOT-001
    const lotTransfersRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/transfers",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });

    assert.equal(lotTransfersRes.status, 200);
    assert.ok(Array.isArray(lotTransfersRes.body.transfers));
    assert.equal(lotTransfersRes.body.transfers.length, 1);
    assert.equal(lotTransfersRes.body.transfers[0].id, createdTransferId);
  });
});

test("S-16: Quy trình xác nhận và từ chối tiếp nhận bàn giao lô hàng", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const cookieOrg1 = await loginUser(server, "user@example.com", "Password@123");
  const cookieOrg2 = await loginUser(server, "user2@example.com", "Password@123");
  const cookieInspector = await loginUser(server, "inspector@example.com", "Password@123");

  // Chuẩn bị: Tạo một transfer PENDING từ org-001 sang org-002 cho LOT-001
  // Đảm bảo không còn pending cũ
  inMemoryTransfers.length = 0;

  const initRes = await request(
    server,
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/transfers",
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
    },
    {
      toOrganizationId: "org-002",
      notes: "Bàn giao thử nghiệm cho S-16",
    }
  );
  assert.equal(initRes.status, 201);
  const transfer1Id = initRes.body.transfer.id;

  // AC4: Tổ chức khác hoặc Inspector cố gọi Confirm/Reject -> 403 Forbidden
  await t.test("1. S-16 AC4: Tổ chức khác hoặc Inspector cố gọi Confirm/Reject -> 403 Forbidden", async () => {
    // 1.1 Bên gửi (org-001) cố Confirm yêu cầu bàn giao của chính mình
    const org1Confirm = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/transfers/${transfer1Id}/confirm`,
      method: "POST",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(org1Confirm.status, 403);
    assert.equal(org1Confirm.body.error, "FORBIDDEN");

    // 1.2 Bên gửi (org-001) cố Reject yêu cầu bàn giao
    const org1Reject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
      },
      { reason: "Lý do từ chối hợp lệ trên 10 ký tự" }
    );
    assert.equal(org1Reject.status, 403);
    assert.equal(org1Reject.body.error, "FORBIDDEN");

    // 1.3 Inspector cố gọi Confirm
    const inspConfirm = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/transfers/${transfer1Id}/confirm`,
      method: "POST",
      headers: { Cookie: cookieInspector },
    });
    assert.equal(inspConfirm.status, 403);

    // 1.4 Inspector cố gọi Reject
    const inspReject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieInspector },
      },
      { reason: "Lý do từ chối hợp lệ trên 10 ký tự" }
    );
    assert.equal(inspReject.status, 403);
  });

  // AC3: Reject để trống / dưới 10 ký tự -> bị chặn (400 Bad Request)
  await t.test("2. S-16 AC3: Reject để trống hoặc dưới 10 ký tự -> 400 Bad Request", async () => {
    // 2.1 Không gửi body / reason rỗng
    const emptyReject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      {}
    );
    assert.equal(emptyReject.status, 400);
    assert.equal(emptyReject.body.error, "INVALID_REASON");

    // 2.2 Reason ngắn dưới 10 ký tự (ví dụ: "Sai hàng")
    const shortReject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      { reason: "Sai hàng" }
    );
    assert.equal(shortReject.status, 400);
    assert.equal(shortReject.body.error, "INVALID_REASON");

    // 2.3 Reason toàn khoảng trắng
    const whitespaceReject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      { reason: "   12345   " }
    );
    assert.equal(whitespaceReject.status, 400);
    assert.equal(whitespaceReject.body.error, "INVALID_REASON");
  });

  // AC2: Bên nhận Reject có lý do -> không đổi chủ + ghi event và lý do
  await t.test("3. S-16 AC2: Bên nhận Reject có lý do -> không đổi chủ + ghi event TRANSFER_REJECTED", async () => {
    const validReason = "Hàng không đúng số lượng và chất lượng cam kết";
    const rejectRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      { reason: validReason }
    );

    assert.equal(rejectRes.status, 200);
    assert.equal(rejectRes.body.transfer.status, "REJECTED");
    assert.equal(rejectRes.body.transfer.rejectionReason, validReason);
    assert.ok(rejectRes.body.event.eventHash);

    // Kiểm tra lô hàng VẪN THUỘC org-001 (không đổi chủ)
    const lotRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(lotRes.status, 200);
    assert.equal(lotRes.body.lot.organizationId, "org-001");

    // Kiểm tra gọi lại lần 2 -> 409 Conflict
    const secondReject = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/transfers/${transfer1Id}/reject`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg2 },
      },
      { reason: "Thử từ chối lần 2" }
    );
    assert.equal(secondReject.status, 409);
    assert.equal(secondReject.body.error, "TRANSFER_ALREADY_RESOLVED");

    // Kiểm tra sự kiện TRANSFER_REJECTED trong lịch sử sự kiện
    const eventsRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/events",
      method: "GET",
      headers: { Cookie: cookieOrg1 },
    });
    assert.equal(eventsRes.status, 200);
    const lastEvt = eventsRes.body.events[eventsRes.body.events.length - 1];
    assert.equal(lastEvt.eventType, "TRANSFER_REJECTED");
    assert.equal(lastEvt.payload.reason, validReason);
  });

  // AC1: Bên nhận Confirm -> đổi chủ sang bên nhận + ghi event TRANSFER_CONFIRMED
  await t.test("4. S-16 AC1: Bên nhận Confirm -> đổi chủ + ghi event TRANSFER_CONFIRMED", async () => {
    // 4.1 Sau khi bị từ chối, bên gửi tạo yêu cầu bàn giao mới (S-16 mục 6)
    const newTrRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/lots/LOT-001/transfers",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieOrg1 },
      },
      {
        toOrganizationId: "org-002",
        notes: "Gửi lại sau khi điều chỉnh số lượng",
      }
    );
    assert.equal(newTrRes.status, 201);
    const transfer2Id = newTrRes.body.transfer.id;

    // 4.2 Bên nhận (org-002) gọi xác nhận bàn giao
    const confirmRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/transfers/${transfer2Id}/confirm`,
      method: "POST",
      headers: { Cookie: cookieOrg2 },
    });

    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.transfer.status, "CONFIRMED");
    assert.ok(confirmRes.body.event.eventHash);

    // 4.3 Kiểm tra lô hàng ĐÃ ĐỔI CHỦ sang org-002 (S-16 AC1)
    const lotRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001",
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(lotRes.status, 200);
    assert.equal(lotRes.body.lot.organizationId, "org-002");

    // 4.4 Lô xuất hiện trong danh sách Lô hàng đang quản lý của org-002
    const org2Lots = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/organization/lots",
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(org2Lots.status, 200);
    assert.ok(org2Lots.body.lots.some((l) => l.id === "LOT-001"));

    // 4.5 Yêu cầu đã biến mất khỏi danh sách chờ tiếp nhận (status=PENDING)
    const incomingPending = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/transfers?type=incoming&status=PENDING",
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(incomingPending.status, 200);
    assert.ok(!incomingPending.body.transfers.some((t) => t.id === transfer2Id));

    // 4.6 Gọi lại Confirm lần 2 -> 409 Conflict
    const secondConfirm = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/transfers/${transfer2Id}/confirm`,
      method: "POST",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(secondConfirm.status, 409);
    assert.equal(secondConfirm.body.error, "TRANSFER_ALREADY_RESOLVED");

    // 4.7 Kiểm tra sự kiện TRANSFER_CONFIRMED trong lịch sử chuỗi băm
    const eventsRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-001/events",
      method: "GET",
      headers: { Cookie: cookieOrg2 },
    });
    assert.equal(eventsRes.status, 200);
    const lastEvt = eventsRes.body.events[eventsRes.body.events.length - 1];
    assert.equal(lastEvt.eventType, "TRANSFER_CONFIRMED");
    assert.equal(lastEvt.payload.toOrganizationId, "org-002");
  });
});
