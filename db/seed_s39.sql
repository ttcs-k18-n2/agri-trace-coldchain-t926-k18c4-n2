-- ============================================================================
-- S-39: BỘ DỮ LIỆU THU HỒI MẪU BỐN TẦNG, BA TỔ CHỨC, CÓ ĐÁP ÁN ĐẾM TAY (IDEMPOTENT)
-- ============================================================================
-- Tiêu chí chấp nhận (Acceptance Criteria):
-- AC1: Đồ thị bốn tầng qua ba tổ chức với ít nhất một lô gộp đa nguồn và một lô đã tiêu thụ.
-- AC2: Đáp án đối chiếu đếm tay độc lập từ hai người theo bảng tra cứu lô gốc.
-- Dependencies: S-22, S-29 (Trạng thái 'Đã bán hết' và remaining_quantity = 0).
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

-- 4. 15 lô hàng qua 4 tầng (Lots)
INSERT INTO lots (
    id, name, status, organization_id, farm_id, product_id,
    initial_quantity, remaining_quantity, harvested_at, parent_lot_id, created_at
) VALUES
    ('R01', 'Lô Cà chua Nguồn R01', 'Đã thu hoạch', 'ORG-A', 'FARM-ORG-A', 'PROD-TOMATO', 1000.000, 200.000, '2026-10-01', NULL, '2026-10-01T08:00:00.000Z'),
    ('R02', 'Lô Cà chua Nguồn R02', 'Đã thu hoạch', 'ORG-A', 'FARM-ORG-A', 'PROD-TOMATO', 800.000, 300.000, '2026-10-01', NULL, '2026-10-01T08:30:00.000Z'),
    ('R03', 'Lô Cà chua Nguồn R03', 'Đã thu hoạch', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 500.000, 100.000, '2026-10-01', NULL, '2026-10-01T09:00:00.000Z'),
    ('R04', 'Lô Cà chua Sơ chế R04 (Tách từ R01)', 'Đang chế biến', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 400.000, 150.000, '2026-10-02', 'R01', '2026-10-02T08:00:00.000Z'),
    ('R05', 'Lô Cà chua Sơ chế R05 (Tách từ R01)', 'Đang chế biến', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 400.000, 100.000, '2026-10-02', 'R01', '2026-10-02T08:30:00.000Z'),
    ('R06', 'Lô Cà chua Sơ chế R06 (Tách từ R02)', 'Đang chế biến', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 500.000, 100.000, '2026-10-02', 'R02', '2026-10-02T09:00:00.000Z'),
    ('R07', 'Lô Cà chua Sơ chế R07 (Tách từ R03)', 'Đang chế biến', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 400.000, 150.000, '2026-10-02', 'R03', '2026-10-02T09:30:00.000Z'),
    ('R08', 'Lô Cà chua Đóng gói R08 (Gộp R04 + R06)', 'Đang chế biến', 'ORG-B', 'FARM-ORG-B', 'PROD-TOMATO', 500.000, 100.000, '2026-10-03', 'R04', '2026-10-03T08:00:00.000Z'),
    ('R09', 'Lô Cà chua Đóng hộp R09 (Tách từ R05)', 'Đã nhập kho', 'ORG-C', NULL, 'PROD-TOMATO', 300.000, 100.000, '2026-10-03', 'R05', '2026-10-03T08:30:00.000Z'),
    ('R10', 'Lô Nước ép Cà chua R10 (Gộp R06 + R07)', 'Đã nhập kho', 'ORG-C', NULL, 'PROD-TOMATO', 400.000, 100.000, '2026-10-03', 'R06', '2026-10-03T09:00:00.000Z'),
    ('R11', 'Lô Cà chua Siêu thị R11 (Tách từ R08)', 'Đã bán hết', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 0.000, '2026-10-04', 'R08', '2026-10-04T08:00:00.000Z'),
    ('R12', 'Lô Cà chua Siêu thị R12 (Tách từ R08)', 'Đang lưu kho', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 200.000, '2026-10-04', 'R08', '2026-10-04T08:30:00.000Z'),
    ('R13', 'Lô Cà chua Tiện lợi R13 (Tách từ R09)', 'Đang lưu kho', 'ORG-C', NULL, 'PROD-TOMATO', 200.000, 80.000, '2026-10-04', 'R09', '2026-10-04T09:00:00.000Z'),
    ('R14', 'Lô Nước ép Điểm bán R14 (Tách từ R10)', 'Đã bán hết', 'ORG-C', NULL, 'PROD-TOMATO', 300.000, 0.000, '2026-10-04', 'R10', '2026-10-04T09:30:00.000Z'),
    ('R15', 'Lô Cà chua Độc lập R15', 'Đã nhập kho', 'ORG-C', NULL, 'PROD-TOMATO', 100.000, 100.000, '2026-10-05', NULL, '2026-10-05T09:30:00.000Z')
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

