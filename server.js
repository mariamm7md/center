const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1TMDiMSAtyjk4iPAsLsMoo-uf7nUeJuOwKeOtPZ3o3xw';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let credentials;
try {
  credentials = process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : require('./service-account.json');
} catch (e) {
  console.error('❌ لم يتم العثور على بيانات المصادقة');
  app.get('*', (req, res) => {
    res.status(500).send(`<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#070b12;color:#e4e9f2;font-family:system-ui;text-align:center;padding:20px"><div><div style="font-size:60px;margin-bottom:20px">⚠️</div><h2 style="color:#ff5757;margin-bottom:12px">خطأ في المصادقة</h2><p style="color:#6b7a94">أضف متغير <code style="background:#1c2d48;padding:2px 8px;border-radius:4px;color:#00d4aa">GOOGLE_CREDENTIALS</code> في Railway</p></div></div>`);
  });
}

const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });

let SH = {};
const SH_DEFAULTS = { students:'الطلاب', attendance:'الحضور', payments:'المدفوعات', grades:'الدرجات', schedules:'المواعيد', excuses:'الاعتذارات' };
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

async function detectSheets() {
  try {
    const r = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const names = r.data.sheets.map(s => s.properties.title);
    for (const key in SH_DEFAULTS) {
      const ex = SH_DEFAULTS[key];
      SH[key] = names.includes(ex) ? ex : (names.find(n => n.includes(ex.replace('ال',''))) || ex);
    }
    console.log('✅ الأوراق:', JSON.stringify(SH));
  } catch (e) { SH = { ...SH_DEFAULTS }; }
}

