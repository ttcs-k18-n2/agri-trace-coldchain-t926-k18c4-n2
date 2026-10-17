/**
 * Module quản lý chuyến vận chuyển liên kết một thùng lạnh với nhiều lô hàng (Story S-40 / Jira N2-211)
 *
 * Nghiệp vụ cốt lõi:
 * 1. Mở chuyến vận chuyển: Gắn 1 thùng lạnh (coldBoxId) với nhiều lô hàng (lotIds).
 * 2. Kiểm tra quyền tổ chức: Chỉ tổ chức đang giữ lô hàng mới được gắn vào chuyến (hoặc admin).
 * 3. Chống cạnh tranh (Concurrency Defense): Chặn một lô tham gia 2 chuyến đang hoạt động đồng thời (DB partial unique index + row locking).
 * 4. Chuỗi băm bất biến (Hash-Chain RFC 8785 SHA-256):
 *    - Ghi sự kiện lên xe (SHIPMENT_LOADED) vào chuỗi của từng lô khi mở chuyến.
 *    - Ghi sự kiện xuống xe (SHIPMENT_UNLOADED) vào chuỗi của từng lô khi kết thúc chuyến.
 * 5. Tính nguyên tử (ACID Transaction): Toàn bộ thao tác tạo/kết thúc chuyến, cập nhật bảng liên kết,
 *    ghi sự kiện lô và ghi nhật ký kiểm toán (audit log) phải nằm trong cùng một Transaction duy nhất.
 */

const crypto = require("node:crypto");
const { appendBatchEvent } = require("./event_repository");
const { recordAuditLog, inMemoryAuditLogs } = require("./audit_logger");
const { getOrganizationMap } = require("./lot_access");

const inMemoryShipments = [];
const inMemoryShipmentLots = [];
const inMemoryShipmentTemperatures = [];

/**
 * Mutex lock in-memory cho nhiệt độ thùng lạnh nhằm mô phỏng tuần tự hoá (SELECT FOR UPDATE)
 * khi chạy ở môi trường kiểm thử in-memory không có CSDL PostgreSQL.
 */
const temperatureLocks = new Map();

async function withTemperatureLock(key, fn) {
  const currentLock = temperatureLocks.get(key) || Promise.resolve();
  let release;
  const nextLock = new Promise((res) => {
    release = res;
  });
  const queued = currentLock.then(() => nextLock);
  temperatureLocks.set(key, queued);

  await currentLock;
  try {
    return await fn();
  } finally {
    release();
    if (temperatureLocks.get(key) === queued) {
      temperatureLocks.delete(key);
    }
  }
}

/**
 * Mutex lock in-memory cho từng lô hàng nhằm mô phỏng tuần tự hoá (SELECT FOR UPDATE)
 * khi chạy ở môi trường kiểm thử in-memory không có CSDL PostgreSQL.
 */
const lotShipmentLocks = new Map();

async function withLotLocks(lotIds, fn) {
  const sorted = [...lotIds].sort();
  const acquireNext = async (index) => {
    if (index >= sorted.length) {
      return await fn();
    }
    const lotId = sorted[index];
    const currentLock = lotShipmentLocks.get(lotId) || Promise.resolve();
    let release;
    const nextLock = new Promise((res) => {
      release = res;
    });
    const queued = currentLock.then(() => nextLock);
    lotShipmentLocks.set(lotId, queued);

    await currentLock;
    try {
      return await acquireNext(index + 1);
    } finally {
      release();
      if (lotShipmentLocks.get(lotId) === queued) {
        lotShipmentLocks.delete(lotId);
      }
    }
  };

  return await acquireNext(0);
}

/**
 * Tạo chuyến vận chuyển mới gắn 1 thùng lạnh với nhiều lô hàng (S-40)
 */
