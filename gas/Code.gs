/** MATH ADVENTURE: MISI PULAU 1000 — Google Apps Script backend (JSON API).
 * The UI (web/index.html) is hosted on GitHub Pages and calls this script with fetch POST.
 * Owner deploy as ME, access ANYONE. Students do not need Google accounts.
 * Setup: define SETUP_ADMIN_PASSWORD in Project Settings / Script Properties, then run setupApplication once.
 * Only functions listed in API_FUNCTIONS can be called from the browser; helpers end with underscore.
 */
const SETTINGS = {minScore:75,durationMin:40,questionCount:20,adminSessionSeconds:21600,maxStudents:40,lastSeenWriteMs:60000,retakeMinScore:85,retakeMaxScore:85};
const ROOM_HEADERS = ['roomId','code','title','status','createdAt','startedAt','endsAt','closedAt','durationMin'];
const STUDENT_HEADERS = ['studentId','roomId','studentNo','studentName','tokenHash','joinedAt','lastSeen','submittedAt','answersJson','questionOrderJson','finalScore','correctCount','state','completionReason',
  // v4 (appended; existing databases are migrated in getDB_): second chance and extra time.
  'attempt','firstScore','firstCorrect','firstAnswersJson','firstSubmittedAt','retakeScore','deadlineAt','extraMin'];
const SCHEMA_VERSION = '4';

function setupApplication() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_HASH')) {
    const password = props.getProperty('SETUP_ADMIN_PASSWORD');
    if (!password || password.length < 12 || password === 'GANTI_PASSWORD_ANDA') {
      throw new Error('Tambahkan SETUP_ADMIN_PASSWORD (minimal 12 karakter) di Project Settings > Script Properties terlebih dahulu.');
    }
    const salt = Utilities.getUuid();
    props.setProperties({ADMIN_SALT:salt,ADMIN_HASH:hash_(salt+'|'+password)});
    props.deleteProperty('SETUP_ADMIN_PASSWORD');
  }
  getDB_();
  return {message:'Aplikasi siap digunakan. Database tersimpan secara privat pada Google Drive pemilik.'};
}

// Public API for GitHub Pages. setupApplication is deliberately absent: run it only from the editor.
const API_FUNCTIONS = {bootstrap,teacherLogin,teacherCreateRoom,teacherRoomState,teacherStartRoom,teacherCloseRoom,
  teacherReport,teacherParentReports,teacherGrantRetake,teacherExtendTime,studentJoin,studentState,studentSaveAnswer,studentSubmit};

/** Health check: open the /exec URL in a browser to confirm the deployment works. */
function doGet() {
  return json_({ok:true,result:Object.assign({app:'Math Adventure API'},bootstrap())});
}
/** Body (sent as text/plain to avoid a CORS preflight): {"fn":"studentState","args":[code,token]}.
 * Response: {"ok":true,"result":...} or {"ok":false,"error":"pesan"}. */
