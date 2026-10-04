# منصة الدعم — Full Node.js

## ما الموجود؟
- Frontend عربي متجاوب.
- Express API.
- SQLite database.
- تسجيل/تسجيل خروج.
- Sessions عبر HttpOnly cookies.
- أدوار USER / HELPER / ADMIN.
- طلبات الداعمين ومراجعتها.
- قائمة الداعمين المعتمدين.
- محادثات ورسائل.
- إنهاء المحادثة.
- الإبلاغ عن المستخدم.
- لوحة إدارة.
- Audit logs.
- Helmet + rate limiting + bcrypt.
- إنشاء أول Admin من متغيرات البيئة.

## التشغيل
يتطلب Node.js 20 أو أحدث.

```bash
npm install
npm start
```

افتح:
`http://localhost:3000`

## إعداد Admin
انسخ `.env.example` إلى `.env` وضع:
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

سيُنشأ حساب الإدارة تلقائيًا عند أول تشغيل إذا لم يكن موجودًا.

## الاستضافة
في استضافة Node.js/Pterodactyl:
- Install command: `npm install`
- Start command: `npm start`
- Port: استخدم متغير `PORT` الذي توفره الاستضافة.

لا تستخدم GitHub Pages لهذا المشروع؛ GitHub Pages لا يشغّل `server.js`.

## ملاحظة سلامة مهمة
هذا مشروع تقني قابل للتشغيل وليس خدمة جاهزة للإطلاق العام للقاصرين. قبل استخدامه فعليًا يجب إضافة التحقق من العمر والموافقة المطلوبة حسب البلد، حماية إضافية للبيانات، سياسة احتفاظ وحذف، مراجعة أمنية، نظام تصعيد للحالات الخطرة، ومراجعة قانونية/حماية أطفال مناسبة.
