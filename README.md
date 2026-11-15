# OPPO Camera Arena MVP

## Chạy thử
1. Cài Node.js 18 trở lên.
2. Chạy `npm install`
3. Chạy `npm start`
4. Mở `/trainer`, `/display` và `/join`.

## Railway
Deploy repository này dưới dạng Node.js service. Start command: `npm start`.
Nên gắn Railway Volume tại `/app/data` và đặt `DATA_DIR=/app/data` để lưu dữ liệu phòng bền vững.

Đây là bản MVP khởi tạo để kiểm thử luồng cơ bản, chưa phải bản production. Cần hoàn thiện QR, giao diện đếm giờ/hiệu ứng, bảng xếp hạng cá nhân, ngân hàng câu hỏi và kiểm thử nhiều thiết bị trước khi dùng sự kiện.
