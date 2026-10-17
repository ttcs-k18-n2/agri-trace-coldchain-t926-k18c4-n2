-- Migration 030: Hourly Aggregation for Cold Chain Temperature Telemetry (Story S-51 / Jira N2-114 / Subtask N2-303)
-- 1. Bảng lưu trữ giá trị tổng hợp nhiệt độ theo giờ (min, max, avg, sample_count, has_violation)
-- 2. Bảng nhật ký ghi log các đợt thực thi job tổng hợp ban đêm (temperature_aggregation_jobs)
-- 3. Khóa duy nhất (shipment_id, cold_box_id, bucket_hour) chống trùng lặp khi chạy lại (Idempotency)

CREATE TABLE IF NOT EXISTS shipment_temperature_hourly_aggregates (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('thour-' || substr(md5(random()::text), 1, 10)),
    shipment_id VARCHAR(50) NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    cold_box_id VARCHAR(50) NOT NULL,
    bucket_hour TIMESTAMPTZ NOT NULL,
    min_temperature NUMERIC(5, 2) NOT NULL,
    max_temperature NUMERIC(5, 2) NOT NULL,
    avg_temperature NUMERIC(5, 2) NOT NULL,
    sample_count INT NOT NULL DEFAULT 1,
    has_violation BOOLEAN NOT NULL DEFAULT FALSE,
    raw_retained BOOLEAN NOT NULL DEFAULT TRUE,
    aggregated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shipment_hourly_agg UNIQUE (shipment_id, cold_box_id, bucket_hour)
);

-- Các chỉ mục phục vụ truy vấn lịch sử nhanh theo chuyến, thùng lạnh và khung giờ
CREATE INDEX IF NOT EXISTS idx_temp_hourly_shipment ON shipment_temperature_hourly_aggregates(shipment_id);
CREATE INDEX IF NOT EXISTS idx_temp_hourly_cold_box ON shipment_temperature_hourly_aggregates(cold_box_id);
CREATE INDEX IF NOT EXISTS idx_temp_hourly_bucket ON shipment_temperature_hourly_aggregates(bucket_hour DESC);
CREATE INDEX IF NOT EXISTS idx_temp_hourly_violation ON shipment_temperature_hourly_aggregates(has_violation);

-- Bảng lưu nhật ký thực thi job nén / tổng hợp dữ liệu ban đêm
CREATE TABLE IF NOT EXISTS temperature_aggregation_jobs (
    id VARCHAR(50) PRIMARY KEY DEFAULT ('job-' || substr(md5(random()::text), 1, 8)),
    job_type VARCHAR(50) NOT NULL DEFAULT 'HOURLY_TEMPERATURE_COMPRESSION',
    cutoff_time TIMESTAMPTZ NOT NULL,
    raw_rows_scanned INT NOT NULL DEFAULT 0,
    aggregated_rows_count INT NOT NULL DEFAULT 0,
    retained_violation_rows_count INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    error_message TEXT,
    details JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_temp_agg_jobs_started ON temperature_aggregation_jobs(started_at DESC);

-- Cấp quyền DML cho agri_app nếu tồn tại
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON shipment_temperature_hourly_aggregates TO agri_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON temperature_aggregation_jobs TO agri_app;
    END IF;
END $$;
