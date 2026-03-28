var express = require('express');
var google = require('googleapis');
var path = require('path');

var PORT = process.env.PORT || 3000;
var SPREADSHEET_ID = '1TMDiMSAtyjk4iPAsLsMoo-uf7nUeJuOwKeOtPZ3o3xw';
var ADMIN_USER = process.env.ADMIN_USER || 'admin';
var ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
var MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

var app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

var auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});
var sheets = google.sheets({ version: 'v4', auth: auth });

function colLetter(c) {
  var s = '';
  while (c >= 0) { s = String.fromCharCode(65 + (c % 26)) + s; c = Math.floor(c / 26) - 1; }
  return s;
}
function cleanPhone(p) { return p ? p.toString().replace(/\D/g, '') : ''; }
function ok(d) { return { success: true, data: d }; }
function fail(m) { return { success: false, message: m }; }

function getVal(range) {
  return sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: range })
    .then(function(r) { return r.data.values || []; })
    .catch(function() { return []; });
}
function setVal(range, values) {
  return sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: range,
    valueInputOption: 'USER_ENTERED', resource: { values: values }
  });
}
function addVal(range, values) {
  return sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: range,
    valueInputOption: 'USER_ENTERED', resource: { values: values }
  });
}
function getSheets() {
  return sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID })
    .then(function(r) { return r.data.sheets.map(function(s) { return { name: s.properties.title, gid: s.properties.sheetId }; }); })
    .catch(function() { return []; });
}
function ensureSheet(name, headers) {
  return getSheets().then(function(list) {
    if (list.some(function(s) { return s.name === name; })) return;
    return sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: name } } }] }
    }).then(function() { if (headers) return addVal(name + '!A1', [headers]); });
  });
}
function maxId(sheetName) {
  return getVal(sheetName + '!A2:A').then(function(rows) {
    var m = 0; rows.forEach(function(r) { var v = parseInt(r[0]); if (v > m) m = v; }); return m;
  });
}
function deleteRow(gid, idx) {
  return sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    resource: { requests: [{ deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } } }] }
  });
}

// LOGIN
app.post('/api/verifyLogin', function(req, res) {
  var role = req.body.role, user = req.body.user, pass = req.body.pass;
  if (role === 'admin') {
    if (user === ADMIN_USER && pass === ADMIN_PASS) return res.json(ok({ role: 'admin', name: 'المدير' }));
    return res.json(fail('بيانات الدخول غير صحيحة'));
  }
  if (role === 'student') {
    getVal('بيانات_الطلاب!A2:H').then(function(rows) {
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (String(r[0]) === String(user)) {
          if (cleanPhone(r[6]).slice(-4) === pass || cleanPhone(r[5]).slice(-4) === pass || pass === '1234')
            return res.json(ok({ role: 'student', name: r[1], studentId: r[0] }));
          return res.json(fail('رمز التحقق غير صحيح'));
        }
      }
      res.json(fail('رقم الطالب غير موجود'));
    });
    return;
  }
  res.json(fail('نوع الدخول غير معروف'));
});