async function createShipment({
  pool = null,
  client = null,
  authContext = null,
  data = {},
  inMemoryLots = [],
  inMemoryOrgs = [],
  inMemoryProducts = [],
  ipAddress = "127.0.0.1",
  userAgent = null,
}) {
  const { resolveShipmentThresholds } = require("./cold_chain_violation_service");
  const {
    coldBoxId,
    lotIds,
    vehiclePlate,
    licensePlate,
    driverName,
    driverPhone,
    originLocationId,
    destinationLocationId,
    notes,
  } = data;

  const rawColdBoxId = coldBoxId || data.containerId;
  const rawOrigin = originLocationId || data.origin;
  const rawDest = destinationLocationId || data.destination;

  const cleanColdBoxId = typeof rawColdBoxId === "string" ? rawColdBoxId.trim() : null;
  const plate = typeof vehiclePlate === "string" ? vehiclePlate.trim() : (typeof licensePlate === "string" ? licensePlate.trim() : null);
  const cleanDriver = typeof driverName === "string" ? driverName.trim() : null;
  const cleanPhone = typeof driverPhone === "string" ? driverPhone.trim() : null;
  const cleanOrigin = typeof rawOrigin === "string" ? rawOrigin.trim() : null;
  const cleanDest = typeof rawDest === "string" ? rawDest.trim() : null;
  const cleanNotes = typeof notes === "string" ? notes.trim() : null;

  // 1. Kiểm tra đầu vào cơ bản
  if (!cleanColdBoxId) {
    return {
      status: 400,
      error: "MISSING_COLD_BOX_ID",
      message: "Mã thùng lạnh (coldBoxId) là bắt buộc.",
    };
  }

  if (!Array.isArray(lotIds) || lotIds.length === 0) {
    return {
      status: 400,
      error: "MISSING_LOT_IDS",
      message: "Danh sách mã lô hàng (lotIds) là bắt buộc và phải có ít nhất 1 lô.",
    };
  }

  const rawLotIds = lotIds.map((id) => (typeof id === "string" ? id.trim() : String(id || ""))).filter(Boolean);
  if (rawLotIds.length === 0) {
    return {
      status: 400,
      error: "MISSING_LOT_IDS",
      message: "Danh sách mã lô hàng (lotIds) không hợp lệ.",
    };
  }

  const uniqueLotIds = Array.from(new Set(rawLotIds));
  if (uniqueLotIds.length !== rawLotIds.length) {
    return {
      status: 400,
      error: "DUPLICATE_LOT_IN_REQUEST",
      message: "Danh sách mã lô hàng trong yêu cầu có chứa phần tử trùng lặp.",
    };
  }

  const sortedLotIds = [...uniqueLotIds].sort();

  // 2. Kiểm tra quyền người gọi
  const userId = authContext ? (authContext.userId || authContext.id) : null;
  const userOrgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;
  const isAdmin = Boolean(authContext && (authContext.roleId === "admin" || authContext.isAdmin));
  const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));

  if (isInspector) {
    return {
      status: 403,
      error: "INSPECTOR_FORBIDDEN",
      message: "Cán bộ kiểm tra chỉ có quyền đọc dữ liệu, không được phép thực hiện thao tác ghi.",
    };
  }

  if (!isAdmin && !userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN",
      message: "Truy cập bị từ chối: thiếu ngữ cảnh tổ chức.",
    };
  }

  const rawShipmentId = data.id || data.code || data.shipmentCode;
  let shipmentId;
  if (typeof rawShipmentId === "string" && rawShipmentId.trim()) {
    const cleanId = rawShipmentId.trim();
    if (cleanId.length < 3 || cleanId.length > 50 || !/^[A-Za-z0-9_-]+$/.test(cleanId)) {
      return {
        status: 400,
        error: "INVALID_SHIPMENT_CODE",
        message: "Mã chuyến vận chuyển phải từ 3 đến 50 ký tự và chỉ chứa chữ cái, số, dấu gạch ngang (-) hoặc gạch dưới (_).",
      };
    }
    shipmentId = cleanId;
  } else {
    shipmentId = "shp-" + crypto.randomUUID().slice(0, 8);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const rawStartedAt = data.startedAt || data.started_at || data.departureTime || data.departure_time;
  const startedAtDate = rawStartedAt ? new Date(rawStartedAt) : now;
  if (isNaN(startedAtDate.getTime())) {
    return {
      status: 400,
      error: "INVALID_DEPARTURE_TIME",
      message: "Thời gian khởi hành không đúng định dạng.",
    };
  }
  const startedAtIso = startedAtDate.toISOString();

  // 3. Thực thi với PostgreSQL Transaction
  if (pool || client) {
    const dbClient = client || (await pool.connect());
    const shouldManageTx = !client;

    try {
      if (shouldManageTx) {
        await dbClient.query("BEGIN");
      }

      // 3.0 Kiểm tra mã chuyến đã tồn tại trong hệ thống chưa (nếu chỉ định mã)
      const existingShipRes = await dbClient.query(
        "SELECT id FROM shipments WHERE id = $1 LIMIT 1",
        [shipmentId]
      );
      if (existingShipRes.rows.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 409,
          error: "SHIPMENT_CODE_ALREADY_EXISTS",
          message: `Mã chuyến vận chuyển '${shipmentId}' đã tồn tại trong hệ thống.`,
        };
      }

      // 3.1 Khóa và kiểm tra thông tin các lô hàng theo thứ tự sắp xếp cố định (tránh Deadlock)
      const lotsRes = await dbClient.query(
        `SELECT id, name, status, organization_id, remaining_quantity, initial_quantity, product_id
         FROM lots
         WHERE id = ANY($1)
         ORDER BY id ASC
         FOR UPDATE`,
        [sortedLotIds]
      );

      const foundLotMap = new Map(lotsRes.rows.map((r) => [r.id, r]));
      const missingLots = sortedLotIds.filter((id) => !foundLotMap.has(id));
      if (missingLots.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 404,
          error: "LOT_NOT_FOUND",
          message: `Không tìm thấy lô hàng trong hệ thống: ${missingLots.join(", ")}`,
          missingLots,
        };
      }

      // 3.2 Kiểm tra quyền sở hữu tổ chức: Tổ chức người gọi phải là đơn vị đang giữ từng lô (AC3)
      const unauthorizedLots = lotsRes.rows.filter(
        (l) => !isAdmin && l.organization_id !== userOrgId
      );
      if (unauthorizedLots.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 403,
          error: "FORBIDDEN_LOT_ACCESS",
          message: `Tổ chức của bạn không phải là đơn vị đang nắm giữ lô hàng: ${unauthorizedLots.map((l) => l.id).join(", ")}`,
          unauthorizedLots: unauthorizedLots.map((l) => l.id),
        };
      }

      // Kiểm tra tất cả các lô hàng trong cùng một chuyến phải thuộc cùng một tổ chức
      const distinctOrgIds = Array.from(new Set(lotsRes.rows.map((l) => l.organization_id)));
      if (distinctOrgIds.length > 1) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 400,
          error: "MULTI_ORG_LOTS_NOT_ALLOWED",
          message: "Tất cả các lô hàng trong cùng một chuyến vận chuyển phải thuộc cùng một tổ chức quản lý.",
        };
      }

      // 3.3 Kiểm tra trạng thái đã tiêu thụ hoặc sự cố của lô hàng
      const consumedLots = lotsRes.rows.filter((l) => {
        const remainingVal = Number(
          l.remaining_quantity !== null && l.remaining_quantity !== undefined
            ? l.remaining_quantity
            : (l.initial_quantity !== null && l.initial_quantity !== undefined ? l.initial_quantity : 0)
        );
        return (
          l.status === "Đã bán hết" ||
          l.status === "Đã tiêu thụ" ||
          l.status === "CONSUMED" ||
          isNaN(remainingVal) ||
          remainingVal <= 0
        );
      });
      if (consumedLots.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 400,
          error: "LOT_ALREADY_CONSUMED",
          message: `Lô hàng đã được bán hết hoặc tiêu thụ, không thể đưa vào chuyến vận chuyển: ${consumedLots.map((l) => l.id).join(", ")}`,
          consumedLots: consumedLots.map((l) => l.id),
        };
      }

      const recalledLots = lotsRes.rows.filter((l) => {
        return l.status === "Có sự cố" || l.status === "RECALLED";
      });
      if (recalledLots.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 400,
          error: "LOT_RECALLED_OR_INCIDENT",
          message: `Lô hàng đang trong trạng thái có sự cố hoặc thu hồi, không thể đưa vào chuyến vận chuyển: ${recalledLots.map((l) => l.id).join(", ")}`,
          recalledLots: recalledLots.map((l) => l.id),
        };
      }

      // 3.4 Kiểm tra xung đột chuyến đang hoạt động (AC4 Concurrency Defense)
      const activeShipmentCheck = await dbClient.query(
        `SELECT lot_id, shipment_id
         FROM shipment_lots
         WHERE lot_id = ANY($1) AND is_active = TRUE
         FOR UPDATE`,
        [sortedLotIds]
      );
      if (activeShipmentCheck.rows.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 409,
          error: "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
          message: "Một hoặc nhiều lô hàng đang tham gia chuyến vận chuyển khác đang hoạt động.",
          conflictingLots: activeShipmentCheck.rows.map((r) => ({
            lotId: r.lot_id,
            activeShipmentId: r.shipment_id,
          })),
        };
      }

      // 3.4.1 Kiểm tra thùng lạnh có đang bận trên chuyến khác (S-40 AC-S40-05 / TC-S40-10)
      const activeColdBoxCheck = await dbClient.query(
        `SELECT id FROM shipments
         WHERE cold_box_id = $1 AND status = 'IN_TRANSIT'
         LIMIT 1
         FOR UPDATE`,
        [cleanColdBoxId]
      );
      if (activeColdBoxCheck.rows.length > 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 409,
          error: "COLD_BOX_ALREADY_IN_USE",
          message: `Thùng lạnh '${cleanColdBoxId}' đang tham gia một chuyến vận chuyển khác đang hoạt động.`,
          activeShipmentId: activeColdBoxCheck.rows[0].id,
        };
      }

      // 3.5 Tra cứu cấu hình ngưỡng nhiệt độ theo sản phẩm (Story S-44)
      const productIds = Array.from(
        new Set(lotsRes.rows.map((r) => r.product_id).filter(Boolean))
      );
      let productRows = [];
      if (productIds.length > 0) {
        const prodRes = await dbClient.query(
          `SELECT id, name, temp_min, temp_max, delay_minutes FROM products WHERE id = ANY($1)`,
          [productIds]
        );
        productRows = prodRes.rows;
      }

      const resolvedThresholds = resolveShipmentThresholds(productRows);
      if (resolvedThresholds.incompatible) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 400,
          error: "INCOMPATIBLE_PRODUCT_TEMPERATURE_RANGES",
          message: resolvedThresholds.incompatibilityReason,
          details: {
            effectiveTempMin: resolvedThresholds.tempMin,
            effectiveTempMax: resolvedThresholds.tempMax,
            products: resolvedThresholds.productDetails,
          },
        };
      }

      // 3.6 Thêm chuyến vận chuyển mới vào bảng shipments kèm snapshot cấu hình ngưỡng
      const shipOrgId = isAdmin ? lotsRes.rows[0].organization_id : userOrgId;
      const insertShipRes = await dbClient.query(
        `INSERT INTO shipments (
          id, cold_box_id, status, organization_id, created_by_user_id,
          vehicle_plate, driver_name, driver_phone,
          origin_location_id, destination_location_id, notes,
          started_at, created_at, updated_at,
          applied_temp_min, applied_temp_max, applied_delay_minutes, temperature_config
        ) VALUES ($1, $2, 'IN_TRANSIT', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12, $13, $14, $15, $16)
        RETURNING *`,
        [
          shipmentId,
          cleanColdBoxId,
          shipOrgId,
          userId,
          plate,
          cleanDriver,
          cleanPhone,
          cleanOrigin,
          cleanDest,
          cleanNotes,
          startedAtDate,
          now,
          resolvedThresholds.tempMin,
          resolvedThresholds.tempMax,
          resolvedThresholds.delayMinutes,
          JSON.stringify(resolvedThresholds),
        ]
      );

      // Lấy tên tổ chức
      let orgName = shipOrgId;
      try {
        const orgRes = await dbClient.query("SELECT name FROM organizations WHERE id = $1", [shipOrgId]);
        if (orgRes.rows[0]) orgName = orgRes.rows[0].name;
      } catch {
        /* ignore */
      }

      const createdLotsMeta = [];

      // 3.6 Thêm bản ghi liên kết shipment_lots và ghi sự kiện SHIPMENT_LOADED vào chuỗi hash từng lô
      for (const lotId of sortedLotIds) {
        const lotObj = foundLotMap.get(lotId);
        const lotRecordId = "shplot-" + crypto.randomUUID().slice(0, 8);

        await dbClient.query(
          `INSERT INTO shipment_lots (
            id, shipment_id, lot_id, is_active, status, loaded_at, notes, created_at
          ) VALUES ($1, $2, $3, TRUE, 'LOADED', $4, $5, $4)`,
          [lotRecordId, shipmentId, lotId, now, cleanNotes]
        );

        // Ghi sự kiện lên xe vào chuỗi băm bất biến của lô
        const loadEvent = await appendBatchEvent(dbClient, {
          batchId: lotId,
          eventType: "SHIPMENT_LOADED",
          payload: {
            shipmentId,
            coldBoxId: cleanColdBoxId,
            action: "LOAD",
            vehiclePlate: plate,
            driverName: cleanDriver,
            driverPhone: cleanPhone,
            originLocationId: cleanOrigin,
            destinationLocationId: cleanDest,
            notes: cleanNotes,
            status: "IN_TRANSIT",
          },
          organizationId: lotObj.organization_id,
          actorUserId: userId,
          occurredAt: now,
        });

        createdLotsMeta.push({
          lotId,
          lotName: lotObj.name,
          status: "LOADED",
          loadedAt: nowIso,
          event: {
            id: loadEvent.id,
            sequenceNo: loadEvent.sequenceNo,
            eventType: loadEvent.eventType,
            eventHash: loadEvent.eventHash,
          },
        });
      }

      // 3.7 Ghi nhật ký kiểm toán độc lập (Audit Log S-31) trong cùng transaction
      await recordAuditLog({
        client: dbClient,
        pool,
        inMemoryLogs: inMemoryAuditLogs,
        actorUserId: userId,
        actorEmail: authContext ? authContext.email : null,
        organizationId: shipOrgId,
        action: "SHIPMENT_CREATED",
        resourceType: "shipment",
        resourceId: shipmentId,
        ipAddress,
        userAgent,
        details: {
          coldBoxId: cleanColdBoxId,
          lotCount: sortedLotIds.length,
          lotIds: sortedLotIds,
          vehiclePlate: plate,
          driverName: cleanDriver,
        },
      });

      if (shouldManageTx) {
        await dbClient.query("COMMIT");
      }

      const shipRow = insertShipRes.rows[0];
      const resultPayload = {
        id: shipRow.id,
        code: shipRow.id,
        coldBoxId: shipRow.cold_box_id,
        containerId: shipRow.cold_box_id,
        status: shipRow.status,
        organizationId: shipRow.organization_id,
        organizationName: orgName,
        vehiclePlate: shipRow.vehicle_plate,
        driverName: shipRow.driver_name,
        driverPhone: shipRow.driver_phone,
        originLocationId: shipRow.origin_location_id,
        origin: shipRow.origin_location_id,
        destinationLocationId: shipRow.destination_location_id,
        destination: shipRow.destination_location_id,
        notes: shipRow.notes,
        createdByUserId: shipRow.created_by_user_id,
        startedAt: shipRow.started_at ? new Date(shipRow.started_at).toISOString() : startedAtIso,
        departureTime: shipRow.started_at ? new Date(shipRow.started_at).toISOString() : startedAtIso,
        completedAt: null,
        createdAt: shipRow.created_at ? new Date(shipRow.created_at).toISOString() : nowIso,
        updatedAt: shipRow.updated_at ? new Date(shipRow.updated_at).toISOString() : nowIso,
        appliedTempMin:
          shipRow.applied_temp_min !== null && shipRow.applied_temp_min !== undefined
            ? Number(shipRow.applied_temp_min)
            : null,
        appliedTempMax:
          shipRow.applied_temp_max !== null && shipRow.applied_temp_max !== undefined
            ? Number(shipRow.applied_temp_max)
            : null,
        appliedDelayMinutes:
          shipRow.applied_delay_minutes !== null && shipRow.applied_delay_minutes !== undefined
            ? Number(shipRow.applied_delay_minutes)
            : null,
        temperatureConfig:
          typeof shipRow.temperature_config === "string"
            ? JSON.parse(shipRow.temperature_config)
            : (shipRow.temperature_config || null),
        lots: createdLotsMeta,
      };

      return {
        status: 201,
        success: true,
        message: "Chuyến vận chuyển đã được khởi tạo thành công.",
        shipment: resultPayload,
        data: resultPayload,
      };
    } catch (txErr) {
      if (shouldManageTx) {
        await dbClient.query("ROLLBACK");
      }
      if (
        txErr.code === "23505" ||
        (txErr.message && (
          txErr.message.includes("idx_unique_active_shipment_per_lot") ||
          txErr.message.includes("idx_unique_active_shipment_per_cold_box") ||
          txErr.message.includes("shipments_pkey")
        ))
      ) {
        if (txErr.constraint === "shipments_pkey" || (txErr.message && txErr.message.includes("shipments_pkey"))) {
          return {
            status: 409,
            error: "SHIPMENT_CODE_ALREADY_EXISTS",
            message: `Mã chuyến vận chuyển '${shipmentId}' đã tồn tại trong hệ thống.`,
          };
        }
        if (txErr.message && txErr.message.includes("idx_unique_active_shipment_per_cold_box")) {
          return {
            status: 409,
            error: "COLD_BOX_ALREADY_IN_USE",
            message: `Thùng lạnh '${cleanColdBoxId}' đang tham gia một chuyến vận chuyển khác đang hoạt động.`,
          };
        }
        return {
          status: 409,
          error: "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
          message: "Một hoặc nhiều lô hàng đang tham gia chuyến vận chuyển khác đang hoạt động.",
        };
      }
      throw txErr;
    } finally {
      if (shouldManageTx) {
        dbClient.release();
      }
    }
  }

  // 4. In-Memory Execution Path (Hỗ trợ môi trường test không có PostgreSQL)
  return await withLotLocks(sortedLotIds, async () => {
    if (inMemoryShipments.some((s) => s.id === shipmentId || s.code === shipmentId)) {
      return {
        status: 409,
        error: "SHIPMENT_CODE_ALREADY_EXISTS",
        message: `Mã chuyến vận chuyển '${shipmentId}' đã tồn tại trong hệ thống.`,
      };
    }

    const foundLots = inMemoryLots.filter((l) => sortedLotIds.includes(l.id));
    const foundLotMap = new Map(foundLots.map((l) => [l.id, l]));

    const missingLots = sortedLotIds.filter((id) => !foundLotMap.has(id));
    if (missingLots.length > 0) {
      return {
        status: 404,
        error: "LOT_NOT_FOUND",
        message: `Không tìm thấy lô hàng trong hệ thống: ${missingLots.join(", ")}`,
        missingLots,
      };
    }

    // Kiểm tra quyền tổ chức
    const unauthorizedLots = foundLots.filter(
      (l) => !isAdmin && (l.organizationId || l.organization_id) !== userOrgId
    );
    if (unauthorizedLots.length > 0) {
      return {
        status: 403,
        error: "FORBIDDEN_LOT_ACCESS",
        message: `Tổ chức của bạn không phải là đơn vị đang nắm giữ lô hàng: ${unauthorizedLots.map((l) => l.id).join(", ")}`,
        unauthorizedLots: unauthorizedLots.map((l) => l.id),
      };
    }

    // Kiểm tra tất cả các lô hàng trong cùng một chuyến phải thuộc cùng một tổ chức
    const distinctOrgIds = Array.from(new Set(foundLots.map((l) => l.organizationId || l.organization_id)));
    if (distinctOrgIds.length > 1) {
      return {
        status: 400,
        error: "MULTI_ORG_LOTS_NOT_ALLOWED",
        message: "Tất cả các lô hàng trong cùng một chuyến vận chuyển phải thuộc cùng một tổ chức quản lý.",
      };
    }

    // Kiểm tra đã tiêu thụ
    const consumedLots = foundLots.filter((l) => {
      const remainingVal = Number(
        l.remainingQuantity !== undefined && l.remainingQuantity !== null
          ? l.remainingQuantity
          : (l.remaining_quantity !== undefined && l.remaining_quantity !== null
              ? l.remaining_quantity
              : (l.current_quantity !== undefined && l.current_quantity !== null
                  ? l.current_quantity
                  : (l.initialQuantity || l.initial_quantity || l.quantity || 0)))
      );
      return (
        l.status === "Đã bán hết" ||
        l.status === "Đã tiêu thụ" ||
        l.status === "CONSUMED" ||
        isNaN(remainingVal) ||
        remainingVal <= 0
      );
    });
    if (consumedLots.length > 0) {
      return {
        status: 400,
        error: "LOT_ALREADY_CONSUMED",
        message: `Lô hàng đã được bán hết hoặc tiêu thụ, không thể đưa vào chuyến vận chuyển: ${consumedLots.map((l) => l.id).join(", ")}`,
        consumedLots: consumedLots.map((l) => l.id),
      };
    }

    const recalledLots = foundLots.filter((l) => {
      return l.status === "Có sự cố" || l.status === "RECALLED";
    });
    if (recalledLots.length > 0) {
      return {
        status: 400,
        error: "LOT_RECALLED_OR_INCIDENT",
        message: `Lô hàng đang trong trạng thái có sự cố hoặc thu hồi, không thể đưa vào chuyến vận chuyển: ${recalledLots.map((l) => l.id).join(", ")}`,
        recalledLots: recalledLots.map((l) => l.id),
      };
    }

    // Kiểm tra xung đột chuyến đang chạy
    const activeConflicts = inMemoryShipmentLots.filter(
      (sl) => sl.isActive && sortedLotIds.includes(sl.lotId)
    );
    if (activeConflicts.length > 0) {
      return {
        status: 409,
        error: "LOT_ALREADY_IN_ACTIVE_SHIPMENT",
        message: "Một hoặc nhiều lô hàng đang tham gia chuyến vận chuyển khác đang hoạt động.",
        conflictingLots: activeConflicts.map((c) => ({
          lotId: c.lotId,
          activeShipmentId: c.shipmentId,
        })),
      };
    }

    // Kiểm tra thùng lạnh có đang bận trên chuyến khác (S-40 AC-S40-05 / TC-S40-10)
    const activeColdBox = inMemoryShipments.find(
      (s) => s.coldBoxId === cleanColdBoxId && s.status === "IN_TRANSIT"
    );
    if (activeColdBox) {
      return {
        status: 409,
        error: "COLD_BOX_ALREADY_IN_USE",
        message: `Thùng lạnh '${cleanColdBoxId}' đang tham gia một chuyến vận chuyển khác đang hoạt động.`,
        activeShipmentId: activeColdBox.id,
      };
    }

    const shipOrgId = isAdmin
      ? (foundLots[0].organizationId || foundLots[0].organization_id)
      : userOrgId;

    // S-44: Tra cứu cấu hình ngưỡng theo sản phẩm (In-Memory)
    const productIds = Array.from(
      new Set(foundLots.map((l) => l.productId || l.product_id).filter(Boolean))
    );
    const matchedProducts = inMemoryProducts.filter((p) => productIds.includes(p.id));
    const resolvedThresholds = resolveShipmentThresholds(matchedProducts);
    if (resolvedThresholds.incompatible) {
      return {
        status: 400,
        error: "INCOMPATIBLE_PRODUCT_TEMPERATURE_RANGES",
        message: resolvedThresholds.incompatibilityReason,
        details: {
          effectiveTempMin: resolvedThresholds.tempMin,
          effectiveTempMax: resolvedThresholds.tempMax,
          products: resolvedThresholds.productDetails,
        },
      };
    }

    const orgMap = await getOrganizationMap(null, inMemoryOrgs);
    const orgName = orgMap[shipOrgId] || shipOrgId;

    const newShipment = {
      id: shipmentId,
      code: shipmentId,
      coldBoxId: cleanColdBoxId,
      containerId: cleanColdBoxId,
      status: "IN_TRANSIT",
      organizationId: shipOrgId,
      organizationName: orgName,
      vehiclePlate: plate,
      driverName: cleanDriver,
      driverPhone: cleanPhone,
      originLocationId: cleanOrigin,
      origin: cleanOrigin,
      destinationLocationId: cleanDest,
      destination: cleanDest,
      notes: cleanNotes,
      createdByUserId: userId,
      completedByUserId: null,
      startedAt: startedAtIso,
      departureTime: startedAtIso,
      completedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      appliedTempMin: resolvedThresholds.tempMin,
      appliedTempMax: resolvedThresholds.tempMax,
      appliedDelayMinutes: resolvedThresholds.delayMinutes,
      temperatureConfig: resolvedThresholds,
      lotIds: sortedLotIds,
    };

    inMemoryShipments.unshift(newShipment);

    const createdLotsMeta = [];
    for (const lotId of sortedLotIds) {
      const lotObj = foundLotMap.get(lotId);
      const lotRecordId = "shplot-" + crypto.randomUUID().slice(0, 8);

      inMemoryShipmentLots.push({
        id: lotRecordId,
        shipmentId,
        lotId,
        lotOrgId: lotObj.organizationId || lotObj.organization_id,
        isActive: true,
        status: "LOADED",
        loadedAt: nowIso,
        unloadedAt: null,
        notes: cleanNotes,
        createdAt: nowIso,
      });

      const loadEvent = await appendBatchEvent(null, {
        batchId: lotId,
        eventType: "SHIPMENT_LOADED",
        payload: {
          shipmentId,
          coldBoxId: cleanColdBoxId,
          action: "LOAD",
          vehiclePlate: plate,
          driverName: cleanDriver,
          driverPhone: cleanPhone,
          originLocationId: cleanOrigin,
          destinationLocationId: cleanDest,
          notes: cleanNotes,
          status: "IN_TRANSIT",
        },
        organizationId: lotObj.organizationId || lotObj.organization_id,
        actorUserId: userId,
        occurredAt: now,
      });

      createdLotsMeta.push({
        lotId,
        lotName: lotObj.name,
        status: "LOADED",
        loadedAt: nowIso,
        event: {
          id: loadEvent.id,
          sequenceNo: loadEvent.sequenceNo,
          eventType: loadEvent.eventType,
          eventHash: loadEvent.eventHash,
        },
      });
    }

    await recordAuditLog({
      pool: null,
      client: null,
      inMemoryLogs: inMemoryAuditLogs,
      actorUserId: userId,
      actorEmail: authContext ? authContext.email : null,
      organizationId: shipOrgId,
      action: "SHIPMENT_CREATED",
      resourceType: "shipment",
      resourceId: shipmentId,
      ipAddress,
      userAgent,
      details: {
        coldBoxId: cleanColdBoxId,
        lotCount: sortedLotIds.length,
        lotIds: sortedLotIds,
        vehiclePlate: plate,
        driverName: cleanDriver,
      },
    });

    const resultPayload = {
      ...newShipment,
      lots: createdLotsMeta,
    };

    return {
      status: 201,
      success: true,
      message: "Chuyến vận chuyển đã được khởi tạo thành công.",
      shipment: resultPayload,
      data: resultPayload,
    };
  });
}

