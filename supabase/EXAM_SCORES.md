# Thiết lập điểm thi

Giao diện: `admin.html#admin-scores` và `achievements.html?type=scores`.

## Kích hoạt trên Supabase

1. Mở SQL Editor của dự án Supabase đang được website sử dụng.
2. Kiểm tra hàm `public.current_user_is_admin()` hiện có, rồi chạy file `migrations/20260907144035_exam_scores.sql` một lần.
3. Đăng nhập admin bằng tài khoản quản trị hiện có, mở tab **Điểm thi** và làm mới.
4. Nhập điểm thật. Chỉ bản ghi bật **Công bố điểm trong thống kê** xuất hiện trong biểu đồ công khai.

Migration này chưa được thực thi trên cơ sở dữ liệu production. Đẩy code lên GitHub Pages không tự chạy SQL. Không đưa mật khẩu cơ sở dữ liệu hoặc khóa `service_role` vào website.

## Dữ liệu và thống kê

- Mỗi bản ghi là một bài thi môn Toán, không phải một học sinh duy nhất. Điểm giống nhau được phép vì nhiều bài có thể cùng điểm.
- Bốn kỳ theo thứ tự: GK1, CK1, GK2, CK2. Điểm từ 0 đến 10, tối đa hai chữ số thập phân. Ô nhập chấp nhận `8,5` và `8.5`.
- Lưu khối, lớp/khóa học, năm học và trạng thái công bố. Không có trường họ tên, email hoặc dữ liệu cá nhân học sinh.
- Biểu đồ cột đếm bài trong các khoảng `[0,1)`, ..., `[8,9)`, `[9,10]`; biểu đồ tròn đếm bốn nhóm `<5`, `[5,6.5)`, `[6.5,8)`, `[8,10]`.
- Biểu đồ đoạn thẳng là điểm trung bình theo kỳ; kỳ chưa có bài được để trống, không thay bằng 0. Tất cả biểu đồ dùng cùng bộ lọc.
- Khách chỉ đọc các điểm đã công bố. Chỉ quản trị viên theo hàm phân quyền hiện có được thêm, sửa, ẩn hoặc xóa. RLS và quyền bảng đều được khai báo trong migration.

## Kiểm thử

Chạy kiểm thử tính toán với Node.js:

```sh
node --test tests/exam-scores.test.cjs
```

Hai bộ kiểm thử bổ sung dùng `playwright` và `@electric-sql/pglite@0.5.8` từ môi trường phát triển, không phải phụ thuộc của website:

```sh
node --test tests/exam-scores-rls.test.cjs
node tests/exam-scores.browser.cjs
```

Có thể đặt `PGLITE_MODULE` / `PLAYWRIGHT_MODULE` thành đường dẫn module tuyệt đối. Kiểm thử trình duyệt mặc định dùng Edge và server `http://127.0.0.1:4174`; có thể thay bằng `TEST_BROWSER_CHANNEL` / `TEST_BASE_URL`. Ảnh kiểm thử lưu tại thư mục tạm hoặc `TEST_OUTPUT_DIR`.

Kiểm thử trình duyệt chặn mọi request Supabase và dùng dữ liệu giả lập, không ghi production. Kiểm thử RLS chạy PostgreSQL trong bộ nhớ, với hai kết quả giả lập của hàm xác thực quản trị. Nó kiểm tra policy và ràng buộc mới, không thay cho việc kiểm tra hàm phân quyền hoặc Security Advisor của dự án production sau khi kích hoạt.
