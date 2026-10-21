const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
let locks=0;const props={SETUP_ADMIN_PASSWORD:'PASSWORD_PTS_2026_TES!'},cache={},books={};let bookcount=0;
class Range{constructor(sheet,r,c,h=1,w=1){Object.assign(this,{sheet,r,c,h,w});}getValues(){return Array.from({length:this.h},(_,i)=>Array.from({length:this.w},(_,j)=>this.sheet.rows[this.r-1+i]?.[this.c-1+j]??''));}setValue(v){this.sheet.ensure(this.r,this.c);this.sheet.rows[this.r-1][this.c-1]=v;return this;}setValues(rows){rows.forEach((line,i)=>line.forEach((v,j)=>{this.sheet.ensure(this.r+i,this.c+j);this.sheet.rows[this.r+i-1][this.c+j-1]=v;}));return this;}setBackground(){return this;}setFontColor(){return this;}setFontWeight(){return this;}setWrap(){return this;}setVerticalAlignment(){return this;}createFilter(){return this;}}
class Sheet{constructor(name){this.name=name;this.rows=[];}getDataRange(){return new Range(this,1,1,Math.max(this.rows.length,1),Math.max(...this.rows.map(a=>a.length),1));}appendRow(row){this.rows.push([...row]);return this;}getRange(r,c,h,w){return new Range(this,r,c,h,w);}ensure(r,c){while(this.rows.length<r)this.rows.push([]);while(this.rows[r-1].length<c)this.rows[r-1].push('');}setName(n){this.name=n;return this;}getLastColumn(){return Math.max(0,...this.rows.map(r=>r.length));}setFrozenRows(){return this;}setColumnWidth(){return this;}setRowHeight(){return this;}}
class Book{constructor(name){this.name=name;this.id=String(++bookcount);books[this.id]=this;this.sheets=[new Sheet('Sheet1')];}getSheets(){return this.sheets;}getSheetByName(n){return this.sheets.find(s=>s.name===n)||null;}insertSheet(n){const x=new Sheet(n);this.sheets.push(x);return x;}getId(){return this.id;}getUrl(){return 'https://docs.google.com/spreadsheets/d/'+this.id+'/edit';}}
const ctx={console,Date,Math,JSON,Number,String,Array,Object,RegExp,Map,Set,Error,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>{props[k]=v;},setProperties:o=>Object.assign(props,o),deleteProperty:k=>delete props[k]})},
 SpreadsheetApp:{create:n=>new Book(n),openById:id=>books[id],flush:()=>{}},
 Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'UTF_8'},DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(algo,str)=>[...crypto.createHash('sha256').update(str).digest()].map(x=>x>127?x-256:x),formatDate:(d,tz,p)=>d.toISOString()},
 LockService:{getScriptLock:()=>({tryLock:()=>{locks++;return true;},releaseLock:()=>{}})},
 CacheService:{getScriptCache:()=>({put:(k,v)=>{cache[k]=v;},get:k=>cache[k]})},
 Session:{getScriptTimeZone:()=> 'Asia/Jakarta'},
 ContentService:{MimeType:{JSON:'application/json'},createTextOutput:s=>({content:s,mime:'text/plain',setMimeType(m){this.mime=m;return this;},getContent(){return this.content;}})}
};
const ROOT=path.join(__dirname,'..'),src=f=>{const p=path.join(ROOT,f);if(!fs.existsSync(p))throw Error(f+' tidak ditemukan. Salin bank soal pribadi Anda ke '+f+' sebelum menjalankan uji.');return fs.readFileSync(p,'utf8');};
// Urutan sama dengan proyek Apps Script: Code.gs lalu Questions.gs.
vm.createContext(ctx);vm.runInContext(src('gas/Code.gs')+'\n'+src('gas/Questions.gs'),ctx);
// Semua panggilan melewati doPost + JSON, sama seperti fetch dari GitHub Pages.
function post(body){const out=ctx.doPost({postData:{type:'text/plain',contents:body}});if(out.mime!=='application/json')throw Error('API must answer JSON');return JSON.parse(out.getContent());}
function ok(v,desc){if(!v)throw Error('FAILED: '+desc);console.log('✓ '+desc);}function call(name,...args){const r=post(JSON.stringify({fn:name,args}));if(!r.ok)throw Error(r.error);return r.result;}let fails=0;function expectErr(fn,msg){try{fn();throw Error('Expected error: '+msg)}catch(e){if(!e.message.includes(msg))throw e;}}
const setup=ctx.setupApplication();ok(setup.message.includes('siap'),'database initialized');ok(!props.SETUP_ADMIN_PASSWORD,'setup password removed');
const health=JSON.parse(ctx.doGet().getContent());ok(health.ok&&health.result.configured&&health.result.indicators.length===5,'doGet health check reports configured API');
ok(['setupApplication','getDB_','hash_','constructor','__proto__','toString'].every(fn=>post(JSON.stringify({fn,args:[]})).error==='Fungsi server tidak dikenal.'),'API rejects setup, helpers, and prototype names');
ok(!post('bukan json').ok&&!post('null').ok&&!post('{"fn":42}').ok,'API rejects malformed request bodies');
ok(post(JSON.stringify({fn:'teacherLogin',args:['salah']})).error.includes('tidak sesuai'),'server error message returned as JSON');
expectErr(()=>call('teacherLogin','wrong'),'tidak sesuai');let t=call('teacherLogin','PASSWORD_PTS_2026_TES!').token;
const r=call('teacherCreateRoom',t,'PTS 3A');ok(r.code.length===7,'room code');
const a=call('studentJoin',r.code,'01','Anisa'),b=call('studentJoin',r.code,'02','Budi');
expectErr(()=>call('studentJoin',r.code,'01','Nita'),'nama lain');
expectErr(()=>call('studentSaveAnswer',r.code,a.token,'Q01','empat ratus dua puluh enam'),'belum dimulai');
call('teacherStartRoom',t,r.code);
const state=call('studentState',r.code,a.token);ok(state.questions.length===20,'20 question set');ok(state.questions.slice(0,3).every(x=>x.indicator==='I1'),'questions grouped by island');ok(state.questions.every(x=>!Object.hasOwn(x,'answer')&&!Object.hasOwn(x,'explain')),'answer keys private');
const bank=vm.runInContext('BANK_QUESTIONS',ctx);ok(bank.length===20,'bank 20');
const orderA=state.questions.map(q=>q.id),orderB=call('studentState',r.code,b.token).questions.map(q=>q.id);
ok(orderA.some((id,i)=>id!==bank[i].id)||orderB.some((id,i)=>id!==bank[i].id),'exam questions randomized relative to canonical order');
for (const q of bank){call('studentSaveAnswer',r.code,a.token,q.id,q.answer);}
const res=call('studentSubmit',r.code,a.token).result;ok(res.score===100&&res.passed,'student perfect score 100');
for(const q of bank.slice(0,14))call('studentSaveAnswer',r.code,b.token,q.id,q.answer);
const failed=call('studentSubmit',r.code,b.token).result;ok(failed.score===70&&!failed.passed,'student score 70 needs remedial');
expectErr(()=>call('studentSaveAnswer',r.code,a.token,'Q01','wrong'),'dikumpulkan');
const c=call('studentJoin',r.code,'03','Citra');
for(const q of bank.slice(0,15))call('studentSaveAnswer',r.code,c.token,q.id,q.answer);
const exact=call('studentSubmit',r.code,c.token).result;ok(exact.score===75&&exact.passed,'KKM 75 exactly is passed');
const dashboard=call('teacherRoomState',t,r.code);ok(dashboard.stats.total===3&&dashboard.stats.done===3&&dashboard.stats.passed===2,'admin monitoring');
const rep=call('teacherReport',t,r.code);ok(rep.spreadsheetUrl.includes('docs.google.com'),'sheet report link');ok(rep.excelUrl.includes('format=xlsx'),'Excel export link');
const rb=books[String(bookcount)];ok(rb.sheets.length===6,'6 report worksheets');ok(rb.getSheetByName('Per Siswa').rows.length===4,'three student analysis rows');
const row=rb.getSheetByName('Per Siswa').rows[2];ok(row[3]===70&&row[4]==='Belum tuntas'&&row[11].length>0,'per-student recommendation');
ok(rb.getSheetByName('Analisis Butir').rows.length===21,'20 item analysis rows');
expectErr(()=>call('teacherParentReports',t,r.code),'setelah guru menutup');
call('teacherCloseRoom',t,r.code);ok(call('teacherRoomState',t,r.code).room.status==='closed','room closure');
expectErr(()=>call('teacherParentReports','invalid',r.code),'Sesi guru');
const handouts=call('teacherParentReports',t,r.code);
ok(handouts.students.length===3,'three individual printable reports');
ok(handouts.questions.length===20&&handouts.questions.every((q,i)=>q.id===bank[i].id&&q.number===i+1),'canonical order Q01–Q20 for every student');
const anisa=handouts.students[0],budi=handouts.students[1],citra=handouts.students[2];
ok(anisa.no==='01'&&budi.no==='02'&&citra.no==='03','student handouts sorted by participant number');
ok(anisa.answers.every((a,i)=>a.id===handouts.questions[i].id&&a.correct),'perfect student matches standardized answer positions');
ok(budi.score===70&&budi.answers[14].id==='Q15'&&!budi.answers[14].answered&&budi.answers[14].studentAnswer.includes('tidak dijawab'),'unanswered items shown explicitly');
ok(budi.recommendations.length>0&&budi.indicatorResults.length===5,'parent handout includes remedial and 5 indicator analyses');
ok(citra.score===75&&citra.passed,'exact threshold reflected on printable handout');
console.log('ALL PASSED');
// Versi 3: kelengkapan format lembar soal penuh dan penandaan pilihan sesuai data server.
ok(handouts.questions.every(q=>q.type&&Array.isArray(q.options)&&Array.isArray(q.tiles)), 'print bank returns types and unshuffled options/cards');
ok(handouts.questions.find(q=>q.id==='Q12').stack.top===278, 'print bank carries written stacked arithmetic');
ok(handouts.students[0].answers.find(a=>a.id==='Q03').value.join(' ')==='tujuh ratus lima puluh dua','print response retains ordered tile array');
const source=src('web/index.html');
ok(!source.includes('google.script')&&source.includes('<script src="config.js"></script>')&&/API_URL\s*:/.test(src('web/config.js')),'web UI uses fetch API configured by config.js');
const parentCode=source.slice(source.indexOf('const PARENT_PRINT_PARTS='),source.indexOf('function statusTag('));
const ux={console,x:s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),window:{scrollTo(){}},view:{innerHTML:''},button:()=>''};
vm.createContext(ux);vm.runInContext(parentCode,ux);
const sample=handouts.questions[0];const printedWrong=ux.parentOneQuestion(sample,{id:'Q01',value:sample.options[1],studentAnswer:sample.options[1],answered:true,correct:false});
ok(printedWrong.includes(sample.options[0])&&printedWrong.includes(sample.options[1])&&printedWrong.includes('picked')&&printedWrong.includes('Perlu diperbaiki'),'wrong multiple-choice answer is crossed without hiding other options');
const printedEmpty=ux.parentOneQuestion(sample,{id:'Q01',value:null,answered:false,correct:false});
ok(!printedEmpty.includes('class="parent-choicebox picked"')&&printedEmpty.includes('Tidak dijawab'),'unanswered multiple-choice keeps every checkbox empty');
const numeric=ux.parentOneQuestion(handouts.questions[11],{id:'Q12',value:424,studentAnswer:'424',answered:true,correct:false});
ok(numeric.includes('424')&&numeric.includes('278')&&numeric.includes('156'),'written answer appears beneath stacked calculation');
const printedTiles=ux.parentOneQuestion(handouts.questions[2],{id:'Q03',value:['tujuh','ratus','lima','puluh','dua'],studentAnswer:'tujuh → ratus → lima → puluh → dua',answered:true,correct:true});
ok(printedTiles.includes('Susunan siswa')&&printedTiles.includes('tujuh → ratus'),'ordered tiles preserve student response');
const testPages=ux.renderParentStudent(handouts,handouts.students[0]);
ok((testPages.match(/class="parent-paper"/g)||[]).length===4,'four distinct printable A4 sections per student');
ok(testPages.includes('Nomor 19–20')&&testPages.includes('Analisis penguasaan materi'),'all 20 questions and analysis are included');
console.log('VERSI 3 PRINT TESTS PASSED');
// Siswa bergiliran: setiap siswa punya 40 menit sendiri, ruang tetap terbuka sampai guru menutup.
const RH=vm.runInContext('ROOM_HEADERS',ctx),SH=vm.runInContext('STUDENT_HEADERS',ctx),ago=Date.now()-41*60000;
const r2=call('teacherCreateRoom',t,'PTS bergiliran');call('teacherStartRoom',t,r2.code);
const early=call('studentJoin',r2.code,'11','Awal'),room2=ctx.findRoom_(r2.code);
ctx.updateRow_(ctx.sheet_('Rooms'),room2.row,{startedAt:ago},RH);ctx.updateRow_(ctx.sheet_('Students'),ctx.studentsInRoom_(room2.roomId)[0].row,{joinedAt:ago},SH);
const late=call('studentJoin',r2.code,'12','Telat');ok(!!late.token,'student can still join 41 minutes after start');
const lateState=call('studentState',r2.code,late.token);ok(!lateState.result&&lateState.questions.length===20&&lateState.room.endsAt-Date.now()>39*60000,'late joiner gets a full personal 40 minutes');
ok(call('studentSaveAnswer',r2.code,late.token,bank[0].id,bank[0].answer).ok,'late joiner can save answers');
const earlyState=call('studentState',r2.code,early.token);ok(earlyState.result&&earlyState.result.reason==='WAKTU_HABIS','student past own 40 minutes is graded automatically');
const live2=call('teacherRoomState',t,r2.code);ok(live2.room.status==='live'&&live2.stats.done===1&&live2.participants.find(p=>p.no==='12').endsAt>Date.now(),'room stays open; teacher sees each remaining time');
call('teacherCloseRoom',t,r2.code);expectErr(()=>call('studentJoin',r2.code,'13','Baru'),'ditutup');
ok(call('studentState',r2.code,late.token).result.reason==='DITUTUP_GURU','closing grades students still working');
console.log('GILIRAN TESTS PASSED');
// Beban server: polling rutin tidak boleh ikut antre kunci (penyebab "Server sedang sibuk").
const r3=call('teacherCreateRoom',t,'PTS beban');call('teacherStartRoom',t,r3.code);const p1=call('studentJoin',r3.code,'21','Poll');
call('studentState',r3.code,p1.token);let before=locks;for(let i=0;i<5;i++)call('studentState',r3.code,p1.token);
ok(locks===before,'repeated student polls run without the script lock');
before=locks;for(let i=0;i<3;i++)call('teacherRoomState',t,r3.code);ok(locks===before,'teacher dashboard polls run without the script lock');
const room3=ctx.findRoom_(r3.code),p1row=ctx.studentsInRoom_(room3.roomId)[0];
ctx.updateRow_(ctx.sheet_('Students'),p1row.row,{lastSeen:Date.now()-61000},SH);before=locks;call('studentState',r3.code,p1.token);
ok(locks===before+1&&Date.now()-ctx.studentsInRoom_(room3.roomId)[0].lastSeen<5000,'lastSeen refreshed at most once a minute, under the lock');
call('studentSaveAnswer',r3.code,p1.token,bank[1].id,bank[1].answer);const fin=call('studentSubmit',r3.code,p1.token).result;
const saved=ctx.studentsInRoom_(room3.roomId)[0];ok(fin.score===5&&saved.state==='done'&&saved.completionReason==='DIKUMPULKAN'&&JSON.parse(saved.answersJson)[bank[1].id],'batched row write keeps answers and grade intact');
console.log('BEBAN TESTS PASSED');
// Masuk kembali dengan nomor + nama yang sama (ganti HP / token hilang).
const r4=call('teacherCreateRoom',t,'PTS masuk ulang');call('teacherStartRoom',t,r4.code);
const first=call('studentJoin',r4.code,'07','Dewi Lestari');call('studentSaveAnswer',r4.code,first.token,bank[0].id,bank[0].answer);
const endsBefore=call('studentState',r4.code,first.token).room.endsAt;
const again=call('studentJoin',r4.code,'7','  dewi   lestari ');ok(again.resumed&&again.token!==first.token&&again.name==='Dewi Lestari','same number + name logs back in (leading zero, case, spaces ignored)');
const back=call('studentState',r4.code,again.token);ok(back.answers[bank[0].id]===bank[0].answer&&back.room.endsAt===endsBefore,'re-login keeps saved answers and personal deadline');
expectErr(()=>call('studentState',r4.code,first.token),'Sesi siswa');ok(true,'old device token stops working after re-login');
expectErr(()=>call('studentJoin',r4.code,'07','Orang Lain'),'nama lain');ok(true,'same number with a different name is rejected');
ok(call('teacherRoomState',t,r4.code).stats.total===1,'re-login does not create a duplicate participant');
call('studentSubmit',r4.code,again.token);ok(call('studentJoin',r4.code,'07','Dewi Lestari').resumed,'finished student can log in again to see the result');
console.log('MASUK ULANG TESTS PASSED');
// Database lama (14 kolom) dimigrasi otomatis tanpa mengubah data.
{const db=ctx.getDB_(),st=db.getSheetByName('Students'),n0=st.rows.length;st.rows[0]=st.rows[0].slice(0,14);delete props.SCHEMA_VERSION;vm.runInContext('DB_=null;for(const k in SHEETS_)delete SHEETS_[k];',ctx);
 ctx.getDB_();ok(st.rows[0].join()===SH.join()&&props.SCHEMA_VERSION===vm.runInContext('SCHEMA_VERSION',ctx)&&st.rows.length===n0,'old database gets new columns appended once');}
