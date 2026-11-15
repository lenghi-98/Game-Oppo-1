# OPPO Camera Arena · TAP BATTLE (MVP)

Bản triển khai MVP cho Game 1 TAP BATTLE, gồm Trainer Control Panel, màn hình lớn và giao diện PG trên điện thoại. Ứng dụng dùng Node.js thuần, không cần cài thư viện bên ngoài.

## Chạy thử trên máy tính

Yêu cầu Node.js 18 trở lên.

```bash
npm start
```

Mở `http://localhost:3000` để tạo phòng. Khi thử nhiều vai trò trên cùng máy, mở thêm các tab:

- Trainer: tạo phòng mới, điều khiển game.
- Màn hình lớn: mở nút **MỞ MÀN HÌNH LỚN** trong Trainer.
- PG: quét QR hoặc nhập mã phòng tại trang chủ.

Để điện thoại khác truy cập trong cùng mạng Wi-Fi, mở ứng dụng bằng địa chỉ LAN của máy chạy server, ví dụ `http://192.168.1.10:3000`. Máy tính và điện thoại phải cùng mạng.

## Đưa lên internet

Triển khai thư mục này lên một dịch vụ hosting hỗ trợ Node.js và WebSocket. Lệnh chạy là `npm start`; cổng lấy từ biến môi trường `PORT`. Khi dùng hosting công khai, bắt buộc bật HTTPS/WSS và chỉ chia sẻ link/mã phòng cho người tham gia.

## Luật TAP BATTLE được lập trình trong MVP

- Số đội linh hoạt, tạo từ 2 đội trở lên; chỉ các đội có PG đăng ký mới tham gia lượt tap.
- PG đăng ký tên và chọn đội.
- Tất cả PG trong đội đều nằm trong mẫu số tính trung bình, kể cả người không tap.
- Vòng đầu 10 giây; đội có trung bình lượt tap cao nhất thắng.
- Nếu hòa: các đội đồng hạng tap thêm 5 giây. Nếu vẫn hòa, chuyển sang TAP RACE TO 100; đội đầu tiên đạt 100 lượt tap trong nhóm đang hòa thắng.
- Đội thắng trả lời miệng. Màn hình lớn chỉ hiển thị câu hỏi, không hiện lựa chọn.
- Trainer đọc các lựa chọn, công bố đáp án trước, sau đó chấm Đúng/Sai.
- Đúng: đội +100; đội trưởng +100 điểm cá nhân. Sai: +0.
- Bảng xếp hạng cập nhật sau mỗi câu. Màn hình lớn hiển thị Top 10 cá nhân; Trainer thấy toàn bộ danh sách.

## Lưu ý bản MVP

- Dữ liệu phòng được lưu vào `data.json` trên máy chủ; cần giữ file này khi deploy và sao lưu định kỳ.
- QR tham gia hiện dùng dịch vụ tạo QR từ xa, nên trình duyệt cần có internet để tải hình QR. Link và mã phòng vẫn có thể chia sẻ thủ công.
- PG vào trong lúc một lượt đang diễn ra được xếp chờ và chỉ được tính vào đội từ câu tiếp theo.
- Đây là MVP để kiểm thử luồng chơi. Trước khi dùng trong sự kiện đông người cần kiểm thử tải đồng thời, bổ sung bảo vệ quản trị, sao lưu/khôi phục, và triển khai trên hosting ổn định có HTTPS.
- Ngân hàng câu hỏi ban đầu để trống, Trainer nhập câu hỏi, 4 lựa chọn, đáp án và giải thích trong Control Panel. Không tự tạo dữ kiện sản phẩm chưa được xác minh.
