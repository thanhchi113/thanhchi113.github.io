# Điểm thi, đóng góp và tài khoản admin

Các trang chính: `admin.html#admin-scores`, `achievements.html?type=scores`, biểu mẫu học sinh gửi điểm tại `index.html#scoreSubmission`, và `admin.html#admin-account`.

## Trạng thái triển khai

Đã kích hoạt trên Supabase production: bảng điểm, tên/ảnh minh chứng, hai kho ảnh riêng tư, hộp thư học sinh gửi điểm và các hàm quản lý tài khoản admin. Lỗi thiếu bảng `exam_scores` khiến biểu mẫu nhập điểm bị khóa đã được xử lý ở cơ sở dữ liệu.

Đã kích hoạt `20260908082007_exam_score_name_privacy.sql` trên production: API điểm công khai phản hồi 200, truy cập bảng điểm gốc bằng khóa khách bị từ chối (401).

Đã kích hoạt và kiểm tra cài đặt bật/tắt thống kê trên production.

Đã lưu và kiểm tra URL phục hồi mật khẩu trong Supabase Auth: `https://thanhchi113.github.io/reset-password.html`.

Đã tạo năm bản ghi **Học sinh mẫu 1** đến **Học sinh mẫu 5**, lần lượt đạt **4,5; 6; 7,25; 8,5; 9,5**, khối 12, lớp **NHÁP - Xem thử**, GK1, năm học **2026-2027**. Ban đầu các bản ghi có `published=false`; lựa chọn hiển thị và chỉnh sửa sau đó trong admin được giữ nguyên. Không chạy lại thao tác thêm mẫu để tránh tạo bản ghi trùng.

## Thiết lập cho môi trường mới

Xác nhận đúng dự án Supabase và hàm phân quyền `public.current_user_is_admin()` hiện có, rồi chạy migration theo thứ tự:

1. `migrations/20260907144035_exam_scores.sql`: bảng điểm, quyền bảng và RLS.
2. `migrations/20260908070137_exam_score_student_details.sql`: tên học sinh, ảnh xác nhận và bucket riêng tư `exam-score-evidence`.
3. `migrations/20260908082005_admin_accounts_and_score_submissions.sql`: hộp thư `exam_score_submissions`, bucket đóng góp và các hàm duyệt điểm/quản lý admin.
4. `migrations/20260908082007_exam_score_name_privacy.sql`: ẩn tên, bắt buộc tên với bản ghi mới/sửa, API công khai loại bỏ thông tin bị ẩn.
5. `migrations/20260908083027_exam_score_statistics_settings.sql`: cài đặt bật/tắt từng phần thống kê và các kỳ tham gia.

Các migration tạo đối tượng mới; không chạy lại tùy tiện trên môi trường đã cài đặt. Đẩy code lên GitHub Pages không tự thực thi SQL. Giao diện mới cần các migration tương ứng trước khi triển khai.

Trong **Authentication → URL Configuration**, thêm URL chính xác của `reset-password.html` tại tên miền triển khai vào danh sách Redirect URLs. Frontend chỉ sử dụng publishable key; không đưa mật khẩu cơ sở dữ liệu, secret key hoặc `service_role` vào website. Phân quyền dựa trên `profiles` và hàm admin hiện có, không dựa trên `user_metadata` do người dùng tự sửa.

## Dữ liệu và thống kê