function doPost(e) {
  let req;
  try {req=JSON.parse(e&&e.postData&&e.postData.contents||'');} catch(err) {return json_({ok:false,error:'Permintaan ke server tidak valid.'});}
  const name=req&&req.fn;
  if (typeof name!=='string'||!Object.prototype.hasOwnProperty.call(API_FUNCTIONS,name)) return json_({ok:false,error:'Fungsi server tidak dikenal.'});
  try {
    return json_({ok:true,result:API_FUNCTIONS[name].apply(null,Array.isArray(req.args)?req.args:[])});
  } catch(err) {
    return json_({ok:false,error:String(err&&err.message||err)});
  }
}
function json_(obj){return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);}
function bootstrap() {
  const p=PropertiesService.getScriptProperties();
  return {configured:!!(p.getProperty('ADMIN_HASH') && p.getProperty('APP_DB_ID')),
    indicators:INDICATORS.map(x=>({id:x.id,name:x.name})),
    minScore:SETTINGS.minScore,questionCount:SETTINGS.questionCount};
}
function teacherLogin(password) {
  const props=PropertiesService.getScriptProperties();
  const salt=props.getProperty('ADMIN_SALT');
  if (!salt || !password || !safeEqual_(hash_(salt+'|'+String(password)),props.getProperty('ADMIN_HASH'))) {
    throw new Error('Kata sandi guru tidak sesuai.');
  }
  const token=randomToken_();
  CacheService.getScriptCache().put('t_'+hash_(token),'ok',SETTINGS.adminSessionSeconds);
  return {token,expiresInSeconds:SETTINGS.adminSessionSeconds};
}
function teacherCreateRoom(token,title) {
  requireTeacher_(token);
  const name=clean_(title,70)||'PTS Matematika · Bab 1';
  if (/^[=+@-]/.test(name)) throw new Error('Judul tidak boleh diawali simbol rumus.');
  return withLock_(()=>{
    const sh=sheet_('Rooms'),rows=readObjects_(sh);
    let code; do {code=makeCode_();}while(rows.some(r=>r.code===code));
    const room={roomId:Utilities.getUuid(),code,title:name,status:'waiting',createdAt:Date.now(),startedAt:'',endsAt:'',closedAt:'',durationMin:SETTINGS.durationMin};
    sh.appendRow(ROOM_HEADERS.map(h=>room[h]));
    return {code,title:name,status:'waiting',durationMin:SETTINGS.durationMin};
  });
}
function teacherRoomState(token,code) {
  requireTeacher_(token);
  // Dashboard polls are read-only unless someone's time ran out; only then queue for the script lock.
  return teacherRoomRead_(code,false)||withLock_(()=>teacherRoomRead_(code,true));
}
function teacherRoomRead_(code,locked) {
    const room=findRoom_(code); if(!room) throw new Error('Ruang tidak ditemukan.');
    const students=studentsInRoom_(room.roomId);
    if(!locked&&needsExpiry_(room,students)) return null;
    expireRoom_(room,students);
    const summary=students.map(s=>({name:s.studentName,no:s.studentNo,state:s.state||'waiting',answered:countAnswered_(s),score:s.finalScore===''?null:Number(s.finalScore),lastSeen:Number(s.lastSeen||0),submittedAt:Number(s.submittedAt||0),endsAt:s.submittedAt||retakePending_(s)?0:studentEndsAt_(room,s),
      attempt:attempt_(s),retakePending:retakePending_(s),canRetake:canRetake_(s),passed:!!s.submittedAt&&passed_(s),firstScore:s.firstScore===''||s.firstScore==null?null:Number(s.firstScore),extraMin:Number(s.extraMin||0)}));
    return {room:publicRoom_(room),participants:summary,serverTime:Date.now(),stats:roomStats_(students)};
}
function teacherStartRoom(token,code) {
  requireTeacher_(token);
  return withLock_(()=>{
    const room=findRoom_(code); if(!room) throw new Error('Ruang tidak ditemukan.');
    if(room.status!=='waiting') throw new Error('Ujian sudah dimulai atau telah ditutup.');
    const now=Date.now();
    // No room-wide deadline: each student gets durationMin from their own start (see studentEndsAt_).
    updateRow_(sheet_('Rooms'),room.row,{status:'live',startedAt:now,endsAt:''},ROOM_HEADERS);
    return {message:'Ujian dimulai. Siswa yang datang kemudian tetap bisa bergabung.'};
  });
}
function teacherCloseRoom(token,code) {
  requireTeacher_(token);
  return withLock_(()=>{
    const room=findRoom_(code);if(!room) throw new Error('Ruang tidak ditemukan.');
    if(room.status==='waiting') throw new Error('Ruang belum dimulai.');
    if(room.status==='closed') return {message:'Ruang sudah ditutup.'};
    const now=Date.now();
    updateRow_(sheet_('Rooms'),room.row,{status:'closed',closedAt:now},ROOM_HEADERS);
    const students=studentsInRoom_(room.roomId);
    students.filter(s=>!s.submittedAt).forEach(s=>finalize_(s,now,'DITUTUP_GURU'));
    return {message:'Ujian ditutup. Jawaban seluruh siswa yang bergabung telah dinilai.'};
  });
}
/** Second chance for students who finished below the pass mark. studentNo empty = every eligible student.
 * The first attempt is kept in first* columns; the retake starts with empty answers and its own timer,
 * which begins when the student opens it. Retake: pass at retakeMinScore, score capped at retakeMaxScore. */
