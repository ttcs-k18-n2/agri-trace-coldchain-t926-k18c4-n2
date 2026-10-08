-- Migration 018: Đảm bảo quyền DML cho tài khoản ứng dụng agri_app trên tất cả các bảng
-- Giải quyết triệt để vấn đề cơ sở dữ liệu cũ đã đánh dấu hoàn tất migrations 013 và 017 nhưng chưa nhận được quyền mới.
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        -- 1. Cấp quyền truy cập schema public
        GRANT USAGE ON SCHEMA public TO agri_app;

        -- 2. Cấp quyền DML trên bảng lot_transfers (Migration 013)
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lot_transfers') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON lot_transfers TO agri_app;
        END IF;

        -- 3. Cấp quyền DML trên bảng batch_relations (Migration 017)
        IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'batch_relations') THEN
            GRANT SELECT, INSERT, UPDATE, DELETE ON batch_relations TO agri_app;
        END IF;

        -- 4. Cấp quyền DML cho tất cả các bảng nghiệp vụ khác trong schema public
        GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agri_app;
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agri_app;

        -- 5. Bảo vệ tuyệt đối nguyên tắc Append-Only của sổ cái batch_events (K-01 / S-11)
        -- Thu hồi quyền sửa/xóa/truncate, chỉ cho phép SELECT và INSERT
        REVOKE UPDATE, DELETE, TRUNCATE ON batch_events FROM agri_app;
        GRANT SELECT, INSERT ON batch_events TO agri_app;

        -- 6. Thiết lập quyền mặc định cho các bảng và chuỗi tạo mới trong tương lai
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agri_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agri_app;
    END IF;
END $$;