- Mỗi bản ghi là một bài thi môn Toán, không phải một học sinh duy nhất. Điểm giống nhau được phép vì nhiều bài có thể cùng điểm.
- Bốn kỳ theo thứ tự: GK1, CK1, GK2, CK2. Điểm từ 0 đến 10, tối đa hai chữ số thập phân. Ô nhập chấp nhận `8,5` và `8.5`.
- Bắt buộc tên học sinh khi thêm hoặc sửa; lưu khối, lớp/khóa học, năm học và trạng thái công bố. Ảnh xác nhận là tùy chọn, hỗ trợ kéo thả một JPG, PNG hoặc WebP tối đa 10 MB. Không có ảnh thì thẻ hiển thị hình tài liệu SVG chuyển động.
- Biểu đồ cột đếm bài trong các khoảng `[0,1)`, ..., `[8,9)`, `[9,10]`; biểu đồ tròn đếm bốn nhóm `<5`, `[5,6.5)`, `[6.5,8)`, `[8,10]`.
- Biểu đồ đoạn thẳng là điểm trung bình theo kỳ; kỳ chưa có bài được để trống, không thay bằng 0. Tất cả biểu đồ dùng cùng bộ lọc.
- STT là vị trí trong danh sách, tiếp tục qua mỗi trang 10 bản ghi. STT biểu mẫu là vị trí bản ghi đang sửa hoặc số tiếp theo khi nhập mới; không phải mã học sinh hoặc ID cố định trong database.
- Chỉ quản trị viên theo hàm phân quyền hiện có được thêm, sửa, ẩn hoặc xóa điểm. RLS và quyền bảng đều được khai báo trong migration.

## Ẩn tên và ẩn điểm

| Lựa chọn | Nội dung công khai | Dữ liệu admin |
| --- | --- | --- |
| Bật **Hiển thị điểm công khai**, không ẩn tên | Tên, điểm, ảnh nếu có; điểm tham gia thống kê | Giữ đầy đủ |
| Bật **Ẩn tên và ảnh xác nhận**, vẫn công khai điểm | Chữ mẫu làm mờ thay tên, không hiện ảnh; điểm vẫn tham gia thống kê | Giữ tên và ảnh thật |
| Tắt **Hiển thị điểm công khai** | Ẩn toàn bộ bản ghi, thẻ và điểm khỏi thống kê | Chỉ admin xem/sửa hoặc công bố lại |

Giao diện chỉ làm mờ chữ mẫu; không đặt tên thật phía sau lớp mờ. Khách đọc bằng `get_published_exam_scores(page_offset, page_limit)`: hàm chỉ trả điểm đã công bố và trả `null` cho tên, đường dẫn ảnh, tên file ảnh khi bật ẩn tên. Khách và tài khoản thường không thể đọc trực tiếp bảng điểm đầy đủ; admin vẫn đọc dữ liệu gốc để quản lý.

Ảnh được truy cập bằng URL ký có thời hạn 300 giây. Sau khi ẩn tên hoặc ẩn điểm, truy vấn mới loại bỏ thông tin đó và khách không thể xin URL mới. URL đã cấp trước đó có thể còn dùng được tối đa 5 phút, cho đến lúc hết hạn.

Ràng buộc tên sử dụng `NOT VALID` để giữ bản ghi cũ chưa có tên. Mọi bản ghi thêm hoặc sửa sau migration đều phải có tên hợp lệ; admin cần bổ sung tên khi sửa một bản ghi cũ còn trống.

## Cài đặt thống kê

Trong mục **Điểm thi → Hiển thị thống kê**, admin có thể tắt toàn bộ thống kê hoặc chọn riêng **Tổng quan**, **Biểu đồ cột**, **Biểu đồ tròn**, **Biểu đồ đoạn thẳng**. Các checkbox GK1, CK1, GK2, CK2 quyết định kỳ nào tham gia thống kê.

Thay đổi chỉ áp dụng sau khi bấm **Lưu cài đặt thống kê**. Tắt công tắc tổng giữ nguyên các lựa chọn bên dưới để bật lại sau. Cài đặt được lưu ở bản ghi `exam_score_settings` có `id=1`: `statistics_enabled`, `summary_enabled`, `bar_enabled`, `pie_enabled`, `line_enabled`, `enabled_periods`.

Các cài đặt này chỉ điều khiển thống kê; thẻ học sinh vẫn được quản lý riêng bằng `published`. Nếu không tải được cài đặt, phần nhập/sửa điểm admin vẫn hoạt động.

## Nhập điểm hàng loạt từ tệp

Trong **Điểm thi → Nhập điểm từ tệp**, kéo thả hoặc chọn nhiều tệp **Word `.docx`, Excel `.xlsx`, CSV/TXT, ảnh JPG/PNG/WebP**. Điền năm học, khối, kỳ thi và lớp mặc định trước khi chọn tệp; các giá trị này chỉ bổ sung trường còn thiếu. Tệp `.doc`/`.xls` cũ cần lưu lại thành `.docx`/`.xlsx` trước.