-- 5. Quan hệ phân tách và sáp nhập (Batch Relations)
INSERT INTO batch_relations (
    id, parent_batch_id, child_batch_id, relation_type, quantity, organization_id, created_at
) VALUES
    ('rel-s39-01', 'R01', 'R04', 'SPLIT', 400.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-02', 'R01', 'R05', 'SPLIT', 400.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-03', 'R02', 'R06', 'SPLIT', 500.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-04', 'R03', 'R07', 'SPLIT', 400.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-05', 'R04', 'R08', 'MERGE', 250.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-06', 'R06', 'R08', 'MERGE', 250.000, 'ORG-B', CURRENT_TIMESTAMP),
    ('rel-s39-07', 'R05', 'R09', 'SPLIT', 300.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-08', 'R06', 'R10', 'MERGE', 150.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-09', 'R07', 'R10', 'MERGE', 250.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-10', 'R08', 'R11', 'SPLIT', 200.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-11', 'R08', 'R12', 'SPLIT', 200.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-12', 'R09', 'R13', 'SPLIT', 200.000, 'ORG-C', CURRENT_TIMESTAMP),
    ('rel-s39-13', 'R10', 'R14', 'SPLIT', 300.000, 'ORG-C', CURRENT_TIMESTAMP)
ON CONFLICT (parent_batch_id, child_batch_id) DO UPDATE SET
    relation_type = EXCLUDED.relation_type,
    quantity = EXCLUDED.quantity,
    organization_id = EXCLUDED.organization_id;

-- 6. Chuỗi sự kiện toàn vẹn mật mã SHA-256 (Batch Events)
INSERT INTO batch_events (
    id, batch_id, sequence_no, event_type, payload, organization_id,
    actor_user_id, occurred_at, previous_hash, event_hash
) VALUES
    ('evt-s39-r01-01', 'R01', 1, 'HARVEST_CREATED', '{"initialQuantity":1000,"farmId":"FARM-ORG-A","productId":"PROD-TOMATO"}'::jsonb, 'ORG-A', 'usr-s39-a', '2026-10-01T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'c60bfd02c60955e7a711280e84f6e440feaee89ee679b11e2f0a093d2db8ddb5'),
    ('evt-s39-r01-02', 'R01', 2, 'LOT_SPLIT', '{"childLotId":"R04","splitQuantity":400,"step":"Tách 400kg tạo lô R04"}'::jsonb, 'ORG-A', 'usr-s39-a', '2026-10-02T08:00:00.000Z', 'c60bfd02c60955e7a711280e84f6e440feaee89ee679b11e2f0a093d2db8ddb5', 'de1c7b943c1103d4b902cf17948312d03903d682c463edfe951de57da6e5f8ce'),
    ('evt-s39-r01-03', 'R01', 3, 'LOT_SPLIT', '{"childLotId":"R05","splitQuantity":400,"step":"Tách 400kg tạo lô R05"}'::jsonb, 'ORG-A', 'usr-s39-a', '2026-10-02T08:30:00.000Z', 'de1c7b943c1103d4b902cf17948312d03903d682c463edfe951de57da6e5f8ce', '777267045099d1f352b993be773e1a3d8a23aaaadfe7cbbdfcc6a14d69b26e8d'),
    ('evt-s39-r02-01', 'R02', 1, 'HARVEST_CREATED', '{"initialQuantity":800,"farmId":"FARM-ORG-A","productId":"PROD-TOMATO"}'::jsonb, 'ORG-A', 'usr-s39-a', '2026-10-01T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'e6c64da06eb731a3bbe1f18f3aef2ebc0a0c9c19805bd45103c7ce39521a3eba'),
    ('evt-s39-r02-02', 'R02', 2, 'LOT_SPLIT', '{"childLotId":"R06","splitQuantity":500,"step":"Tách 500kg tạo lô R06"}'::jsonb, 'ORG-A', 'usr-s39-a', '2026-10-02T09:00:00.000Z', 'e6c64da06eb731a3bbe1f18f3aef2ebc0a0c9c19805bd45103c7ce39521a3eba', '3bf18792ed1547f3255fe39e489b88b908b7d30e486cc8475eb45b2da3238587'),
    ('evt-s39-r03-01', 'R03', 1, 'HARVEST_CREATED', '{"initialQuantity":500,"farmId":"FARM-ORG-B","productId":"PROD-TOMATO"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-01T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'f41f5a25ae33dd42810a0c5f92c9c58394688ec4af91788fe6ab7d16c9e9036b'),
    ('evt-s39-r03-02', 'R03', 2, 'LOT_SPLIT', '{"childLotId":"R07","splitQuantity":400,"step":"Tách 400kg tạo lô R07"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-02T09:30:00.000Z', 'f41f5a25ae33dd42810a0c5f92c9c58394688ec4af91788fe6ab7d16c9e9036b', '51cc3368cf6f3a1e706aebd57336087c798b5284d502aa7e24fa92851c74e5b6'),
    ('evt-s39-r04-01', 'R04', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R01","initialQuantity":400,"step":"Khởi tạo từ tách lô R01"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-02T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '86b2547dd84cffc4fe7d6b78a0e62ef3b6c52b12b1dfa8e56390459f78a0a980'),
    ('evt-s39-r04-02', 'R04', 2, 'LOT_MERGED_FROM', '{"targetLotId":"R08","takeQuantity":250,"step":"Gộp 250kg vào lô R08"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T08:00:00.000Z', '86b2547dd84cffc4fe7d6b78a0e62ef3b6c52b12b1dfa8e56390459f78a0a980', 'aa22a1b26bb2c3924cd030aacd45507be6dbdd85e668a9abccd77502a9567b6a'),
    ('evt-s39-r05-01', 'R05', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R01","initialQuantity":400,"step":"Khởi tạo từ tách lô R01"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-02T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'cb33855aa8f318ef20b2c87435616214bd090364350c805c73057de9d97d6149'),
    ('evt-s39-r05-02', 'R05', 2, 'LOT_SPLIT', '{"childLotId":"R09","splitQuantity":300,"step":"Tách 300kg tạo lô R09"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T08:30:00.000Z', 'cb33855aa8f318ef20b2c87435616214bd090364350c805c73057de9d97d6149', '07b676a70d3f2cb1c3f620e53b525b4f9c2d2d60ec159c82e604afb3d729fbdb'),
    ('evt-s39-r06-01', 'R06', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R02","initialQuantity":500,"step":"Khởi tạo từ tách lô R02"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-02T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '2855163113b9f4dde966f2d6425b1ef986239a9e308cd383e38ee9326df8f703'),
    ('evt-s39-r06-02', 'R06', 2, 'LOT_MERGED_FROM', '{"targetLotId":"R08","takeQuantity":250,"step":"Gộp 250kg vào lô R08"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T08:00:00.000Z', '2855163113b9f4dde966f2d6425b1ef986239a9e308cd383e38ee9326df8f703', 'b8b34e2a3c98dbdc42396daadb70ea48ead8d2a7b4dc477ab3855d4393cb3a9c'),
    ('evt-s39-r06-03', 'R06', 3, 'LOT_MERGED_FROM', '{"targetLotId":"R10","takeQuantity":150,"step":"Gộp 150kg vào lô R10"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T09:00:00.000Z', 'b8b34e2a3c98dbdc42396daadb70ea48ead8d2a7b4dc477ab3855d4393cb3a9c', 'e5b4504485306f38155f7c9149d5c7d22401012f59c79d11fa6e654c106837ad'),
    ('evt-s39-r07-01', 'R07', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R03","initialQuantity":400,"step":"Khởi tạo từ tách lô R03"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-02T09:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '2f389b8435654cf0d8ac60a79823c81d6e6141f762cb0928f0c30bff56bd916a'),
    ('evt-s39-r07-02', 'R07', 2, 'LOT_MERGED_FROM', '{"targetLotId":"R10","takeQuantity":250,"step":"Gộp 250kg vào lô R10"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T09:00:00.000Z', '2f389b8435654cf0d8ac60a79823c81d6e6141f762cb0928f0c30bff56bd916a', '7606bdfffc114dfcfada39886a4b042f63b15006a95de8edba047a9f67043053'),
    ('evt-s39-r08-01', 'R08', 1, 'CREATED_FROM_MERGE', '{"totalQuantity":500,"parentLots":[{"parentBatchId":"R04","quantity":250},{"parentBatchId":"R06","quantity":250}],"step":"Gộp từ R04 và R06"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-03T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '07448fdd4f54b2da030d618d677d4520b209f74f447a58155a38aa16e16a5b50'),
    ('evt-s39-r08-02', 'R08', 2, 'LOT_SPLIT', '{"childLotId":"R11","splitQuantity":200,"step":"Tách 200kg tạo lô R11"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-04T08:00:00.000Z', '07448fdd4f54b2da030d618d677d4520b209f74f447a58155a38aa16e16a5b50', '3e3fcf42fe106363aabbd07dd8b147b3ec151af5ffb76e1f3a8ab46cc5f8e227'),
    ('evt-s39-r08-03', 'R08', 3, 'LOT_SPLIT', '{"childLotId":"R12","splitQuantity":200,"step":"Tách 200kg tạo lô R12"}'::jsonb, 'ORG-B', 'usr-s39-b', '2026-10-04T08:30:00.000Z', '3e3fcf42fe106363aabbd07dd8b147b3ec151af5ffb76e1f3a8ab46cc5f8e227', '61880aa0c887aec085050406645d3ff951a37d6b309ece9a9f43c280428f480c'),
    ('evt-s39-r09-01', 'R09', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R05","initialQuantity":300,"step":"Khởi tạo từ tách lô R05"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-03T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'cd12a0d52aebcda286a680992625d6a9673fdcc59adfb521b3619fe8c03eb326'),
    ('evt-s39-r09-02', 'R09', 2, 'LOT_SPLIT', '{"childLotId":"R13","splitQuantity":200,"step":"Tách 200kg tạo lô R13"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T09:00:00.000Z', 'cd12a0d52aebcda286a680992625d6a9673fdcc59adfb521b3619fe8c03eb326', '920dbf0d2bae487e91ecf09f63970a58e7c2e146468e20d9764aa88f5ec98d83'),
    ('evt-s39-r10-01', 'R10', 1, 'CREATED_FROM_MERGE', '{"totalQuantity":400,"parentLots":[{"parentBatchId":"R06","quantity":150},{"parentBatchId":"R07","quantity":250}],"step":"Gộp từ R06 và R07"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-03T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'b0df3cdaa81f42baa78f7f8304d4b376fedabbd2fc9cb2a0640a28d501285434'),
    ('evt-s39-r10-02', 'R10', 2, 'LOT_SPLIT', '{"childLotId":"R14","splitQuantity":300,"step":"Tách 300kg tạo lô R14"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T09:30:00.000Z', 'b0df3cdaa81f42baa78f7f8304d4b376fedabbd2fc9cb2a0640a28d501285434', '236dda6cf301629d9c9a3a4e4f1a31880840beef9dc699d3ff5c983203fc9b88'),
    ('evt-s39-r11-01', 'R11', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R08","initialQuantity":200,"step":"Khởi tạo từ tách lô R08"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T08:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '7f6829850d597ad6da2c7286ef598e457a96ae517b8190f7fcb5153174655ac0'),
    ('evt-s39-r11-02', 'R11', 2, 'LOT_CONSUMED', '{"previousStatus":"Đã nhập kho","consumedQuantity":200,"notes":"Đã phân phối hết tại siêu thị A tới tay người tiêu dùng"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-05T08:00:00.000Z', '7f6829850d597ad6da2c7286ef598e457a96ae517b8190f7fcb5153174655ac0', '0673635bb1519f85648ab62d427698e8b99b86132607cf25965bdea03993d900'),
    ('evt-s39-r12-01', 'R12', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R08","initialQuantity":200,"step":"Khởi tạo từ tách lô R08"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T08:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'c1315a475ec1976aa47864cefe8bebd1b92759735e5850eb4e892f6056687316'),
    ('evt-s39-r13-01', 'R13', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R09","initialQuantity":200,"step":"Khởi tạo từ tách lô R09"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T09:00:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', 'feef19f1c4eb8f8b488fed0fdde22c6d6913ad9e527104a6c0657fab225b6b2d'),
    ('evt-s39-r14-01', 'R14', 1, 'CREATED_FROM_SPLIT', '{"parentLotId":"R10","initialQuantity":300,"step":"Khởi tạo từ tách lô R10"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-04T09:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '59a7efa5ecb60f1279b83cbfedb6926dc392c2f1f5f37ad4afaeffac176f93cc'),
    ('evt-s39-r14-02', 'R14', 2, 'LOT_CONSUMED', '{"previousStatus":"Đã nhập kho","consumedQuantity":300,"notes":"Đã bán hết tại quầy nước giải khát D"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-05T09:00:00.000Z', '59a7efa5ecb60f1279b83cbfedb6926dc392c2f1f5f37ad4afaeffac176f93cc', 'c313e457fcf9ebc10da8100847efa2dabeab1a7fa5cdd5edb26e004008a55c33'),
    ('evt-s39-r15-01', 'R15', 1, 'HARVEST_CREATED', '{"initialQuantity":100,"productId":"PROD-TOMATO"}'::jsonb, 'ORG-C', 'usr-s39-c', '2026-10-05T09:30:00.000Z', '0000000000000000000000000000000000000000000000000000000000000000', '4c7b1ac258ffe37264fa3119ca8ba05a08b9562bd207085a3b8d360cc92d679e')
ON CONFLICT (batch_id, sequence_no) DO UPDATE SET
    event_type = EXCLUDED.event_type,
    payload = EXCLUDED.payload,
    organization_id = EXCLUDED.organization_id,
    actor_user_id = EXCLUDED.actor_user_id,
    occurred_at = EXCLUDED.occurred_at,
    previous_hash = EXCLUDED.previous_hash,
    event_hash = EXCLUDED.event_hash;
