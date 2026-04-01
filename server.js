require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════
// GOOGLE APPS SCRIPT API URL
// ═══════════════════════════════════════════════════════════════
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwKGwkHY6WSsF2fAU4KUSYvbgsH2wDA3P7t6hWFNY6r5-G2QXVnvMmnTcsxDsfCd2a-/exec';

// ═══════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(morgan('combined'));
// Increased limit to 10mb to handle image uploads (base64)
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

// Generic function to call Apps Script
async function callAppsScript(action, params = {}, method = 'GET') {
  try {
    let url = APPS_SCRIPT_URL;
    const opts = {
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'text/plain;charset=utf-8'
      }
    };

    if (method === 'GET') {
      const queryParams = new URLSearchParams({ action, ...params });
      url += '?' + queryParams.toString();
    } else {
      // POST requests to Apps Script require a JSON payload
      opts.body = JSON.stringify({ action, ...params });
    }

    const response = await fetch(url, opts);
    const text = await response.text();

    // Try to parse JSON, handle errors
    try {
      return JSON.parse(text);
    } catch (parseError) {
      console.error('JSON Parse Error:', text.substring(0, 100));
      return { success: false, message: 'Invalid JSON response from Apps Script', raw: text };
    }
  } catch (error) {
    console.error('[API Error]', error.message);
    return { success: false, message: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  const result = await callAppsScript('test');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// LOGIN API
// ═══════════════════════════════════════════════════════════════
app.post('/api/verifyLogin', async (req, res) => {
  try {
    const { role, user, pass } = req.body;

    // Admin login (Check local environment variables)
    if (role === 'admin') {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminPass = process.env.ADMIN_PASS || 'admin123';

      if (user === adminUser && pass === adminPass) {
        return res.json({
          success: true,
          data: {
            role: 'admin',
            name: 'Admin',
            id: 'admin'
          }
        });
      }
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    // Student login via Apps Script
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

// ═══════════════════════════════════════════════════════════════
// DASHBOARD API
// ═══════════════════════════════════════════════════════════════
app.get('/api/dashboard', async (req, res) => {
  const result = await callAppsScript('dashboard');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS API
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// PAYMENTS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/payments', async (req, res) => {
  const result = await callAppsScript('getPayments');
  res.json(result);
});

app.post('/api/payments/add', async (req, res) => {
  const result = await callAppsScript('addPayment', req.body, 'POST');
  res.json(result);
});

// Edit Payment endpoint
app.post('/api/payments/edit', async (req, res) => {
  const result = await callAppsScript('updatePayment', req.body, 'POST');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// GRADES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/grades', async (req, res) => {
  const result = await callAppsScript('getGrades');
  res.json(result);
});

app.post('/api/grades/update', async (req, res) => {
  const result = await callAppsScript('updateGrade', req.body, 'POST');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// SCHEDULES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/schedules', async (req, res) => {
  const result = await callAppsScript('getSchedules');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE API
// ═══════════════════════════════════════════════════════════════
app.post('/api/attendance/mark', async (req, res) => {
  const result = await callAppsScript('markAttendance', req.body, 'POST');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// EXCUSES API
// ═══════════════════════════════════════════════════════════════
app.get('/api/excuses', async (req, res) => {
  const result = await callAppsScript('getExcuses');
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

// ═══════════════════════════════════════════════════════════════
// STUDENT PORTAL API
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/dashboard', async (req, res) => {
  const result = await callAppsScript('studentDashboard', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/profile', async (req, res) => {
  const result = await callAppsScript('studentProfile', { id: req.query.id });
  res.json(result);
});

// Profile Update Route (Name & Photo)
app.post('/api/student/updateProfile', async (req, res) => {
  // req.body contains { id, name, photo (base64 string) }
  const result = await callAppsScript('updateStudentProfile', req.body, 'POST');
  res.json(result);
});

app.get('/api/student/grades', async (req, res) => {
  const result = await callAppsScript('studentGrades', { id: req.query.id });
  res.json(result);
});

// Student Payments - now uses ID for backend lookup
app.get('/api/student/payments', async (req, res) => {
  const result = await callAppsScript('studentPayments', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/attendance', async (req, res) => {
  const result = await callAppsScript('studentAttendance', { id: req.query.id });
  res.json(result);
});

app.get('/api/student/schedules', async (req, res) => {
  const result = await callAppsScript('getSchedules');
  res.json(result);
});

app.get('/api/student/excuses', async (req, res) => {
  const result = await callAppsScript('studentExcuses', { id: req.query.id });
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// NOTIFICATIONS API
// ═══════════════════════════════════════════════════════════════
app.get('/api/student/notifications', async (req, res) => {
  const result = await callAppsScript('getNotifications', { studentId: req.query.id });
  res.json(result);
});

app.post('/api/notifications/read', async (req, res) => {
  const result = await callAppsScript('readNotification', req.body, 'POST');
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('');
  console.log('═════════════════════════════════════════════════════');
  console.log(' 🚀 Smart Educational Center Server');
  console.log('═════════════════════════════════════════════════════');
  console.log(` 📡 Port: ${PORT}`);
  console.log(` 🔗 API: Apps Script Connected`);
  console.log(` 👤 Admin: ${process.env.ADMIN_USER || 'admin'}`);
  console.log('═════════════════════════════════════════════════════');
  console.log('');
});
