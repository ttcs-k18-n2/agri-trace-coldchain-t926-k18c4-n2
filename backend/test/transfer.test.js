const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  users,
  inMemoryLots,
  inMemoryTransfers,
  inMemoryBatchEvents,
  seedDemoUser,
  hashPassword,
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
