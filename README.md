# LMS_Ques

Web mô phỏng LMS để làm bài trắc nghiệm, lấy câu hỏi từ Google Sheet.

- **Luyện tập từng câu:** câu hỏi ngẫu nhiên, hiện đáp án ngay sau khi chọn. Kết quả phiên được lưu vào trang `Log_Practice` khi bấm "Hoàn tất bài kiểm tra", khi làm hết bank, hoặc khi đóng tab.
- **Làm đề 40 câu:** 40 câu xáo trộn, có đồng hồ (mặc định 60 phút, chọn được ở trang chủ). Bài được chấm ở server, lưu vào trang `Log_Exam`, sau đó user xem lại từng câu.

## Cấu trúc

```
index.html          giao diện (4 màn hình: trang chủ, luyện tập, làm đề, kết quả)
style.css
js/config.js        URL của Apps Script
js/common.js        hàm dùng chung + gọi API + hiển thị câu hỏi
js/practice.js      luồng luyện tập
js/exam.js          luồng làm đề
js/app.js           trang chủ, gắn sự kiện
apps-script/Code.gs backend (dán vào Apps Script của Google Sheet)
```

## Cài đặt

### 1. Google Sheet
Trang question bank cần có các cột tiêu đề: `STT`, `Câu hỏi`, `Phương án A`, `Phương án B`, `Phương án C`, `Phương án D`, `Đáp án đúng` (giá trị A/B/C/D). Thứ tự cột và các cột khác (Ghi chú...) không ảnh hưởng.

Mỗi câu hỏi được nhận diện bằng **STT**, nên STT không được trùng. Dòng nào trống STT sẽ bị bỏ qua. Nếu 2 dòng trùng STT thì chỉ lấy dòng đầu tiên.

Hai trang `Log_Exam` và `Log_Practice` sẽ được tự tạo khi có người nộp bài đầu tiên.

Nên đặt múi giờ cho Sheet: **Tệp > Cài đặt > Múi giờ > (GMT+07:00) Bangkok/Hà Nội**.

### 2. Apps Script
1. Trong Google Sheet: **Tiện ích mở rộng > Apps Script**.
2. Xóa code mặc định, dán toàn bộ nội dung `apps-script/Code.gs`, lưu lại.
3. **Deploy > New deployment > Select type: Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Cấp quyền khi được hỏi, rồi copy **Web app URL** (đuôi `/exec`).
5. Kiểm tra: mở `<URL>?action=exam` trên trình duyệt, nếu thấy JSON chứa câu hỏi là chạy được.

Mỗi lần sửa `Code.gs`: **Deploy > Manage deployments > Edit > Version: New version > Deploy** (giữ nguyên URL).

### 3. Web
1. Dán URL vào `js/config.js`:
   ```js
   const API_URL = 'https://script.google.com/macros/s/xxxx/exec';
   ```
2. Chạy thử: mở `index.html` bằng trình duyệt (hoặc dùng Live Server của VS Code).
3. Đưa lên mạng bằng Vercel: push code lên GitHub, vào vercel.com > **Add New > Project** > chọn repo > Framework Preset: **Other**, để trống Build Command > **Deploy**. Mỗi lần push lên `main`, Vercel tự deploy lại. File trong `.vercelignore` (Apps Script, script, README) không được đưa lên web.

## Nhạc khi làm bài

Nhạc phát bằng trình phát YouTube ẩn. Ảnh bìa tự tải từ iTunes.

1. Sửa `music/songs.txt`, mỗi dòng: `Ca sĩ - Tên bài | link YouTube`
2. Chạy `node scripts/fetch-covers.mjs`. Script tải bìa vào `music/covers/` và tạo lại `music/playlist.js`. Bìa sai thì thay file ảnh bằng tay, giữ nguyên tên.
3. Nên dùng link bản audio ("Provided to YouTube by..." hoặc kênh "... - Topic"). MV chính thức hay bị chặn nhúng. Kiểm tra nhanh bằng cách mở `https://www.youtube.com/embed/<ID>`.

**Chạy thử trên máy:** YouTube không phát khi mở `index.html` trực tiếp (lỗi 153). Chạy `node scripts/serve.mjs` rồi mở http://localhost:5500 (hoặc dùng Live Server).

## Lưu ý
- Đáp án của đề 40 câu không được gửi xuống trình duyệt, nên user không xem trộm được bằng DevTools. Riêng chế độ luyện tập thì có gửi đáp án, vì cần hiện ngay sau khi chọn.
- Trên điện thoại, nếu user tắt hẳn trình duyệt khi đang luyện tập thì phiên đó có thể không được lưu.