Word được đọc từ bảng hoặc đoạn văn; Excel đọc tất cả sheet, dùng kết quả công thức đã lưu trong tệp (không tự tính lại công thức). Công cụ nhận các tiêu đề tiếng Việt như Họ tên, Lớp, Điểm, Kỳ thi. Bảng có GK1, CK1, GK2, CK2 ở các cột riêng được tách thành một bản ghi cho mỗi bài thi. Ảnh được nhận diện chữ tiếng Việt và tiếng Anh ngay trong trình duyệt; ảnh mờ, chữ viết tay hoặc bố cục phức tạp có thể cần sửa nhiều trường.

Sau khi đọc, bảng kiểm tra hiện tên, lớp, điểm, kỳ thi, khối, năm học, nguồn và nội dung gốc; phân trang 10 dòng. Sửa trực tiếp các ô, bỏ chọn hoặc xóa dòng không cần, rồi bấm **Lưu các dòng đã chọn**. Dòng được chọn thiếu tên/lớp hoặc có điểm, kỳ thi, năm học không hợp lệ sẽ ngăn lưu cho tới khi sửa hoặc bỏ chọn. Lưu nháp là mặc định; có thể chọn công bố và ẩn tên trước khi lưu. Không công bố tự động chỉ vì đã thả tệp.

Giới hạn 20 tệp/lượt, ảnh 10 MB, tài liệu 25 MB/tệp và 3.000 dòng trong bản nhập. Tệp gốc được đọc cục bộ; ảnh nguồn chỉ dùng đối chiếu, không tự gắn lên thẻ học sinh vì có thể chứa điểm của cả lớp. Muốn đăng ảnh minh chứng riêng, mở sửa điểm sau khi lưu. Đăng xuất xóa bản nhập và ảnh tạm khỏi giao diện.

Lưu dùng quyền admin hiện có, chia mỗi lô tối đa 50 dòng và giữ UUID cố định để đối soát khi mất phản hồi. Nếu lỗi mạng, giữ nguyên bản nhập và bấm **Lưu** lại; những dòng đã được máy chủ xác nhận sẽ được bỏ khỏi bản nhập. Các dòng đang chờ xác nhận giữ nguyên nội dung đã gửi; sau khi xác nhận, sửa tại danh sách điểm. Không tải lại trang hoặc nhập lại cùng tệp trong lúc thử lại vì bản nhập chỉ được giữ trong bộ nhớ của tab.

## Học sinh gửi điểm và duyệt

Học sinh có thể gửi tên, lớp, khối, kỳ thi, năm học, điểm và ảnh tùy chọn từ trang chủ mà không cần đăng nhập. Yêu cầu luôn bắt đầu ở trạng thái `pending`; người gửi không có quyền đọc danh sách yêu cầu, tự sửa, duyệt hoặc xóa. Ảnh chờ duyệt nằm trong bucket riêng tư `exam-score-submissions`, chỉ admin xem.

Admin mở **Điểm học sinh gửi chờ duyệt**, xem ảnh và sửa thông tin trước khi bấm **Duyệt và hiển thị**. Hàm duyệt tạo điểm công khai và đánh dấu yêu cầu đã xử lý trong cùng giao dịch. Khóa bản ghi ngăn duyệt hai lần tạo điểm trùng. Khi có ảnh, admin chuyển bản sao sang bucket minh chứng trước khi duyệt và dọn ảnh nguồn sau khi thành công.

Yêu cầu đã duyệt hoặc xóa không còn trong hộp chờ duyệt. Điểm đã duyệt vẫn sửa, ẩn tên/ảnh, ẩn toàn bộ hoặc xóa được ở **Điểm thi đã nhập**. Hai danh sách đều phân trang 10 mục.

## Tài khoản và mật khẩu

**Quên mật khẩu?** nằm trên biểu mẫu đăng nhập, gửi liên kết tới email với thông báo chung không tiết lộ email có tồn tại hay không. Trang phục hồi kiểm tra liên kết, xóa token khỏi thanh địa chỉ và hỗ trợ hash, token hash, mã PKCE. Liên kết lỗi/hết hạn không mở biểu mẫu mật khẩu.

