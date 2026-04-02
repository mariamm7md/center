# Smart Educational Center - Backend Server

نظام إدارة مركز تعليمي ذكي (طلاب - مدفوعات - درجات - حضور - اعتذارات)

## المميزات
- واجهة خلفية (Backend) باستخدام **Express.js**
- الاتصال بـ **Google Apps Script** كقاعدة بيانات
- دعم تسجيل دخول الأدمن والطلاب
- API Proxy لجميع عمليات الطلاب والإدارة
- أمان أساسي باستخدام Helmet

## التقنيات المستخدمة
- Node.js + Express
- node-fetch (للاتصال بـ Google Apps Script)
- dotenv (لإدارة المتغيرات البيئية)
- Helmet, Compression, Morgan

## كيفية التشغيل

### 1. استنساخ المشروع
```bash
git clone https://github.com/yourusername/educational-center-server.git
cd educational-center-server