function teacherGrantRetake(token,code,studentNo) {
  requireTeacher_(token);
  return withLock_(()=>{
    const room=findRoom_(code);if(!room) throw new Error('Ruang tidak ditemukan.');
    if(room.status==='waiting') throw new Error('Ujian belum dimulai.');
    const students=studentsInRoom_(room.roomId);expireRoom_(room,students);
    const all=studentNo==null||String(studentNo)==='';
    const targets=all?students.filter(canRetake_):students.filter(s=>sameStudentNo_(s.studentNo,studentNo));
    if(!targets.length) throw new Error(all?'Tidak ada siswa belum tuntas yang dapat diberi perbaikan.':'Siswa tidak ditemukan.');
    const blocked=targets.find(s=>!canRetake_(s));
    if(blocked) throw new Error(blocked.studentName+' tidak dapat diberi perbaikan: hanya untuk siswa yang sudah selesai, belum tuntas, dan belum pernah perbaikan.');
    const reopened=reopenRoom_(room);
    targets.forEach(s=>updateRow_(sheet_('Students'),s.row,{attempt:2,firstScore:s.finalScore,firstCorrect:s.correctCount,firstAnswersJson:s.answersJson,firstSubmittedAt:s.submittedAt,
      answersJson:'{}',submittedAt:'',finalScore:'',correctCount:'',retakeScore:'',state:'waiting',completionReason:'',deadlineAt:''},STUDENT_HEADERS));
    return {count:targets.length,message:(targets.length===1?targets[0].studentName+' mendapat':targets.length+' siswa mendapat')+' kesempatan perbaikan (lulus bila nilai ≥'+SETTINGS.retakeMinScore+', nilai maksimal '+SETTINGS.retakeMaxScore+
      '). Minta siswa masuk lagi dengan nomor dan nama yang sama.'+(reopened?' Ruang dibuka kembali.':'')};
  });
}
/** Extra time for one student (e.g. lost time to server errors). A finished student is reopened with saved answers. */
function teacherExtendTime(token,code,studentNo,minutes) {
  requireTeacher_(token);
  const add=Math.round(Number(minutes));
  if(!(add>=1&&add<=120)) throw new Error('Tambahan waktu harus 1–120 menit.');
  return withLock_(()=>{
    const room=findRoom_(code);if(!room) throw new Error('Ruang tidak ditemukan.');
    if(room.status==='waiting') throw new Error('Ujian belum dimulai.');
    const s=studentsInRoom_(room.roomId).find(x=>sameStudentNo_(x.studentNo,studentNo));
    if(!s) throw new Error('Siswa tidak ditemukan.');
    if(retakePending_(s)) throw new Error(s.studentName+' belum membuka perbaikan; waktunya baru berjalan saat ia masuk.');
    const now=Date.now(),wasDone=!!s.submittedAt,reopened=reopenRoom_(room);
    const patch={deadlineAt:(wasDone?now:Math.max(now,studentEndsAt_(room,s)))+add*60000,extraMin:Number(s.extraMin||0)+add};
    if(wasDone) Object.assign(patch,{submittedAt:'',finalScore:'',correctCount:'',retakeScore:'',state:'working',completionReason:''});
    updateRow_(sheet_('Students'),s.row,patch,STUDENT_HEADERS);
    return {message:s.studentName+' mendapat tambahan '+add+' menit.'+(wasDone?' Ujiannya dibuka lagi dengan jawaban yang sudah tersimpan; minta siswa masuk lagi dengan nomor dan nama yang sama.':'')+(reopened?' Ruang dibuka kembali.':'')};
  });
}
function teacherReport(token,code) {
  requireTeacher_(token);
  const snapshot=withLock_(()=>{
    const room=findRoom_(code);if(!room) throw new Error('Ruang tidak ditemukan.');
    const students=studentsInRoom_(room.roomId);expireRoom_(room,students);
    return {room,students};
  });
  const room=snapshot.room,students=snapshot.students;
    const submitted=students.filter(s=>s.submittedAt);
    if(!submitted.length) throw new Error('Belum ada siswa yang selesai dinilai.');
    const title='Laporan PTS '+room.code+' '+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),'yyyyMMdd_HHmm');
    const report=SpreadsheetApp.create(title);
    const sheet0=report.getSheets()[0];sheet0.setName('Ringkasan');
    const scores=submitted.map(s=>Number(s.finalScore));
    const mean=Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*100)/100;
    const tuntas=submitted.filter(passed_).length,retakers=submitted.filter(s=>attempt_(s)===2);
    putSheet_(sheet0,[['MATH ADVENTURE — LAPORAN PTS BAB 1','Nilai'],['Ruang',room.code],['Judul',room.title],['Tanggal laporan',new Date().toISOString()],['Jumlah peserta',students.length],['Sudah dinilai',submitted.length],['Belum dinilai',students.length-submitted.length],['Nilai rata-rata',mean],['Nilai tertinggi',Math.max(...scores)],['Nilai terendah',Math.min(...scores)],['Tuntas',tuntas],['Belum tuntas',scores.length-tuntas],['Persentase ketuntasan',(tuntas/scores.length*100).toFixed(1)+'%'],['KKM',SETTINGS.minScore],
      ['Mengikuti perbaikan',retakers.length],['Tuntas melalui perbaikan',retakers.filter(passed_).length],
      ['Aturan perbaikan','Kesempatan kedua untuk siswa belum tuntas: lulus bila nilai perbaikan ≥'+SETTINGS.retakeMinScore+'; nilai akhir maksimal '+SETTINGS.retakeMaxScore+' dan tidak lebih rendah dari nilai awal.'],
      ['Keterangan','Nilai dihitung server dari 20 soal; 5 poin per jawaban benar. Untuk siswa perbaikan, analisis indikator, butir, dan respons memakai jawaban perbaikan; lihat kolom Keterangan di tab Per Siswa.']]);
    const byStudent=[['No. Peserta','Nama','Benar','Nilai','Status','Waktu selesai','I1 (3)','I2 (3)','I3 (4)','I4 (6)','I5 (4)','Rekomendasi','Nilai awal','Nilai perbaikan','Keterangan perbaikan / waktu']];
    const byIndicator=[['No. Peserta','Nama','Indikator','Benar','Total','Capaian (%)','Tindak lanjut']];
    const followUp=[['No. Peserta','Nama','Nilai','Status','Prioritas','Saran tindak lanjut','Keterangan perbaikan / waktu']];
    const responses=[['No. Peserta','Nama',...BANK_QUESTIONS.map(q=>q.id),'Nilai']];
    const itemRows=[['No.','Indikator','Kesulitan','Bentuk','Butir soal','Peserta dinilai','Benar','Salah/kosong','Persen benar','Catatan']];
    const calc=submitted.map(s=>({s,correct:correctByQuestion_(s)}));
    calc.forEach(({s,correct})=>{
      const group=indicatorScores_(correct);
      const weak=INDICATORS.filter(k=>group[k.id].correct/group[k.id].total<0.75);
      const status=passed_(s)?(attempt_(s)===2?'Tuntas (perbaikan)':'Tuntas'):'Belum tuntas',note=studentNote_(s),retake=attempt_(s)===2;
      const priority=weak.map(k=>k.name).join('; ')||(passed_(s)?'Pengayaan dan soal cerita':'Latihan campuran');
      const targeted=targetedAdvice_(correct);
      const suggestions=(targeted.length?targeted.concat(weak.map(k=>k.next)).slice(0,5):weak.map(k=>k.next)).join(' ')||'Pengayaan soal cerita dan penalaran bilangan cacah.';
      byStudent.push([textCell_(s.studentNo),textCell_(s.studentName),s.correctCount,s.finalScore,status,formatDate_(s.submittedAt),...INDICATORS.map(k=>group[k.id].correct+'/'+group[k.id].total),suggestions,retake?Number(s.firstScore):s.finalScore,retake?Number(s.retakeScore):'',note]);
      INDICATORS.forEach(k=>byIndicator.push([textCell_(s.studentNo),textCell_(s.studentName),k.name,group[k.id].correct,group[k.id].total,Math.round(group[k.id].correct/group[k.id].total*100),group[k.id].correct/group[k.id].total>=0.75?'Penguatan/pengayaan':k.next]));
      followUp.push([textCell_(s.studentNo),textCell_(s.studentName),s.finalScore,status,priority,suggestions,note]);
      const a=parseJson_(s.answersJson,{});responses.push([textCell_(s.studentNo),textCell_(s.studentName),...BANK_QUESTIONS.map(q=>correct[q.id]?'Benar':(a[q.id]?'Salah':'Kosong')),s.finalScore]);
    });
    BANK_QUESTIONS.forEach((q,i)=>{
      const right=calc.filter(x=>x.correct[q.id]).length;
      const fraction=right/submitted.length*100;
      itemRows.push([i+1,INDICATORS.find(k=>k.id===q.indicator).name,q.difficulty,q.type,q.prompt,submitted.length,right,submitted.length-right,Math.round(fraction),fraction<50?'Prioritaskan pembahasan butir ini':fraction<75?'Perlu latihan lanjutan':'Penguasaan relatif baik']);
    });
    putSheet_(report.insertSheet('Per Siswa'),byStudent);
    putSheet_(report.insertSheet('Per Indikator'),byIndicator);
    putSheet_(report.insertSheet('Analisis Butir'),itemRows);
    putSheet_(report.insertSheet('Tindak Lanjut'),followUp);
    putSheet_(report.insertSheet('Respons Soal'),responses);
    SpreadsheetApp.flush();
    const excelUrl='https://docs.google.com/spreadsheets/d/'+report.getId()+'/export?format=xlsx';
    return {spreadsheetUrl:report.getUrl(),excelUrl,reportName:title,count:submitted.length};
}


