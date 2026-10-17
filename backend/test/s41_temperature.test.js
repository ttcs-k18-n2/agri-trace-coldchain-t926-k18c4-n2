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
});
