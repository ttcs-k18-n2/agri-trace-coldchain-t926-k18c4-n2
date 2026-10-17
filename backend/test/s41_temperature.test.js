const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const {
  app,
  inMemoryLots,
  inMemoryShipments,
  inMemoryShipmentLots,
  inMemoryShipmentTemperatures,
  inMemoryBatchEvents,
  inMemoryAuditLogs,
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

test("S-41 (Jira N2-109): Ghi nhận nhiệt độ theo thời gian cho chuyến - Cold Chain Temperature Tracking", async (t) => {
  await seedDemoUser();

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  t.after(() => {
    server.close();
  });

  const producerCookie = await loginUser(server, "user@example.com", "Password@123"); // org-001
  const coopCookie = await loginUser(server, "user2@example.com", "Password@123"); // org-002
  const inspectorCookie = await loginUser(server, "inspector@example.com", "Password@123"); // org-inspector
  const adminCookie = await loginUser(server, "admin@example.com", "Password@123"); // org-system
  const transporterCookie = await loginUser(server, "transporter@example.com", "Password@123"); // org-trans

  assert.ok(producerCookie, "Login producer thành công");
  assert.ok(coopCookie, "Login coop thành công");
  assert.ok(inspectorCookie, "Login inspector thành công");

  const resetState = () => {
    inMemoryLots.length = 0;
    inMemoryShipments.length = 0;
    inMemoryShipmentLots.length = 0;
    if (inMemoryShipmentTemperatures) {
      inMemoryShipmentTemperatures.length = 0;
    }
    inMemoryBatchEvents.length = 0;
    inMemoryAuditLogs.length = 0;

    inMemoryLots.push({
      id: "LOT-TEMP-01",
      name: "Lô Dâu tây lạnh #1",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      organization_id: "org-001",
      remainingQuantity: 100,
      initialQuantity: 100,
    });
  };

  await t.test("TC-S41-01 & TC-S41-02 & TC-S41-03: Ghi nhận số đo mới hơn, bỏ qua số đo cũ hơn hoặc bằng số đo đã lưu", async () => {
    resetState();

    // 1. Tạo chuyến vận chuyển cho org-001 với thùng lạnh CB-TEMP-01
    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-TEMP-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    assert.equal(createRes.status, 201, "Tạo chuyến thành công");
    const shipmentId = createRes.body.shipment.id;

    // 2. Gửi số đo đầu tiên (T1: 2026-10-17T10:00:00.000Z, 4.5 độ)
    const t1 = "2026-10-17T10:00:00.000Z";
    const postT1 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-TEMP-01",
        timestamp: t1,
        temperature: 4.5,
      }
    );
    assert.equal(postT1.status, 200);
    assert.equal(postT1.body.success, true);
    assert.equal(postT1.body.acknowledged, true);
    assert.equal(postT1.body.ignored, false);

    // 3. Gửi số đo mới hơn (T2: 2026-10-17T10:15:00.000Z, 4.8 độ) -> Được lưu
    const t2 = "2026-10-17T10:15:00.000Z";
    const postT2 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-TEMP-01",
        timestamp: t2,
        temperature: 4.8,
      }
    );
    assert.equal(postT2.status, 200);
    assert.equal(postT2.body.acknowledged, true);
    assert.equal(postT2.body.ignored, false);

    // 4. Gửi số đo cũ hơn (T_old: 2026-10-17T10:05:00.000Z, 9.9 độ) -> Bỏ qua, trả acknowledged
    const tOld = "2026-10-17T10:05:00.000Z";
    const postOld = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-TEMP-01",
        timestamp: tOld,
        temperature: 9.9,
      }
    );
    assert.equal(postOld.status, 200);
    assert.equal(postOld.body.acknowledged, true);
    assert.equal(postOld.body.ignored, true);

    // 5. Gửi số đo có cùng thời điểm với số đo mới nhất (T2, 3.0 độ) -> Bỏ qua, trả acknowledged
    const postEqual = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-TEMP-01",
        timestamp: t2,
        temperature: 3.0,
      }
    );
    assert.equal(postEqual.status, 200);
    assert.equal(postEqual.body.acknowledged, true);
    assert.equal(postEqual.body.ignored, true);

    // 6. Kiểm tra nhiệt độ hiện hành của chuyến: vẫn phải là 4.8 độ tại T2
    const shipRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}`,
        method: "GET",
        headers: { Cookie: producerCookie },
      }
    );
    assert.equal(shipRes.status, 200);
    assert.equal(shipRes.body.shipment.currentTemperature, 4.8);
    assert.equal(new Date(shipRes.body.shipment.lastTemperatureAt).getTime(), new Date(t2).getTime());
  });

  await t.test("TC-S41-04: Xử lý đồng thời các gói tin nhiệt độ đến sai thứ tự (Concurrent Out-Of-Order)", async () => {
    resetState();

    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-CONCUR-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    assert.equal(createRes.status, 201);
    const shipmentId = createRes.body.shipment.id;

    // Gửi đồng thời 5 request với mốc thời gian không theo thứ tự: t1, t5, t3, t2, t4
    const readings = [
      { timestamp: "2026-10-17T11:00:00.000Z", temperature: 2.1 },
      { timestamp: "2026-10-17T11:20:00.000Z", temperature: 5.5 }, // Mới nhất (t5)
      { timestamp: "2026-10-17T11:10:00.000Z", temperature: 3.3 },
      { timestamp: "2026-10-17T11:05:00.000Z", temperature: 2.8 },
      { timestamp: "2026-10-17T11:15:00.000Z", temperature: 4.4 },
    ];

    const results = await Promise.all(
      readings.map((r) =>
        request(
          server,
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/shipments/temperatures",
            method: "POST",
            headers: { "Content-Type": "application/json", Cookie: producerCookie },
          },
          {
            coldBoxId: "CB-CONCUR-01",
            timestamp: r.timestamp,
            temperature: r.temperature,
          }
        )
      )
    );

    // Mọi request đều phải trả về 200 acknowledged
    for (const res of results) {
      assert.equal(res.status, 200);
      assert.equal(res.body.acknowledged, true);
    }

    // Kết quả cuối cùng: nhiệt độ hiện hành phải chính xác là số đo tại thời điểm mới nhất t5 (5.5 độ)
    const shipRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}`,
        method: "GET",
        headers: { Cookie: producerCookie },
      }
    );
    assert.equal(shipRes.status, 200);
    assert.equal(shipRes.body.shipment.currentTemperature, 5.5);
    assert.equal(
      new Date(shipRes.body.shipment.lastTemperatureAt).getTime(),
      new Date("2026-10-17T11:20:00.000Z").getTime()
    );
  });

  await t.test("TC-S41-05: Từ chối hoặc xử lý khi không có chuyến hoạt động / chuyến đã kết thúc", async () => {
    resetState();

    // 1. Thùng lạnh chưa từng có chuyến nào -> 404 NO_ACTIVE_SHIPMENT
    const noShipRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NON-EXISTENT",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(noShipRes.status, 404);
    assert.equal(noShipRes.body.error, "NO_ACTIVE_SHIPMENT");

    // 2. Tạo chuyến và kết thúc chuyến
    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-ENDED-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    const shipmentId = createRes.body.shipment.id;

    const endRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/complete`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {}
    );
    assert.equal(endRes.status, 200);

    // 3. Gửi số đo cho chuyến đã kết thúc -> 400 SHIPMENT_ALREADY_ENDED
    const endedRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-ENDED-01",
        timestamp: "2026-10-17T12:05:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(endedRes.status, 400);
    assert.equal(endedRes.body.error, "SHIPMENT_ALREADY_ENDED");
  });

  await t.test("TC-S41-06: Xác thực, phân quyền (RBAC) và chống can thiệp đa tổ chức (Cross-Tenant)", async () => {
    resetState();

    // 1. Tạo chuyến cho org-001
    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-SEC-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );

    // 2. Chưa xác thực (No Cookie) -> 401
    const unauthRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      {
        coldBoxId: "CB-SEC-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(unauthRes.status, 401);

    // 3. Khác tổ chức (coopCookie từ org-002) -> 403 Forbidden
    const crossTenantRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: coopCookie },
      },
      {
        coldBoxId: "CB-SEC-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(crossTenantRes.status, 403);

    // 4. Cán bộ kiểm tra (inspectorCookie) -> 403 (chỉ đọc, không ghi)
    const inspectorRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: inspectorCookie },
      },
      {
        coldBoxId: "CB-SEC-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(inspectorRes.status, 403);

    // 5. Transporter từ org-trans gửi số đo cho chuyến của org-001 -> 403 Forbidden
    const transporterRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: transporterCookie },
      },
      {
        coldBoxId: "CB-SEC-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(transporterRes.status, 403);

    // 6. Quản trị viên hệ thống (adminCookie) có toàn quyền ghi số đo -> 200 OK
    const adminRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: adminCookie },
      },
      {
        coldBoxId: "CB-SEC-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 3.9,
      }
    );
    assert.equal(adminRes.status, 200);
    assert.equal(adminRes.body.acknowledged, true);
  });

  await t.test("TC-S41-07: Kiểm tra dữ liệu đầu vào không hợp lệ (Invalid Inputs)", async () => {
    resetState();

    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-VALID-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );

    // 1. Thiếu mã thùng lạnh
    const noColdBox = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 5.0,
      }
    );
    assert.equal(noColdBox.status, 400);
    assert.equal(noColdBox.body.error, "MISSING_COLD_BOX_CODE");

    // 2. Nhiệt độ không hữu hạn (NaN / Infinity / String)
    const nanTemp = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-VALID-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: "invalid_temp",
      }
    );
    assert.equal(nanTemp.status, 400);
    assert.equal(nanTemp.body.error, "INVALID_TEMPERATURE");

    // 3. Thời điểm đo sai định dạng
    const badTime = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-VALID-01",
        timestamp: "not-a-valid-timestamp",
        temperature: 5.0,
      }
    );
    assert.equal(badTime.status, 400);
    assert.equal(badTime.body.error, "INVALID_TIMESTAMP");
  });

  await t.test("TC-S41-08: Chống giả mạo tổ chức từ payload (Enforce session org, no caller org spoof)", async () => {
    resetState();

    // 1. Tạo chuyến thuộc org-001
    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie }, // org-001
      },
      {
        coldBoxId: "CB-SPOOF-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );

    // 2. User org-002 gửi request ghi nhận nhiệt độ nhưng cố ý truyền organizationId = "org-001" trong payload
    const spoofRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: coopCookie }, // user from org-002
      },
      {
        coldBoxId: "CB-SPOOF-01",
        timestamp: "2026-10-17T12:00:00.000Z",
        temperature: 4.0,
        organizationId: "org-001", // Kẻ tấn công cố tình giả mạo org
        organization_id: "org-001",
      }
    );
    // Hệ thống phải sử dụng session auth để chặn, không được tin tưởng payload -> 403 Forbidden
    assert.equal(spoofRes.status, 403);
    assert.equal(spoofRes.body.error, "FORBIDDEN_SHIPMENT_ACCESS");
  });

  await t.test("TC-S41-09: Hai yêu cầu đồng thời có cùng mốc thời gian (Duplicate timestamp concurrency)", async () => {
    resetState();

    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-DUP-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );

    const dupTimestamp = "2026-10-17T12:30:00.000Z";
    const [res1, res2] = await Promise.all([
      request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/shipments/temperatures",
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: producerCookie },
        },
        {
          coldBoxId: "CB-DUP-01",
          timestamp: dupTimestamp,
          temperature: 4.2,
        }
      ),
      request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/shipments/temperatures",
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: producerCookie },
        },
        {
          coldBoxId: "CB-DUP-01",
          timestamp: dupTimestamp,
          temperature: 4.2,
        }
      ),
    ]);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(res1.body.acknowledged, true);
    assert.equal(res2.body.acknowledged, true);

    // Một trong hai phải là ignored: true (vì cùng timestamp) hoặc cả hai đều acknowledged mà không làm trùng lặp bản ghi
    const ignoredCount = (res1.body.ignored ? 1 : 0) + (res2.body.ignored ? 1 : 0);
    assert.ok(ignoredCount >= 1, "Ít nhất một trong hai yêu cầu trùng timestamp phải bị ignore");
  });

  await t.test("TC-S41-10: Tra cứu lịch sử nhiệt độ qua GET và bảo toàn vòng đời S-40", async () => {
    resetState();

    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-HIST-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    const shipmentId = createRes.body.shipment.id;

    // Gửi 2 số đo hợp lệ
    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/cold-boxes/CB-HIST-01/temperatures`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        timestamp: "2026-10-17T13:00:00.000Z",
        temperature: 3.5,
      }
    );

    await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/cold-boxes/CB-HIST-01/temperatures`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        timestamp: "2026-10-17T13:10:00.000Z",
        temperature: 3.8,
      }
    );

    // Tra cứu qua GET /api/shipments/:id/temperatures
    const getRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/temperatures`,
        method: "GET",
        headers: { Cookie: producerCookie },
      }
    );
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.count, 2);
    assert.equal(getRes.body.temperatures[0].temperature, 3.5);
    assert.equal(getRes.body.temperatures[1].temperature, 3.8);

    // Cán bộ kiểm tra được phép đọc lịch sử
    const inspectorGet = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentId}/temperatures`,
        method: "GET",
        headers: { Cookie: inspectorCookie },
      }
    );
    assert.equal(inspectorGet.status, 200);
    assert.equal(inspectorGet.body.count, 2);
  });

  await t.test("TC-S41-11: Chống ô nhiễm gói tin đến trễ khi tái sử dụng thùng lạnh (Cold box reuse delayed packet protection)", async () => {
    resetState();
    inMemoryLots.push({
      id: "LOT-TEMP-02",
      name: "Lô Dâu tây lạnh #2",
      status: "Đã thu hoạch",
      organizationId: "org-001",
      organization_id: "org-001",
      remainingQuantity: 50,
      initialQuantity: 50,
    });


    // 1. Tạo và hoàn thành chuyến A với thùng lạnh CB-REUSE-99
    const createResA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-REUSE-99",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    const shipmentAId = createResA.body.shipment.id;

    // Kết thúc chuyến A
    const compResA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentAId}/complete`,
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {}
    );
    assert.equal(compResA.status, 200);

    // 2. Mở chuyến B mới với cùng thùng lạnh CB-REUSE-99
    const createResB = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-REUSE-99",
        lotIds: ["LOT-TEMP-02"],
      }
    );
    assert.equal(createResB.status, 201);
    const shipmentBId = createResB.body.shipment.id;

    // Thời điểm bắt đầu của chuyến B (tạo lúc now, trong test giả định chuỗi thời gian)
    // Giả sử chuyến B vừa được tạo (startedAt là thời điểm hiện tại).
    // Giả lập gói tin đến trễ từ chuyến A: có timestamp 1 giờ trước khi B bắt đầu (khi B chưa có mẫu nào)
    const delayedTimestampA = new Date(Date.now() - 3600000).toISOString();

    const postDelayedA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-REUSE-99",
        timestamp: delayedTimestampA,
        temperature: 9.9,
      }
    );

    // Gói tin trễ từ A phải được acknowledge nhưng ignored: true, KHÔNG được gắn vào chuyến B
    assert.equal(postDelayedA.status, 200);
    assert.equal(postDelayedA.body.acknowledged, true);
    assert.equal(postDelayedA.body.ignored, true);
    assert.equal(postDelayedA.body.data.latestTemperature, null);

    // Kiểm tra lịch sử chuyến B: phải hoàn toàn sạch sẽ (0 bản ghi)
    const getHistBEmpty = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentBId}/temperatures`,
        method: "GET",
        headers: { Cookie: producerCookie },
      }
    );
    assert.equal(getHistBEmpty.status, 200);
    assert.equal(getHistBEmpty.body.count, 0);

    // 3. Gửi số đo hợp lệ của chuyến B (timestamp hiện tại)
    const validTimestampB = new Date().toISOString();
    const postValidB = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-REUSE-99",
        timestamp: validTimestampB,
        temperature: 4.2,
      }
    );
    assert.equal(postValidB.status, 200);
    assert.equal(postValidB.body.acknowledged, true);
    assert.equal(postValidB.body.ignored, false);
    assert.equal(postValidB.body.data.temperature, 4.2);

    // 4. Lại nhận thêm một gói tin đến trễ từ chuyến A (thời gian trước khi B bắt đầu)
    const anotherDelayedA = new Date(Date.now() - 7200000).toISOString();
    const postDelayedA2 = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-REUSE-99",
        timestamp: anotherDelayedA,
        temperature: 15.0,
      }
    );
    assert.equal(postDelayedA2.status, 200);
    assert.equal(postDelayedA2.body.acknowledged, true);
    assert.equal(postDelayedA2.body.ignored, true);
    assert.equal(postDelayedA2.body.data.latestTemperature, 4.2);

    // Kiểm tra lịch sử chuyến B: vẫn chỉ có đúng 1 bản ghi hợp lệ của B
    const getHistBFinal = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipmentBId}/temperatures`,
        method: "GET",
        headers: { Cookie: producerCookie },
      }
    );
    assert.equal(getHistBFinal.status, 200);
    assert.equal(getHistBFinal.body.count, 1);
    assert.equal(getHistBFinal.body.temperatures[0].temperature, 4.2);
  });

  await t.test("TC-S41-12: Kiểm tra giới hạn số PostgreSQL NUMERIC(5, 2) và chống future poisoning", async () => {
    resetState();

    const createRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        lotIds: ["LOT-TEMP-01"],
      }
    );
    assert.equal(createRes.status, 201);

    // A. Tràn giới hạn NUMERIC(5, 2): giá trị >= 1000 hoặc <= -1000 phải trả 400 INVALID_TEMPERATURE (thay vì 500)
    const overflowHigh = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        timestamp: new Date().toISOString(),
        temperature: 1000.0,
      }
    );
    assert.equal(overflowHigh.status, 400);
    assert.equal(overflowHigh.body.error, "INVALID_TEMPERATURE");

    const overflowLow = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        timestamp: new Date().toISOString(),
        temperature: -1000.0,
      }
    );
    assert.equal(overflowLow.status, 400);
    assert.equal(overflowLow.body.error, "INVALID_TEMPERATURE");

    // B. Giá trị cực hạn hợp lệ trong dải NUMERIC(5, 2) (-999.99 và 999.99)
    const boundaryValid = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        timestamp: new Date().toISOString(),
        temperature: -99.5,
      }
    );
    assert.equal(boundaryValid.status, 200);
    assert.equal(boundaryValid.body.acknowledged, true);

    // C. Timestamp là số (number) thay vì string ISO-8601 -> phải từ chối 400 INVALID_TIMESTAMP
    const numericTimestamp = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        timestamp: Date.now(),
        temperature: 4.0,
      }
    );
    assert.equal(numericTimestamp.status, 400);
    assert.equal(numericTimestamp.body.error, "INVALID_TIMESTAMP");

    // D. Accelerated fixture timestamps: valid future timestamps are accepted (no arbitrary 24h skew blocking S42)
    const futureAccelerated = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      {
        coldBoxId: "CB-NUM-01",
        timestamp: "2099-01-01T00:00:00.000Z",
        temperature: 4.0,
      }
    );
    assert.equal(futureAccelerated.status, 200);
    assert.equal(futureAccelerated.body.acknowledged, true);

    // E. Strict calendar date and format rejection: ambiguous strings, invalid calendar dates
    const invalidCalendarDates = [
      "1",
      "invalid-date",
      "2026-02-31T12:00:00.000Z",
      "2026-13-01T12:00:00.000Z",
      "2026-04-31T12:00:00.000Z",
      "2026-10-17T25:00:00.000Z",
      "2026-10-17T12:60:00.000Z",
    ];
    for (const badTs of invalidCalendarDates) {
      const resBad = await request(
        server,
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/shipments/temperatures",
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: producerCookie },
        },
        {
          coldBoxId: "CB-NUM-01",
          timestamp: badTs,
          temperature: 4.0,
        }
      );
      assert.equal(resBad.status, 400, `Expected 400 for bad timestamp '${badTs}'`);
      assert.equal(resBad.body.error, "INVALID_TIMESTAMP");
    }
  });

  await t.test("TC-S41-13: List (/api/shipments) và detail (/api/shipments/:id) đồng nhất currentTemperature (0, số âm, null)", async () => {
    resetState();
    inMemoryLots.push(
      { id: "LOT-PROJ-01", name: "Lô 01", status: "Đã thu hoạch", organizationId: "org-001", remainingQuantity: 100, initialQuantity: 100 },
      { id: "LOT-PROJ-02", name: "Lô 02", status: "Đã thu hoạch", organizationId: "org-001", remainingQuantity: 100, initialQuantity: 100 },
      { id: "LOT-PROJ-03", name: "Lô 03", status: "Đã thu hoạch", organizationId: "org-001", remainingQuantity: 100, initialQuantity: 100 }
    );

    // 1. Tạo 3 chuyến: Chuyến A (sẽ đo 0 độ), Chuyến B (sẽ đo số âm), Chuyến C (chưa đo)
    const createA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { coldBoxId: "CB-PROJ-01", lotIds: ["LOT-PROJ-01"] }
    );
    assert.equal(createA.status, 201);
    const shipAId = createA.body.shipment.id;

    const createB = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { coldBoxId: "CB-PROJ-02", lotIds: ["LOT-PROJ-02"] }
    );
    assert.equal(createB.status, 201);
    const shipBId = createB.body.shipment.id;

    const createC = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { coldBoxId: "CB-PROJ-03", lotIds: ["LOT-PROJ-03"] }
    );
    assert.equal(createC.status, 201);
    const shipCId = createC.body.shipment.id;

    // Ghi số đo 0 độ cho Chuyến A
    const timeA = new Date("2026-10-17T12:00:00.000Z").toISOString();
    const resA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { coldBoxId: "CB-PROJ-01", temperature: 0.0, timestamp: timeA }
    );
    assert.equal(resA.status, 200);

    // Ghi số đo âm (-3.2 độ) cho Chuyến B
    const timeB = new Date("2026-10-17T12:05:00.000Z").toISOString();
    const resB = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments/temperatures",
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: producerCookie },
      },
      { coldBoxId: "CB-PROJ-02", temperature: -3.2, timestamp: timeB }
    );
    assert.equal(resB.status, 200);

    // 2. Gọi GET /api/shipments (list)
    const listRes = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/shipments",
        method: "GET",
        headers: { Cookie: adminCookie },
      }
    );
    assert.equal(listRes.status, 200);
    const listItems = listRes.body.data;
    const map = new Map(listItems.map((s) => [s.id, s]));

    // 3. Gọi GET /api/shipments/:id (detail)
    const detailA = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipAId}`,
        method: "GET",
        headers: { Cookie: adminCookie },
      }
    );
    const detailB = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipBId}`,
        method: "GET",
        headers: { Cookie: adminCookie },
      }
    );
    const detailC = await request(
      server,
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/shipments/${shipCId}`,
        method: "GET",
        headers: { Cookie: adminCookie },
      }
    );

    // So sánh Chuyến A: currentTemperature = 0 (bảo toàn số 0, không nhầm với falsy/null)
    const itemA = map.get(shipAId);
    assert.ok(itemA, "Chuyến A phải có trong danh sách");
    assert.strictEqual(itemA.currentTemperature, 0, "List Chuyến A phải có currentTemperature là 0");
    assert.strictEqual(detailA.body.shipment.currentTemperature, 0, "Detail Chuyến A phải có currentTemperature là 0");
    assert.equal(itemA.lastTemperatureAt, timeA);
    assert.equal(detailA.body.shipment.lastTemperatureAt, timeA);

    // So sánh Chuyến B: currentTemperature = -3.2
    const itemB = map.get(shipBId);
    assert.ok(itemB, "Chuyến B phải có trong danh sách");
    assert.strictEqual(itemB.currentTemperature, -3.2);
    assert.strictEqual(detailB.body.shipment.currentTemperature, -3.2);
    assert.equal(itemB.lastTemperatureAt, timeB);
    assert.equal(detailB.body.shipment.lastTemperatureAt, timeB);

    // So sánh Chuyến C: currentTemperature = null, lastTemperatureAt = null
    const itemC = map.get(shipCId);
    assert.ok(itemC, "Chuyến C phải có trong danh sách");
    assert.strictEqual(itemC.currentTemperature, null);
    assert.strictEqual(detailC.body.shipment.currentTemperature, null);
    assert.strictEqual(itemC.lastTemperatureAt, null);
    assert.strictEqual(detailC.body.shipment.lastTemperatureAt, null);
  });
});