/**
 * Kết thúc chuyến vận chuyển (Dỡ hàng & Xuống xe - Story S-40)
 */
async function completeShipment({
  pool = null,
  client = null,
  authContext = null,
  shipmentId,
  data = {},
  _inMemoryOrgs = [],
  ipAddress = "127.0.0.1",
  userAgent = null,
}) {
  if (!shipmentId) {
    return {
      status: 400,
      error: "MISSING_SHIPMENT_ID",
      message: "Mã chuyến vận chuyển là bắt buộc.",
    };
  }

  const userId = authContext ? (authContext.userId || authContext.id) : null;
  const userOrgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;
  const isAdmin = Boolean(authContext && (authContext.roleId === "admin" || authContext.isAdmin));
  const isInspector = Boolean(authContext && (authContext.roleId === "inspector" || authContext.isInspector));

  if (isInspector) {
    return {
      status: 403,
      error: "INSPECTOR_FORBIDDEN",
      message: "Cán bộ kiểm tra chỉ có quyền đọc dữ liệu, không được phép thực hiện thao tác ghi.",
    };
  }

  const rawDest = data.destinationLocationId || data.destination;
  const cleanNotes = typeof data.notes === "string" ? data.notes.trim() : null;
  const cleanDest = typeof rawDest === "string" ? rawDest.trim() : null;
  const now = new Date();
  const nowIso = now.toISOString();

  // 1. Thực thi với PostgreSQL Transaction
  if (pool || client) {
    const dbClient = client || (await pool.connect());
    const shouldManageTx = !client;

    try {
      if (shouldManageTx) {
        await dbClient.query("BEGIN");
      }

      const shipRes = await dbClient.query(
        "SELECT * FROM shipments WHERE id = $1 FOR UPDATE",
        [shipmentId]
      );
      if (shipRes.rows.length === 0) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 404,
          error: "SHIPMENT_NOT_FOUND",
          message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
        };
      }

      const shipment = shipRes.rows[0];

      // Kiểm tra quyền tổ chức: Phải thuộc tổ chức quản lý chuyến hoặc admin
      if (!isAdmin && shipment.organization_id !== userOrgId) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 403,
          error: "FORBIDDEN_SHIPMENT_ACCESS",
          message: "Bạn không có quyền kết thúc chuyến vận chuyển của tổ chức khác.",
        };
      }

      // Kiểm tra trạng thái chuyến
      if (shipment.status !== "IN_TRANSIT") {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 400,
          error: "SHIPMENT_ALREADY_COMPLETED",
          message: `Chuyến vận chuyển đang ở trạng thái '${shipment.status}', không thể kết thúc lại.`,
        };
      }

      // Cập nhật trạng thái chuyến sang COMPLETED
      const updateShipRes = await dbClient.query(
        `UPDATE shipments
         SET status = 'COMPLETED',
             completed_at = $2,
             completed_by_user_id = $3,
             notes = COALESCE($4, notes),
             destination_location_id = COALESCE($5, destination_location_id),
             updated_at = $2
         WHERE id = $1
         RETURNING *`,
        [shipmentId, now, userId, cleanNotes, cleanDest]
      );

      // Lấy danh sách các lô hàng trong chuyến
      const lotsRes = await dbClient.query(
        `SELECT sl.*, l.name AS lot_name, l.organization_id AS lot_org_id
         FROM shipment_lots sl
         JOIN lots l ON sl.lot_id = l.id
         WHERE sl.shipment_id = $1
         FOR UPDATE`,
        [shipmentId]
      );

      // Cập nhật trạng thái shipment_lots sang DELIVERED và is_active = FALSE (giải phóng lô hàng)
      await dbClient.query(
        `UPDATE shipment_lots
         SET is_active = FALSE,
             status = 'DELIVERED',
             unloaded_at = $2
         WHERE shipment_id = $1`,
        [shipmentId, now]
      );

      const completedLotsMeta = [];

      // Ghi sự kiện SHIPMENT_UNLOADED vào chuỗi băm của từng lô
      for (const row of lotsRes.rows) {
        const unloadEvent = await appendBatchEvent(dbClient, {
          batchId: row.lot_id,
          eventType: "SHIPMENT_UNLOADED",
          payload: {
            shipmentId,
            coldBoxId: shipment.cold_box_id,
            action: "UNLOAD",
            destinationLocationId: cleanDest || shipment.destination_location_id,
            notes: cleanNotes || shipment.notes,
            status: "DELIVERED",
          },
          organizationId: row.lot_org_id || shipment.organization_id,
          actorUserId: userId,
          occurredAt: now,
        });

        completedLotsMeta.push({
          lotId: row.lot_id,
          lotName: row.lot_name,
          status: "DELIVERED",
          loadedAt: row.loaded_at ? new Date(row.loaded_at).toISOString() : null,
          unloadedAt: nowIso,
          unloadEvent: {
            id: unloadEvent.id,
            sequenceNo: unloadEvent.sequenceNo,
            eventType: unloadEvent.eventType,
            eventHash: unloadEvent.eventHash,
          },
        });
      }

      // Ghi nhật ký kiểm toán độc lập S-31
      await recordAuditLog({
        client: dbClient,
        pool,
        inMemoryLogs: inMemoryAuditLogs,
        actorUserId: userId,
        actorEmail: authContext ? authContext.email : null,
        organizationId: shipment.organization_id,
        action: "SHIPMENT_COMPLETED",
        resourceType: "shipment",
        resourceId: shipmentId,
        ipAddress,
        userAgent,
        details: {
          coldBoxId: shipment.cold_box_id,
          lotCount: lotsRes.rows.length,
          lotIds: lotsRes.rows.map((r) => r.lot_id),
          completedAt: nowIso,
        },
      });

      // Hoàn tất và chốt các vi phạm nhiệt độ còn dang dở khi kết thúc chuyến (S-45 / S-43)
      try {
        const { finalizeShipmentViolations } = require("./cold_chain_violation_service");
        await finalizeShipmentViolations({
          client: dbClient,
          shipment,
          coldBoxId: shipment.cold_box_id,
          organizationId: shipment.organization_id,
        });
      } catch (err) {
        console.error("Lỗi khi finalize vi phạm nhiệt độ chuyến vận chuyển:", err);
      }

      if (shouldManageTx) {
        await dbClient.query("COMMIT");
      }

      const updatedRow = updateShipRes.rows[0];
      const resultPayload = {
        id: updatedRow.id,
        code: updatedRow.id,
        coldBoxId: updatedRow.cold_box_id,
        containerId: updatedRow.cold_box_id,
        status: updatedRow.status,
        organizationId: updatedRow.organization_id,
        vehiclePlate: updatedRow.vehicle_plate,
        driverName: updatedRow.driver_name,
        driverPhone: updatedRow.driver_phone,
        originLocationId: updatedRow.origin_location_id,
        origin: updatedRow.origin_location_id,
        destinationLocationId: updatedRow.destination_location_id,
        destination: updatedRow.destination_location_id,
        notes: updatedRow.notes,
        createdByUserId: updatedRow.created_by_user_id,
        completedByUserId: updatedRow.completed_by_user_id,
        startedAt: updatedRow.started_at ? new Date(updatedRow.started_at).toISOString() : null,
        completedAt: nowIso,
        createdAt: updatedRow.created_at ? new Date(updatedRow.created_at).toISOString() : null,
        updatedAt: nowIso,
        lots: completedLotsMeta,
      };

      return {
        status: 200,
        success: true,
        message: "Chuyến vận chuyển đã kết thúc thành công. Đã dỡ toàn bộ lô hàng khỏi thùng lạnh.",
        shipment: resultPayload,
        data: resultPayload,
      };
    } catch (err) {
      if (shouldManageTx) {
        await dbClient.query("ROLLBACK");
      }
      throw err;
    } finally {
      if (shouldManageTx) {
        dbClient.release();
      }
    }
  }

  // 2. In-Memory Execution Path
  const shipment = inMemoryShipments.find((s) => s.id === shipmentId);
  if (!shipment) {
    return {
      status: 404,
      error: "SHIPMENT_NOT_FOUND",
      message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
    };
  }

  if (!isAdmin && shipment.organizationId !== userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN_SHIPMENT_ACCESS",
      message: "Bạn không có quyền kết thúc chuyến vận chuyển của tổ chức khác.",
    };
  }

  if (shipment.status !== "IN_TRANSIT") {
    return {
      status: 400,
      error: "SHIPMENT_ALREADY_COMPLETED",
      message: `Chuyến vận chuyển đang ở trạng thái '${shipment.status}', không thể kết thúc lại.`,
    };
  }

  shipment.status = "COMPLETED";
  shipment.completedAt = nowIso;
  shipment.completedByUserId = userId;
  shipment.updatedAt = nowIso;
  if (cleanNotes) shipment.notes = cleanNotes;
  if (cleanDest) {
    shipment.destinationLocationId = cleanDest;
    shipment.destination = cleanDest;
  }

  const attachedLots = inMemoryShipmentLots.filter((sl) => sl.shipmentId === shipmentId);
  const completedLotsMeta = [];

  for (const sl of attachedLots) {
    sl.isActive = false;
    sl.status = "DELIVERED";
    sl.unloadedAt = nowIso;

    const unloadEvent = await appendBatchEvent(null, {
      batchId: sl.lotId,
      eventType: "SHIPMENT_UNLOADED",
      payload: {
        shipmentId,
        coldBoxId: shipment.coldBoxId,
        action: "UNLOAD",
        destinationLocationId: cleanDest || shipment.destinationLocationId,
        notes: cleanNotes || shipment.notes,
        status: "DELIVERED",
      },
      organizationId: shipment.organizationId,
      actorUserId: userId,
      occurredAt: now,
    });

    completedLotsMeta.push({
      lotId: sl.lotId,
      status: "DELIVERED",
      loadedAt: sl.loadedAt,
      unloadedAt: nowIso,
      unloadEvent: {
        id: unloadEvent.id,
        sequenceNo: unloadEvent.sequenceNo,
        eventType: unloadEvent.eventType,
        eventHash: unloadEvent.eventHash,
      },
    });
  }

  await recordAuditLog({
    pool: null,
    client: null,
    inMemoryLogs: inMemoryAuditLogs,
    actorUserId: userId,
    actorEmail: authContext ? authContext.email : null,
    organizationId: shipment.organizationId,
    action: "SHIPMENT_COMPLETED",
    resourceType: "shipment",
    resourceId: shipmentId,
    ipAddress,
    userAgent,
    details: {
      coldBoxId: shipment.coldBoxId,
      lotCount: attachedLots.length,
      lotIds: attachedLots.map((sl) => sl.lotId),
      completedAt: nowIso,
    },
  });

  // Hoàn tất và chốt các vi phạm nhiệt độ còn dang dở khi kết thúc chuyến (S-45 / S-43)
  try {
    const { finalizeShipmentViolations } = require("./cold_chain_violation_service");
    await finalizeShipmentViolations({
      client: null,
      shipment,
      coldBoxId: shipment.coldBoxId,
      organizationId: shipment.organizationId,
    });
  } catch (err) {
    console.error("Lỗi khi finalize in-memory vi phạm nhiệt độ:", err);
  }

  const resultPayload = {
    ...shipment,
    lots: completedLotsMeta,
  };

  return {
    status: 200,
    success: true,
    message: "Chuyến vận chuyển đã kết thúc thành công. Đã dỡ toàn bộ lô hàng khỏi thùng lạnh.",
    shipment: resultPayload,
    data: resultPayload,
  };
}