/** Teacher-only parent handout data. All printed questions use the canonical
 * Q01–Q20 order, never the per-student randomized questionOrderJson.
 * Enabled only after a room is closed to avoid exposing answer keys in class.
 */
function teacherParentReports(token,code) {
  requireTeacher_(token);
  return withLock_(()=>{
    const room=findRoom_(code);if(!room)throw new Error('Ruang tidak ditemukan.');
    const students=studentsInRoom_(room.roomId);
    expireRoom_(room,students);
    if(room.status!=='closed')throw new Error('Lembar orang tua tersedia setelah guru menutup ujian atau waktu habis.');
    const completed=students.filter(s=>!!s.submittedAt).sort((a,b)=>
      String(a.studentNo).localeCompare(String(b.studentNo),'id',{numeric:true,sensitivity:'base'}) ||
      String(a.studentName).localeCompare(String(b.studentName),'id'));
    if(!completed.length)throw new Error('Belum ada hasil siswa yang dapat dicetak.');
    const questions=BANK_QUESTIONS.map((q,i)=>({
      number:i+1,id:q.id,indicator:q.indicator,prompt:q.prompt,
      type:q.type,options:q.options ? q.options.slice() : [],
      tiles:q.tiles ? q.tiles.slice() : [],
      stack:q.stack ? {top:q.stack.top,bottom:q.stack.bottom,symbol:q.stack.symbol} : null,
      answerKey:formatReportAnswer_(q,q.answer)
    }));
    return {
      room:{code:room.code,title:room.title,durationMin:Number(room.durationMin)},
      generatedAt:formatDate_(Date.now()),minScore:SETTINGS.minScore,retakeMinScore:SETTINGS.retakeMinScore,retakeMaxScore:SETTINGS.retakeMaxScore,
      questionCount:SETTINGS.questionCount,questions,
      indicators:INDICATORS.map(i=>({id:i.id,name:i.name,next:i.next})),
      students:completed.map(s=>{
        const saved=parseJson_(s.answersJson,{}),correct=correctByQuestion_(s),groups=indicatorScores_(correct);
        const weak=INDICATORS.filter(i=>groups[i.id].correct/groups[i.id].total<0.75);
        const targeted=targetedAdvice_(correct);
        const suggestions=[...new Set(targeted.concat(weak.map(i=>i.next)))].slice(0,4);
        return {
          id:s.studentId,no:String(s.studentNo),name:String(s.studentName),
          completedAt:formatDate_(s.submittedAt),reason:s.completionReason,
          score:Number(s.finalScore),correctCount:Number(s.correctCount),
          passed:passed_(s),attempt:attempt_(s),minScore:minScoreFor_(s),note:studentNote_(s),
          firstScore:attempt_(s)===2?Number(s.firstScore):null,retakeScore:attempt_(s)===2?Number(s.retakeScore):null,
          answers:BANK_QUESTIONS.map(q=>({id:q.id,
            studentAnswer:saved[q.id] ? formatReportAnswer_(q,saved[q.id].value) : '— (tidak dijawab)',
            value:saved[q.id] ? saved[q.id].value : null,
            correct:!!correct[q.id],answered:!!saved[q.id]
          })),
          indicatorResults:INDICATORS.map(i=>({id:i.id,name:i.name,
            correct:groups[i.id].correct,total:groups[i.id].total,
            percentage:Math.round(groups[i.id].correct/groups[i.id].total*100),
            mastery:groups[i.id].correct/groups[i.id].total>=0.75
          })),
          recommendations:suggestions.length?suggestions:['Berikan soal pengayaan dan soal cerita bertahap untuk melatih penalaran.']
        };
      })
    };
  });
}
function formatReportAnswer_(q,value) {
  if(value===undefined||value===null||value==='')return '— (tidak dijawab)';
  if(Array.isArray(value))return value.map(v=>String(v)).join(' → ');
  return String(value);
}

