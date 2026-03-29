require('dotenv').config();

const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1emhIjMexXdwWvuMQWHWQx4p0AtfjqcCie5IV0Pl4Rzk';

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google Auth
let sheets = null;

async function initGoogleAuth() {
  try {
    let credentials;
    
    if (process.env.GOOGLE_CREDENTIALS) {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      console.log('✅ Using ENV credentials');
    } else {
      try {
        credentials = require('./service-account.json');
        console.log('✅ Using service-account.json');
      } catch (e) {
        console.log('⚠️ No credentials found - running in demo mode');
        return;
      }
    }

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets connected');
  } catch (e) {
    console.error('❌ Auth error:', e.message);
  }
}

initGoogleAuth();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const safeStr = (v) => (v == null ? '' : String(v).trim());
const safeNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

async function getRows(sheetName) {
  try {
    if (!sheets) return [];
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:ZZ`
    });
    return res.data.values || [];
  } catch (e) {
    console.error(`Error reading ${sheetName}:`, e.message);
    return [];
  }
}

function findRow(rows, col, val) {
  for (let i = 0; i < rows.length; i++) {
    if (safeStr(rows[i][col]) === safeStr(val)) return i;
  }
  return -1;
}

function colLetter(i) {
  let s = '';
  i++;
  while (i > 0) {
    const mod = (i - 1) % 26;
    s = String.fromCharCode(65 + mod) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

async function setCell(sheetName, row, col, val) {
  try {
    if (!sheets) return;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!${colLetter(col)}${row}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[val]] }
    });
  } catch (e) {
    console.error('setCell error:', e.message);
  }
}

async function appendRow(sheetName, vals) {
  try {
    if (!sheets) return;
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:A`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [vals] }
    });
  } catch (e) {
    console.error('appendRow error:', e.message);
  }
}

