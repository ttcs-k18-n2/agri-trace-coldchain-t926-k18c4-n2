const { GENESIS_HASH, calculateEventHash } = require("./integrity");

/**
 * Standardized batch integrity verification (S-12 / T-28).
 * Checks:
 * 1. Strict sequence continuity: 1, 2, 3, ... (detects deleted/missing events)
 * 2. Strict previous_hash chaining (detects reordering, insertions, or forks)
 * 3. Exact event_hash recalculation over full canonical metadata (detects content tampering)
 *
 * @param {Array<object>} events - Ordered list of events for a batch
 * @returns {object} Standardized audit result:
 *   - Valid: { valid: true, eventCount, finalHash }
 *   - Tampered: { valid: false, type: "CONTENT_TAMPERED", firstInvalidSequence, eventId, suspiciousFrom, error }
 *   - Broken chain: { valid: false, type: "BROKEN_CHAIN", firstInvalidSequence, suspiciousFrom, error, ... }
 */
function verifyBatchEventChain(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return {
      valid: true,
      eventCount: 0,
      finalHash: null,
    };
  }

  let expectedPreviousHash = GENESIS_HASH;
  let expectedSequence = 1;

  for (const event of events) {
    const seq = Number(
      event.sequenceNo !== undefined ? event.sequenceNo : event.sequence_no
    );
    const prevHash =
      event.previousHash !== undefined ? event.previousHash : event.previous_hash;
    const evHash =
      event.eventHash !== undefined ? event.eventHash : event.event_hash;
    const evId = event.id;

    // 1. Kiểm tra thứ tự sequence liên tục (phát hiện xóa event)
    if (seq !== expectedSequence) {
      return {
        valid: false,
        type: "BROKEN_CHAIN",
        error: `Sequence bị đứt đoạn tại vị trí ${expectedSequence}: mong đợi ${expectedSequence}, nhận được ${seq}`,
        firstInvalidSequence: expectedSequence,
        actualSequence: seq,
        suspiciousFrom: expectedSequence,
      };
    }

    // 2. Kiểm tra chuỗi hash liên kết với event trước
    if (prevHash !== expectedPreviousHash) {
      return {
        valid: false,
        type: "BROKEN_CHAIN",
        error: `Chuỗi hash bị gãy tại sự kiện #${seq}: previous_hash không khớp với event_hash của sự kiện trước.`,
        firstInvalidSequence: seq,
        expectedPreviousHash,
        actualPreviousHash: prevHash,
        suspiciousFrom: seq,
      };
    }

    // 3. Tính toán lại mã băm trên toàn bộ metadata chuẩn hóa
    const recalculated = calculateEventHash(prevHash, event);
    if (recalculated !== evHash) {
      return {
        valid: false,
        type: "CONTENT_TAMPERED",
        error: `Nội dung sự kiện #${seq} đã bị sửa đổi trái phép (tampered): hash tính lại không khớp với event_hash được lưu.`,
        firstInvalidSequence: seq,
        eventId: evId,
        suspiciousFrom: seq,
      };
    }

    expectedPreviousHash = evHash;
    expectedSequence++;
  }

  return {
    valid: true,
    eventCount: events.length,
    finalHash: expectedPreviousHash,
  };
}

/**
 * Loads events for a batch and verifies the integrity chain (S-12).
 * Lazy-loads getBatchEvents from event_repository to prevent circular dependency.
 *
 * @param {import('pg').Pool|import('pg').Client|null} clientOrPool
 * @param {string} batchId
 * @returns {Promise<object>} Standardized audit result
 */
async function verifyBatchIntegrity(clientOrPool, batchId) {
  const { getBatchEvents } = require("./event_repository");
  const events = await getBatchEvents(clientOrPool, batchId);
  return verifyBatchEventChain(events);
}

module.exports = {
  verifyBatchEventChain,
  verifyBatchIntegrity,
};
