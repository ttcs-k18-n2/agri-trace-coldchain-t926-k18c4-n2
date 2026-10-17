const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  inMemoryLots,
  inMemoryShipments,
  inMemoryShipmentLots,
  inMemoryBatchEvents,
  inMemoryAuditLogs,
  seedDemoUser,
  verifyBatchEventChain,
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

test("S-40 (Jira N2-211): Mở chuyến vận chuyển gắn nhiều lô và một thùng lạnh", async (t) => {
  await seedDemoUser();

  // Khởi tạo máy chủ HTTP cho test
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  // Đăng nhập các vai trò thử nghiệm
  const producerCookie = await loginUser(server, "user@example.com", "Password@123"); // org-001 (producer)
  const coopCookie = await loginUser(server, "user2@example.com", "Password@123"); // org-002 (cooperative)
  const transporterCookie = await loginUser(server, "transporter@example.com", "Password@123"); // org-trans (transporter)
  const adminCookie = await loginUser(server, "admin@example.com", "Password@123"); // org-system (admin)
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123"); // org-inspector (inspector)

  assert.ok(producerCookie, "Đăng nhập producer (org-001) thành công");
  assert.ok(coopCookie, "Đăng nhập coop (org-002) thành công");
  assert.ok(transporterCookie, "Đăng nhập transporter (org-trans) thành công");
  assert.ok(adminCookie, "Đăng nhập admin thành công");
  assert.ok(inspectorCookie, "Đăng nhập inspector thành công");

  // Thiết lập dữ liệu lô hàng mẫu
  // LOT-S40-01, LOT-S40-02 thuộc org-001
  // LOT-S40-03 thuộc org-002
  const setupLots = () => {
    inMemoryLots.length = 0;
    inMemoryShipments.length = 0;
    inMemoryShipmentLots.length = 0;
    inMemoryBatchEvents.length = 0;
    inMemoryAuditLogs.length = 0;

    inMemoryLots.push(
      {
        id: "LOT-S40-01",
        name: "Lô Dâu tây Mộc Châu #1",
        status: "Đã thu hoạch",
        organizationId: "org-001",
        organization_id: "org-001",
        remainingQuantity: 500,
        initialQuantity: 500,
      },
      {
        id: "LOT-S40-02",
        name: "Lô Cà chua Thái Nguyên #2",
        status: "Đã thu hoạch",
        organizationId: "org-001",
        organization_id: "org-001",
        remainingQuantity: 300,
        initialQuantity: 300,
      },
      {
        id: "LOT-S40-03",
        name: "Lô Rau cải Bắc Giang #3",
        status: "Đã thu hoạch",
        organizationId: "org-002",
        organization_id: "org-002",
        remainingQuantity: 400,
        initialQuantity: 400,
      },
      {
        id: "LOT-S40-CONSUMED",
        name: "Lô Dưa lưới đã tiêu thụ hết",
        status: "Đã bán hết",
        organizationId: "org-001",
        organization_id: "org-001",
        remainingQuantity: 0,
        initialQuantity: 100,
      }
    );
  };

  await t.test("1. Mở chuyến vận chuyển: Gắn 1 thùng lạnh với nhiều lô hàng thành công", async () => {
    setupLots();

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-COLD-01",
        lotIds: ["LOT-S40-01", "LOT-S40-02"],
        vehiclePlate: "29C-999.88",
        driverName: "Trần Văn Vận",
        driverPhone: "0988776655",
        originLocationId: "LOC-WH-TN-01",
        destinationLocationId: "LOC-HUB-HN-01",
        notes: "Chuyến lạnh chở dâu tây và cà chua 2-4 độ C",
      }
    );

    assert.equal(res.status, 201, "Tạo chuyến thành công phải trả về HTTP 201");
    assert.ok(res.body.shipment, "Response phải chứa object shipment");
    assert.equal(res.body.shipment.coldBoxId, "CBX-COLD-01");
    assert.equal(res.body.shipment.status, "IN_TRANSIT");
    assert.equal(res.body.shipment.lots.length, 2, "Chuyến phải liên kết đủ 2 lô hàng");

    // Kiểm tra sự kiện lên xe (SHIPMENT_LOADED) được ghi vào chuỗi băm của từng lô
    for (const lotMeta of res.body.shipment.lots) {
      assert.equal(lotMeta.status, "LOADED");
      assert.ok(lotMeta.event, "Phải có thông tin sự kiện chuỗi băm");
      assert.equal(lotMeta.event.eventType, "SHIPMENT_LOADED");
      assert.ok(lotMeta.event.eventHash, "Sự kiện phải có mã băm SHA-256");

      // Kiểm tra trong inMemoryBatchEvents
      const lotEvents = inMemoryBatchEvents.filter((e) => (e.batchId || e.batch_id) === lotMeta.lotId);
      assert.ok(lotEvents.length > 0, `Lô ${lotMeta.lotId} phải có sự kiện trong sổ cái`);
      const lastEvent = lotEvents[lotEvents.length - 1];
      assert.equal(lastEvent.eventType || lastEvent.event_type, "SHIPMENT_LOADED");
      assert.equal(lastEvent.payload.coldBoxId, "CBX-COLD-01");
      assert.equal(lastEvent.payload.action, "LOAD");

      // Kiểm tra tính toàn vẹn chuỗi hash
      const chainValid = verifyBatchEventChain(lotEvents);
      assert.ok(chainValid.valid, `Chuỗi hash của lô ${lotMeta.lotId} phải hợp lệ và nguyên vẹn`);
    }

    // Kiểm tra audit log S-31
    const auditLogs = inMemoryAuditLogs.filter((a) => a.action === "SHIPMENT_CREATED");
    assert.ok(auditLogs.length > 0, "Phải có audit log SHIPMENT_CREATED");
    assert.equal(auditLogs[0].resourceId, res.body.shipment.id);
  });

  await t.test("2. Kiểm tra quyền tổ chức: Chặn gắn lô hàng thuộc quyền quản lý của tổ chức khác", async () => {
    setupLots();

    // user@example.com thuộc org-001 cố tình gắn LOT-S40-03 (thuộc org-002)
    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-01",
        lotIds: ["LOT-S40-01", "LOT-S40-03"], // LOT-S40-03 là của org-002!
      }
    );

    assert.equal(res.status, 403, "Cố gắn lô của tổ chức khác phải trả về 403 Forbidden");
    assert.equal(res.body.error, "FORBIDDEN_LOT_ACCESS");
    assert.ok(res.body.unauthorizedLots.includes("LOT-S40-03"));

    // Đảm bảo không có shipment rác nào được tạo
    assert.equal(inMemoryShipments.length, 0, "Không được tạo chuyến khi kiểm tra quyền thất bại");
  });

  await t.test("3. Chặn lô hàng đã tiêu thụ/bán hết tham gia chuyến vận chuyển", async () => {
    setupLots();

    const res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-01",
        lotIds: ["LOT-S40-CONSUMED"],
      }
    );

    assert.equal(res.status, 400, "Lô đã tiêu thụ phải trả về 400 Bad Request");
    assert.equal(res.body.error, "LOT_ALREADY_CONSUMED");
  });

  await t.test("4. Chặn một lô tham gia 2 chuyến đang hoạt động đồng thời (Concurrency Defense)", async () => {
    setupLots();

    // Mở chuyến 1 chứa LOT-S40-01 và LOT-S40-02
    const res1 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-01",
        lotIds: ["LOT-S40-01", "LOT-S40-02"],
      }
    );
    assert.equal(res1.status, 201, "Mở chuyến 1 thành công");

    // Thử mở chuyến 2 cũng chứa LOT-S40-01 -> Phải bị chặn 409
    const res2 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-02",
        lotIds: ["LOT-S40-01"],
      }
    );
    assert.equal(res2.status, 409, "Cố gắn lô đang chạy vào chuyến mới phải trả về 409 Conflict");
    assert.equal(res2.body.error, "LOT_ALREADY_IN_ACTIVE_SHIPMENT");

    // Kiểm tra API kiểm tra chuyến đang chạy của lô
    const activeCheck = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/lots/LOT-S40-01/active-shipment",
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(activeCheck.status, 200);
    assert.equal(activeCheck.body.hasActiveShipment, true);
    assert.equal(activeCheck.body.shipment.id, res1.body.shipment.id);
  });

  await t.test("5. Mô phỏng 2 request cạnh tranh đồng thời cùng mở chuyến với cùng một lô", async () => {
    setupLots();

    // Gửi 2 request đồng thời qua Promise.all
    const [reqA, reqB] = await Promise.all([
      request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/shipments",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: producerCookie,
          },
        },
        {
          coldBoxId: "CBX-RACE-A",
          lotIds: ["LOT-S40-01"],
        }
      ),
      request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/shipments",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: producerCookie,
          },
        },
        {
          coldBoxId: "CBX-RACE-B",
          lotIds: ["LOT-S40-01"],
        }
      ),
    ]);

    const statuses = [reqA.status, reqB.status].sort();
    assert.deepEqual(
      statuses,
      [201, 409],
      "Khi có 2 request cạnh tranh cùng lúc, đúng 1 request thành công (201) và 1 request bị từ chối (409)"
    );
  });

  await t.test("6. Kết thúc chuyến vận chuyển: Ghi sự kiện xuống xe (SHIPMENT_UNLOADED) và giải phóng lô", async () => {
    setupLots();

    // 1. Tạo chuyến
    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-FINISH-01",
        lotIds: ["LOT-S40-01", "LOT-S40-02"],
      }
    );
    assert.equal(createRes.status, 201);
    const shipmentId = createRes.body.shipment.id;

    // 2. Kết thúc chuyến
    const completeRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/complete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        notes: "Đã giao đến kho đích an toàn, dỡ hàng thành công",
        destinationLocationId: "LOC-HUB-HN-01",
      }
    );

    assert.equal(completeRes.status, 200, "Kết thúc chuyến thành công trả về 200 OK");
    assert.equal(completeRes.body.shipment.status, "COMPLETED");
    assert.ok(completeRes.body.shipment.completedAt, "Phải có completedAt");

    // Kiểm tra sự kiện xuống xe (SHIPMENT_UNLOADED)
    for (const lotMeta of completeRes.body.shipment.lots) {
      assert.equal(lotMeta.status, "DELIVERED");
      assert.ok(lotMeta.unloadEvent, "Phải có unloadEvent");
      assert.equal(lotMeta.unloadEvent.eventType, "SHIPMENT_UNLOADED");

      const lotEvents = inMemoryBatchEvents.filter((e) => (e.batchId || e.batch_id) === lotMeta.lotId);
      assert.equal(lotEvents.length, 2, "Lô phải có 2 sự kiện: LOADED và UNLOADED");
      const loadEv = lotEvents[0];
      const unloadEv = lotEvents[1];

      assert.equal(loadEv.eventType || loadEv.event_type, "SHIPMENT_LOADED");
      assert.equal(unloadEv.eventType || unloadEv.event_type, "SHIPMENT_UNLOADED");
      assert.equal(unloadEv.previousHash || unloadEv.previous_hash, loadEv.eventHash || loadEv.event_hash);

      const chainValid = verifyBatchEventChain(lotEvents);
      assert.ok(chainValid.valid, `Chuỗi hash gồm 2 sự kiện của lô ${lotMeta.lotId} phải toàn vẹn`);
    }

    // Kiểm tra audit log hoàn thành chuyến
    const completeAudit = inMemoryAuditLogs.filter((a) => a.action === "SHIPMENT_COMPLETED");
    assert.ok(completeAudit.length > 0, "Phải có audit log SHIPMENT_COMPLETED");

    // 3. Sau khi kết thúc chuyến, lô hàng được giải phóng và CÓ THỂ tham gia chuyến tiếp theo
    const newShipmentRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-NEXT-02",
        lotIds: ["LOT-S40-01"], // Lô 01 đã xuống xe, giờ có thể lên chuyến mới!
      }
    );
    assert.equal(newShipmentRes.status, 201, "Lô sau khi dỡ hàng có thể tham gia chuyến mới thành công");

    // Kiểm tra không thể kết thúc lại chuyến đã COMPLETED
    const reCompleteRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/complete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {}
    );
    assert.equal(reCompleteRes.status, 400, "Kết thúc lại chuyến đã hoàn thành phải trả về 400");
  });

  await t.test("7. Phân quyền vai trò: Inspector chỉ đọc (403 ghi), Admin toàn quyền", async () => {
    setupLots();

    // 7.1 Cán bộ kiểm tra (Inspector) cố mở chuyến -> 403
    const inspPostRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: inspectorCookie,
        },
      },
      {
        coldBoxId: "CBX-01",
        lotIds: ["LOT-S40-01"],
      }
    );
    assert.equal(inspPostRes.status, 403, "Inspector không được phép ghi dữ liệu tạo chuyến");

    // 7.2 Tạo chuyến mẫu bằng producer
    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-INSP-TEST",
        lotIds: ["LOT-S40-01"],
      }
    );
    const shipmentId = createRes.body.shipment.id;

    // 7.3 Inspector được phép xem danh sách và chi tiết
    const inspGetList = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/shipments",
      method: "GET",
      headers: { Cookie: inspectorCookie },
    });
    assert.equal(inspGetList.status, 200, "Inspector xem danh sách thành công");
    assert.ok(Array.isArray(inspGetList.body.data));

    const inspGetDetail = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${shipmentId}`,
      method: "GET",
      headers: { Cookie: inspectorCookie },
    });
    assert.equal(inspGetDetail.status, 200, "Inspector xem chi tiết thành công");

    // 7.4 Inspector không được phép kết thúc chuyến
    const inspCompleteRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/complete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: inspectorCookie,
        },
      },
      {}
    );
    assert.equal(inspCompleteRes.status, 403, "Inspector không được phép kết thúc chuyến");

    // 7.5 Admin có quyền kết thúc chuyến của bất kỳ tổ chức nào
    const adminCompleteRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/complete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
      },
      { notes: "Admin kết thúc chuyến đặc quyền" }
    );
    assert.equal(adminCompleteRes.status, 200, "Admin kết thúc chuyến thành công");
  });

  await t.test("8. Chặn một thùng lạnh tham gia 2 chuyến đang hoạt động đồng thời (Cold Box Concurrency Defense)", async () => {
    setupLots();

    // Mở chuyến 1 gắn thùng lạnh CBX-SHARED-01
    const res1 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-SHARED-01",
        lotIds: ["LOT-S40-01"],
        vehiclePlate: "29C-111.11",
      }
    );
    assert.equal(res1.status, 201, "Mở chuyến 1 với CBX-SHARED-01 thành công");
    const shipment1Id = res1.body.shipment.id;

    // Mở chuyến 2 với cùng thùng lạnh CBX-SHARED-01 nhưng khác lô (LOT-S40-02) -> Phải bị chặn 409
    const res2 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        containerId: "CBX-SHARED-01", // thử cả alias containerId
        lotIds: ["LOT-S40-02"],
        vehiclePlate: "29C-222.22",
      }
    );
    assert.equal(res2.status, 409, "Cố gắn thùng lạnh đang hoạt động phải trả về 409 Conflict");
    assert.equal(res2.body.error, "COLD_BOX_ALREADY_IN_USE");
    assert.equal(res2.body.activeShipmentId, shipment1Id);

    // Kết thúc chuyến 1
    const compRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipment1Id}/complete`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      { notes: "Đã dỡ hàng chuyến 1, giải phóng thùng lạnh" }
    );
    assert.equal(compRes.status, 200, "Kết thúc chuyến 1 thành công");

    // Sau khi giải phóng, thùng lạnh CBX-SHARED-01 có thể được sử dụng lại cho chuyến mới
    const res3 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CBX-SHARED-01",
        lotIds: ["LOT-S40-02"],
        vehiclePlate: "29C-222.22",
      }
    );
    assert.equal(res3.status, 201, "Thùng lạnh đã giải phóng mở chuyến mới thành công");
  });

  await t.test("9. Chặn gắn các lô hàng thuộc nhiều tổ chức khác nhau vào cùng một chuyến vận chuyển", async () => {
    setupLots();

    // Dù là Admin, cũng không được phép gom các lô của các tổ chức khác nhau (org-001 và org-002) vào cùng một chuyến
    const resMultiOrg = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
      },
      {
        coldBoxId: "CBX-MULTI-ORG",
        lotIds: ["LOT-S40-01", "LOT-S40-03"], // 01 thuộc org-001, 03 thuộc org-002
      }
    );
    assert.equal(resMultiOrg.status, 400, "Gom lô nhiều tổ chức vào cùng chuyến phải trả về 400 Bad Request");
    assert.equal(resMultiOrg.body.error, "MULTI_ORG_LOTS_NOT_ALLOWED");
  });

  await t.test("10. Tương thích định dạng trường (Aliases) và endpoint danh mục thùng lạnh", async () => {
    setupLots();

    // 10.1 Mở chuyến dùng các trường alias của frontend adapter (containerId, origin, destination)
    const createAliasRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        containerId: "CONT-COLD-01",
        lotIds: ["LOT-S40-01"],
        origin: "Kho Mộc Châu",
        destination: "Kho Hà Nội",
        vehiclePlate: "29C-123.45",
        driverName: "Tài xế Chuỗi Lạnh",
      }
    );

    assert.equal(createAliasRes.status, 201);
    const ship = createAliasRes.body.shipment;
    assert.equal(ship.containerId, "CONT-COLD-01");
    assert.equal(ship.coldBoxId, "CONT-COLD-01");
    assert.equal(ship.origin, "Kho Mộc Châu");
    assert.equal(ship.destination, "Kho Hà Nội");
    assert.ok(ship.code);
    assert.ok(ship.id);

    // 10.2 Kiểm tra API chi tiết chuyến bảo toàn các trường alias và lotIds
    const detailRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: `/api/shipments/${ship.id}`,
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.body.shipment.containerId, "CONT-COLD-01");
    assert.equal(detailRes.body.shipment.origin, "Kho Mộc Châu");
    assert.equal(detailRes.body.shipment.destination, "Kho Hà Nội");
    assert.deepEqual(detailRes.body.shipment.lotIds, ["LOT-S40-01"]);

    // 10.3 Kiểm tra tìm kiếm chuyến theo từ khóa (search query)
    const searchRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/shipments?search=29C-123.45",
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.total, 1);
    assert.equal(searchRes.body.data[0].id, ship.id);

    // 10.4 Kiểm tra endpoint GET /api/cold-containers
    const unauthContainers = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/cold-containers",
      method: "GET",
    });
    assert.equal(unauthContainers.status, 401, "Truy cập cold-containers khi chưa đăng nhập phải trả về 401");

    const authContainers = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/cold-containers",
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(authContainers.status, 200, "Đăng nhập truy cập cold-containers thành công");
    assert.equal(authContainers.body.success, true);
    assert.ok(Array.isArray(authContainers.body.containers));
    assert.ok(authContainers.body.containers.some((c) => c.id === "CONT-COLD-01"));
  });

  await t.test("11. Fixes S40: Custom code, departure time, lot safety checks, container in-use status", async () => {
    setupLots();

    // 11.1 Tạo chuyến với mã tùy chỉnh (custom code) và thời gian khởi hành (departureTime)
    const customDeparture = "2026-10-18T05:30:00.000Z";
    const customRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        code: "SHP-CUSTOM-2026-001",
        coldBoxId: "CONT-COLD-02",
        lotIds: ["LOT-S40-01"],
        origin: "Nông trường Mộc Châu",
        destination: "Hà Nội",
        departureTime: customDeparture,
      }
    );

    assert.equal(customRes.status, 201, "Tạo chuyến với mã tùy chỉnh thành công");
    assert.equal(customRes.body.shipment.id, "SHP-CUSTOM-2026-001");
    assert.equal(customRes.body.shipment.code, "SHP-CUSTOM-2026-001");
    assert.equal(new Date(customRes.body.shipment.departureTime).toISOString(), customDeparture);

    // 11.2 Kiểm tra chặn mã chuyến trùng lặp (409 SHIPMENT_CODE_ALREADY_EXISTS)
    const dupCodeRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        code: "SHP-CUSTOM-2026-001",
        coldBoxId: "CONT-COLD-03",
        lotIds: ["LOT-S40-02"],
      }
    );
    assert.equal(dupCodeRes.status, 409, "Mã chuyến trùng lặp phải trả về 409");
    assert.equal(dupCodeRes.body.error, "SHIPMENT_CODE_ALREADY_EXISTS");

    // 11.3 Kiểm tra endpoint cold-containers phản ánh container đang bận
    const containersRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/cold-containers",
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(containersRes.status, 200);
    const box2 = containersRes.body.containers.find((c) => c.id === "CONT-COLD-02");
    assert.ok(box2, "CONT-COLD-02 có trong danh sách");
    assert.equal(box2.inUse, true, "CONT-COLD-02 đang trong chuyến vận chuyển nên inUse = true");

    // 11.4 Kiểm tra từ chối lô hàng đã bị thu hồi / có sự cố (400 LOT_RECALLED_OR_INCIDENT)
    inMemoryLots.push({
      id: "LOT-RECALLED-01",
      name: "Lô Rau có sự cố",
      status: "Có sự cố",
      organizationId: "org-001",
      remainingQuantity: 100,
    });
    const recallRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CONT-COLD-03",
        lotIds: ["LOT-RECALLED-01"],
      }
    );
    assert.equal(recallRes.status, 400, "Lô có sự cố phải bị từ chối");
    assert.equal(recallRes.body.error, "LOT_RECALLED_OR_INCIDENT");

    // 11.5 Kiểm tra từ chối lô hàng đã bán hết / tiêu thụ (400 LOT_ALREADY_CONSUMED)
    inMemoryLots.push({
      id: "LOT-CONSUMED-01",
      name: "Lô Dưa lưới đã bán hết",
      status: "CONSUMED",
      organizationId: "org-001",
      remainingQuantity: 0,
    });
    const consumedRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CONT-COLD-03",
        lotIds: ["LOT-CONSUMED-01"],
      }
    );
    assert.equal(consumedRes.status, 400, "Lô đã tiêu thụ phải bị từ chối");
    assert.equal(consumedRes.body.error, "LOT_ALREADY_CONSUMED");

    // 11.6 Kiểm tra lô còn 25 kg hiển thị đúng 25 kg và tạo chuyến bình thường
    inMemoryLots.push({
      id: "LOT-25KG-VALID",
      name: "Lô Bơ Sáp 25kg",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      remainingQuantity: 25,
      initialQuantity: 100,
    });
    const lotsListRes = await request(server, {
      hostname: "127.0.0.1",
      port,
      path: "/api/organization/lots",
      method: "GET",
      headers: { Cookie: producerCookie },
    });
    assert.equal(lotsListRes.status, 200);
    const found25 = lotsListRes.body.lots.find((l) => l.id === "LOT-25KG-VALID");
    assert.ok(found25);
    assert.equal(found25.remainingQuantity, 25, "Lô còn 25 kg hiển thị đúng 25 kg trong API");
    assert.equal(found25.current_quantity, 25);

    const create25Res = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CONT-CHILL-01",
        lotIds: ["LOT-25KG-VALID"],
        origin: "Đắk Lắk",
        destination: "Hà Nội",
      }
    );
    assert.equal(create25Res.status, 201, "Lô có khối lượng hợp lệ (25 kg) vẫn tạo chuyến bình thường");

    // 11.7 Kiểm tra lô 0 kg (status bình thường nhưng remaining = 0) bị chặn ở backend
    inMemoryLots.push({
      id: "LOT-ZERO-WEIGHT",
      name: "Lô Dưa chuột hết hàng",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      remainingQuantity: 0,
      initialQuantity: 100,
    });
    const createZeroRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CONT-FREEZE-01",
        lotIds: ["LOT-ZERO-WEIGHT"],
      }
    );
    assert.equal(createZeroRes.status, 400, "Lô 0 kg phải bị chặn ở backend");
    assert.equal(createZeroRes.body.error, "LOT_ALREADY_CONSUMED");

    // 11.8 Kiểm tra lô trạng thái 'Đã bán hết' bị chặn
    inMemoryLots.push({
      id: "LOT-SOLD-OUT",
      name: "Lô Cà rốt đã bán hết",
      status: "Đã bán hết",
      organizationId: "org-001",
      remainingQuantity: 0,
    });
    const createSoldRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: producerCookie,
        },
      },
      {
        coldBoxId: "CONT-FREEZE-01",
        lotIds: ["LOT-SOLD-OUT"],
      }
    );
    assert.equal(createSoldRes.status, 400, "Lô Đã bán hết phải bị chặn");
    assert.equal(createSoldRes.body.error, "LOT_ALREADY_CONSUMED");
  });
});

