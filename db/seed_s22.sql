-- ============================================================================
-- S-22: BỘ DỮ LIỆU MẪU PHÂN HỆ BA TẦNG CÓ ĐÁP ÁN ĐẾM TAY (SEED THỰC THI IDEMPOTENT)
-- ============================================================================
-- Tiêu chí chấp nhận (Acceptance Criteria):
-- AC1: Tạo ít nhất 12 lô qua ba tầng, có cả tách và gộp, thuộc 3 tổ chức.
-- AC2: Idempotent - Chạy lại nhiều lần trạng thái dữ liệu không đổi, không nhân đôi.
-- AC3: Đáp án độc lập viết tay trước thuật toán:
--
-- Sơ đồ phả hệ đếm tay:
--   TẦNG 1:  L01   L02   L03   L04
--              |    / \    |    |
--              |   /   \   |    |
--   TẦNG 2:  L05 L06   L07 L08 L09
--                \      /   \  /
--                 \    /     \/
--   TẦNG 3:       L10       L11 L12
--
-- Đáp án tổ tiên (Ancestors):
--   L07 = {L01, L03}
--   L10 = {L05, L08, L02, L04}
--   L11 = {L06, L09, L02, L04}
--   L05 = {L02}
--   L06 = {L02}
--   L08 = {L04}
--   L09 = {L04}
--   L12 = {} (độc lập)
--
-- Đáp án hậu duệ (Descendants):
--   L01 = {L07}
--   L02 = {L05, L06, L10, L11}
--   L03 = {L07}
--   L04 = {L08, L09, L10, L11}
--   L05 = {L10}
--   L06 = {L11}
--   L08 = {L10}
--   L09 = {L11}
--   L10 = {}
--   L11 = {}
--   L12 = {} (độc lập)
-- ============================================================================

-- 1. Ba tổ chức (Organizations)
INSERT INTO organizations (id, name, type) VALUES
    ('ORG-A', 'Hợp tác xã Nông nghiệp A', 'cooperative'),
    ('ORG-B', 'Nhà máy/đơn vị sơ chế B', 'producer'),
    ('ORG-C', 'Trung tâm phân phối C', 'distributor')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type;

-- 2. Sản phẩm (Products)
INSERT INTO products (id, name, unit) VALUES
    ('PROD-TOMATO', 'Cà chua', 'kg')
ON CONFLICT (id) DO NOTHING;

-- 3. Thửa đất / Vùng sản xuất (Farms)
INSERT INTO farms (id, name, area, coordinates, organization_id) VALUES
    ('FARM-ORG-A', 'Thửa canh tác Hợp tác xã A', 3.50, '21.5645, 105.6789', 'ORG-A'),
    ('FARM-ORG-B', 'Thửa sơ chế Nhà máy B', 2.00, '21.5712, 105.6841', 'ORG-B')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    area = EXCLUDED.area,
    organization_id = EXCLUDED.organization_id;