function studentJoin(code,studentNo,studentName) {
  return withLock_(()=>{
    const room=findRoom_(code); if(!room) throw new Error('Kode ruang tidak dikenal. Periksa kembali.');
    if(room.status==='closed') throw new Error('Ruang ujian telah ditutup guru.');
    const no=clean_(studentNo,30),name=clean_(studentName,65);
    if(!no||!name) throw new Error('Masukkan nomor peserta dan nama.');
    if (/^[=+@-]/.test(name)) throw new Error('Nama tidak boleh diawali simbol rumus.');
    if(!/^[a-zA-Z0-9 ._-]{1,30}$/.test(no)) throw new Error('Nomor peserta hanya boleh huruf, angka, spasi, titik, atau tanda hubung.');
    const students=studentsInRoom_(room.roomId);
    if (/^-/.test(no)) throw new Error('Nomor peserta tidak boleh diawali tanda minus.');
    const existing=students.find(s=>sameStudentNo_(s.studentNo,no));
    if(existing) {
      // Re-login (new phone, cleared browser, or a join whose reply was lost): same number + same name gets a fresh
      // token; the old device's token stops working. Answers and the personal deadline are kept.
      if(clean_(existing.studentName,65).toLowerCase()!==name.toLowerCase()) throw new Error('Nomor peserta ini sudah dipakai dengan nama lain. Tulis nama persis seperti saat pertama masuk, atau hubungi guru.');
      const rawToken=randomToken_();
      updateRow_(sheet_('Students'),existing.row,{tokenHash:hash_(rawToken),lastSeen:Date.now()},STUDENT_HEADERS);
      return {token:rawToken,code:room.code,name:String(existing.studentName),studentNo:String(existing.studentNo),resumed:true};
    }
    if(students.length>=SETTINGS.maxStudents) throw new Error('Ruang sudah mencapai batas peserta.');
    const rawToken=randomToken_(),id=Utilities.getUuid(),order=INDICATORS.flatMap(i=>shuffled_(BANK_QUESTIONS.filter(q=>q.indicator===i.id).map(q=>q.id),id+i.id));
    const now=Date.now();
    const s={studentId:id,roomId:room.roomId,studentNo:no,studentName:name,tokenHash:hash_(rawToken),joinedAt:now,lastSeen:now,submittedAt:'',answersJson:'{}',questionOrderJson:JSON.stringify(order),finalScore:'',correctCount:'',state:room.status==='live'?'working':'waiting',completionReason:'',
      attempt:1,firstScore:'',firstCorrect:'',firstAnswersJson:'',firstSubmittedAt:'',retakeScore:'',deadlineAt:'',extraMin:''};
    sheet_('Students').appendRow(STUDENT_HEADERS.map(h=>s[h]));
    return {token:rawToken,code:room.code,name,studentNo:no};
  });
}
function studentState(code,token) {
  // Most polls need no write: answer them without the script lock so they never queue behind saves.
  return studentStateRead_(code,token,false)||withLock_(()=>studentStateRead_(code,token,true));
}
function studentStateRead_(code,token,locked) {
    const context=studentContext_(code,token),r=context.room,s=context.student,now=Date.now();
    const patch={};
    if(retakePending_(s)&&r.status==='live') patch.deadlineAt=now+Number(r.durationMin)*60000;
    const endsAt=patch.deadlineAt||studentEndsAt_(r,s);
    const mustFinalize=!s.submittedAt&&(r.status==='closed'||(r.status==='live'&&now>=endsAt));
    if(!mustFinalize&&r.status==='live'&&s.state==='waiting') patch.state='working';
    if(now-Number(s.lastSeen||0)>=SETTINGS.lastSeenWriteMs) patch.lastSeen=now;
    if(!locked&&(mustFinalize||Object.keys(patch).length)) return null;
    if(mustFinalize) finalize_(s,now,r.status==='closed'?'DITUTUP_GURU':'WAKTU_HABIS');
    else if(Object.keys(patch).length){updateRow_(sheet_('Students'),s.row,patch,STUDENT_HEADERS);Object.assign(s,patch);}
    const answers=parseJson_(s.answersJson,{}),order=parseJson_(s.questionOrderJson,[]);
    return {room:Object.assign(publicRoom_(r),{endsAt}),serverTime:Date.now(),student:{name:s.studentName,no:s.studentNo,attempt:attempt_(s),minScore:minScoreFor_(s),state:s.submittedAt?'done':(r.status==='waiting'?'waiting':'working'),answered:Object.keys(answers).length},
      questions:s.submittedAt?[]:order.map(id=>publicQuestion_(BANK_QUESTIONS.find(q=>q.id===id),s.studentId)),
      answers:s.submittedAt?{}:Object.fromEntries(Object.entries(answers).map(([k,v])=>[k,v.value])),
      result:s.submittedAt?makeResult_(s):null};
}
function studentSaveAnswer(code,token,questionId,value) {
  return withLock_(()=>{
    const ctx=studentContext_(code,token),r=ctx.room,s=ctx.student;
    if(s.submittedAt) throw new Error('Ujian sudah dikumpulkan.');
    if(r.status!=='live'||Date.now()>=studentEndsAt_(r,s)) {if(r.status==='live') finalize_(s,Date.now(),'WAKTU_HABIS');throw new Error('Waktu ujian sudah habis atau ruang belum dimulai.');}
    const q=BANK_QUESTIONS.find(x=>x.id===questionId);if(!q) throw new Error('Soal tidak dikenal.');
    const valid=validateAnswer_(q,value);
    const answers=parseJson_(s.answersJson,{});answers[q.id]={value:valid,savedAt:Date.now()};
    updateRow_(sheet_('Students'),s.row,{answersJson:JSON.stringify(answers),state:'working',lastSeen:Date.now()},STUDENT_HEADERS);
    return {ok:true,answered:Object.keys(answers).length,savedAt:Date.now()};
  });
}
function studentSubmit(code,token) {
  return withLock_(()=>{
    const ctx=studentContext_(code,token),r=ctx.room,s=ctx.student;
    if(!s.submittedAt){
      if(r.status==='waiting') throw new Error('Guru belum memulai ujian.');
      finalize_(s,Date.now(),r.status==='closed'?'DITUTUP_GURU':Date.now()>=studentEndsAt_(r,s)?'WAKTU_HABIS':'DIKUMPULKAN');
    }
    return {result:makeResult_(s),serverTime:Date.now()};
  });
}

