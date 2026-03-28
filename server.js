const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// --- Configuration ---
const ADMIN_PASSWORD = "mersal2026admin";
const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
    volunteers: path.join(DATA_DIR, 'volunteers.json'),
    attendance: path.join(DATA_DIR, 'attendance.json'),
    activities: path.join(DATA_DIR, 'activities.json'),
    settings: path.join(DATA_DIR, 'settings.json')
};

// --- Helpers ---
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const readJSON = (file) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : [];
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

if (!fs.existsSync(FILES.settings)) writeJSON(FILES.settings, { hoursTarget: 130 });
if (!fs.existsSync(FILES.activities)) writeJSON(FILES.activities, [
    { id: '1', name: 'Medical Services' }, { id: '2', name: 'Education' }, { id: '3', name: 'Social Services' }
]);

// ===================
// AUTH ROUTES (Email Based)
// ===================

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const volunteers = readJSON(FILES.volunteers);
    // البحث بالمستخدم بالبريد وكلمة المرور
    const user = volunteers.find(u => u.email === email && u.password === password);
    if (user) {
        // إرجاع بيانات المستخدم بدون كلمة المرور للأمان
        const { password, ...safeUser } = user;
        res.json(safeUser);
    } else {
        res.json(null);
    }
});

app.post('/api/register', (req, res) => {
    const volunteers = readJSON(FILES.volunteers);
    const { name, email, password } = req.body;

    if (volunteers.find(u => u.email === email)) {
        return res.status(400).json({ error: 'Email already exists' });
    }

    const user = { 
        id: Date.now().toString(), 
        name, 
        email,
        password, // في التطبيق الحقيقي يجب تشفيرها
        avatar: null, 
        createdAt: new Date().toISOString() 
    };
    
    volunteers.push(user);
    writeJSON(FILES.volunteers, volunteers);
    
    const { password: pwd, ...safeUser } = user;
    res.json(safeUser);
});

// ===================
// USER & PROFILE ROUTES
// ===================

app.post('/api/user/update', (req, res) => {
    let volunteers = readJSON(FILES.volunteers);
    const { userId, name, email } = req.body;
    const index = volunteers.findIndex(v => v.id === userId);
    
    if (index !== -1) {
        if (name) volunteers[index].name = name;
        if (email) volunteers[index].email = email;
        writeJSON(FILES.volunteers, volunteers);
        const { password, ...safeUser } = volunteers[index];
        res.json(safeUser);
    } else res.status(404).json({ error: 'User not found' });
});

app.post('/api/user/avatar', (req, res) => {
    let volunteers = readJSON(FILES.volunteers);
    const { userId, avatar } = req.body;
    const index = volunteers.findIndex(v => v.id === userId);
    if (index !== -1) {
        volunteers[index].avatar = avatar;
        writeJSON(FILES.volunteers, volunteers);
        res.json({ success: true });
    } else res.status(404).json({ error: 'User not found' });
});

app.delete('/api/user/delete', (req, res) => {
    let volunteers = readJSON(FILES.volunteers);
    let attendance = readJSON(FILES.attendance);
    const { userId } = req.body;
    volunteers = volunteers.filter(v => v.id !== userId);
    attendance = attendance.filter(a => a.volunteerId !== userId);
    writeJSON(FILES.volunteers, volunteers);
    writeJSON(FILES.attendance, attendance);
    res.json({ success: true });
});

// ===================
// ACTIVITY & ATTENDANCE
// ===================

app.get('/api/activities', (req, res) => res.json(readJSON(FILES.activities)));

app.post('/api/attendance/checkin', (req, res) => {
    const attendance = readJSON(FILES.attendance);
    const { volunteerId, activityName } = req.body;
    const now = new Date();
    const record = {
        id: Date.now().toString(),
        volunteerId,
        dateStr: now.toISOString().split('T')[0],
        checkIn: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        checkInTime: now.getTime(),
        checkOut: null, duration: 0, type: 'live',
        activityName: activityName || 'General',
        feedback: ''
    };
    attendance.push(record);
    writeJSON(FILES.attendance, attendance);
    res.json(record);
});

app.post('/api/attendance/checkout', (req, res) => {
    const attendance = readJSON(FILES.attendance);
    const { volunteerId, feedback } = req.body;
    const now = new Date();
    const record = attendance.find(r => r.volunteerId === volunteerId && !r.checkOut);
    if (!record) return res.status(400).json({ error: 'No active session' });
    
    record.checkOut = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    record.duration = Math.round((now.getTime() - record.checkInTime) / 3600000 * 10) / 10;
    record.feedback = feedback || '';
    writeJSON(FILES.attendance, attendance);
    res.json(record);
});