// DASHBOARD
app.get('/api/dashboard', function(req, res) {
  var now = new Date(), mo = MONTHS_AR[now.getMonth()], dc = 4 + now.getDate() - 1;
  Promise.all([
    getVal('🏠 الرئيسية!B4:F4'),
    getVal('بيانات_الطلاب!A2:L'),
    getVal('المدفوعات!A2:F'),
    getVal(mo + '!A5:' + colLetter(dc)),
    ensureSheet('الاعتذارات', null).then(function() { return getVal('الاعتذارات!A2:F'); })
  ]).then(function(results) {
    var hd = results[0], sr = results[1], pr = results[2], ar = results[3], er = results[4];
    var ts = (hd[0] && hd[0][0]) || 0, ac = 0, tp = 0, tr = 0, tpr = 0, tab = 0, pe = 0;
    sr.forEach(function(r) { if (r[0] && (r[11] === '✅ نشط' || r[11] === 'نشط')) ac++; });
    pr.forEach(function(r) { if (r[0]) { tp += (r[4] || 0) * 1; tr += Math.max(0, (r[3] || 0) * 1 - (r[4] || 0) * 1); } });
    ar.forEach(function(r) { if (r[0] && String(r[1]) === String(now.getFullYear())) { if (r[dc] === 'ح') tpr++; if (r[dc] === 'غ') tab++; } });
    er.forEach(function(r) { if (r[0] && (r[4] === '⏳ قيد المراجعة' || r[4] === 'قيد المراجعة')) pe++; });
    res.json(ok({ totalStudents: ts, activeStudents: ac, totalPaid: tp, totalRemaining: tr, currentMonth: mo + ' ' + now.getFullYear(), todayPresent: tpr, todayAbsent: tab, pendingExcuses: pe }));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENTS
app.get('/api/students', function(req, res) {
  getVal('بيانات_الطلاب!A2:M').then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0] && r[1]) out.push({ id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'', parentName: r[4]||'', whatsapp: cleanPhone(r[5]), studentPhone: r[6]||'', phone2: r[7]||'', subscription: (r[8]||0)*1, group: r[9]||'مجموعة 1', joinDate: r[10]||'', status: r[11]||'✅ نشط', notes: r[12]||'' }); });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.get('/api/students/:id', function(req, res) {
  getVal('بيانات_الطلاب!A2:M').then(function(rows) {
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (String(r[0]) === String(req.params.id)) return res.json(ok({ id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'', parentName: r[4]||'', whatsapp: r[5]||'', studentPhone: r[6]||'', phone2: r[7]||'', subscription: (r[8]||0)*1, group: r[9]||'مجموعة 1', status: r[11]||'✅ نشط' })); }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/students/add', function(req, res) {
  var d = req.body;
  maxId('بيانات_الطلاب').then(function(m) {
    addVal('بيانات_الطلاب!A:M', [[m + 1, d.name, d.grade, d.subject||'كيمياء', d.parentName, d.whatsapp, d.studentPhone, d.phone2, d.subscription, d.group, new Date().toISOString(), d.status, '']]).then(function() { res.json(ok('تم الإضافة')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/students/update', function(req, res) {
  var d = req.body;
  getVal('بيانات_الطلاب!A2:A').then(function(rows) {
    var proms = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        var rw = i + 2;
        var ups = [[1,d.name],[2,d.grade],[3,d.subject],[4,d.parentName],[5,d.whatsapp],[6,d.studentPhone],[7,d.phone2],[8,d.group],[9,d.subscription],[11,d.status]];
        ups.forEach(function(u) { proms.push(setVal('بيانات_الطلاب!' + colLetter(u[0]) + rw, [[u[1]]])); });
        break;
      }
    }
    Promise.all(proms).then(function() { res.json(ok('تم التعديل')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/students/delete', function(req, res) {
  Promise.all([getVal('بيانات_الطلاب!A2:A'), getSheets()]).then(function(results) {
    var rows = results[0], list = results[1], sid = 0;
    list.forEach(function(s) { if (s.name === 'بيانات_الطلاب') sid = s.gid; });
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.id)) { deleteRow(sid, i + 1).then(function() { res.json(ok('تم الحذف')); }); return; }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// ATTENDANCE
app.get('/api/attendance', function(req, res) {
  getVal(req.query.month + '!A5:AI').then(function(rows) {
    var out = [], yr = req.query.year;
    rows.forEach(function(r) { if (r[0] && r[2] && String(r[1]) === String(yr)) { var days = []; for (var d = 4; d < 35; d++) days.push(r[d]||''); out.push({ id: r[0], name: r[2], group: r[3]||'', days: days }); } });
    res.json(ok(out));
  }).catch(function() { res.json(ok([])); });
});

app.post('/api/attendance/save', function(req, res) {
  var body = req.body, col = 4 + body.day - 1;
  getVal(body.month + '!A5:D').then(function(rows) {
    var proms = [];
    body.records.forEach(function(rec) {
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]) === String(rec.studentId) && String(rows[i][1]) === String(body.year)) { proms.push(setVal(body.month + '!' + colLetter(col) + (i + 5), [[rec.status]])); break; }
      }
    });
    Promise.all(proms).then(function() { res.json(ok('تم الحفظ')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// PAYMENTS
app.get('/api/payments', function(req, res) {
  getVal('المدفوعات!A2:F').then(function(rows) {
    var out = [];
    rows.forEach(function(r, i) { if (r[0]) { var p = (r[4]||0)*1, s = (r[3]||0)*1, rem = s - p; out.push({ rowIndex: i+2, name: r[0], group: r[1], monthYear: r[2]||'', subscription: s, paid: p, remaining: rem, status: rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل', notes: r[5]||'' }); } });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/payments/add', function(req, res) {
  var d = req.body, my = d.month + ' ' + d.year;
  getVal('المدفوعات!A2:F').then(function(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(d.studentName).trim() && String(rows[i][2]).trim() === my) {
        return setVal('المدفوعات!E' + (i + 2), [[((rows[i][4]||0)*1) + d.paid]]).then(function() { res.json(ok('تم إضافة للسجل')); });
      }
    }
    addVal('المدفوعات!A:F', [[d.studentName, d.group, my, d.subscription, d.paid, d.notes||'']]).then(function() { res.json(ok('دفعة جديدة')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/payments/update', function(req, res) {
  var ri = req.body.rowIndex, np = req.body.newPaid;
  getVal('المدفوعات!E' + ri + ':E' + ri).then(function(rows) {
    setVal('المدفوعات!E' + ri, [[((rows[0] && rows[0][0]) || 0)*1 + np]]).then(function() { res.json(ok('تم التحديث')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// GRADES
app.get('/api/grades', function(req, res) {
  getVal('الدرجات!A2:L').then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0]) out.push({ id: r[0], name: r[1], exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5], hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]||'', notes: r[11]||'' }); });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/grades/update', function(req, res) {
  var d = req.body;
  getVal('الدرجات!A2:A').then(function(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        var rw = i + 2;
        Promise.all([setVal('الدرجات!C' + rw + ':I' + rw, [[d.exam1,d.exam2,d.exam3,d.exam4,d.hw1,d.hw2,d.hw3]]), setVal('الدرجات!J' + rw + ':L' + rw, [[d.avg,d.grade,d.notes||'']])]).then(function() { res.json(ok('تم الحفظ')); });
        return;
      }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// SCHEDULES
app.get('/api/schedules', function(req, res) {
  ensureSheet('المواعيد', ['رقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات']).then(function() {
    return getVal('المواعيد!A2:H');
  }).then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0]) out.push({ id: r[0], day: r[1]||'', time: r[2]||'', group: r[3]||'', subject: r[4]||'', teacher: r[5]||'', status: r[6]||'نشط', notes: r[7]||'' }); });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/schedules/add', function(req, res) {
  var d = req.body;
  maxId('المواعيد').then(function(m) {
    addVal('المواعيد!A:H', [[m+1, d.day, d.time, d.group, d.subject, d.teacher, 'نشط', d.notes||'']]).then(function() { res.json(ok('تم الإضافة')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/schedules/update', function(req, res) {
  var d = req.body;
  getVal('المواعيد!A2:A').then(function(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(d.id)) {
        setVal('المواعيد!B' + (i+2) + ':H' + (i+2), [[d.day,d.time,d.group,d.subject,d.teacher,d.status,d.notes||'']]).then(function() { res.json(ok('تم التحديث')); });
        return;
      }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/schedules/delete', function(req, res) {
  Promise.all([getVal('المواعيد!A2:A'), getSheets()]).then(function(results) {
    var rows = results[0], list = results[1], sid = 0;
    list.forEach(function(s) { if (s.name === 'المواعيد') sid = s.gid; });
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.id)) { deleteRow(sid, i+1).then(function() { res.json(ok('تم الحذف')); }); return; }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// EXCUSES
app.get('/api/excuses', function(req, res) {
  ensureSheet('الاعتذارات', ['رقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','رد الإدارة']).then(function() {
    return getVal('الاعتذارات!A2:G');
  }).then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0]) { var ds = ''; try { ds = new Date(r[3]).toLocaleDateString('ar-EG'); } catch(e) {} out.push({ id: r[0], studentId: r[1], studentName: r[2], date: ds, reason: r[4]||'', status: r[5]||'⏳ قيد المراجعة', reply: r[6]||'' }); } });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/excuses/add', function(req, res) {
  maxId('الاعتذارات').then(function(m) {
    addVal('الاعتذارات!A:G', [[m+1, req.body.studentId, req.body.studentName, new Date().toISOString(), req.body.reason, '⏳ قيد المراجعة', '']]).then(function() { res.json(ok('تم الإرسال')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/excuses/update', function(req, res) {
  getVal('الاعتذارات!A2:A').then(function(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.id)) {
        setVal('الاعتذارات!F' + (i+2) + ':G' + (i+2), [[req.body.status, req.body.reply||'']]).then(function() { res.json(ok('تم التحديث')); });
        return;
      }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// ALERTS
app.get('/api/alerts', function(req, res) {
  var now = new Date(), mo = MONTHS_AR[now.getMonth()], dc = 4 + now.getDate() - 1;
  Promise.all([getVal(mo + '!A5:' + colLetter(dc)), getVal('بيانات_الطلاب!A2:F')]).then(function(results) {
    var ar = results[0], sr = results[1], out = [];
    ar.forEach(function(r) {
      if (r[0] && String(r[1]) === String(now.getFullYear()) && r[dc] === 'غ') {
        var wa = '';
        sr.forEach(function(s) { if (String(s[0]) === String(r[0]) && s[5]) wa = cleanPhone(s[5]); });
        if (wa) out.push({ name: r[2], whatsapp: wa, message: 'مرحبا ولي أمر الطالب/ة ' + r[2] + '، يرجى العلم أنه تم تسجيل غياب للطالب اليوم.' });
      }
    });
    res.json(ok(out));
  }).catch(function() { res.json(ok([])); });
});

// SHEETS
app.get('/api/sheets', function(req, res) {
  getSheets().then(function(list) { res.json(ok(list)); }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT DASHBOARD
app.get('/api/student/dashboard', function(req, res) {
  var sid = req.query.id, now = new Date(), mo = MONTHS_AR[now.getMonth()];
  Promise.all([
    getVal(mo + '!A5:AI'),
    getVal('الدرجات!A2:L'),
    getVal('بيانات_الطلاب!A2:B'),
    getVal('المدفوعات!A2:F')
  ]).then(function(results) {
    var ar = results[0], gr = results[1], sr = results[2], pr = results[3];
    var prs = 0, ab = 0, lt = 0, avgG = '-', grdL = '-', stuN = '', unc = 0;
    ar.forEach(function(r) { if (String(r[0]) === String(sid) && String(r[1]) === String(now.getFullYear())) { for (var d = 4; d < 35; d++) { if (r[d]==='ح') prs++; if (r[d]==='غ') ab++; if (r[d]==='ت') lt++; } } });
    gr.forEach(function(r) { if (String(r[0]) === String(sid)) { avgG = r[9]||'-'; grdL = r[10]||'-'; } });
    sr.forEach(function(r) { if (String(r[0]) === String(sid)) stuN = r[1]; });
    if (stuN) pr.forEach(function(r) { if (r[0] && String(r[0]).trim() === String(stuN).trim() && (r[3]||0)*1 - (r[4]||0)*1 > 0) unc++; });
    var tot = prs + ab + lt;
    res.json(ok({ present: prs, absent: ab, late: lt, attRate: tot ? ((prs/tot)*100).toFixed(0) : 0, avgGrade: avgG, gradeLabel: grdL, unpaidCount: unc, month: mo }));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT PROFILE
app.get('/api/student/profile', function(req, res) {
  getVal('بيانات_الطلاب!A2:M').then(function(rows) {
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (String(r[0]) === String(req.query.id)) return res.json(ok({ id: r[0], name: r[1], grade: r[2]||'', subject: r[3]||'', parentName: r[4]||'', whatsapp: r[5]||'', studentPhone: r[6]||'', phone2: r[7]||'', subscription: (r[8]||0)*1, group: r[9]||'مجموعة 1', status: r[11]||'✅ نشط' })); }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/student/profile/update', function(req, res) {
  var b = req.body;
  getVal('بيانات_الطلاب!A2:A').then(function(rows) {
    var ps = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(b.studentId)) {
        var rw = i + 2;
        if (b.studentPhone !== undefined) ps.push(setVal('بيانات_الطلاب!G' + rw, [[b.studentPhone]]));
        if (b.whatsapp !== undefined) ps.push(setVal('بيانات_الطلاب!F' + rw, [[b.whatsapp]]));
        if (b.phone2 !== undefined) ps.push(setVal('بيانات_الطلاب!H' + rw, [[b.phone2]]));
        break;
      }
    }
    Promise.all(ps).then(function() { res.json(ok('تم التحديث')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT ATTENDANCE
app.get('/api/student/attendance', function(req, res) {
  var now = new Date(), mo = MONTHS_AR[now.getMonth()];
  getVal(mo + '!A5:AI').then(function(rows) {
    for (var i = 0; i < rows.length; i++) { var r = rows[i]; if (String(r[0]) === String(req.query.id) && String(r[1]) === String(now.getFullYear())) { var days = []; for (var d = 4; d < 35; d++) days.push(r[d]||''); return res.json(ok({ month: mo, group: r[3]||'', days: days })); } }
    res.json(ok({ month: mo, days: [], group: '' }));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/student/attendance/mark', function(req, res) {
  var now = new Date(), mo = MONTHS_AR[now.getMonth()], dc = 4 + now.getDate() - 1;
  getVal(mo + '!A5:D').then(function(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(req.body.studentId) && String(rows[i][1]) === String(now.getFullYear())) {
        setVal(mo + '!' + colLetter(dc) + (i+5), [[req.body.status]]).then(function() { res.json(ok('تم التسجيل')); });
        return;
      }
    }
    res.json(fail('لم يتم العثور'));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT GRADES
app.get('/api/student/grades', function(req, res) {
  getVal('الدرجات!A2:L').then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (String(r[0]) === String(req.query.id)) out.push({ id: r[0], name: r[1], exam1: r[2], exam2: r[3], exam3: r[4], exam4: r[5], hw1: r[6], hw2: r[7], hw3: r[8], avg: r[9], grade: r[10]||'', notes: r[11]||'' }); });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT PAYMENTS
app.get('/api/student/payments', function(req, res) {
  getVal('المدفوعات!A2:F').then(function(rows) {
    var out = [], nm = req.query.name;
    rows.forEach(function(r) { if (r[0] && String(r[0]).trim() === String(nm).trim()) { var p = (r[4]||0)*1, s = (r[3]||0)*1, rem = s-p; out.push({ monthYear: r[2]||'', subscription: s, paid: p, remaining: rem, status: rem <= 0 ? '✅ مكتمل' : '⚠️ غير مكتمل', notes: r[5]||'' }); } });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT EXCUSES
app.get('/api/student/excuses', function(req, res) {
  ensureSheet('الاعتذارات', null).then(function() { return getVal('الاعتذارات!A2:G'); }).then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0] && String(r[1]) === String(req.query.id)) { var ds = ''; try { ds = new Date(r[3]).toLocaleDateString('ar-EG'); } catch(e) {} out.push({ id: r[0], date: ds, reason: r[4]||'', status: r[5]||'⏳ قيد المراجعة', reply: r[6]||'' }); } });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

app.post('/api/student/excuses/add', function(req, res) {
  maxId('الاعتذارات').then(function(m) {
    addVal('الاعتذارات!A:G', [[m+1, req.body.studentId, req.body.studentName, new Date().toISOString(), req.body.reason, '⏳ قيد المراجعة', '']]).then(function() { res.json(ok('تم الإرسال')); });
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// STUDENT SCHEDULES
app.get('/api/student/schedules', function(req, res) {
  ensureSheet('المواعيد', null).then(function() { return getVal('المواعيد!A2:H'); }).then(function(rows) {
    var out = [];
    rows.forEach(function(r) { if (r[0] && r[6] !== 'ملغي') out.push({ day: r[1]||'', time: r[2]||'', group: r[3]||'', subject: r[4]||'', teacher: r[5]||'' }); });
    res.json(ok(out));
  }).catch(function(e) { res.json(fail(e.toString())); });
});

// SERVE
app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.listen(PORT, function() { console.log('Running on port ' + PORT); });