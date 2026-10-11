const { logSecurityEvent } = require('./security_logger');

function auditMiddleware(req, res, next) {
    // Lắng nghe sự kiện khi request trả về kết quả (finish)
    res.on('finish', () => {
        const url = req.originalUrl || req.url;
        const method = req.method;

        let event = null;
        let resourceType = null;
        let resourceId = null;

        // 1. Bắt sự kiện ĐĂNG NHẬP
        if (url.includes('/login') && method === 'POST') {
            event = res.statusCode >= 200 && res.statusCode < 300 ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED';
            resourceType = 'Authentication';
        }
        // 2. Bắt sự kiện THAY ĐỔI LÔ HÀNG (Thêm, Sửa, Xóa)
        else if (url.includes('/lots') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
            event = 'LOT_MODIFICATION';
            resourceType = 'Lot';
            // Trích xuất ID lô hàng từ URL nếu có (ví dụ: /api/lots/123 -> 123)
            const parts = url.split('/');
            resourceId = parts[parts.length - 1] !== 'lots' ? parts[parts.length - 1] : null;
        }

        // Nếu là các sự kiện cần theo dõi thì tiến hành lưu log
        if (event) {
            // Lấy IP của người dùng
            const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;

            // Lấy thông tin user (thường được gán vào req.user sau khi verify token, hoặc nằm trong req.body khi login)
            const userId = req.user?.id || (req.body && (req.body.email || req.body.username)) || 'anonymous';
            const userOrgId = req.user?.orgId || null;

            logSecurityEvent(event, {
                userId,
                userOrgId,
                ip,
                action: method,
                resourceType,
                resourceId,
                message: `[HTTP ${res.statusCode}] API ${method} ${url}`
            });
        }
    });

    next();
}

module.exports = auditMiddleware;