// Manual Entry (Enhanced)
app.post('/api/attendance/manual', (req, res) => {
    const attendance = readJSON(FILES.attendance);
    const { volunteerId, date, checkIn, checkOut, activityName, feedback } = req.body;
    
    const start = new Date(`${date}T${checkIn}`);
    const end = new Date(`${date}T${checkOut}`);
    const duration = Math.round((end - start) / 3600000 * 10) / 10;

    attendance.push({
        id: Date.now().toString(),
        volunteerId, dateStr: date, checkIn, checkOut, duration,
        type: 'manual', activityName: activityName || 'General',
        feedback: feedback || ''
    });
    writeJSON(FILES.attendance, attendance);
    res.json({ success: true });
});

app.get('/api/attendance/:id', (req, res) => {
    const attendance = readJSON(FILES.attendance);
    res.json(attendance.filter(r => r.volunteerId === req.params.id).reverse());
});

// ===================
// ADMIN & EXPORT
// ===================

app.get('/api/settings', (req, res) => res.json(readJSON(FILES.settings)));
app.post('/api/admin/login', (req, res) => res.json({ success: req.body.password === ADMIN_PASSWORD }));
app.get('/api/admin/stats', (req, res) => {
    const volunteers = readJSON(FILES.volunteers);
    const attendance = readJSON(FILES.attendance);
    const settings = readJSON(FILES.settings);
    const today = new Date().toISOString().split('T')[0];
    res.json({
        totalVolunteers: volunteers.length,
        totalHours: attendance.reduce((s, r) => s + (r.duration || 0), 0).toFixed(1),
        activeToday: attendance.filter(r => r.dateStr === today).length,
        hoursTarget: settings.hoursTarget
    });
});
app.get('/api/admin/all', (req, res) => res.json({ volunteers: readJSON(FILES.volunteers), attendance: readJSON(FILES.attendance), activities: readJSON(FILES.activities) }));

app.post('/api/admin/user/update', (req, res) => {
    let volunteers = readJSON(FILES.volunteers);
    const { userId, name, email } = req.body; // Updated to email
    const index = volunteers.findIndex(v => v.id === userId);
    if (index !== -1) {
        volunteers[index].name = name;
        volunteers[index].email = email;
        writeJSON(FILES.volunteers, volunteers);
        const { password, ...safeUser } = volunteers[index];
        res.json(safeUser);
    } else res.status(404).json({ error: 'Not found' });
});

app.delete('/api/admin/user', (req, res) => {
    let volunteers = readJSON(FILES.volunteers); let attendance = readJSON(FILES.attendance);
    volunteers = volunteers.filter(v => v.id !== req.body.userId);
    attendance = attendance.filter(a => a.volunteerId !== req.body.userId);
    writeJSON(FILES.volunteers, volunteers); writeJSON(FILES.attendance, attendance);
    res.json({ success: true });
});

app.post('/api/admin/activity', (req, res) => {
    const activities = readJSON(FILES.activities);
    activities.push({ id: Date.now().toString(), name: req.body.name });
    writeJSON(FILES.activities, activities);
    res.json(activities);
});
app.delete('/api/admin/activity', (req, res) => {
    let activities = readJSON(FILES.activities).filter(a => a.id !== req.body.id);
    writeJSON(FILES.activities, activities);
    res.json(activities);
});
app.delete('/api/admin/log', (req, res) => {
    let attendance = readJSON(FILES.attendance).filter(l => l.id !== req.body.logId);
    writeJSON(FILES.attendance, attendance);
    res.json({ success: true });
});

app.get('/api/export', async (req, res) => {
    const volunteers = readJSON(FILES.volunteers);
    const attendance = readJSON(FILES.attendance);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Report');
    worksheet.columns = [
        { header: 'Date', key: 'date', width: 12 }, { header: 'Name', key: 'name', width: 20 },
        { header: 'Activity', key: 'activityName', width: 20 }, { header: 'In', key: 'in', width: 8 },
        { header: 'Out', key: 'out', width: 8 }, { header: 'Hours', key: 'hours', width: 8 },
        { header: 'Feedback', key: 'feedback', width: 30 }
    ];
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563eb' } };
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    attendance.forEach(log => {
        const user = volunteers.find(v => v.id === log.volunteerId) || {};
        worksheet.addRow({ date: log.dateStr, name: user.name, activityName: log.activityName, in: log.checkIn, out: log.checkOut || '-', hours: log.duration, feedback: log.feedback });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mersal_Data.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