// Perbaikan (kesempatan kedua): lulus bila ≥85, nilai maksimal 85, tidak pernah turun dari nilai awal.
const r5=call('teacherCreateRoom',t,'PTS perbaikan');call('teacherStartRoom',t,r5.code);
const join5=(no,nm,k)=>{const j=call('studentJoin',r5.code,no,nm);for(const q of bank.slice(0,k))call('studentSaveAnswer',r5.code,j.token,q.id,q.answer);call('studentSubmit',r5.code,j.token);return j;};
join5('31','Ani',8);join5('32','Bayu',8);join5('33','Cici',16);join5('34','Dodi',4);join5('35','Eka',10);
expectErr(()=>call('teacherGrantRetake',t,r5.code,'33'),'tidak dapat diberi perbaikan');
const g1=call('teacherGrantRetake',t,r5.code,'31');ok(g1.count===1&&g1.message.includes('85'),'teacher grants retake to one student');
let st5=call('teacherRoomState',t,r5.code);let ani=st5.participants.find(p=>p.no==='31');ok(ani.attempt===2&&ani.retakePending&&ani.firstScore===40&&ani.score===null,'dashboard shows pending retake with first score');
const ani2=call('studentJoin',r5.code,'31','Ani');let s5=call('studentState',r5.code,ani2.token);
ok(s5.student.attempt===2&&s5.student.minScore===85&&Object.keys(s5.answers).length===0&&s5.questions.length===20&&s5.room.endsAt-Date.now()>39*60000,'retake starts empty with its own 40 minutes when opened');
for(const q of bank)call('studentSaveAnswer',r5.code,ani2.token,q.id,q.answer);
let res5=call('studentSubmit',r5.code,ani2.token).result;ok(res5.score===85&&res5.passed&&res5.retakeScore===100&&res5.firstScore===40&&res5.minScore===85,'perfect retake is capped at 85 and passes');
expectErr(()=>call('teacherGrantRetake',t,r5.code,'31'),'tidak dapat diberi perbaikan');
const g2=call('teacherGrantRetake',t,r5.code,'');ok(g2.count===3,'bulk retake goes to every student below the pass mark (not the passed one)');
const bayu=call('studentJoin',r5.code,'32','Bayu');call('studentState',r5.code,bayu.token);for(const q of bank.slice(0,16))call('studentSaveAnswer',r5.code,bayu.token,q.id,q.answer);
res5=call('studentSubmit',r5.code,bayu.token).result;ok(res5.score===80&&!res5.passed&&res5.note.includes('Belum tuntas'),'retake of 80 is not a pass (needs 85)');
const dodi=call('studentJoin',r5.code,'34','Dodi');call('studentState',r5.code,dodi.token);call('studentSaveAnswer',r5.code,dodi.token,bank[0].id,'salah'===bank[0].answer?'x':bank[0].options[1]);
res5=call('studentSubmit',r5.code,dodi.token).result;ok(res5.score===20&&res5.retakeScore===0,'worse retake keeps the first score');
// Tambah waktu: siswa yang waktunya habis (gangguan server) dibuka lagi dengan jawaban tersimpan.
const fani=call('studentJoin',r5.code,'36','Fani');call('studentSaveAnswer',r5.code,fani.token,bank[0].id,bank[0].answer);
{const rm=ctx.findRoom_(r5.code),row=ctx.studentsInRoom_(rm.roomId).find(x=>x.studentNo==36||x.studentNo==='36');ctx.updateRow_(ctx.sheet_('Students'),row.row,{joinedAt:Date.now()-41*60000},SH);ctx.updateRow_(ctx.sheet_('Rooms'),rm.row,{startedAt:Date.now()-41*60000},RH);}
ok(call('studentState',r5.code,fani.token).result.reason==='WAKTU_HABIS','student hit by time-out is auto-graded');
expectErr(()=>call('teacherExtendTime',t,r5.code,'36',0),'1–120');
const ext=call('teacherExtendTime',t,r5.code,'36',10);ok(ext.message.includes('10 menit')&&ext.message.includes('dibuka lagi'),'teacher gives extra time to a timed-out student');
const fani2=call('studentJoin',r5.code,'36','Fani'),s6=call('studentState',r5.code,fani2.token);
ok(!s6.result&&s6.answers[bank[0].id]===bank[0].answer&&Math.abs(s6.room.endsAt-Date.now()-10*60000)<5000,'reopened student keeps answers and gets the extra minutes');
call('teacherExtendTime',t,r5.code,'36',5);ok(Math.abs(call('studentState',r5.code,fani2.token).room.endsAt-Date.now()-15*60000)<5000,'extra time adds to a running timer');
st5=call('teacherRoomState',t,r5.code);ok(st5.stats.passed===2&&st5.stats.retakes===4,'stats count retake passes with the 85 rule');
// Ruang ditutup: perbaikan yang belum dibuka tetap memakai nilai awal; perbaikan pada ruang tertutup membuka ruang lagi.
call('teacherCloseRoom',t,r5.code);st5=call('teacherRoomState',t,r5.code);const eka=st5.participants.find(p=>p.no==='35');ok(eka.score===50&&!eka.passed,'unopened retake keeps first score when the room closes');
const rep5=call('teacherReport',t,r5.code),book5=books[String(bookcount)],ps=book5.getSheetByName('Per Siswa').rows;
ok(ps[0].includes('Keterangan perbaikan / waktu')&&ps.some(r=>r[1]==='Ani'&&r[4]==='Tuntas (perbaikan)'&&String(r[14]).includes('nilai awal 40, nilai perbaikan 100 (dibatasi 85)')),'report marks retake pass and explains it');
ok(ps.some(r=>r[1]==='Fani'&&String(r[14]).includes('tambahan waktu 15 menit'))&&ps.some(r=>r[1]==='Eka'&&String(r[14]).includes('tidak mengerjakan')),'report notes extra time and unused retakes');
ok(book5.getSheetByName('Ringkasan').rows.some(r=>r[0]==='Mengikuti perbaikan'&&r[1]===4),'summary sheet counts retakes');
const ph5=call('teacherParentReports',t,r5.code),aniP=ph5.students.find(x=>x.name==='Ani');ok(aniP.attempt===2&&aniP.minScore===85&&aniP.passed&&aniP.note.includes('Perbaikan'),'parent sheet carries retake details');
const g3=call('teacherGrantRetake',t,r5.code,'36');ok(g3.message.includes('Ruang dibuka kembali')&&call('teacherRoomState',t,r5.code).room.status==='live','retake on a closed room reopens it');
console.log('PERBAIKAN TESTS PASSED');