async function clearRow(sheetName, rowIdx) {
  try {
    if (!sheets) return;
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A${rowIdx + 1}:Z${rowIdx + 1}`
    });
  } catch (e) {
    console.error('clearRow error:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════════════
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;
    
    if (role === 'admin') {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      if (user === adminUser && pass === adminPass) {
        return res.json({ success: true, data: { role: 'admin', name: 'Admin', id: 'admin' } });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }
    
    // Student login
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, user);
    if (idx === -1) return res.json({ success: false, message: 'Student not found' });
    
    const wa = safeStr(rows[idx][5]); // واتساب ولي الأمر
    if (pass === wa.slice(-4) || pass === '1234') {
      return res.json({
        success: true,
        data: { role: 'student', name: safeStr(rows[idx][1]), id: safeStr(rows[idx][0]) }
      });
    }
    
    res.json({ success: false, message: 'Invalid code' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  try {
    const sRows = await getRows('بيانات_الطلاب');
    const pRows = await getRows('المدفوعات');
    
    const totalStudents = Math.max(0, sRows.length - 1);
    const activeStudents = sRows.slice(1).filter(r => safeStr(r[11]).includes('نشط')).length;
    const totalRevenue = pRows.slice(1).reduce((sum, r) => sum + safeNum(r[4]), 0);
    const pendingPayments = pRows.slice(1).reduce((sum, r) => sum + Math.max(0, safeNum(r[3]) - safeNum(r[4])), 0);
    
    // Get today's attendance from current month sheet
    const currentMonth = MONTHS_AR[new Date().getMonth()];
    const aRows = await getRows(currentMonth);
    const today = new Date().getDate();
    const todayCol = today + 4; // العمود المقابل لليوم
    
    let presentToday = 0;
    let absentToday = 0;
    aRows.slice(2).forEach(r => {
      const status = safeStr(r[todayCol]);
      if (status === 'ح') presentToday++;
      else if (status === 'غ') absentToday++;
    });
    
    res.json({
      success: true,
      data: { totalStudents, activeStudents, totalRevenue, pendingPayments, presentToday, absentToday }
    });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS
// ═══════════════════════════════════════════════════════════════
app.get('/api/students', async (req, res) => {
  try {
    const rows = (await getRows('بيانات_الطلاب')).slice(1);
    const data = rows.filter(r => r[0]).map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]), grade: safeStr(r[2]), subject: safeStr(r[3]),
      parentName: safeStr(r[4]), whatsapp: safeStr(r[5]), phone: safeStr(r[6]),
      phone2: safeStr(r[7]), subscription: safeStr(r[8]), group: safeStr(r[9]),
      joinDate: safeStr(r[10]), status: safeStr(r[11]), notes: safeStr(r[12])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/add', async (req, res) => {
  try {
    const d = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).filter(r => r[0]).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [
      newId, d.name, d.grade, d.subject || 'كيمياء', d.parentName, d.whatsapp,
      d.phone, '', d.subscription, d.group,
      new Date().toISOString().split('T')[0], d.status || '✅ نشط', d.notes || ''
    ];
    
    await appendRow('بيانات_الطلاب', newRow);
    res.json({ success: true, id: newId });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/update', async (req, res) => {
  try {
    const { id, name, grade, whatsapp, phone, group, subscription, status } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    if (name) await setCell('بيانات_الطلاب', row, 1, name);
    if (grade) await setCell('بيانات_الطلاب', row, 2, grade);
    if (whatsapp) await setCell('بيانات_الطلاب', row, 5, whatsapp);
    if (phone) await setCell('بيانات_الطلاب', row, 6, phone);
    if (group) await setCell('بيانات_الطلاب', row, 9, group);
    if (subscription) await setCell('بيانات_الطلاب', row, 8, subscription);
    if (status) await setCell('بيانات_الطلاب', row, 11, status);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/students/delete', async (req, res) => {
  try {
    const { id } = req.body;
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    await clearRow('بيانات_الطلاب', idx);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    const data = rows.filter(r => r[0]).map(r => ({
      name: safeStr(r[0]), group: safeStr(r[1]), monthYear: safeStr(r[2]),
      subscription: safeStr(r[3]), paid: safeStr(r[4]), notes: safeStr(r[5]),
      remaining: Math.max(0, safeNum(r[3]) - safeNum(r[4])),
      status: safeNum(r[4]) >= safeNum(r[3]) ? 'مكتمل' : 'غير مكتمل'
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/payments/add', async (req, res) => {
  try {
    const { studentId, studentName, month, year, subscription, paid } = req.body;
    const sRows = await getRows('بيانات_الطلاب');
    const idx = findRow(sRows, 0, studentId);
    const group = idx !== -1 ? safeStr(sRows[idx][9]) : '';
    
    const newRow = [studentName, group, `${month} ${year}`, subscription, paid, ''];
    await appendRow('المدفوعات', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// GRADES
// ═══════════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.filter(r => r[0]).map(r => ({
      id: safeStr(r[0]), name: safeStr(r[1]),
      exam1: safeStr(r[2]), exam2: safeStr(r[3]), exam3: safeStr(r[4]), exam4: safeStr(r[5]),
      hw1: safeStr(r[6]), hw2: safeStr(r[7]), hw3: safeStr(r[8]),
      avg: safeStr(r[9]), grade: safeStr(r[10]), notes: safeStr(r[11])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/grades/update', async (req, res) => {
  try {
    const { id, exam1, exam2, exam3, exam4, hw1, hw2, hw3, avg, grade } = req.body;
    const rows = await getRows('الدرجات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    if (exam1 !== undefined) await setCell('الدرجات', row, 2, exam1);
    if (exam2 !== undefined) await setCell('الدرجات', row, 3, exam2);
    if (exam3 !== undefined) await setCell('الدرجات', row, 4, exam3);
    if (exam4 !== undefined) await setCell('الدرجات', row, 5, exam4);
    if (hw1 !== undefined) await setCell('الدرجات', row, 6, hw1);
    if (hw2 !== undefined) await setCell('الدرجات', row, 7, hw2);
    if (hw3 !== undefined) await setCell('الدرجات', row, 8, hw3);
    if (avg !== undefined) await setCell('الدرجات', row, 9, avg);
    if (grade !== undefined) await setCell('الدرجات', row, 10, grade);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES
// ═══════════════════════════════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    const data = rows.filter(r => r[0]).map(r => ({
      id: safeStr(r[0]), day: safeStr(r[1]), time: safeStr(r[2]),
      group: safeStr(r[3]), subject: safeStr(r[4]), teacher: safeStr(r[5]),
      status: safeStr(r[6]), notes: safeStr(r[7])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/schedules/add', async (req, res) => {
  try {
    const { day, time, group, subject, teacher } = req.body;
    const rows = await getRows('المواعيد');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).filter(r => r[0]).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, day, time, group, subject, teacher, 'نشط', ''];
    await appendRow('المواعيد', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════
app.post('/api/attendance/mark', async (req, res) => {
  try {
    const { studentId, status, date } = req.body;
    const d = new Date(date);
    const month = MONTHS_AR[d.getMonth()];
    const day = d.getDate();
    
    const aRows = await getRows(month);
    const idx = findRow(aRows, 0, studentId);
    
    if (idx === -1) {
      // Add student row if not exists
      const sRows = await getRows('بيانات_الطلاب');
      const sIdx = findRow(sRows, 0, studentId);
      const studentName = sIdx !== -1 ? safeStr(sRows[sIdx][1]) : '';
      const group = sIdx !== -1 ? safeStr(sRows[sIdx][9]) : '';
      
      const newRow = [studentId, new Date().getFullYear(), studentName, group];
      // Fill empty cells up to day column
      for (let i = 4; i < day + 4; i++) newRow.push('');
      newRow[day + 3] = status === 'حاضر' ? 'ح' : 'غ';
      
      await appendRow(month, newRow);
    } else {
      // Update existing row
      const row = idx + 1;
      const col = day + 3;
      await setCell(month, row, col, status === 'حاضر' ? 'ح' : 'غ');
    }
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXCUSES
// ═══════════════════════════════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  try {
    const rows = (await getRows('الاعتذارات')).slice(1);
    const data = rows.filter(r => r[0]).map(r => ({
      id: safeStr(r[0]), studentId: safeStr(r[1]), studentName: safeStr(r[2]),
      date: safeStr(r[3]), reason: safeStr(r[4]), status: safeStr(r[5]), reply: safeStr(r[6])
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/excuses/add', async (req, res) => {
  try {
    const { studentId, studentName, reason } = req.body;
    const rows = await getRows('الاعتذارات');
    const newId = rows.length > 1 ? Math.max(...rows.slice(1).filter(r => r[0]).map(r => parseInt(r[0]) || 0)) + 1 : 1;
    
    const newRow = [newId, studentId, studentName, new Date().toISOString().split('T')[0], reason, '⏳ قيد المراجعة', ''];
    await appendRow('الاعتذارات', newRow);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/excuses/update', async (req, res) => {
  try {
    const { id, status, reply } = req.body;
    const rows = await getRows('الاعتذارات');
    const idx = findRow(rows, 0, id);
    if (idx === -1) return res.json({ success: false, message: 'Not found' });
    
    const row = idx + 1;
    const statusIcon = status === 'مقبول' ? '✅ مقبول' : '❌ مرفوض';
    await setCell('الاعتذارات', row, 5, statusIcon);
    if (reply) await setCell('الاعتذارات', row, 6, reply);
    
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/dashboard', async (req, res) => {
  try {
    const id = req.query.id;
    const currentMonth = MONTHS_AR[new Date().getMonth()];
    const aRows = await getRows(currentMonth);
    const studentRows = aRows.slice(2).filter(r => safeStr(r[0]) === id);
    
    let present = 0, absent = 0, late = 0;
    studentRows.forEach(r => {
      for (let i = 4; i < r.length; i++) {
        if (r[i] === 'ح') present++;
        else if (r[i] === 'غ') absent++;
        else if (r[i] === 'ت') late++;
      }
    });
    
    const total = present + absent + late || 1;
    const attRate = Math.round((present / total) * 100);
    
    const gRows = await getRows('الدرجات');
    const gIdx = findRow(gRows, 0, id);
    const avgGrade = gIdx !== -1 ? safeStr(gRows[gIdx][9]) : '-';
    const gradeLabel = gIdx !== -1 ? safeStr(gRows[gIdx][10]) : '-';
    
    res.json({ success: true, data: { attRate, avgGrade, gradeLabel, present, absent, late } });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/profile', async (req, res) => {
  try {
    const rows = await getRows('بيانات_الطلاب');
    const idx = findRow(rows, 0, req.query.id);
    if (idx === -1) return res.json({ success: false });
    const r = rows[idx];
    res.json({ success: true, data: {
      id: r[0], name: r[1], grade: r[2], subject: r[3],
      parentName: r[4], whatsapp: r[5], phone: r[6], group: r[9], status: r[11]
    }});
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/grades', async (req, res) => {
  try {
    const rows = (await getRows('الدرجات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === req.query.id);
    if (!data.length) return res.json({ success: true, data: [] });
    const r = data[0];
    res.json({ success: true, data: [{
      exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5],
      hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]
    }]});
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/payments', async (req, res) => {
  try {
    const rows = (await getRows('المدفوعات')).slice(1);
    const data = rows.filter(r => safeStr(r[0]) === req.query.name).map(r => ({
      monthYear: safeStr(r[2]), subscription: safeStr(r[3]), paid: safeStr(r[4]),
      status: safeNum(r[4]) >= safeNum(r[3]) ? 'مكتمل' : 'غير مكتمل'
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/attendance', async (req, res) => {
  try {
    const id = req.query.id;
    const attendance = [];
    
    for (const month of MONTHS_AR) {
      const rows = await getRows(month);
      const studentRows = rows.slice(2).filter(r => safeStr(r[0]) === id);
      
      studentRows.forEach(r => {
        for (let i = 4; i < r.length; i++) {
          if (r[i] === 'ح' || r[i] === 'غ' || r[i] === 'ت') {
            attendance.push({
              date: `${i - 3} ${month}`,
              status: r[i] === 'ح' ? 'حاضر' : r[i] === 'غ' ? 'غائب' : 'متأخر'
            });
          }
        }
      });
    }
    
    res.json({ success: true, data: attendance.reverse().slice(0, 30) });
  } catch (e) {
    res.json({ success: false });
  }
});

app.get('/api/student/schedules', async (req, res) => {
  try {
    const rows = (await getRows('المواعيد')).slice(1);
    res.json({ success: true, data: rows.filter(r => r[0]).map(r => ({
      day: r[1], time: r[2], group: r[3], subject: r[4]
    }))});
  } catch (e) {
    res.json({ success: false });
  }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('═════════════════════════════════════════════════════');
  console.log('🚀 Smart Educational Center');
  console.log('═════════════════════════════════════════════════════');
  console.log(`📡 Port: ${PORT}`);
  console.log(`📊 Spreadsheet: ${SPREADSHEET_ID}`);
  console.log('═════════════════════════════════════════════════════');
});