Trong **Tài khoản**, admin phải xác minh mật khẩu hiện tại trước khi đổi mật khẩu mới. Danh sách và thao tác thu hồi dùng `list_admin_accounts()` và `revoke_admin_access(target_user_id)`, kiểm tra quyền ở database. Thu hồi chuyển vai trò từ `admin` sang `viewer`, giữ tài khoản đăng nhập; không thể tự thu hồi và phải giữ ít nhất một admin. Hộp xác nhận nêu rõ tài khoản đích.

Callback đăng nhập không chờ thao tác Supabase Auth bên trong callback để tránh khóa phiên. Khi đăng xuất, dữ liệu điểm/tài khoản được xóa khỏi giao diện; phản hồi xác thực cũ không thể mở lại trang admin.

## Kiểm thử

Chạy kiểm thử tính toán với Node.js:

```sh
node --test tests/exam-scores.test.cjs
node --test tests/exam-score-import-parser.test.cjs
```

Kiểm thử quyền truy cập dùng PostgreSQL cô lập:

```sh
node --test tests/exam-scores-rls.test.cjs
node --test tests/admin-score-access.test.cjs
```

Kiểm thử trình duyệt:

```sh
node tests/admin-account.browser.cjs
node tests/exam-scores.browser.cjs
node tests/exam-score-images.browser.cjs
node tests/score-submissions.browser.cjs
node tests/exam-score-settings-admin.browser.cjs
node tests/exam-score-import.browser.cjs
```

Các bộ kiểm thử dùng `playwright` và `@electric-sql/pglite@0.5.8` từ môi trường phát triển, không phải phụ thuộc của website. Có thể đặt `PGLITE_MODULE` / `PLAYWRIGHT_MODULE` thành đường dẫn module tuyệt đối. Kiểm thử trình duyệt thông thường mặc định dùng Edge và server `http://127.0.0.1:4174`; thay bằng `TEST_BROWSER_CHANNEL` / `TEST_BASE_URL` khi cần. Bộ account và bộ settings phục vụ/giả lập nội dung trực tiếp, không cần server riêng. `TEST_VENDOR_DIR` hỗ trợ bản SDK Supabase 2.116.0 và Chart.js 4.5.1 nguyên bản đã tải sẵn khi máy chặn CDN. Ảnh kiểm thử lưu tại thư mục tạm hoặc `TEST_OUTPUT_DIR`.

Kiểm thử bao gồm tên bắt buộc, STT/phân trang, hai chế độ ẩn độc lập, chữ mẫu làm mờ, CRUD và kéo thả ảnh, lỗi upload/tải ảnh, dọn ảnh sau khi ghi thành công, duyệt/xóa yêu cầu, XSS và giao diện di động. Bộ account kiểm tra cả phản hồi `getUser`/RPC muộn sau đăng xuất. Bộ settings kiểm tra lưu rõ ràng, giữ lựa chọn khi tắt tổng, lỗi đọc/ghi không khóa ô nhập điểm và bỏ kết quả tải cũ sau khi xóa phiên.

Bộ nhập tệp kiểm tra DOCX/XLSX được tạo thật, nhiều kỳ thi, số thập phân, sửa lỗi và chọn dòng, lô 50 dòng, đối soát khi mất phản hồi, lỗi từng tệp, ảnh OCR giả lập và giao diện di động. Bộ này cần module `docx` (hoặc `DOCX_MODULE`) và các bản Mammoth 1.8.0, ExcelJS 4.4.0 trong `TEST_VENDOR_DIR` để kiểm tra các thư viện đọc tệp thật.

Kiểm thử trình duyệt chặn mọi request Supabase và dùng dữ liệu giả lập, không ghi production. Không gửi email, đổi mật khẩu hoặc thu hồi tài khoản thật để kiểm thử. Kiểm thử RLS chạy PostgreSQL trong bộ nhớ; không thay cho xác minh hàm phân quyền, cấu hình Auth hoặc Security Advisor của dự án production.