-- 4. 12 lô hàng qua 3 tầng (Lots)
INSERT INTO lots (
    id, name, status, organization_id, farm_id, product_id,
    initial_quantity, remaining_quantity, harvested_at, parent_lot_id, created_at
) VALUES
    -- Tầng 1 (Lô nguồn)
    ('L01', 'Lô Cà chua Nguồn L01', 'Đã thu hoạch', 'ORG-A', 'FARM-ORG-A', 'PROD-TOMATO', 500.000, 300.000, '2026-10-01', NULL, '2026-10-01T08:00:00.000Z'),
    ('L02', 'Lô Cà chua Nguồn L02', 'Đã thu hoạch', 'ORG-A', 'FARM-ORG-A', 'PROD-TOMATO', 600.000, 200.000, '2026-10-01', NULL, '2026-10-01T08:30:00.000Z'),
    ('L03', 'Lô Cà chua Nguồn L03', 'Đã thu hoạch', 'ORG-A', 'FARM-ORG-A', 'PROD-TOMATO', 400.000, 200.000, '2026-10-01', NULL, '2026-10-01T09:00:00.000Z'),
    ('L04', 'Lô Cà chua Nguồn L04', 'Đã thu hoạch', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 500.000, 100.000, '2026-10-02', NULL, '2026-10-02T08:00:00.000Z'),

    -- Tầng 2 (Tách từ L02, Gộp L01+L03, Tách từ L04)
    ('L05', 'Lô Cà chua Sơ chế L05 (Tách từ L02)', 'Đã thu hoạch', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 200.000, 100.000, '2026-10-03', 'L02', '2026-10-03T08:00:00.000Z'),
    ('L06', 'Lô Cà chua Sơ chế L06 (Tách từ L02)', 'Đã thu hoạch', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 200.000, 100.000, '2026-10-03', 'L02', '2026-10-03T08:30:00.000Z'),
    ('L07', 'Lô Cà chua Gộp L07 (Gộp L01 + L03)', 'Đã thu hoạch', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 400.000, 400.000, '2026-10-03', 'L01', '2026-10-03T09:00:00.000Z'),
    ('L08', 'Lô Cà chua Phân phối L08 (Tách từ L04)', 'Đã thu hoạch', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 100.000, '2026-10-04', 'L04', '2026-10-04T08:00:00.000Z'),
    ('L09', 'Lô Cà chua Phân phối L09 (Tách từ L04)', 'Đã thu hoạch', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 100.000, '2026-10-04', 'L04', '2026-10-04T08:30:00.000Z'),

    -- Tầng 3 (Gộp L05+L08, Gộp L06+L09, Lô cuối nhánh độc lập L12)
    ('L10', 'Lô Cà chua Gộp L10 (Gộp L05 + L08)', 'Đã thu hoạch', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 200.000, '2026-10-05', 'L05', '2026-10-05T08:00:00.000Z'),
    ('L11', 'Lô Cà chua Gộp L11 (Gộp L06 + L09)', 'Đã thu hoạch', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 200.000, '2026-10-05', 'L06', '2026-10-05T08:30:00.000Z'),
    ('L12', 'Lô Cà chua Độc lập L12', 'Đã thu hoạch', 'ORG-C', NULL, 'PROD-TOMATO', 150.000, 150.000, '2026-10-05', NULL, '2026-10-05T09:00:00.000Z')
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    organization_id = EXCLUDED.organization_id,
    farm_id = EXCLUDED.farm_id,
    product_id = EXCLUDED.product_id,
    initial_quantity = EXCLUDED.initial_quantity,
    remaining_quantity = EXCLUDED.remaining_quantity,
    harvested_at = EXCLUDED.harvested_at,
    parent_lot_id = EXCLUDED.parent_lot_id;

-- 5. Quan hệ phân tách và sáp nhập (Batch Relations - T-39 / S-17 / S-19)
INSERT INTO batch_relations (
    id, parent_batch_id, child_batch_id, relation_type, quantity, organization_id, created_at
) VALUES
    ('rel-s22-01', 'L02', 'L05', 'SPLIT', 200.000, 'ORG-B', '2026-10-03T08:00:00.000Z'),
    ('rel-s22-02', 'L02', 'L06', 'SPLIT', 200.000, 'ORG-B', '2026-10-03T08:30:00.000Z'),
    ('rel-s22-03', 'L01', 'L07', 'MERGE', 200.000, 'ORG-B', '2026-10-03T09:00:00.000Z'),
    ('rel-s22-04', 'L03', 'L07', 'MERGE', 200.000, 'ORG-B', '2026-10-03T09:00:00.000Z'),
    ('rel-s22-05', 'L04', 'L08', 'SPLIT', 200.000, 'ORG-C', '2026-10-04T08:00:00.000Z'),
    ('rel-s22-06', 'L04', 'L09', 'SPLIT', 200.000, 'ORG-C', '2026-10-04T08:30:00.000Z'),
    ('rel-s22-07', 'L05', 'L10', 'MERGE', 100.000, 'ORG-C', '2026-10-05T08:00:00.000Z'),
    ('rel-s22-08', 'L08', 'L10', 'MERGE', 100.000, 'ORG-C', '2026-10-05T08:00:00.000Z'),
    ('rel-s22-09', 'L06', 'L11', 'MERGE', 100.000, 'ORG-C', '2026-10-05T08:30:00.000Z'),
    ('rel-s22-10', 'L09', 'L11', 'MERGE', 100.000, 'ORG-C', '2026-10-05T08:30:00.000Z')
ON CONFLICT (parent_batch_id, child_batch_id) DO UPDATE SET
    relation_type = EXCLUDED.relation_type,
    quantity = EXCLUDED.quantity,
    organization_id = EXCLUDED.organization_id;

