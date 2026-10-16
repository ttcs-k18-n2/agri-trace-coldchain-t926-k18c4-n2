const http = require('http');

// 1. Dữ liệu giả lập để test API S-36 (Tạo xác nhận)
// LƯU Ý: Đổi số '1' ở đường dẫn thành một recall_id có thật trong database của bạn
const recallId = 1;

const postData = JSON.stringify({
    org_name: "Siêu thị Co.opmart",
    status: "Action Taken",
    note: "Đã gỡ toàn bộ sản phẩm khỏi kệ theo yêu cầu."
});

const postOptions = {
    hostname: 'localhost',
    port: 3000, // Thay 3000 bằng cổng backend của bạn nếu khác
    path: `/api/recalls/${recallId}/acknowledgments`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log(`\n--- ĐANG TEST S-36: TẠO XÁC NHẬN CHO RECALL_ID = ${recallId} ---`);
const reqPost = http.request(postOptions, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(`Trạng thái (POST): ${res.statusCode}`);
        console.log(`Kết quả trả về: ${data}`);

        // 2. Chạy tiếp test lấy tiến độ (S-37) sau khi tạo thành công
        testProgressAPI();
    });
});

reqPost.on('error', (e) => { console.error(`Lỗi (POST): ${e.message}`); });
reqPost.write(postData);
reqPost.end();

// Hàm test API S-37 (Lấy tiến độ)
function testProgressAPI() {
    console.log(`\n--- ĐANG TEST S-37: LẤY TIẾN ĐỘ CHO RECALL_ID = ${recallId} ---`);
    const getOptions = {
        hostname: 'localhost',
        port: 3000, // Thay 3000 bằng cổng backend của bạn nếu khác
        path: `/api/recalls/${recallId}/progress`,
        method: 'GET'
    };

    const reqGet = http.request(getOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log(`Trạng thái (GET): ${res.statusCode}`);
            console.log(`Kết quả trả về: ${data}\n`);
        });
    });

    reqGet.on('error', (e) => { console.error(`Lỗi (GET): ${e.message}`); });
    reqGet.end();
}