/**
 * Lấy danh sách chuyến vận chuyển hỗ trợ lọc và phân quyền tổ chức
 */
async function getShipments({
  pool = null,
  authContext = null,
  filters = {},
  inMemoryOrgs = [],
}) {
  const isGlobal = Boolean(
    authContext &&
      (authContext.roleId === "admin" ||
        authContext.isAdmin ||
        authContext.roleId === "inspector" ||
        authContext.isInspector)
  );
  const userOrgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;

  const rawColdBoxId = filters.coldBoxId || filters.containerId;
  const { status, lotId, limit = 50, offset = 0, search } = filters;
  const coldBoxId = typeof rawColdBoxId === "string" ? rawColdBoxId.trim() : null;
  const cleanSearch = typeof search === "string" ? search.trim() : null;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const safeOffset = Math.max(0, Number(offset) || 0);

  if (pool) {
    const conditions = [];
    const params = [];

    if (!isGlobal && userOrgId) {
      params.push(userOrgId);
      conditions.push(`(s.organization_id = $${params.length} OR EXISTS (
        SELECT 1 FROM shipment_lots sl2
        JOIN lots l2 ON sl2.lot_id = l2.id
        WHERE sl2.shipment_id = s.id AND l2.organization_id = $${params.length}
      ))`);
    }

    if (status) {
      params.push(String(status).trim().toUpperCase());
      conditions.push(`s.status = $${params.length}`);
    }

    if (coldBoxId) {
      params.push(String(coldBoxId).trim());
      conditions.push(`s.cold_box_id = $${params.length}`);
    }

    if (lotId) {
      params.push(String(lotId).trim());
      conditions.push(`EXISTS (SELECT 1 FROM shipment_lots sl WHERE sl.shipment_id = s.id AND sl.lot_id = $${params.length})`);
    }

    if (cleanSearch) {
      params.push(`%${cleanSearch}%`);
      conditions.push(`(s.id ILIKE $${params.length} OR s.cold_box_id ILIKE $${params.length} OR s.vehicle_plate ILIKE $${params.length} OR s.driver_name ILIKE $${params.length} OR s.origin_location_id ILIKE $${params.length} OR s.destination_location_id ILIKE $${params.length} OR EXISTS (SELECT 1 FROM shipment_lots sl_srch WHERE sl_srch.shipment_id = s.id AND sl_srch.lot_id ILIKE $${params.length}))`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*)::int AS total FROM shipments s ${whereClause}`;
    const countRes = await pool.query(countSql, params);
    const total = countRes.rows[0] ? countRes.rows[0].total : 0;

    const dataSql = `
      SELECT s.*, o.name AS organization_name,
        COALESCE(
          json_agg(
            json_build_object('lotId', sl.lot_id, 'status', sl.status, 'isActive', sl.is_active)
          ) FILTER (WHERE sl.id IS NOT NULL),
          '[]'::json
        ) AS lots,
        COUNT(sl.id)::int AS lot_count
      FROM shipments s
      LEFT JOIN organizations o ON s.organization_id = o.id
      LEFT JOIN shipment_lots sl ON s.id = sl.shipment_id
      ${whereClause}
      GROUP BY s.id, o.name
      ORDER BY s.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const dataRes = await pool.query(dataSql, [...params, safeLimit, safeOffset]);
    const items = dataRes.rows.map((r) => ({
      id: r.id,
      code: r.id,
      coldBoxId: r.cold_box_id,
      containerId: r.cold_box_id,
      status: r.status,
      organizationId: r.organization_id,
      organizationName: r.organization_name || r.organization_id,
      vehiclePlate: r.vehicle_plate,
      driverName: r.driver_name,
      driverPhone: r.driver_phone,
      originLocationId: r.origin_location_id,
      origin: r.origin_location_id,
      destinationLocationId: r.destination_location_id,
      destination: r.destination_location_id,
      notes: r.notes,
      lotCount: r.lot_count,
      lots: r.lots,
      lotIds: Array.isArray(r.lots) ? r.lots.map((l) => l.lotId) : [],
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      departureTime: r.started_at ? new Date(r.started_at).toISOString() : null,
      completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
      currentTemperature:
        r.current_temperature !== null && r.current_temperature !== undefined
          ? Number(r.current_temperature)
          : null,
      lastTemperatureAt: r.last_temperature_at
        ? new Date(r.last_temperature_at).toISOString()
        : null,
      appliedTempMin:
        r.applied_temp_min !== null && r.applied_temp_min !== undefined
          ? Number(r.applied_temp_min)
          : null,
      appliedTempMax:
        r.applied_temp_max !== null && r.applied_temp_max !== undefined
          ? Number(r.applied_temp_max)
          : null,
      appliedDelayMinutes:
        r.applied_delay_minutes !== null && r.applied_delay_minutes !== undefined
          ? Number(r.applied_delay_minutes)
          : null,
      temperatureConfig:
        typeof r.temperature_config === "string"
          ? JSON.parse(r.temperature_config)
          : (r.temperature_config || null),
    }));

    return {
      success: true,
      data: items,
      shipments: items,
      total,
      count: total,
      pagination: {
        total,
        limit: safeLimit,
        offset: safeOffset,
      },
    };
  }

  // In-Memory
  const orgMap = await getOrganizationMap(null, inMemoryOrgs);
  let filtered = [...inMemoryShipments];

  if (!isGlobal && userOrgId) {
    filtered = filtered.filter((s) => {
      if (s.organizationId === userOrgId) return true;
      const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === s.id);
      return attached.some((sl) => {
        return sl.lotOrgId === userOrgId;
      });
    });
  }

  if (status) {
    filtered = filtered.filter((s) => String(s.status).toUpperCase() === String(status).toUpperCase());
  }

  if (coldBoxId) {
    filtered = filtered.filter((s) => s.coldBoxId === coldBoxId);
  }

  if (lotId) {
    filtered = filtered.filter((s) => {
      const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === s.id);
      return attached.some((sl) => sl.lotId === lotId);
    });
  }

  if (cleanSearch) {
    const q = cleanSearch.toLowerCase();
    filtered = filtered.filter((s) => {
      const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === s.id);
      return (
        (s.id && s.id.toLowerCase().includes(q)) ||
        (s.code && s.code.toLowerCase().includes(q)) ||
        (s.coldBoxId && s.coldBoxId.toLowerCase().includes(q)) ||
        (s.vehiclePlate && s.vehiclePlate.toLowerCase().includes(q)) ||
        (s.driverName && s.driverName.toLowerCase().includes(q)) ||
        (s.originLocationId && s.originLocationId.toLowerCase().includes(q)) ||
        (s.destinationLocationId && s.destinationLocationId.toLowerCase().includes(q)) ||
        attached.some((sl) => sl.lotId.toLowerCase().includes(q))
      );
    });
  }

  const total = filtered.length;
  const paginated = filtered.slice(safeOffset, safeOffset + safeLimit).map((s) => {
    const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === s.id);
    return {
      ...s,
      code: s.code || s.id,
      containerId: s.coldBoxId,
      origin: s.originLocationId,
      destination: s.destinationLocationId,
      organizationName: orgMap[s.organizationId] || s.organizationId,
      lotCount: attached.length,
      lots: attached.map((sl) => ({ lotId: sl.lotId, status: sl.status, isActive: sl.isActive })),
      lotIds: attached.map((sl) => sl.lotId),
      departureTime: s.departureTime || s.startedAt || null,
      currentTemperature:
        s.currentTemperature !== undefined && s.currentTemperature !== null
          ? Number(s.currentTemperature)
          : null,
      lastTemperatureAt: s.lastTemperatureAt
        ? new Date(s.lastTemperatureAt).toISOString()
        : null,
      appliedTempMin: s.appliedTempMin !== undefined ? s.appliedTempMin : null,
      appliedTempMax: s.appliedTempMax !== undefined ? s.appliedTempMax : null,
      appliedDelayMinutes: s.appliedDelayMinutes !== undefined ? s.appliedDelayMinutes : null,
      temperatureConfig: s.temperatureConfig || null,
    };
  });

  return {
    success: true,
    data: paginated,
    shipments: paginated,
    total,
    count: total,
    pagination: {
      total,
      limit: safeLimit,
      offset: safeOffset,
    },
  };
}

