require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz6RjIVYlovAo1H04KmEE5VNFQ2CG2Fg2IAkR53fpCg4hmr3CUejFdaC1cp__TtN1zo/exec';

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTION - call Google Apps Script
// ═══════════════════════════════════════════════════════════════
async function callAppsScript(action, params = {}, method = 'GET') {
  try {
    let url = APPS_SCRIPT_URL;
    const opts = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    };

    if (method === 'GET') {
      const queryParams = new URLSearchParams({ action, ...params });
      url += '?' + queryParams.toString();
    } else {
      opts.body = JSON.stringify({ action, ...params });
    }

    const response = await fetch(url, opts);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();

    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON Parse Error:', text.substring(0, 150));
      return { 
        success: false, 
        message: 'Invalid JSON response from Apps Script', 
        raw: text 
      };
    }
  } catch (error) {
    console.error('[API Error]', error.message);
    return { 
      success: false, 
      message: `Failed to connect to Apps Script: ${error.message}` 
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test Endpoint
app.get('/api/test', async (req, res) => {
  const result = await callAppsScript('test');
  res.json(result);
});

// ====================== LOGIN ======================
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;

    if (role === 'admin') {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';
      
      if (user === adminUser && pass === adminPass) {
        return res.json({
          success: true,
          data: { role: 'admin', name: 'Admin', id: 'admin' }
        });
      }
      return res.json({ success: false, message: 'Invalid admin credentials' });
    }

    // Student Login
    const result = await callAppsScript('verifyLogin', {
      studentId: user,
      code: pass
    });
    res.json(result);
  } catch (error) {
    console.error('Login Error:', error.message);
    res.json({ success: false, message: error.message });
  }
});

// ====================== ADMIN DASHBOARD ======================
app.get('/api/dashboard', async (req, res) => {
  const result = await callAppsScript('dashboard');
  res.json(result);
});

// ====================== STUDENTS ======================
app.get('/api/students', async (req, res) => {
  const result = await callAppsScript('getStudents');
  res.json(result);
});

app.post('/api/students/add', async (req, res) => {
  const result = await callAppsScript('addStudent', req.body, 'POST');
  res.json(result);
});

app.post('/api/students/update', async (req, res) => {
  const result = await callAppsScript('updateStudent', req.body, 'POST');
  res.json(result);
});

app.post('/api/students/delete', async (req, res) => {
  const result = await callAppsScript('deleteStudent', req.body, 'POST');
  res.json(result);
});

// ====================== PAYMENTS ======================
app.get('/api/payments', async (req, res) => {
  const result = await callAppsScript('getPayments');
  res.json(result);
});

app.post('/api/payments/add', async (req, res) => {
  const result = await callAppsScript('addPayment', req.body, 'POST');
  res.json(result);
});

app.post('/api/payments/update', async (req, res) => {
  const result = await callAppsScript('updatePayment', req.body, 'POST');
  res.json(result);
});

// ====================== GRADES ======================
app.get('/api/grades', async (req, res) => {
  const result = await callAppsScript('getGrades');
  res.json(result);
});

app.post('/api/grades/update', async (req, res) => {
  const result = await callAppsScript('updateGrade', req.body, 'POST');
  res.json(result);
});

app.post('/api/grades/add', async (req, res) => {
  const result = await callAppsScript('addGrade', req.body, 'POST');
  res.json(result);
});

// ====================== SCHEDULES ======================
app.get('/api/schedules', async (req, res) => {
  const result = await callAppsScript('getSchedules');
  res.json(result);
});

app.post('/api/schedules/add', async (req, res) => {
  const result = await callAppsScript('addSchedule', req.body, 'POST');
  res.json(result);
});

// ====================== ATTENDANCE ======================
app.post('/api/attendance/mark', async (req, res) => {
  const result = await callAppsScript('markAttendance', req.body, 'POST');
  res.json(result);
});

// ====================== EXCUSES ======================
app.get('/api/excuses', async (req, res) => {
  const result = await callAppsScript('getExcuses', { studentId: req.query.studentId });
  res.json(result);
});

app.post('/api/excuses/add', async (req, res) => {
  const result = await callAppsScript('addExcuse', req.body, 'POST');
  res.json(result);
});

app.post('/api/excuses/update', async (req, res) => {
  const result = await callAppsScript('updateExcuse', req.body, 'POST');
  res.json(result);
});

// ====================== NOTIFICATIONS ======================
app.get('/api/notifications', async (req, res) => {
  const result = await callAppsScript('getNotifications', { studentId: req.query.studentId });
  res.json(result);
});

app.post('/api/notifications/read', async (req, res) => {
  const result = await callAppsScript('readNotification', req.body, 'POST');
  res.json(result);
});

app.post('/api/notifications/readAll', async (req, res) => {
  const result = await callAppsScript('readAllNotifications', req.body, 'POST');
  res.json(result);
});

// ====================== STUDENT PORTAL ======================
app.get('/api/student/dashboard', async (req, res) => {
  const result = await callAppsScript('studentDashboard', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/profile', async (req, res) => {
  const result = await callAppsScript('studentProfile', { id: req.query.id });
  res.json(result);
});

app.post('/api/student/profile/update', async (req, res) => {
  const result = await callAppsScript('updateStudentProfile', req.body, 'POST');
  res.json(result);
});

app.get('/api/student/grades', async (req, res) => {
  const result = await callAppsScript('studentGrades', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/payments', async (req, res) => {
  const result = await callAppsScript('studentPayments', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/attendance', async (req, res) => {
  const result = await callAppsScript('studentAttendance', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/excuses', async (req, res) => {
  const result = await callAppsScript('studentExcuses', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/rank', async (req, res) => {
  const result = await callAppsScript('studentRank', { id: req.query.id });
  res.json(result);
});

// ====================== ERROR HANDLING ======================
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Start Server
app.listen(PORT, () => {
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  console.log(' 🚀 Smart Educational Center Server');
  console.log('═════════════════════════════════════════════════════');
  console.log(` 📡 Running on port : ${PORT}`);
  console.log(` 👤 Admin username  : ${process.env.ADMIN_USER || 'admin'}`);
  console.log('═════════════════════════════════════════════════════');
  console.log(`✅ Server is ready!`);
});