// ---------- INTERNAL HELPERS (not remotely callable from HTML) ----------
// Opening the spreadsheet is slow, so do it once per request.
let DB_=null;const SHEETS_={};
function getDB_() {
  if(DB_) return DB_;
  const p=PropertiesService.getScriptProperties(),id=p.getProperty('APP_DB_ID');
  if(id) {DB_=SpreadsheetApp.openById(id);if(p.getProperty('SCHEMA_VERSION')!==SCHEMA_VERSION)migrate_(DB_,p);return DB_;}
  const db=SpreadsheetApp.create('DATABASE Math Adventure PTS (JANGAN DIBAGIKAN)');
  const rs=db.getSheets()[0];rs.setName('Rooms');rs.appendRow(ROOM_HEADERS);
  db.insertSheet('Students').appendRow(STUDENT_HEADERS);
  p.setProperties({APP_DB_ID:db.getId(),SCHEMA_VERSION});
  return DB_=db;
}
// Adds new Students columns at the end of the header row; existing data and column positions stay as they were.
function migrate_(db,p){const sh=db.getSheetByName('Students'),width=sh.getLastColumn(),have=width?sh.getRange(1,1,1,width).getValues()[0].map(String):[];
 while(have.length&&have[have.length-1]==='')have.pop();
 if(have.some((h,i)=>h!==STUDENT_HEADERS[i])) throw new Error('Kolom database Students tidak sesuai. Jangan mengubah urutan kolom spreadsheet.');
 if(have.length<STUDENT_HEADERS.length) sh.getRange(1,have.length+1,1,STUDENT_HEADERS.length-have.length).setValues([STUDENT_HEADERS.slice(have.length)]);
 p.setProperty('SCHEMA_VERSION',SCHEMA_VERSION);}
function sheet_(name){return SHEETS_[name]||(SHEETS_[name]=getDB_().getSheetByName(name));}
function withLock_(fn) {const l=LockService.getScriptLock(); if(!l.tryLock(28000)) throw new Error('Server sedang sibuk. Coba lagi beberapa detik.');try{return fn();}finally{l.releaseLock();}}
function readObjects_(sh){const data=sh.getDataRange().getValues();if(data.length<2)return [];
 const headers=data[0];return data.slice(1).map((row,i)=>{const o={row:i+2};headers.forEach((k,j)=>{o[k]=row[j] instanceof Date?row[j].getTime():row[j];});return o;});}
function findRoom_(code){const value=String(code||'').trim().toUpperCase();return readObjects_(sheet_('Rooms')).find(x=>x.code===value);}
function studentsInRoom_(id){return readObjects_(sheet_('Students')).filter(x=>x.roomId===id);}
function studentContext_(code,token){const room=findRoom_(code);if(!room) throw new Error('Ruang tidak ditemukan.');if(!token||String(token).length>200)throw new Error('Sesi siswa tidak valid.');
 const secret=hash_(String(token)),student=studentsInRoom_(room.roomId).find(x=>safeEqual_(String(x.tokenHash),secret));
 if(!student)throw new Error('Sesi siswa tidak ditemukan. Masukkan ulang kode dan identitas sesuai petunjuk guru.');return {room,student};}
