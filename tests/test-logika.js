const fs=require('fs'),vm=require('vm'),crypto=require('crypto'),path=require('path');
const props={SETUP_ADMIN_PASSWORD:'PASSWORD_PTS_2026_TES!'},cache={},books={};let bookcount=0;
class Range{constructor(sheet,r,c,h=1,w=1){Object.assign(this,{sheet,r,c,h,w});}getValues(){return Array.from({length:this.h},(_,i)=>Array.from({length:this.w},(_,j)=>this.sheet.rows[this.r-1+i]?.[this.c-1+j]??''));}setValue(v){this.sheet.ensure(this.r,this.c);this.sheet.rows[this.r-1][this.c-1]=v;return this;}setValues(rows){rows.forEach((line,i)=>line.forEach((v,j)=>{this.sheet.ensure(this.r+i,this.c+j);this.sheet.rows[this.r+i-1][this.c+j-1]=v;}));return this;}setBackground(){return this;}setFontColor(){return this;}setFontWeight(){return this;}setWrap(){return this;}setVerticalAlignment(){return this;}createFilter(){return this;}}
class Sheet{constructor(name){this.name=name;this.rows=[];}getDataRange(){return new Range(this,1,1,Math.max(this.rows.length,1),Math.max(...this.rows.map(a=>a.length),1));}appendRow(row){this.rows.push([...row]);return this;}getRange(r,c,h,w){return new Range(this,r,c,h,w);}ensure(r,c){while(this.rows.length<r)this.rows.push([]);while(this.rows[r-1].length<c)this.rows[r-1].push('');}setName(n){this.name=n;return this;}setFrozenRows(){return this;}setColumnWidth(){return this;}setRowHeight(){return this;}}
class Book{constructor(name){this.name=name;this.id=String(++bookcount);books[this.id]=this;this.sheets=[new Sheet('Sheet1')];}getSheets(){return this.sheets;}getSheetByName(n){return this.sheets.find(s=>s.name===n)||null;}insertSheet(n){const x=new Sheet(n);this.sheets.push(x);return x;}getId(){return this.id;}getUrl(){return 'https://docs.google.com/spreadsheets/d/'+this.id+'/edit';}}
const ctx={console,Date,Math,JSON,Number,String,Array,Object,RegExp,Map,Set,Error,
 PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k],setProperty:(k,v)=>{props[k]=v;},setProperties:o=>Object.assign(props,o),deleteProperty:k=>delete props[k]})},
 SpreadsheetApp:{create:n=>new Book(n),openById:id=>books[id],flush:()=>{}},
 Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'UTF_8'},DigestAlgorithm:{SHA_256:'SHA_256'},computeDigest:(algo,str)=>[...crypto.createHash('sha256').update(str).digest()].map(x=>x>127?x-256:x),formatDate:(d,tz,p)=>d.toISOString()},
 LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
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
expectErr(()=>call('studentJoin',r.code,'01','Nita'),'sudah digunakan');
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