function colLetter(i) { let s=''; while(i>=0){s=String.fromCharCode(65+(i%26))+s;i=Math.floor(i/26)-1;} return s; }
async function getRows(sn) { try{const r=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:ZZ`});return r.data.values||[];}catch(e){return[];} }
async function setRange(sn,rng,vals) { try{await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${sn}!${rng}`,valueInputOption:'USER_ENTERED',requestBody:{values:vals}});return true;}catch(e){return false;} }
async function appendRow(sn,vals) { try{await sheets.spreadsheets.values.append({spreadsheetId:SPREADSHEET_ID,range:`${sn}!A:A`,valueInputOption:'USER_ENTERED',requestBody:{values:[vals]}});return true;}catch(e){return false;} }
async function deleteSheetRow(sn,idx) { try{const r=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});const sid=r.data.sheets.find(s=>s.properties.title===sn).properties.sheetId;await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{deleteDimension:{range:{sheetId:sid,dimension:'ROWS',startIndex:idx+1,endIndex:idx+2}}}]}});return true;}catch(e){return false;} }
async function nextId(sn) { const rows=await getRows(sn); if(rows.length<=1)return 1; const ids=rows.slice(1).map(r=>parseInt(r[0])).filter(id=>!isNaN(id)); return ids.length?Math.max(...ids)+1:1; }
function safeNum(v){const n=parseFloat(v);return isNaN(n)?0:n;}
function safeStr(v){return v==null?'':String(v).trim();}

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.get('/api/setup',async(req,res)=>{
  try{
    const ex=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
    const exN=ex.data.sheets.map(s=>s.properties.title);
    const toAdd=[
      {name:'الطلاب',h:['الرقم','الاسم','الصف','المادة','ولي الأمر','واتساب','تليفون الطالب','تليفون ثاني','المجموعة','الاشتراك','الحالة','ملاحظات']},
      {name:'الحضور',h:['رقم الطالب','اسم الطالب','المجموعة','الشهر','السنة',...Array.from({length:31},(_,i)=>String(i+1))]},
      {name:'المدفوعات',h:['اسم الطالب','المجموعة','الشهر','السنة','الاشتراك','المدفوع','المتبقي','الحالة','ملاحظات']},
      {name:'الدرجات',h:['الرقم','الاسم','امتحان1','امتحان2','امتحان3','امتحان4','واجب1','واجب2','واجب3','المتوسط','التقدير','ملاحظات']},
      {name:'المواعيد',h:['الرقم','اليوم','الوقت','المجموعة','المادة','المدرس','الحالة','ملاحظات']},
      {name:'الاعتذارات',h:['الرقم','رقم الطالب','اسم الطالب','التاريخ','السبب','الحالة','الرد']}
    ];
    let c=0;
    for(const s of toAdd){if(!exN.includes(s.name)){await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,requestBody:{requests:[{addSheet:{properties:{title:s.name}}}]}});await appendRow(s.name,s.h);c++;}}
    await detectSheets();
    res.json({success:true,message:`تم إنشاء ${c} أوراق`,sheets:SH});
  }catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/verifyLogin',async(req,res)=>{
  try{
    const{role,user,pass}=req.body;
    if(role==='admin'){
      if(user==='admin'&&pass==='admin123')return res.json({success:true,data:{role:'admin',name:'المدير'}});
      return res.json({success:false,message:'بيانات خاطئة'});
    }
    const rows=(await getRows(SH.students)).slice(1);
    const stu=rows.find(r=>safeStr(r[0])===safeStr(user));
    if(!stu)return res.json({success:false,message:'رقم الطالب غير موجود'});
    const wa=safeStr(stu[5]),last4=wa.length>=4?wa.slice(-4):'';
    if(pass===last4||pass==='1234')return res.json({success:true,data:{role:'student',name:safeStr(stu[1]),studentId:safeStr(stu[0])}});
    res.json({success:false,message:'رمز التحقق خاطئ'});
  }catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/dashboard',async(req,res)=>{
  try{
    const sr=(await getRows(SH.students)).slice(1),ts=sr.length,as=sr.filter(s=>safeStr(s[10]).includes('نشط')).length;
    const pr=(await getRows(SH.payments)).slice(1);let tp=0,rm=0;pr.forEach(p=>{tp+=safeNum(p[5]);rm+=safeNum(p[6]);});
    const now=new Date(),cm=MONTHS_AR[now.getMonth()],cy=String(now.getFullYear()),td=now.getDate();
    const ar=(await getRows(SH.attendance)).slice(1);let tP=0,tA=0;
    ar.forEach(r=>{if(safeStr(r[3])===cm&&safeStr(r[4])===cy){const v=safeStr(r[4+td]);if(v==='ح')tP++;if(v==='غ')tA++;}});
    const er=(await getRows(SH.excuses)).slice(1),pe=er.filter(e=>safeStr(e[5]).includes('قيد')).length;
    res.json({success:true,data:{totalStudents:ts,activeStudents:as,totalPaid:tp,remaining:rm,currentMonth:cm,todayPresent:tP,todayAbsent:tA,pendingExcuses:pe}});
  }catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/students',async(req,res)=>{
  try{const rows=(await getRows(SH.students)).slice(1);res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),grade:safeStr(r[2]),subject:safeStr(r[3]),parentName:safeStr(r[4]),whatsapp:safeStr(r[5]),studentPhone:safeStr(r[6]),phone2:safeStr(r[7]),group:safeStr(r[8]),subscription:safeStr(r[9]),status:safeStr(r[10])}))});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/students/:id',async(req,res)=>{
  try{const rows=(await getRows(SH.students)).slice(1);const s=rows.find(r=>safeStr(r[0])===req.params.id);if(!s)return res.json({success:false,message:'غير موجود'});res.json({success:true,data:{id:safeStr(s[0]),name:safeStr(s[1]),grade:safeStr(s[2]),subject:safeStr(s[3]),parentName:safeStr(s[4]),whatsapp:safeStr(s[5]),studentPhone:safeStr(s[6]),phone2:safeStr(s[7]),group:safeStr(s[8]),subscription:safeStr(s[9]),status:safeStr(s[10])}});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/students/add',async(req,res)=>{
  try{const d=req.body,id=await nextId(SH.students);await appendRow(SH.students,[id,safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription)||'0',safeStr(d.status),'']);res.json({success:true,data:{id}});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/students/update',async(req,res)=>{
  try{const d=req.body,all=await getRows(SH.students),idx=all.findIndex(r=>safeStr(r[0])===safeStr(d.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});await setRange(SH.students,`B${idx+1}:K${idx+1}`,[[safeStr(d.name),safeStr(d.grade),safeStr(d.subject),safeStr(d.parentName),safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2),safeStr(d.group),safeStr(d.subscription)||'0',safeStr(d.status)]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/students/delete',async(req,res)=>{
  try{const all=await getRows(SH.students),idx=all.findIndex(r=>safeStr(r[0])===safeStr(req.body.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});await deleteSheetRow(SH.students,idx-1);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/attendance',async(req,res)=>{
  try{const{month,year}=req.query,rows=(await getRows(SH.attendance)).slice(1);const data=rows.filter(r=>safeStr(r[3])===(month||'')&&safeStr(r[4])===String(year||'')).map(r=>{const days=[];for(let d=0;d<31;d++)days.push(safeStr(r[5+d]));return{id:safeStr(r[0]),name:safeStr(r[1]),group:safeStr(r[2]),days};});res.json({success:true,data});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/attendance/save',async(req,res)=>{
  try{const{month,year,records}=req.body,sr=(await getRows(SH.students)).slice(1),ar=await getRows(SH.attendance);
  for(const rec of records){const dn=parseInt(rec.day),dc=colLetter(4+dn),ri=ar.findIndex(r=>safeStr(r[0])===safeStr(rec.studentId)&&safeStr(r[3])===month&&safeStr(r[4])===String(year));
  if(ri!==-1){await setRange(SH.attendance,`${dc}${ri+1}`,[[rec.status]]);}else{const stu=sr.find(s=>safeStr(s[0])===safeStr(rec.studentId));const nr=[rec.studentId,stu?safeStr(stu[1]):'',stu?safeStr(stu[8]):'',month,String(year)];const days=Array(31).fill('');days[dn-1]=rec.status;await appendRow(SH.attendance,[...nr,...days]);}}
  res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/payments',async(req,res)=>{
  try{const rows=(await getRows(SH.payments)).slice(1);res.json({success:true,data:rows.map((r,i)=>({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8]),rowIndex:i}))});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/payments/add',async(req,res)=>{
  try{const d=req.body,sub=safeNum(d.subscription),pd=safeNum(d.paid),rem=sub-pd,st=rem<=0?'✅ مكتمل':'⚠️ غير مكتمل';await appendRow(SH.payments,[safeStr(d.studentName),safeStr(d.group),safeStr(d.month),String(d.year||''),sub,pd,rem,st,safeStr(d.notes)]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/payments/update',async(req,res)=>{
  try{const{rowIndex,newPaid}=req.body,rows=await getRows(SH.payments),row=rows[rowIndex+1];if(!row)return res.json({success:false,message:'غير موجود'});const sub=safeNum(row[4]),up=safeNum(row[5])+safeNum(newPaid),rem=sub-up,st=rem<=0?'✅ مكتمل':'⚠️ غير مكتمل';await setRange(SH.payments,`F${rowIndex+2}:H${rowIndex+2}`,[[up,rem,st]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/grades',async(req,res)=>{
  try{const rows=(await getRows(SH.grades)).slice(1);res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}))});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/grades/update',async(req,res)=>{
  try{const d=req.body,rows=(await getRows(SH.grades)).slice(1),idx=rows.findIndex(r=>safeStr(r[0])===String(d.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});const ri=idx+1;await setRange(SH.grades,`C${ri}:L${ri}`,[[safeStr(d.exam1),safeStr(d.exam2),safeStr(d.exam3),safeStr(d.exam4),safeStr(d.hw1),safeStr(d.hw2),safeStr(d.hw3),safeStr(d.avg),safeStr(d.grade),safeStr(d.notes)]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/schedules',async(req,res)=>{
  try{const rows=(await getRows(SH.schedules)).slice(1);res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5]),status:safeStr(r[6])||'نشط',notes:safeStr(r[7])}))});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/schedules/add',async(req,res)=>{
  try{const d=req.body,id=await nextId(SH.schedules);await appendRow(SH.schedules,[id,safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),'نشط',safeStr(d.notes)]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/schedules/update',async(req,res)=>{
  try{const d=req.body,rows=(await getRows(SH.schedules)).slice(1),idx=rows.findIndex(r=>safeStr(r[0])===String(d.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});await setRange(SH.schedules,`B${idx+1}:H${idx+1}`,[[safeStr(d.day),safeStr(d.time),safeStr(d.group),safeStr(d.subject),safeStr(d.teacher),safeStr(d.status)||'نشط',safeStr(d.notes)]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/schedules/delete',async(req,res)=>{
  try{const rows=(await getRows(SH.schedules)).slice(1),idx=rows.findIndex(r=>safeStr(r[0])===String(req.body.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});await deleteSheetRow(SH.schedules,idx-1);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/excuses',async(req,res)=>{
  try{const rows=(await getRows(SH.excuses)).slice(1);res.json({success:true,data:rows.map(r=>({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}))});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/excuses/update',async(req,res)=>{
  try{const d=req.body,rows=(await getRows(SH.excuses)).slice(1),idx=rows.findIndex(r=>safeStr(r[0])===String(d.id));if(idx===-1)return res.json({success:false,message:'غير موجود'});await setRange(SH.excuses,`F${idx+1}:G${idx+1}`,[[safeStr(d.status),safeStr(d.reply)]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/alerts',async(req,res)=>{
  try{const now=new Date(),cm=MONTHS_AR[now.getMonth()],cy=String(now.getFullYear()),td=now.getDate();const ar=(await getRows(SH.attendance)).slice(1),sr=(await getRows(SH.students)).slice(1);const aids=ar.filter(r=>safeStr(r[3])===cm&&safeStr(r[4])===cy&&safeStr(r[4+td])==='غ').map(r=>safeStr(r[0]));const alerts=aids.map(sid=>{const stu=sr.find(s=>safeStr(s[0])===sid);const n=stu?safeStr(stu[1]):sid;return{name:n,whatsapp:stu?safeStr(stu[5]):'',message:`عذراً، تم تسجيل غياب ${n} اليوم في المركز. يرجى التواصل معنا.`};});res.json({success:true,data:alerts});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/sheets',async(req,res)=>{
  try{const r=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});res.json({success:true,data:r.data.sheets.map(s=>({name:s.properties.title,gid:s.properties.sheetId}))});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/dashboard',async(req,res)=>{
  try{const{id}=req.query,now=new Date(),cm=MONTHS_AR[now.getMonth()],cy=String(now.getFullYear());const sr=(await getRows(SH.students)).slice(1),stu=sr.find(r=>safeStr(r[0])===String(id));if(!stu)return res.json({success:false,message:'غير موجود'});const ar=(await getRows(SH.attendance)).slice(1),aRow=ar.find(r=>safeStr(r[0])===String(id)&&safeStr(r[3])===cm&&safeStr(r[4])===cy);let p=0,a=0,l=0;if(aRow){for(let d=0;d<31;d++){const v=safeStr(aRow[5+d]);if(v==='ح')p++;else if(v==='غ')a++;else if(v==='ت')l++;}}const tot=p+a+l,rate=tot>0?Math.round((p/tot)*100):0;const gr=(await getRows(SH.grades)).slice(1),gRow=gr.find(r=>safeStr(r[0])===String(id));const pr=(await getRows(SH.payments)).slice(1),uc=pr.filter(p=>safeStr(p[0])===safeStr(stu[1])&&safeStr(p[7]).includes('غير')).length;res.json({success:true,data:{attRate:rate,present:p,absent:a,late:l,avgGrade:gRow?safeStr(gRow[9]):'-',gradeLabel:gRow?safeStr(gRow[10]):'-',unpaidCount:uc,month:cm}});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/profile',async(req,res)=>{
  try{const rows=(await getRows(SH.students)).slice(1),s=rows.find(r=>safeStr(r[0])===String(req.query.id));if(!s)return res.json({success:false,message:'غير موجود'});res.json({success:true,data:{id:safeStr(s[0]),name:safeStr(s[1]),grade:safeStr(s[2]),subject:safeStr(s[3]),parentName:safeStr(s[4]),whatsapp:safeStr(s[5]),studentPhone:safeStr(s[6]),phone2:safeStr(s[7]),group:safeStr(s[8]),subscription:safeStr(s[9]),status:safeStr(s[10])}});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/student/profile/update',async(req,res)=>{
  try{const d=req.body,rows=(await getRows(SH.students)).slice(1),idx=rows.findIndex(r=>safeStr(r[0])===String(d.studentId));if(idx===-1)return res.json({success:false,message:'غير موجود'});await setRange(SH.students,`F${idx+1}:H${idx+1}`,[[safeStr(d.whatsapp),safeStr(d.studentPhone),safeStr(d.phone2)]]);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/attendance',async(req,res)=>{
  try{const now=new Date(),cm=MONTHS_AR[now.getMonth()],cy=String(now.getFullYear()),rows=(await getRows(SH.attendance)).slice(1),row=rows.find(r=>safeStr(r[0])===String(req.query.id)&&safeStr(r[3])===cm&&safeStr(r[4])===cy);const days=[];if(row){for(let d=0;d<31;d++)days.push(safeStr(row[5+d]));}res.json({success:true,data:{month:cm,days}});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/student/attendance/mark',async(req,res)=>{
  try{const{studentId,status}=req.body,now=new Date(),today=now.getDate(),cm=MONTHS_AR[now.getMonth()],cy=String(now.getFullYear()),dc=colLetter(4+today),sr=(await getRows(SH.students)).slice(1),stu=sr.find(r=>safeStr(r[0])===String(studentId)),ar=await getRows(SH.attendance),ri=ar.findIndex(r=>safeStr(r[0])===String(studentId)&&safeStr(r[3])===cm&&safeStr(r[4])===cy);if(ri!==-1){await setRange(SH.attendance,`${dc}${ri+1}`,[[status]]);}else{const nr=[studentId,stu?safeStr(stu[1]):'',stu?safeStr(stu[8]):'',cm,cy];const days=Array(31).fill('');days[today-1]=status;await appendRow(SH.attendance,[...nr,...days]);}res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/grades',async(req,res)=>{
  try{const rows=(await getRows(SH.grades)).slice(1);const data=rows.filter(r=>safeStr(r[0])===String(req.query.id)).map(r=>({id:safeStr(r[0]),name:safeStr(r[1]),exam1:safeStr(r[2]),exam2:safeStr(r[3]),exam3:safeStr(r[4]),exam4:safeStr(r[5]),hw1:safeStr(r[6]),hw2:safeStr(r[7]),hw3:safeStr(r[8]),avg:safeStr(r[9]),grade:safeStr(r[10]),notes:safeStr(r[11])}));res.json({success:true,data});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/payments',async(req,res)=>{
  try{const rows=(await getRows(SH.payments)).slice(1);const data=rows.filter(r=>safeStr(r[0])===safeStr(req.query.name)).map(r=>({name:safeStr(r[0]),group:safeStr(r[1]),monthYear:`${safeStr(r[2])}/${safeStr(r[3])}`,subscription:safeStr(r[4]),paid:safeStr(r[5]),remaining:safeStr(r[6]),status:safeStr(r[7]),notes:safeStr(r[8])}));res.json({success:true,data});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/excuses',async(req,res)=>{
  try{const rows=(await getRows(SH.excuses)).slice(1);const data=rows.filter(r=>safeStr(r[1])===String(req.query.id)).map(r=>({id:safeStr(r[0]),studentId:safeStr(r[1]),studentName:safeStr(r[2]),date:safeStr(r[3]),reason:safeStr(r[4]),status:safeStr(r[5])||'قيد المراجعة',reply:safeStr(r[6])}));res.json({success:true,data});}catch(e){res.json({success:false,message:e.message});}
});

app.post('/api/student/excuses/add',async(req,res)=>{
  try{const d=req.body,id=await nextId(SH.excuses),now=new Date();await appendRow(SH.excuses,[id,safeStr(d.studentId),safeStr(d.studentName),`${now.getFullYear()}/${now.getMonth()+1}/${now.getDate()}`,safeStr(d.reason),'قيد المراجعة','']);res.json({success:true});}catch(e){res.json({success:false,message:e.message});}
});

app.get('/api/student/schedules',async(req,res)=>{
  try{const rows=(await getRows(SH.schedules)).slice(1);const data=rows.filter(r=>(safeStr(r[6])||'نشط')==='نشط').map(r=>({day:safeStr(r[1]),time:safeStr(r[2]),group:safeStr(r[3]),subject:safeStr(r[4]),teacher:safeStr(r[5])}));res.json({success:true,data});}catch(e){res.json({success:false,message:e.message});}
});

app.use((err,req,res,next)=>{console.error('خطأ:',err.message);res.status(500).json({success:false,message:'خطأ في الخادم'});});

app.listen(PORT,async()=>{await detectSheets();console.log(`🚀 http://localhost:${PORT}`);});
