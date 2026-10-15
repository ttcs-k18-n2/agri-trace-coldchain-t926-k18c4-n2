-- Migration 023: Danh mục tọa độ đại diện cấp khu vực/xã phục vụ bản đồ công khai (Story S-60)
-- Tuyệt đối không dùng tọa độ thửa gốc để bảo vệ quyền riêng tư nông hộ (S-06 / N2-290).

CREATE TABLE IF NOT EXISTS public_map_areas (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    admin_level VARCHAR(50) NOT NULL DEFAULT 'commune', -- 'commune', 'district', 'province', 'industrial_zone'
    commune VARCHAR(100),
    district VARCHAR(100),
    province VARCHAR(100),
    latitude NUMERIC(9, 6) NOT NULL,
    longitude NUMERIC(9, 6) NOT NULL,
    keywords TEXT, -- Từ khóa nhận diện tương ứng với tên thửa hoặc địa chỉ
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_public_map_areas_keywords ON public_map_areas(keywords);

-- Nạp các vùng canh tác và phân phối đại diện
INSERT INTO public_map_areas (id, name, admin_level, commune, district, province, latitude, longitude, keywords, description)
VALUES
    ('AREA-LA-BANG', 'Vùng chè an toàn La Bằng', 'commune', 'La Bằng', 'Đại Từ', 'Thái Nguyên', 21.5580, 105.6720, 'la bằng, la bang, labang, đại từ, daitu', 'Tâm hành chính xã La Bằng, vùng chỉ dẫn địa lý chè Đại Từ'),
    ('AREA-HUNG-SON', 'Vùng trồng nông sản an toàn Hùng Sơn', 'commune', 'Hùng Sơn', 'Đại Từ', 'Thái Nguyên', 21.5750, 105.6905, 'hùng sơn, hung son, hungson, đại từ, daitu', 'Khu vực trung tâm thị trấn Hùng Sơn'),
    ('AREA-TAN-CUONG', 'Vùng chỉ dẫn địa lý Tân Cương', 'commune', 'Tân Cương', 'TP Thái Nguyên', 'Thái Nguyên', 21.5450, 105.7720, 'tân cương, tan cuong, tancuong, thái nguyên, thai nguyen', 'Vùng đặc sản Tân Cương Thái Nguyên'),
    ('AREA-YEN-DUNG', 'Vùng chuyên canh nông sản Yên Dũng', 'district', 'Nham Biền', 'Yên Dũng', 'Bắc Giang', 21.2290, 106.1820, 'yên dũng, yen dung, nham biền, nham bien, yendung', 'Khu vực trung tâm huyện Yên Dũng'),
    ('AREA-HIEP-HOA', 'Vùng trồng nông sản Hiệp Hòa', 'district', 'Hiệp Hòa', 'Hiệp Hòa', 'Bắc Giang', 21.3415, 105.9810, 'hiệp hòa, hiep hoa, hiephoa', 'Vùng trồng nông sản Hiệp Hòa'),
    ('AREA-DAI-TU', 'Khu vực sản xuất nông nghiệp Đại Từ', 'district', 'Đại Từ', 'Đại Từ', 'Thái Nguyên', 21.6300, 105.6400, 'đại từ, dai tu, thái nguyên, thai nguyen, daitu', 'Khu vực huyện Đại Từ'),
    ('AREA-LONG-BIEN', 'Cụm logistics phân phối Long Biên', 'district', 'Phúc Đồng', 'Long Biên', 'Hà Nội', 21.0356, 105.9012, 'long biên, long bien, kcn đài tư, dai tu, longbien', 'Trung tâm logistics và kho lạnh tiêu chuẩn'),
    ('AREA-CAU-GIAY', 'Khu vực phân phối Cầu Giấy', 'district', 'Dịch Vọng', 'Cầu Giấy', 'Hà Nội', 21.0333, 105.7989, 'cầu giấy, cau giay, caugiay, dịch vọng, dich vong', 'Trung tâm bán lẻ và phân phối tiêu dùng'),
    ('AREA-THANH-XUAN', 'Khu vực phân phối Thanh Xuân', 'district', 'Thanh Xuân Trung', 'Thanh Xuân', 'Hà Nội', 20.9981, 105.8152, 'nguyễn trãi, nguyen trai, thanh xuân, thanh xuan, thanhxuan', 'Điểm phân phối và chuỗi cửa hàng tiện ích')
ON CONFLICT (id) DO NOTHING;

-- Cấp quyền SELECT cho agri_app
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agri_app') THEN
        GRANT SELECT ON public_map_areas TO agri_app;
    END IF;
END $$;

-- Cập nhật tọa độ chuẩn hóa cho các điểm kho bãi & phân phối mẫu phục vụ bản đồ công khai (S-30 / S-60)
UPDATE locations SET coordinates = '{"lat": 21.5830, "lng": 105.8250}'::jsonb WHERE id = 'LOC-WH-TN-01' AND (coordinates IS NULL OR coordinates = '{"lat": 21.5645, "lng": 105.6789}'::jsonb);
UPDATE locations SET coordinates = '{"lat": 21.2780, "lng": 106.2050}'::jsonb WHERE id = 'LOC-WH-BG-01' AND (coordinates IS NULL OR coordinates = '{"lat": 21.2341, "lng": 106.1892}'::jsonb);
UPDATE locations SET coordinates = '{"lat": 21.0356, "lng": 105.9012}'::jsonb WHERE id = 'LOC-HUB-HN-01' AND coordinates IS NULL;
UPDATE locations SET coordinates = '{"lat": 21.0333, "lng": 105.7989}'::jsonb WHERE id = 'LOC-STORE-HN-01' AND coordinates IS NULL;
UPDATE locations SET coordinates = '{"lat": 20.9981, "lng": 105.8152}'::jsonb WHERE id = 'LOC-STORE-HN-02' AND coordinates IS NULL;