-- 6. Chuỗi sự kiện toàn vẹn mật mã SHA-256 (Batch Events - S-10 / K-01)
INSERT INTO batch_events (
    id, batch_id, sequence_no, event_type, payload, organization_id,
    actor_user_id, occurred_at, previous_hash, event_hash
) VALUES
    ('evt-s22-l01-01', 'L01', 1, 'HARVEST_CREATED', '{"initialQuantity":500,"farmId":"FARM-ORG-A","productId":"PROD-TOMATO"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-01T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '09e34c1b8764369cb6e4300bf4d726455072e5652524c7e56a5ff70b2fbd5de6'),
    ('evt-s22-l01-02', 'L01', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L07","takeQuantity":200,"step":"Gộp 200 vào lô L07"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-03T09:00:00.000Z', '09e34c1b8764369cb6e4300bf4d726455072e5652524c7e56a5ff70b2fbd5de6', 'b3d2339f0523ecfdfada5404e27c4eda2c4caf8e00ec641574c0d26fda3bd974'),
    ('evt-s22-l02-01', 'L02', 1, 'HARVEST_CREATED', '{"initialQuantity":600,"farmId":"FARM-ORG-A","productId":"PROD-TOMATO"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-01T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '2c21886493edcdbc680b644a87646f61e8645a52c086c60b2d91e5a54f346e80'),
    ('evt-s22-l02-02', 'L02', 2, 'LOT_SPLIT', '{"childLotId":"L05","splitQuantity":200,"step":"Tách 200 tạo lô L05"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-03T08:00:00.000Z', '2c21886493edcdbc680b644a87646f61e8645a52c086c60b2d91e5a54f346e80', '1e581c83c3c9a3960bc5ca63d7290c1ee4c852e78cd33d7bcc71ce99ce58f5de'),
    ('evt-s22-l02-03', 'L02', 3, 'LOT_SPLIT', '{"childLotId":"L06","splitQuantity":200,"step":"Tách 200 tạo lô L06"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-03T08:30:00.000Z', '1e581c83c3c9a3960bc5ca63d7290c1ee4c852e78cd33d7bcc71ce99ce58f5de', 'f5645db3a5a8539a8a3d845044bf55cd92e78fd2ef63fe2cb7f957496ae86b5c'),
    ('evt-s22-l03-01', 'L03', 1, 'HARVEST_CREATED', '{"initialQuantity":400,"farmId":"FARM-ORG-A","productId":"PROD-TOMATO"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-01T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'bbeb781f81f1acaafa0244b3552be5e5ae059fc5f5b6da20ac2ff0b137e4303b'),
    ('evt-s22-l03-02', 'L03', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L07","takeQuantity":200,"step":"Gộp 200 vào lô L07"}'::jsonb, 'ORG-A', 'usr-s22-a', '2026-10-03T09:00:00.000Z', 'bbeb781f81f1acaafa0244b3552be5e5ae059fc5f5b6da20ac2ff0b137e4303b', '1da1b3a02444b4b8fab7e45b34a7b7afe4a40ada88b432fc6afadf86c2eaa2cf'),
    ('evt-s22-l04-01', 'L04', 1, 'HARVEST_CREATED', '{"initialQuantity":500,"farmId":"FARM-ORG-B","productId":"PROD-TOMATO"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-02T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'd7b60dcb8cde34c0e56e44355f9d530db0e89882f1a5f21dd77cbd994027bb01'),
    ('evt-s22-l04-02', 'L04', 2, 'LOT_SPLIT', '{"childLotId":"L08","splitQuantity":200,"step":"Tách 200 tạo lô L08"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-04T08:00:00.000Z', 'd7b60dcb8cde34c0e56e44355f9d530db0e89882f1a5f21dd77cbd994027bb01', 'feaecc0f5f17796f2db1c69ba78cd730ad879d08be5a1ccb7ccb1a383f842265'),
    ('evt-s22-l04-03', 'L04', 3, 'LOT_SPLIT', '{"childLotId":"L09","splitQuantity":200,"step":"Tách 200 tạo lô L09"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-04T08:30:00.000Z', 'feaecc0f5f17796f2db1c69ba78cd730ad879d08be5a1ccb7ccb1a383f842265', 'e23655ba412534a7b85cac782bcfd591464dcace17e8c6d2aa606e34fa73cbf2'),
    ('evt-s22-l05-01', 'L05', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"L02","initialQuantity":200,"step":"Khởi tạo từ tách lô L02"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-03T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '8f3a9ee58014ecce0422f7f848d3a0930bf61526aeb01d284f34d79402e5b577'),
    ('evt-s22-l05-02', 'L05', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L10","takeQuantity":100,"step":"Gộp 100 vào lô L10"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-05T08:00:00.000Z', '8f3a9ee58014ecce0422f7f848d3a0930bf61526aeb01d284f34d79402e5b577', '49f77d648853f4f9c63fd72dcac1bdcae832e331447ab930893f6633fc5ba97e'),
    ('evt-s22-l06-01', 'L06', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"L02","initialQuantity":200,"step":"Khởi tạo từ tách lô L02"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-03T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'f4f13caa584fa11635a5c6e8bf779bb4c359bc97070cab26058e0251426f55d5'),
    ('evt-s22-l06-02', 'L06', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L11","takeQuantity":100,"step":"Gộp 100 vào lô L11"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-05T08:30:00.000Z', 'f4f13caa584fa11635a5c6e8bf779bb4c359bc97070cab26058e0251426f55d5', '6d8d24c8be4ec2f404a3543f08c6d7cd2dd0d4a928c51e16f009e40a0ccedfdc'),
    ('evt-s22-l07-01', 'L07', 1, 'CREATED_FROM_MERGE', '{"totalQuantity":400,"parentLots":[{"parentBatchId":"L01","quantity":200},{"parentBatchId":"L03","quantity":200}],"step":"Gộp từ L01 và L03"}'::jsonb, 'ORG-B', 'usr-s22-b', '2026-10-03T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '3bc3e486b52a70a1b66e580e88423abe2b00b01e9f30ac96282d0351cc3887cc'),
    ('evt-s22-l08-01', 'L08', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"L04","initialQuantity":200,"step":"Khởi tạo từ tách lô L04"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-04T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '61cddfd2cda806942fdf8d463071439f806cfb1c2815a49d5bf51a02294b544d'),
    ('evt-s22-l08-02', 'L08', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L10","takeQuantity":100,"step":"Gộp 100 vào lô L10"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-05T08:00:00.000Z', '61cddfd2cda806942fdf8d463071439f806cfb1c2815a49d5bf51a02294b544d', 'c91bb165db6dad3665d433ecd108487e185d4c4d5765b697350d75fde2066733'),
    ('evt-s22-l09-01', 'L09', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"L04","initialQuantity":200,"step":"Khởi tạo từ tách lô L04"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-04T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '2e471d39edd5f0a209a19461fcd12f43aad35760d47123fe8574b381c31f389b'),
    ('evt-s22-l09-02', 'L09', 2, 'LOT_MERGED_FROM', '{"targetLotId":"L11","takeQuantity":100,"step":"Gộp 100 vào lô L11"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-05T08:30:00.000Z', '2e471d39edd5f0a209a19461fcd12f43aad35760d47123fe8574b381c31f389b', 'a59b7f57308aafdf10d03d34073cfe48eac82c20ae3d978153f9504ea286cb4a'),
    ('evt-s22-l10-01', 'L10', 1, 'CREATED_FROM_MERGE', '{"totalQuantity":200,"parentLots":[{"parentBatchId":"L05","quantity":100},{"parentBatchId":"L08","quantity":100}],"step":"Gộp từ L05 và L08"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-05T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'c4bba737d7af16a963e79911dd3130b1a98a15b803c95beaad22a325ad7e26a7'),
    ('evt-s22-l11-01', 'L11', 1, 'CREATED_FROM_MERGE', '{"totalQuantity":200,"parentLots":[{"parentBatchId":"L06","quantity":100},{"parentBatchId":"L09","quantity":100}],"step":"Gộp từ L06 và L09"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-05T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '507a1dcbd3f1db6711f36d54924c42a85ca84be1e0bce821e4c6fac0bb52e002'),
    ('evt-s22-l12-01', 'L12', 1, 'HARVEST_CREATED', '{"initialQuantity":150,"productId":"PROD-TOMATO"}'::jsonb, 'ORG-C', 'usr-s22-c', '2026-10-05T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '23680f207057eded97ba5e936129dad16bff5878b1f3a77e8862944af23ae6ce')
ON CONFLICT (batch_id, sequence_no) DO UPDATE SET
    event_type = EXCLUDED.event_type,
    payload = EXCLUDED.payload,
    organization_id = EXCLUDED.organization_id,
    actor_user_id = EXCLUDED.actor_user_id,
    occurred_at = EXCLUDED.occurred_at,
    previous_hash = EXCLUDED.previous_hash,
    event_hash = EXCLUDED.event_hash;