/**
 * Lấy chi tiết chuyến vận chuyển theo ID
 */
async function getShipmentById({
  pool = null,
  authContext = null,
  shipmentId,
  inMemoryOrgs = [],
}) {
  const isGlobal = Boolean(
    authContext &&
      (authContext.roleId === "admin" ||
        authContext.isAdmin ||
        authContext.roleId === "inspector" ||
        authContext.isInspector)
  );
  const userOrgId = authContext ? (authContext.organizationId || authContext.organization_id) : null;

  if (pool) {
    const shipRes = await pool.query(
      `SELECT s.*, o.name AS organization_name
       FROM shipments s
       LEFT JOIN organizations o ON s.organization_id = o.id
       WHERE s.id = $1`,
      [shipmentId]
    );

    if (shipRes.rows.length === 0) {
      return {
        status: 404,
        error: "SHIPMENT_NOT_FOUND",
        message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
      };
    }

    const ship = shipRes.rows[0];

    // Lấy chi tiết các lô hàng trong chuyến
    const lotsRes = await pool.query(
      `SELECT sl.*, l.name AS lot_name, l.organization_id AS lot_org_id
       FROM shipment_lots sl
       JOIN lots l ON sl.lot_id = l.id
       WHERE sl.shipment_id = $1
       ORDER BY sl.loaded_at ASC`,
      [shipmentId]
    );

    if (!isGlobal && ship.organization_id !== userOrgId) {
      const isLotOwner = lotsRes.rows.some((r) => r.lot_org_id === userOrgId);
      if (!isLotOwner) {
        return {
          status: 403,
          error: "FORBIDDEN_SHIPMENT_ACCESS",
          message: "Bạn không có quyền truy cập thông tin chuyến vận chuyển này.",
        };
      }
    }

    const shipmentPayload = {
      id: ship.id,
      code: ship.id,
      coldBoxId: ship.cold_box_id,
      containerId: ship.cold_box_id,
      status: ship.status,
      organizationId: ship.organization_id,
      organizationName: ship.organization_name || ship.organization_id,
      vehiclePlate: ship.vehicle_plate,
      driverName: ship.driver_name,
      driverPhone: ship.driver_phone,
      originLocationId: ship.origin_location_id,
      origin: ship.origin_location_id,
      destinationLocationId: ship.destination_location_id,
      destination: ship.destination_location_id,
      notes: ship.notes,
      lotIds: lotsRes.rows.map((r) => r.lot_id),
      createdByUserId: ship.created_by_user_id,
      completedByUserId: ship.completed_by_user_id,
      startedAt: ship.started_at ? new Date(ship.started_at).toISOString() : null,
      departureTime: ship.started_at ? new Date(ship.started_at).toISOString() : null,
      completedAt: ship.completed_at ? new Date(ship.completed_at).toISOString() : null,
      createdAt: ship.created_at ? new Date(ship.created_at).toISOString() : null,
      updatedAt: ship.updated_at ? new Date(ship.updated_at).toISOString() : null,
      currentTemperature:
        ship.current_temperature !== null && ship.current_temperature !== undefined
          ? Number(ship.current_temperature)
          : null,
      lastTemperatureAt: ship.last_temperature_at
        ? new Date(ship.last_temperature_at).toISOString()
        : null,
      appliedTempMin:
        ship.applied_temp_min !== null && ship.applied_temp_min !== undefined
          ? Number(ship.applied_temp_min)
          : null,
      appliedTempMax:
        ship.applied_temp_max !== null && ship.applied_temp_max !== undefined
          ? Number(ship.applied_temp_max)
          : null,
      appliedDelayMinutes:
        ship.applied_delay_minutes !== null && ship.applied_delay_minutes !== undefined
          ? Number(ship.applied_delay_minutes)
          : null,
      temperatureConfig:
        typeof ship.temperature_config === "string"
          ? JSON.parse(ship.temperature_config)
          : (ship.temperature_config || null),
      lots: lotsRes.rows.map((r) => ({
        lotId: r.lot_id,
        lotName: r.lot_name,
        status: r.status,
        isActive: r.is_active,
        loadedAt: r.loaded_at ? new Date(r.loaded_at).toISOString() : null,
        unloadedAt: r.unloaded_at ? new Date(r.unloaded_at).toISOString() : null,
      })),
    };

    return {
      status: 200,
      success: true,
      shipment: shipmentPayload,
      data: shipmentPayload,
    };
  }

  // In-Memory
  const ship = inMemoryShipments.find((s) => s.id === shipmentId);
  if (!ship) {
    return {
      status: 404,
      error: "SHIPMENT_NOT_FOUND",
      message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
    };
  }

  const attached = inMemoryShipmentLots.filter((sl) => sl.shipmentId === shipmentId);

  if (!isGlobal && ship.organizationId !== userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN_SHIPMENT_ACCESS",
      message: "Bạn không có quyền truy cập thông tin chuyến vận chuyển này.",
    };
  }

  const orgMap = await getOrganizationMap(null, inMemoryOrgs);
  const shipmentPayload = {
    ...ship,
    code: ship.code || ship.id,
    containerId: ship.coldBoxId,
    origin: ship.originLocationId,
    destination: ship.destinationLocationId,
    startedAt: ship.startedAt || null,
    departureTime: ship.departureTime || ship.startedAt || null,
    currentTemperature: ship.currentTemperature !== undefined ? ship.currentTemperature : null,
    lastTemperatureAt: ship.lastTemperatureAt || null,
    appliedTempMin: ship.appliedTempMin !== undefined ? ship.appliedTempMin : null,
    appliedTempMax: ship.appliedTempMax !== undefined ? ship.appliedTempMax : null,
    appliedDelayMinutes: ship.appliedDelayMinutes !== undefined ? ship.appliedDelayMinutes : null,
    temperatureConfig: ship.temperatureConfig || null,
    lotIds: attached.map((sl) => sl.lotId),
    organizationName: orgMap[ship.organizationId] || ship.organizationId,
    lots: attached.map((sl) => ({
      lotId: sl.lotId,
      status: sl.status,
      isActive: sl.isActive,
      loadedAt: sl.loadedAt,
      unloadedAt: sl.unloadedAt,
    })),
  };

  return {
    status: 200,
    success: true,
    shipment: shipmentPayload,
    data: shipmentPayload,
  };
}

