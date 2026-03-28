const express = require('express');
const { google } = require('googleapis');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = '1TMDiMSAtyjk4iPAsLsMoo-uf7nUeJuOwKeOtPZ3o3xw';

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// إعداد الاتصال بجوجل شيت
const auth = new google.auth.GoogleAuth({
  // تأكدي من وجود ملف الـ JSON الخاص بجوجل في مجلد المشروع وتسميته بـ service-account.json
  keyFile: './service-account.json', 
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
const sheets = google.sheets({ version: 'v4', auth });

// الدوال الأساسية للتعامل مع الشيت
async function getVal(range) {
  try {
    const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
    return r.data.values || [];
  } catch (e) { return []; }
}

// مسار تشغيل الصفحة الرئيسية
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// مسار تسجيل الدخول (API)
app.post('/api/verifyLogin', async (req, res) => {
  const { role, user, pass } = req.body;
  if (role === 'admin') {
    if (user === 'admin' && pass === 'admin123') {
      return res.json({ success: true, data: { role: 'admin', name: 'المدير' } });
    }
    return res.json({ success: false, message: 'بيانات الدخول خاطئة' });
  }
  // هنا يمكنك إضافة منطق دخول الطالب
  res.json({ success: false, message: 'خدمة دخول الطلاب تحت الصيانة' });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});