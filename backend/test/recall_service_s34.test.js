const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inMemoryLots,
  inMemoryBatchRelations,
  inMemoryBatchEvents,
  inMemoryOrgs,
  inMemoryProducts,
  inMemoryFarms,
  inMemoryRecallOrders,
  seedS39Data,
  getRecallOrderWithLiveDescendants,
  traceLotDescendants,
} = require("../src/server");

test("S-34 (Subtasks 1 & 4): Xử lý lô gộp đa nguồn & Tính toán động danh sách hậu duệ thu hồi (Live BFS)", async (t) => {
  // Nạp dữ liệu chuẩn S-39
  seedS39Data();

  await t.test("Subtask 1 - AC2: Gắn cờ isMultiSourceMerge, sourcesCount, mergedSources, notes cho lô gộp đa nguồn", async () => {
    // Duyệt từ R01 -> R08 là lô gộp từ R04 (250kg) và R06 (250kg)
    const resR01 = await traceLotDescendants({
      startLotId: "R01",
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    const r08 = resR01.descendants.find((d) => d.id === "R08");
    assert.ok(r08, "Lô R08 phải nằm trong hậu duệ của R01");
    assert.equal(r08.isMultiSourceMerge, true, "R08 phải có isMultiSourceMerge = true");
    assert.equal(r08.sourcesCount, 2, "R08 phải có 2 nguồn cha");
    assert.equal(r08.notes, "Lô gộp từ nhiều nguồn", "R08 phải có ghi chú 'Lô gộp từ nhiều nguồn'");
    assert.ok(Array.isArray(r08.mergedSources), "mergedSources phải là mảng");
    assert.equal(r08.mergedSources.length, 2, "mergedSources có đúng 2 phần tử");

    const parentIdsInR08 = r08.mergedSources.map((s) => s.parentBatchId);
    assert.ok(parentIdsInR08.includes("R04"), "Nguồn cha gồm R04");
    assert.ok(parentIdsInR08.includes("R06"), "Nguồn cha gồm R06");

    // Lô tách đơn nguồn như R04 phải có isMultiSourceMerge = false
    const r04 = resR01.descendants.find((d) => d.id === "R04");
    assert.ok(r04, "R04 phải có trong hậu duệ của R01");
    assert.equal(r04.isMultiSourceMerge, false, "R04 là lô tách, isMultiSourceMerge = false");
    assert.equal(r04.sourcesCount, 1);
    assert.equal(r04.notes, null);
  });

  await t.test("Subtask 4 - NFR: getRecallOrderWithLiveDescendants tính toán động tại thời điểm xem, không dùng snapshot cứng", async () => {
    // Tạo 1 lệnh thu hồi mẫu cho lô gốc R01
    const testRecallOrderId = "REC-20261016-001";
    inMemoryRecallOrders.push({
      id: testRecallOrderId,
      lotId: "R01",
      reason: "Phát hiện dư lượng thuốc BVTV vượt ngưỡng quy định",
      severity: "CRITICAL",
      status: "OPEN",
      createdBy: "inspector@gov.vn",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Lần 1: Gọi hàm getRecallOrderWithLiveDescendants
    const liveReport1 = await getRecallOrderWithLiveDescendants({
      recallOrderId: testRecallOrderId,
      inMemoryRecallOrders,
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(liveReport1.recallOrder.id, testRecallOrderId);
    assert.equal(liveReport1.recallOrder.lotId, "R01");
    assert.equal(liveReport1.quarantineSummary.totalDescendants, 7);
    assert.equal(liveReport1.quarantineSummary.totalQuarantineQuantity, 730);
    assert.equal(liveReport1.quarantineSummary.quarantineLotsCount, 6);
    assert.equal(liveReport1.quarantineSummary.consumedLotsCount, 1);
    assert.equal(liveReport1.consumedLots[0].id, "R11");

    // Kiểm tra tính Real-time động (không dùng snapshot cứng):
    // Giả sử sau thời điểm kiểm tra, lô R12 tiêu thụ hết ra thị trường (bán lẻ hết 200kg -> remainingQuantity = 0, status = 'Đã bán hết')
    const r12 = inMemoryLots.find((l) => l.id === "R12");
    const originalR12Status = r12.status;
    const originalR12Qty = r12.remainingQuantity;

    r12.remainingQuantity = 0;
    r12.status = "Đã bán hết";

    // Lần 2: Gọi lại getRecallOrderWithLiveDescendants -> Số liệu tự động cập nhật ngay lập tức theo Live BFS
    const liveReport2 = await getRecallOrderWithLiveDescendants({
      recallOrderId: testRecallOrderId,
      inMemoryRecallOrders,
      inMemoryLots,
      inMemoryBatchRelations,
      inMemoryBatchEvents,
      inMemoryOrgs,
      inMemoryProducts,
      inMemoryFarms,
    });

    assert.equal(liveReport2.quarantineSummary.totalDescendants, 7);
    // Tồn kho cần thu hồi giảm từ 730 xuống 530 (do R12 200kg đã bán hết)
    assert.equal(liveReport2.quarantineSummary.totalQuarantineQuantity, 530);
    assert.equal(liveReport2.quarantineSummary.quarantineLotsCount, 5);
    // Số lô đã tiêu thụ tăng lên 2: R11 và R12
    assert.equal(liveReport2.quarantineSummary.consumedLotsCount, 2);
    const consumedIds = liveReport2.consumedLots.map((l) => l.id);
    assert.ok(consumedIds.includes("R11"));
    assert.ok(consumedIds.includes("R12"));

    // Khôi phục lại trạng thái ban đầu cho R12
    r12.status = originalR12Status;
    r12.remainingQuantity = originalR12Qty;
  });

  await t.test("getRecallOrderWithLiveDescendants ném lỗi 404 khi mã lệnh thu hồi không tồn tại", async () => {
    await assert.rejects(
      async () => {
        await getRecallOrderWithLiveDescendants({
          recallOrderId: "NON-EXISTING-REC",
          inMemoryRecallOrders,
          inMemoryLots,
        });
      },
      (err) => {
        assert.equal(err.statusCode, 404);
        assert.match(err.message, /Không tìm thấy lệnh thu hồi/);
        return true;
      }
    );
  });
});