/**
 * Kiểm tra chuyến đang hoạt động của một lô hàng cụ thể
 */
async function getActiveShipmentForLot({ pool = null, lotId }) {
  if (!lotId) return { hasActiveShipment: false, shipment: null };

  if (pool) {
    const res = await pool.query(
      `SELECT s.*, sl.loaded_at
       FROM shipment_lots sl
       JOIN shipments s ON sl.shipment_id = s.id
       WHERE sl.lot_id = $1 AND sl.is_active = TRUE AND s.status = 'IN_TRANSIT'
       LIMIT 1`,
      [lotId]
    );

    if (res.rows.length === 0) {
      return { hasActiveShipment: false, shipment: null };
    }

    const r = res.rows[0];
    return {
      hasActiveShipment: true,
      shipment: {
        id: r.id,
        code: r.id,
        coldBoxId: r.cold_box_id,
        containerId: r.cold_box_id,
        status: r.status,
        vehiclePlate: r.vehicle_plate,
        driverName: r.driver_name,
        driverPhone: r.driver_phone,
        originLocationId: r.origin_location_id,
        origin: r.origin_location_id,
        destinationLocationId: r.destination_location_id,
        destination: r.destination_location_id,
        startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      },
    };
  }

  // In-Memory
  const activeRecord = inMemoryShipmentLots.find((sl) => sl.lotId === lotId && sl.isActive);
  if (!activeRecord) {
    return { hasActiveShipment: false, shipment: null };
  }

  const shipment = inMemoryShipments.find((s) => s.id === activeRecord.shipmentId && s.status === "IN_TRANSIT");
  if (!shipment) {
    return { hasActiveShipment: false, shipment: null };
  }

  return {
    hasActiveShipment: true,
    shipment: {
      id: shipment.id,
      code: shipment.id,
      coldBoxId: shipment.coldBoxId,
      containerId: shipment.coldBoxId,
      status: shipment.status,
      vehiclePlate: shipment.vehiclePlate,
      driverName: shipment.driverName,
      driverPhone: shipment.driverPhone,
      originLocationId: shipment.originLocationId,
      origin: shipment.originLocationId,
      destinationLocationId: shipment.destinationLocationId,
      destination: shipment.destinationLocationId,
      startedAt: shipment.startedAt,
    },
  };
}

/**
 * Ghi nhận số đo nhiệt độ theo thời gian cho chuyến vận chuyển thùng lạnh (Story S-41 / Jira N2-109)
 */