function requireTeacher_(token){if(!token||String(token).length>200||CacheService.getScriptCache().get('t_'+hash_(String(token)))!=='ok')throw new Error('Sesi guru telah berakhir. Silakan masuk lagi.');}
// One read + one write for the whole span of changed columns instead of one call per cell.
function updateRow_(sh,row,patch,headers) {const keys=Object.keys(patch),idx=keys.map(k=>{const i=headers.indexOf(k);if(i<0)throw new Error('Kolom tidak dikenali: '+k);return i;});
 if(keys.length===1){sh.getRange(row,idx[0]+1).setValue(patch[keys[0]]);return;}
 const lo=Math.min(...idx),range=sh.getRange(row,lo+1,1,Math.max(...idx)-lo+1),values=range.getValues()[0];
 keys.forEach((k,j)=>{values[idx[j]-lo]=patch[k];});range.setValues([values]);}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(s),Utilities.Charset.UTF_8).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function safeEqual_(a,b){if(!a||!b||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
function randomToken_(){return Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');}
function makeCode_(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const seed=randomToken_().toUpperCase();let result='';for(let i=0;i<7;i++)result+=alphabet[parseInt(seed.slice(i*2,i*2+2),16)%alphabet.length];return result;}
// Sheets may store '07' as 7, so compare participant numbers numerically when they are digits only.
function sameStudentNo_(a,b){const n=v=>{const t=String(v).trim().toLowerCase();return /^\d+$/.test(t)?String(Number(t)):t;};return n(a)===n(b);}
function clean_(value,max){return String(value||'').replace(/[\x00-\x1F<>]/g,'').trim().replace(/\s+/g,' ').slice(0,max);}
function textCell_(value){const s=String(value||'');return /^[=+\-@\t\r]/.test(s)?"'"+s:s;}
function parseJson_(s,def){try{return JSON.parse(String(s||''));}catch(e){return def;}}
function shuffled_(xs,seed){const a=xs.slice();const h=hash_(seed);let state=parseInt(h.slice(0,8),16)||12345;
 for(let i=a.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=state%(i+1);[a[i],a[j]]=[a[j],a[i]];}return a;}
function publicRoom_(r){return {code:r.code,title:r.title,status:r.status,durationMin:Number(r.durationMin),startedAt:Number(r.startedAt||0),endsAt:Number(r.endsAt||0)};}
function publicQuestion_(q,seed){const out={id:q.id,indicator:q.indicator,type:q.type,difficulty:q.difficulty,prompt:q.prompt};
 if(q.stack)out.stack=q.stack;
 if(q.options)out.options=shuffled_(q.options,seed+q.id+'options');
 if(q.tiles)out.tiles=shuffled_(q.tiles,seed+q.id+'tiles');return out;}
function validateAnswer_(q,value){if(q.type==='number'){const s=String(value??'').trim();if(!/^\d{1,4}$/.test(s)) throw new Error('Masukkan bilangan bulat tanpa tanda baca.');return Number(s);}
 if(q.type==='choice'||q.type==='symbol'){const s=String(value||'');if(!q.options.includes(s))throw new Error('Pilihan tidak tersedia.');return s;}
 if(q.type==='order'||q.type==='sequence'){if(!Array.isArray(value)||value.length!==q.tiles.length)throw new Error('Semua kartu harus disusun.');
 const a=q.tiles.slice().sort(),b=value.map(String).sort();if(a.some((v,i)=>v!==b[i]))throw new Error('Susunan kartu tidak valid.');return value.map(String);}
 throw new Error('Jenis soal tidak tersedia.');}
function answerCorrect_(q,value){if(value===undefined||value===null)return false;
 if(Array.isArray(q.answer))return Array.isArray(value)&&JSON.stringify(q.answer)===JSON.stringify(value);
 if(q.type==='number')return Number(value)===Number(q.answer);
 return String(value)===String(q.answer);}
function correctByQuestion_(s){const a=parseJson_(s.answersJson,{});const o={};BANK_QUESTIONS.forEach(q=>o[q.id]=!!a[q.id]&&answerCorrect_(q,a[q.id].value));return o;}
function countAnswered_(s){return Object.keys(parseJson_(s.answersJson,{})).length;}
// A retake never lowers the first score and is capped at retakeMaxScore.
function finalize_(s,now,reason){const correct=correctByQuestion_(s),n=Object.values(correct).filter(Boolean).length,raw=n*5,retake=attempt_(s)===2;
 const patch={submittedAt:now,finalScore:retake?Math.max(Number(s.firstScore)||0,Math.min(raw,SETTINGS.retakeMaxScore)):raw,correctCount:n,state:'done',completionReason:reason,lastSeen:now};
 if(retake)patch.retakeScore=raw;
 updateRow_(sheet_('Students'),s.row,patch,STUDENT_HEADERS);Object.assign(s,patch);}
function attempt_(s){return Number(s.attempt)===2?2:1;}
function retakePending_(s){return attempt_(s)===2&&!s.submittedAt&&!Number(s.deadlineAt);}
function minScoreFor_(s){return attempt_(s)===2?SETTINGS.retakeMinScore:SETTINGS.minScore;}
function passed_(s){return attempt_(s)===2?Number(s.retakeScore)>=SETTINGS.retakeMinScore:Number(s.finalScore)>=SETTINGS.minScore;}
function canRetake_(s){return !!s.submittedAt&&attempt_(s)===1&&!passed_(s);}
function reopenRoom_(r){if(r.status!=='closed')return false;updateRow_(sheet_('Rooms'),r.row,{status:'live',closedAt:''},ROOM_HEADERS);r.status='live';return true;}
function studentNote_(s){const out=[];
 if(attempt_(s)===2){const first=Number(s.firstScore)||0;
  if(!s.submittedAt) out.push('Perbaikan (kesempatan kedua) belum selesai; nilai awal '+first+'.');
  else if(!countAnswered_(s)) out.push('Diberi perbaikan tetapi tidak mengerjakan; nilai tetap nilai awal '+first+'.');
  else {const raw=Number(s.retakeScore)||0;out.push('Perbaikan (kesempatan kedua): nilai awal '+first+', nilai perbaikan '+raw+(raw>SETTINGS.retakeMaxScore?' (dibatasi '+SETTINGS.retakeMaxScore+')':'')+', nilai akhir '+Number(s.finalScore)+'. '+
   (passed_(s)?'Tuntas melalui perbaikan':'Belum tuntas')+' (batas lulus perbaikan '+SETTINGS.retakeMinScore+').');}}
 if(Number(s.extraMin)>0) out.push('Mendapat tambahan waktu '+Number(s.extraMin)+' menit.');
 return out.join(' ');}
// Personal deadline: the timer starts when the room starts, or when the student joins later (devices taking turns).
function studentEndsAt_(r,s){if(Number(s.deadlineAt))return Number(s.deadlineAt);if(retakePending_(s))return Infinity;if(!Number(r.startedAt))return 0;return Math.max(Number(s.joinedAt)||0,Number(r.startedAt))+Number(r.durationMin)*60000;}
function needsExpiry_(r,students){const now=Date.now();return students.some(s=>!s.submittedAt&&(r.status==='closed'||(r.status==='live'&&now>=studentEndsAt_(r,s))));}
// Rooms stay open until the teacher closes them; only students past their own deadline are graded here.
function expireRoom_(r,students){const now=Date.now();
 if(r.status==='live')students.filter(s=>!s.submittedAt&&now>=studentEndsAt_(r,s)).forEach(s=>finalize_(s,now,'WAKTU_HABIS'));
 if(r.status==='closed')students.filter(s=>!s.submittedAt).forEach(s=>finalize_(s,now,'DITUTUP_GURU'));}
function targetedAdvice_(correct){
 const out=[];
 if(!correct.Q12)out.push('Penguatan penjumlahan bersusun dengan teknik menyimpan.');
 if(!correct.Q15)out.push('Latihan pengurangan bersusun dengan teknik meminjam, gunakan blok nilai tempat.');
 if(!correct.Q13||!correct.Q16)out.push('Bimbingan membaca soal cerita: pilih operasi hitung yang tepat dan tulis kalimat matematika.');
 if(!correct.Q09||!correct.Q10)out.push('Latihan mengurutkan bilangan dari kecil ke besar maupun sebaliknya.');
 if(!correct.Q17)out.push('Peragakan perkalian sebagai penjumlahan berulang.');
 if(!correct.Q19)out.push('Peragakan pembagian sebagai pengurangan berulang atau membagi kelompok benda.');
 return out;
}
function indicatorScores_(correct){const out={};INDICATORS.forEach(i=>out[i.id]={correct:0,total:0});BANK_QUESTIONS.forEach(q=>{out[q.indicator].total++;if(correct[q.id])out[q.indicator].correct++;});return out;}
function makeResult_(s){const correct=correctByQuestion_(s),groups=indicatorScores_(correct),score=Number(s.finalScore||0);
 return {score,correct:Number(s.correctCount||0),total:SETTINGS.questionCount,minScore:minScoreFor_(s),passed:passed_(s),reason:s.completionReason,
 attempt:attempt_(s),firstScore:attempt_(s)===2?Number(s.firstScore):null,retakeScore:attempt_(s)===2?Number(s.retakeScore):null,maxScore:attempt_(s)===2?SETTINGS.retakeMaxScore:100,note:studentNote_(s),
 indicators:INDICATORS.map(i=>({name:i.name,correct:groups[i.id].correct,total:groups[i.id].total})),
 recommendations:INDICATORS.filter(i=>groups[i.id].correct/groups[i.id].total<0.75).map(i=>i.next)};}
function roomStats_(students){const done=students.filter(s=>s.submittedAt),scores=done.map(s=>Number(s.finalScore));return {total:students.length,done:done.length,working:students.length-done.length,passed:done.filter(passed_).length,retakes:students.filter(s=>attempt_(s)===2).length,average:scores.length?Math.round(scores.reduce((a,b)=>a+b,0)/scores.length*10)/10:null};}
function formatDate_(ms){return !ms?'':Utilities.formatDate(new Date(Number(ms)),Session.getScriptTimeZone(),'dd/MM/yyyy HH:mm:ss');}
function putSheet_(sheet,rows){if(!rows.length)return;const width=Math.max(...rows.map(r=>r.length));const padded=rows.map(r=>r.concat(Array(width-r.length).fill('')));
 sheet.getRange(1,1,padded.length,width).setValues(padded);sheet.setFrozenRows(1);
 const header=sheet.getRange(1,1,1,width);header.setBackground('#136d60').setFontColor('#ffffff').setFontWeight('bold').setWrap(true);
 sheet.getRange(1,1,padded.length,width).setVerticalAlignment('middle');
 sheet.getRange(1,1,padded.length,width).setWrap(true);
 for(let c=1;c<=width;c++)sheet.setColumnWidth(c,Math.min(340,Math.max(110,c<=2?170:155)));
 sheet.setRowHeight(1,34);
 if(padded.length>1&&width>1){try{sheet.getRange(1,1,padded.length,width).createFilter();}catch(e){}}
}