async function recordShipmentTemperature({
  pool = null,
  client = null,
  authContext = null,
  data = {},
  _inMemoryOrgs = [],
  _ipAddress = "127.0.0.1",
  _userAgent = null,
  onAcceptedReading = null,
}) {
  const rawColdBoxId =
    data.coldBoxId ||
    data.cold_box_id ||
    data.coldBoxCode ||
    data.cold_box_code ||
    data.code ||
    data.containerId;
  const rawTimestamp =
    data.timestamp ||
    data.recordedAt ||
    data.recorded_at ||
    data.measuredAt ||
    data.measured_at ||
    data.measurementTimestamp ||
    data.measurement_timestamp;
  const rawTemperature =
    data.temperature !== undefined ? data.temperature : data.value;

  let cleanColdBoxId =
    typeof rawColdBoxId === "string" ? rawColdBoxId.trim() : null;

  const rawShipmentId = data.shipmentId || data.shipment_id;
  const cleanShipmentId =
    typeof rawShipmentId === "string" ? rawShipmentId.trim() : null;

  if (!cleanColdBoxId && cleanShipmentId) {
    if (pool || client) {
      const dbClient = client || pool;
      try {
        const shp = await dbClient.query("SELECT cold_box_id FROM shipments WHERE id = $1", [cleanShipmentId]);
        if (shp.rows[0]) {
          cleanColdBoxId = shp.rows[0].cold_box_id;
        }
      } catch {
        /* ignore */
      }
    } else {
      const shp = inMemoryShipments.find((s) => s.id === cleanShipmentId);
      if (shp) {
        cleanColdBoxId = shp.coldBoxId || shp.containerId;
      }
    }
  }

  // 1. Kiểm tra mã thùng lạnh
  if (!cleanColdBoxId) {
    return {
      status: 400,
      error: "MISSING_COLD_BOX_CODE",
      message: "Mã thùng lạnh là bắt buộc.",
    };
  }

  // 2. Kiểm tra nhiệt độ (phải là số hữu hạn, không chấp nhận NaN, Infinity, null, chuỗi không số)
  if (
    rawTemperature === undefined ||
    rawTemperature === null ||
    rawTemperature === "" ||
    typeof rawTemperature === "boolean"
  ) {
    return {
      status: 400,
      error: "INVALID_TEMPERATURE",
      message: "Giá trị nhiệt độ không hợp lệ hoặc bị thiếu.",
    };
  }

  const numTemp = Number(rawTemperature);
  if (!Number.isFinite(numTemp) || Number.isNaN(numTemp)) {
    return {
      status: 400,
      error: "INVALID_TEMPERATURE",
      message: "Giá trị nhiệt độ phải là một số thực hữu hạn.",
    };
  }

  // Đảm bảo kiểu số NUMERIC(5, 2) của PostgreSQL tiếp nhận giá trị hợp lệ (-999.99 đến 999.99)
  // và trả 400 rõ ràng thay vì lỗi cơ sở dữ liệu 500
  if (numTemp > 999.99 || numTemp < -999.99) {
    return {
      status: 400,
      error: "INVALID_TEMPERATURE",
      message: "Giá trị nhiệt độ vượt quá giới hạn lưu trữ (-999.99 đến 999.99).",
    };
  }

  // 3. Kiểm tra thời điểm đo: bắt buộc là chuỗi hợp lệ ISO-8601, từ chối boolean, số, object, chuỗi mơ hồ và ngày sai trên lịch
  if (!rawTimestamp || typeof rawTimestamp !== "string" || !rawTimestamp.trim()) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo nhiệt độ là bắt buộc và phải là chuỗi định dạng ISO-8601.",
    };
  }

  const trimmedTimestamp = rawTimestamp.trim();
  const isoPattern =
    /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:(Z)|([+-]\d{2})(?::?(\d{2}))?)?$/i;
  const match = isoPattern.exec(trimmedTimestamp);
  if (!match) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo không đúng định dạng thời gian ISO-8601 hợp lệ.",
    };
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = match[6] !== undefined ? parseInt(match[6], 10) : 0;

  if (month < 1 || month > 12) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo có tháng không hợp lệ trên lịch.",
    };
  }

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo có ngày không hợp lệ trên lịch.",
    };
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo có giờ, phút hoặc giây không hợp lệ.",
    };
  }

  if (match[9]) {
    const tzHour = Math.abs(parseInt(match[9], 10));
    const tzMin = match[10] ? parseInt(match[10], 10) : 0;
    if (tzHour > 14 || tzMin < 0 || tzMin > 59) {
      return {
        status: 400,
        error: "INVALID_TIMESTAMP",
        message: "Múi giờ trong thời điểm đo không hợp lệ.",
      };
    }
  }

  const dateObj = new Date(trimmedTimestamp);
  if (isNaN(dateObj.getTime())) {
    return {
      status: 400,
      error: "INVALID_TIMESTAMP",
      message: "Thời điểm đo không đúng định dạng thời gian hợp lệ.",
    };
  }

  const recordedAtIso = dateObj.toISOString();
  const incomingTime = dateObj.getTime();

  // 4. Kiểm tra xác thực và phân quyền
  const userId = authContext ? authContext.userId || authContext.id : null;
  const userOrgId = authContext
    ? authContext.organizationId || authContext.organization_id
    : null;
  const isAdmin = Boolean(
    authContext && (authContext.roleId === "admin" || authContext.isAdmin)
  );
  const isInspector = Boolean(
    authContext &&
      (authContext.roleId === "inspector" || authContext.isInspector)
  );

  if (!userId) {
    return {
      status: 401,
      error: "UNAUTHORIZED",
      message: "Chưa đăng nhập.",
    };
  }

  if (isInspector) {
    return {
      status: 403,
      error: "INSPECTOR_FORBIDDEN",
      message:
        "Cán bộ kiểm tra chỉ có quyền đọc dữ liệu, không được phép thực hiện thao tác ghi.",
    };
  }

  if (!isAdmin && !userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN",
      message: "Truy cập bị từ chối: thiếu ngữ cảnh tổ chức.",
    };
  }

  const nowIso = new Date().toISOString();

  // 5. Thực thi với PostgreSQL Transaction
  if (pool || client) {
    const dbClient = client || (await pool.connect());
    const shouldManageTx = !client;

    try {
      if (shouldManageTx) {
        await dbClient.query("BEGIN");
      }

      // 5.1 Khóa và tìm chuyến đang hoạt động liên kết với thùng lạnh này
      const shipRes = await dbClient.query(
        `SELECT id, cold_box_id, status, organization_id, current_temperature, last_temperature_at, started_at, created_at, detector_state,
                applied_temp_min, applied_temp_max, applied_delay_minutes, temperature_config
         FROM shipments
         WHERE cold_box_id = $1 AND status = 'IN_TRANSIT'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [cleanColdBoxId]
      );

      if (shipRes.rows.length === 0) {
        // Kiểm tra xem có chuyến nào đã kết thúc hay không
        const endedRes = await dbClient.query(
          `SELECT id, status
           FROM shipments
           WHERE cold_box_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [cleanColdBoxId]
        );

        if (shouldManageTx) await dbClient.query("ROLLBACK");

        if (
          endedRes.rows.length > 0 &&
          (endedRes.rows[0].status === "COMPLETED" ||
            endedRes.rows[0].status === "CANCELLED")
        ) {
          return {
            status: 400,
            error: "SHIPMENT_ALREADY_ENDED",
            message: `Chuyến vận chuyển của thùng lạnh '${cleanColdBoxId}' đã kết thúc (trạng thái: ${endedRes.rows[0].status}).`,
          };
        }

        return {
          status: 404,
          error: "NO_ACTIVE_SHIPMENT",
          message: `Không tìm thấy chuyến vận chuyển đang hoạt động cho thùng lạnh '${cleanColdBoxId}'.`,
        };
      }

      const shipment = shipRes.rows[0];

      // 5.2 Kiểm tra quyền tổ chức: Phải thuộc tổ chức quản lý chuyến hoặc admin (chống giả mạo tổ chức)
      if (!isAdmin && shipment.organization_id !== userOrgId) {
        if (shouldManageTx) await dbClient.query("ROLLBACK");
        return {
          status: 403,
          error: "FORBIDDEN_SHIPMENT_ACCESS",
          message:
            "Bạn không có quyền ghi nhận nhiệt độ cho chuyến vận chuyển của tổ chức khác.",
        };
      }

      // 5.3 Ranh giới bắt đầu vòng đời chuyến vận chuyển (Lifecycle start boundary)
      const shipmentStartAt = shipment.started_at || shipment.created_at;
      const shipmentStartTime = shipmentStartAt
        ? new Date(shipmentStartAt).getTime()
        : null;

      // 5.4 So sánh mốc thời gian với số đo mới nhất đã lưu và ranh giới bắt đầu chuyến
      const lastTempAt = shipment.last_temperature_at
        ? new Date(shipment.last_temperature_at).getTime()
        : null;

      const isBeforeStart =
        shipmentStartTime !== null && incomingTime < shipmentStartTime;
      const isOlderOrEqual = lastTempAt !== null && incomingTime <= lastTempAt;

      if (isBeforeStart || isOlderOrEqual) {
        // Số đo CŨ HƠN HOẶC TRƯỚC THỜI ĐIỂM BẮT ĐẦU: bỏ qua không ghi đè, trả về 200 acknowledged
        if (shouldManageTx) await dbClient.query("COMMIT");
        return {
          status: 200,
          success: true,
          acknowledged: true,
          ignored: true,
          message: isBeforeStart
            ? "Số đo ghi nhận trước thời điểm chuyến vận chuyển bắt đầu, bỏ qua ghi nhận."
            : "Số đo cũ hơn hoặc bằng số đo mới nhất đã lưu, bỏ qua ghi nhận.",
          data: {
            shipmentId: shipment.id,
            coldBoxId: cleanColdBoxId,
            temperature: numTemp,
            recordedAt: recordedAtIso,
            latestTemperature:
              shipment.current_temperature !== null &&
              shipment.current_temperature !== undefined
                ? Number(shipment.current_temperature)
                : null,
            latestRecordedAt: shipment.last_temperature_at
              ? new Date(shipment.last_temperature_at).toISOString()
              : null,
          },
        };
      }

      // 5.4 Số đo MỚI HƠN: Lưu vào shipment_temperatures và cập nhật shipments atomically
      const tempId = "temp-" + crypto.randomUUID().slice(0, 8);
      await dbClient.query(
        `INSERT INTO shipment_temperatures (id, shipment_id, cold_box_id, temperature, recorded_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shipment_id, recorded_at) DO NOTHING`,
        [tempId, shipment.id, cleanColdBoxId, numTemp, recordedAtIso, nowIso]
      );

      await dbClient.query(
        `UPDATE shipments
         SET current_temperature = $2,
             last_temperature_at = $3,
             updated_at = NOW()
         WHERE id = $1 AND (last_temperature_at IS NULL OR last_temperature_at < $3)`,
        [shipment.id, numTemp, recordedAtIso]
      );

      if (typeof onAcceptedReading === "function") {
        await onAcceptedReading({
          client: dbClient,
          shipment,
          coldBoxId: cleanColdBoxId,
          temperature: numTemp,
          recordedAt: recordedAtIso,
          tempId,
          nowIso,
          authContext,
        });
      }

      if (shouldManageTx) {
        await dbClient.query("COMMIT");
      }

      return {
        status: 200,
        success: true,
        acknowledged: true,
        ignored: false,
        message: "Số đo nhiệt độ đã được ghi nhận thành công.",
        data: {
          id: tempId,
          shipmentId: shipment.id,
          coldBoxId: cleanColdBoxId,
          temperature: numTemp,
          recordedAt: recordedAtIso,
          createdAt: nowIso,
        },
      };
    } catch (err) {
      if (shouldManageTx) {
        try {
          await dbClient.query("ROLLBACK");
        } catch {
          /* ignore rollback failure */
        }
      }
      throw err;
    } finally {
      if (shouldManageTx) {
        dbClient.release();
      }
    }
  }

  // 6. In-Memory Execution Path có Mutex Lock theo coldBoxId
  return await withTemperatureLock(cleanColdBoxId, async () => {
    const activeShipment = inMemoryShipments.find(
      (s) =>
        (s.coldBoxId === cleanColdBoxId || s.containerId === cleanColdBoxId) &&
        s.status === "IN_TRANSIT"
    );

    if (!activeShipment) {
      const anyShipment = inMemoryShipments.find(
        (s) =>
          s.coldBoxId === cleanColdBoxId || s.containerId === cleanColdBoxId
      );
      if (
        anyShipment &&
        (anyShipment.status === "COMPLETED" || anyShipment.status === "CANCELLED")
      ) {
        return {
          status: 400,
          error: "SHIPMENT_ALREADY_ENDED",
          message: `Chuyến vận chuyển của thùng lạnh '${cleanColdBoxId}' đã kết thúc (trạng thái: ${anyShipment.status}).`,
        };
      }
      return {
        status: 404,
        error: "NO_ACTIVE_SHIPMENT",
        message: `Không tìm thấy chuyến vận chuyển đang hoạt động cho thùng lạnh '${cleanColdBoxId}'.`,
      };
    }

    if (!isAdmin && activeShipment.organizationId !== userOrgId) {
      return {
        status: 403,
        error: "FORBIDDEN_SHIPMENT_ACCESS",
        message:
          "Bạn không có quyền ghi nhận nhiệt độ cho chuyến vận chuyển của tổ chức khác.",
      };
    }

    // Ranh giới bắt đầu vòng đời chuyến vận chuyển
    const shipmentStartAt =
      activeShipment.startedAt ||
      activeShipment.started_at ||
      activeShipment.createdAt ||
      activeShipment.created_at;
    const shipmentStartTime = shipmentStartAt
      ? new Date(shipmentStartAt).getTime()
      : null;

    const lastTempAt = activeShipment.lastTemperatureAt
      ? new Date(activeShipment.lastTemperatureAt).getTime()
      : null;

    const isBeforeStart =
      shipmentStartTime !== null && incomingTime < shipmentStartTime;
    const isOlderOrEqual = lastTempAt !== null && incomingTime <= lastTempAt;

    if (isBeforeStart || isOlderOrEqual) {
      return {
        status: 200,
        success: true,
        acknowledged: true,
        ignored: true,
        message: isBeforeStart
          ? "Số đo ghi nhận trước thời điểm chuyến vận chuyển bắt đầu, bỏ qua ghi nhận."
          : "Số đo cũ hơn hoặc bằng số đo mới nhất đã lưu, bỏ qua ghi nhận.",
        data: {
          shipmentId: activeShipment.id,
          coldBoxId: cleanColdBoxId,
          temperature: numTemp,
          recordedAt: recordedAtIso,
          latestTemperature:
            activeShipment.currentTemperature !== undefined &&
            activeShipment.currentTemperature !== null
              ? activeShipment.currentTemperature
              : null,
          latestRecordedAt: activeShipment.lastTemperatureAt || null,
        },
      };
    }

    const prevCurrentTemp = activeShipment.currentTemperature;
    const prevLastTempAt = activeShipment.lastTemperatureAt;
    const prevUpdatedAt = activeShipment.updatedAt;
    const prevDetectorState = activeShipment.detector_state
      ? JSON.parse(JSON.stringify(activeShipment.detector_state))
      : (activeShipment.detectorState ? JSON.parse(JSON.stringify(activeShipment.detectorState)) : null);

    const exists = inMemoryShipmentTemperatures.find(
      (t) => t.shipmentId === activeShipment.id && t.recordedAt === recordedAtIso
    );
    let tempId;
    let newlyInserted = false;
    if (!exists) {
      tempId = "temp-" + crypto.randomUUID().slice(0, 8);
      inMemoryShipmentTemperatures.push({
        id: tempId,
        shipmentId: activeShipment.id,
        coldBoxId: cleanColdBoxId,
        temperature: numTemp,
        recordedAt: recordedAtIso,
        createdAt: nowIso,
      });
      newlyInserted = true;
    } else {
      tempId = exists.id;
    }

    activeShipment.currentTemperature = numTemp;
    activeShipment.lastTemperatureAt = recordedAtIso;
    activeShipment.updatedAt = nowIso;

    if (typeof onAcceptedReading === "function") {
      try {
        await onAcceptedReading({
          shipment: activeShipment,
          coldBoxId: cleanColdBoxId,
          temperature: numTemp,
          recordedAt: recordedAtIso,
          tempId,
          nowIso,
          authContext,
        });
      } catch (err) {
        if (newlyInserted) {
          const idx = inMemoryShipmentTemperatures.findIndex((t) => t.id === tempId);
          if (idx !== -1) inMemoryShipmentTemperatures.splice(idx, 1);
        }
        activeShipment.currentTemperature = prevCurrentTemp;
        activeShipment.lastTemperatureAt = prevLastTempAt;
        activeShipment.updatedAt = prevUpdatedAt;
        activeShipment.detector_state = prevDetectorState;
        activeShipment.detectorState = prevDetectorState;
        throw err;
      }
    }

    return {
      status: 200,
      success: true,
      acknowledged: true,
      ignored: false,
      message: "Số đo nhiệt độ đã được ghi nhận thành công.",
      data: {
        id: tempId,
        shipmentId: activeShipment.id,
        coldBoxId: cleanColdBoxId,
        temperature: numTemp,
        recordedAt: recordedAtIso,
        createdAt: nowIso,
      },
    };
  });
}

/**
 * Lấy lịch sử số đo nhiệt độ của một chuyến vận chuyển
 */
async function getShipmentTemperatures({
  pool = null,
  authContext = null,
  shipmentId,
}) {
  if (!shipmentId) {
    return {
      status: 400,
      error: "MISSING_SHIPMENT_ID",
      message: "Mã chuyến vận chuyển là bắt buộc.",
    };
  }

  const userId = authContext ? authContext.userId || authContext.id : null;
  const userOrgId = authContext
    ? authContext.organizationId || authContext.organization_id
    : null;
  const isGlobal = Boolean(
    authContext &&
      (authContext.roleId === "admin" ||
        authContext.isAdmin ||
        authContext.roleId === "inspector" ||
        authContext.isInspector)
  );

  if (!userId) {
    return {
      status: 401,
      error: "UNAUTHORIZED",
      message: "Chưa đăng nhập.",
    };
  }

  if (pool) {
    const shipRes = await pool.query(
      "SELECT id, organization_id, cold_box_id FROM shipments WHERE id = $1",
      [shipmentId]
    );
    if (shipRes.rows.length === 0) {
      return {
        status: 404,
        error: "SHIPMENT_NOT_FOUND",
        message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
      };
    }

    const ship = shipRes.rows[0];
    if (!isGlobal && ship.organization_id !== userOrgId) {
      return {
        status: 403,
        error: "FORBIDDEN_SHIPMENT_ACCESS",
        message: "Bạn không có quyền truy cập dữ liệu nhiệt độ của chuyến này.",
      };
    }

    const tempsRes = await pool.query(
      `SELECT id, shipment_id, cold_box_id, temperature, recorded_at, created_at
       FROM shipment_temperatures
       WHERE shipment_id = $1
       ORDER BY recorded_at ASC`,
      [shipmentId]
    );

    const items = tempsRes.rows.map((r) => ({
      id: r.id,
      shipmentId: r.shipment_id,
      coldBoxId: r.cold_box_id,
      temperature: Number(r.temperature),
      recordedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));

    return {
      status: 200,
      success: true,
      shipmentId,
      coldBoxId: ship.cold_box_id,
      count: items.length,
      temperatures: items,
      data: items,
    };
  }

  const ship = inMemoryShipments.find((s) => s.id === shipmentId);
  if (!ship) {
    return {
      status: 404,
      error: "SHIPMENT_NOT_FOUND",
      message: "Không tìm thấy chuyến vận chuyển yêu cầu.",
    };
  }

  if (!isGlobal && ship.organizationId !== userOrgId) {
    return {
      status: 403,
      error: "FORBIDDEN_SHIPMENT_ACCESS",
      message: "Bạn không có quyền truy cập dữ liệu nhiệt độ của chuyến này.",
    };
  }

  const items = inMemoryShipmentTemperatures
    .filter((t) => t.shipmentId === shipmentId)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));

  return {
    status: 200,
    success: true,
    shipmentId,
    coldBoxId: ship.coldBoxId,
    count: items.length,
    temperatures: items,
    data: items,
  };
}

module.exports = {
  inMemoryShipments,
  inMemoryShipmentLots,
  inMemoryShipmentTemperatures,
  createShipment,
  completeShipment,
  getShipments,
  getShipmentById,
  getActiveShipmentForLot,
  recordShipmentTemperature,
  getShipmentTemperatures,
};
