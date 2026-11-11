/* EMS Competency live client v1: Supabase Auth + RLS + private storage.
   Never store a service_role or secret API key in browser code. */
'use strict';
const $ = id => document.getElementById(id);
const esc = val => String(val ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const prettyDate = date => date ? new Date(date+'T12:00:00').toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}) : '—';
const prettyTrainingRange = c => { const start=c.trained_on; const end=c.trained_until||start; return start===end?prettyDate(start):`${prettyDate(start)} – ${prettyDate(end)}`; };
const dateDiff = (a,b) => Math.round((new Date(a+'T12:00:00')-new Date(b+'T12:00:00'))/86400000);
const sixMonthsFrom = iso => {const d=new Date(iso+'T12:00:00'),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+6);const m=d.getMonth();d.setDate(Math.min(day,new Date(d.getFullYear(),m+1,0).getDate()));return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const label = (txt,kind='') => `<span class="pill ${kind}">${esc(txt)}</span>`;
const empty = (n=5,txt='ไม่มีรายการ') => `<tr><td colspan="${n}" class="empty">${esc(txt)}</td></tr>`;
let recoveryMode=false, sb=null, current=null, mine=null, profiles=[], courses=[], catalog=[], certificates=[], logs=[], renewId=null, certEditId=null, procEditId=null;
const isAdmin = () => mine?.access_role==='admin' && mine?.approval_status==='approved';

// Avatar v2. Private bucket, per-user UUID folder, no public URLs or service role.
let profileAvatarObjectURL=null, profileAvatarRenderId=0;
function clearProfileAvatarDisplay(){
  profileAvatarRenderId++;
  if(profileAvatarObjectURL){URL.revokeObjectURL(profileAvatarObjectURL);profileAvatarObjectURL=null;}
  const img=$('profileAvatarImage'),placeholder=$('profileAvatarPlaceholder');
  if(img){img.hidden=true;img.removeAttribute('src');}
  if(placeholder)placeholder.hidden=false;
}
async function renderMyAvatar(){
  clearProfileAvatarDisplay();
  const thisRender=profileAvatarRenderId;
  const path=mine?.avatar_path;
  const status=$('myAvatarStatus'),deleteButton=$('myAvatarDelete');
  if(deleteButton)deleteButton.disabled=!path;
  if(!path){if(status)status.textContent='ยังไม่มีรูปโปรไฟล์';return;}
  if(status)status.textContent='กำลังโหลดรูปโปรไฟล์…';
  try{
    const {data,error}=await sb.storage.from('ems-avatars').download(path);
    if(error)throw error;
    if(thisRender!==profileAvatarRenderId)return;
    profileAvatarObjectURL=URL.createObjectURL(data);
    $('profileAvatarImage').src=profileAvatarObjectURL;
    $('profileAvatarImage').hidden=false;
    $('profileAvatarPlaceholder').hidden=true;
    if(status)status.textContent='แสดงรูปโปรไฟล์ล่าสุดแล้ว';
  }catch(err){
    if(thisRender===profileAvatarRenderId){
      if(status)status.textContent='ไม่สามารถโหลดรูปได้ กรุณาตรวจ Storage Policies และสิทธิ์บัญชี';
      console.error('Avatar download failed:',err);
    }
  }
}
function setAvatarActionBusy(busy){
  $('myAvatarUpload').disabled=busy;
  $('myAvatarFile').disabled=busy;
  $('myAvatarDelete').disabled=busy||!mine?.avatar_path;
}

// Staff Profile v1. Safe update is performed by the server-side RPC, never by updating profiles directly.
function staffTenureText(iso){
  if(!iso)return 'ยังไม่ระบุวันเริ่มทำงาน';
  const start=new Date(iso+'T12:00:00'),now=new Date(todayISO()+'T12:00:00');
  if(!Number.isFinite(start.getTime())||start>now)return 'วันเริ่มทำงานไม่ถูกต้อง';
  let months=(now.getFullYear()-start.getFullYear())*12+now.getMonth()-start.getMonth();
  if(now.getDate()<start.getDate())months--;
  months=Math.max(0,months);
  return `${Math.floor(months/12)} ปี ${months%12} เดือน`;
}
function refreshStaffTenure(){
  const el=$('myProfileTenure');if(el)el.textContent=staffTenureText($('myProfileStart').value);
}
function renderMyProfile(){
  if(!mine||!$('myProfileForm'))return;
  $('myProfileFirst').value=mine.first_name||'';
  $('myProfileLast').value=mine.last_name||'';
  $('myProfilePhone').value=mine.phone_number||'';
  $('myProfileStart').value=mine.employment_start_date||'';
  $('myProfileStart').max=todayISO();
  $('myProfilePosition').value=mine.position||'';
  $('profileDisplayName').textContent=`${mine.first_name||''} ${mine.last_name||''}`.trim();
  $('profileRoleLabel').textContent=`${mine.position||''} · ${mine.access_role==='admin'?'Admin':'Staff'}`;
  refreshStaffTenure();
  void renderMyAvatar();
}

const fullName = id => {const p=profiles.find(x=>x.id===id);return p?`${p.first_name} ${p.last_name}`:'ไม่พบข้อมูล'};
const toast = (message,error=false) => {let x=$('toast');x.textContent=message;x.style.background=error?'#962e43':'#244d6b';x.style.display='block';clearTimeout(window.emsToast);window.emsToast=setTimeout(()=>x.style.display='none',6000)};
const reportError = e => {console.error(e);toast(e?.message||'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง',true)};
function showAuthPanel(){ clearProfileAvatarDisplay(); $('startup').hidden=true; $('authWrap').classList.remove('hidden'); $('appPanel').hidden=true; $('mainNav').hidden=true; $('logoutBtn').classList.add('hidden'); $('identity').textContent='EMS Suandok Competency & Operations Hub'; }
function chooseAuth(which){$('loginForm').hidden=which!=='login';$('signupForm').hidden=which!=='signup';$('showLogin').setAttribute('aria-selected',which==='login');$('showSignup').setAttribute('aria-selected',which==='signup');$('showLogin').classList.toggle('primary',which==='login');$('showSignup').classList.toggle('primary',which==='signup');}
function pendingScreen(){showAuthPanel();$('authCard').classList.add('hidden');$('pendingCard').classList.remove('hidden');let st=mine?.approval_status||'pending';$('pendingTitle').textContent=st==='rejected'?'คำขอไม่ผ่านการอนุมัติ':st==='suspended'?'บัญชีถูกระงับ':'รอ Admin อนุมัติบัญชี';$('pendingInfo').textContent=`${mine?.first_name||''} ${mine?.last_name||''} (${mine?.position||''}) — ${st==='pending'?'ส่งคำขอแล้ว โปรดให้ Admin ตรวจสอบ หลังอนุมัติจึงจะเข้าระบบได้':'หากมีข้อสงสัยกรุณาติดต่อผู้ดูแลหน่วยงาน'}`;}
async function fetchAll(table){let out=[];for(let i=0;i<60;i++){let {data,error}=await sb.from(table).select('*').order('created_at',{ascending:false}).range(i*500,(i+1)*500-1);if(error)throw error;out.push(...(data||[]));if(!data||data.length<500) return out;}throw new Error('ข้อมูลจำนวนมากเกินช่วงโหลด โปรดติดต่อผู้ดูแล');}
async function refreshProfile(){let {data,error}=await sb.from('profiles').select('*').eq('id',current.id).single();if(error)throw error;mine=data;}
async function load(){
  if(recoveryMode) return;
  try {
    let {data:{user},error}=await sb.auth.getUser();if(error||!user){current=null;mine=null;showAuthPanel();$('authCard').classList.remove('hidden');$('pendingCard').classList.add('hidden');return;}
    current=user;await refreshProfile();
    if(mine.approval_status!=='approved'){pendingScreen();return;}
    $('startup').hidden=true;$('authWrap').classList.add('hidden');$('appPanel').hidden=false;$('mainNav').hidden=false;$('logoutBtn').classList.remove('hidden');
    $('identity').textContent=`${mine.first_name} ${mine.last_name} · ${mine.position} · ${isAdmin()?'Admin':'Staff'}`;
    document.querySelectorAll('.admin-only').forEach(el=>el.hidden=!isAdmin());
    [profiles,courses,catalog,certificates,logs]=await Promise.all([
      isAdmin()?fetchAll('profiles'):Promise.resolve([mine]),fetchAll('certificate_courses'),fetchAll('procedure_catalog'),fetchAll('certificates'),fetchAll('procedure_logs')]);
    certificates=certificates.filter(c=>!c.deleted_at);
    logs=logs.filter(l=>!l.deleted_at);
    render();renderMyProfile();
    if(window.EMS_EQUIPMENT)await window.EMS_EQUIPMENT.onLogin();
  } catch(e){reportError(e);if(!mine||mine.approval_status!=='approved')showAuthPanel();}
}
function tab(id){if(['members','settings','equipmentAdmin'].includes(id)&&!isAdmin())return;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('#mainNav [data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===id));window.scrollTo({top:0,behavior:'smooth'});if(window.EMS_EQUIPMENT)window.EMS_EQUIPMENT.onTab(id);}
const scopeAllows = (x,p) => x.position_scope==='BOTH'||x.position_scope===p.position;
const courseName = c => c.course_id?(courses.find(x=>x.id===c.course_id)?.name||'ไม่พบหลักสูตร'):c.custom_course;
function certificateLatest(){const m=new Map();for(const c of [...certificates].sort((a,b)=>(a.trained_until||a.trained_on).localeCompare(b.trained_until||b.trained_on)||a.created_at.localeCompare(b.created_at))){m.set(`${c.person_id}|${(courseName(c)||'').toLowerCase().trim()}`,c)}return [...m.values()];}
function certificateStatus(c){if(c.no_expiration)return {label:'ไม่มีวันหมดอายุ',kind:'neutral'};let d=dateDiff(c.expires_on,todayISO());return d<0?{label:`หมดอายุ ${-d} วัน`,kind:'bad'}:c.expires_on<=sixMonthsFrom(todayISO())?{label:`เหลือ ${d} วัน`,kind:'warn'}:{label:'ยังไม่ถึงกำหนด',kind:''};}
function procedureAlerts(){let result=[],today=todayISO();for(const p of profiles.filter(p=>p.approval_status==='approved'))for(const item of catalog.filter(x=>x.active&&scopeAllows(x,p))){let eligible=logs.filter(x=>x.person_id===p.id&&x.procedure_id===item.id&&x.outcome==='success'&&(x.exposure_type==='real'||item.count_simulation));eligible.sort((a,b)=>b.performed_on.localeCompare(a.performed_on));let last=eligible[0];if(!last){result.push({person:p,procedure:item,last:null,over:null,never:true});continue;}let days=dateDiff(today,last.performed_on),over=days-item.interval_days;if(over>0)result.push({person:p,procedure:item,last,over,never:false});}return result.sort((a,b)=>Number(b.never)-Number(a.never)||(b.over||0)-(a.over||0));}

// Summarize competence by person + procedure without changing existing database records.
const plusDaysISO = (iso, days) => {
 const d=new Date(`${iso}T12:00:00`);
 d.setDate(d.getDate()+Number(days));
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
};
const nameSort = (a,b) => String(a).localeCompare(String(b),'th');
const logMoreRecent = (a,b) => b.performed_on.localeCompare(a.performed_on)||String(b.created_at||'').localeCompare(String(a.created_at||''));
const exposureText = type => type==='real'?'Real Patient':type==='simulation'?'Simulation':'—';
const outcomeText = result => ({success:'สำเร็จ',supervised:'ภายใต้การกำกับ',unsuccessful:'ไม่สำเร็จ'})[result]||'—';
function procedureOverview(){
 const history=new Map();
 for(const l of logs){
   const key=`${l.person_id}|${l.procedure_id}`;
   if(!history.has(key))history.set(key,[]);
   history.get(key).push(l);
 }
 for(const list of history.values())list.sort(logMoreRecent);
 const output=[];
 for(const person of profiles.filter(p=>p.approval_status==='approved')){
   for(const procedure of catalog){
     const list=history.get(`${person.id}|${procedure.id}`)||[];
     if(!(procedure.active&&scopeAllows(procedure,person)) && !list.length)continue;
     const lastAttempt=list[0]||null;
     const lastCounted=list.find(x=>x.outcome==='success'&&(x.exposure_type==='real'||procedure.count_simulation))||null;
     let due=null,status;
     if(!procedure.active){status={label:'ปิดใช้งาน',kind:'neutral'};}
     else if(!lastCounted){status=lastAttempt?{label:'ยังไม่มีครั้งที่นับได้',kind:'warn'}:{label:'ไม่เคยบันทึก',kind:'warn'};}
     else {
       due=plusDaysISO(lastCounted.performed_on,procedure.interval_days);
       const remaining=dateDiff(due,todayISO());
       status=remaining<0?{label:`เกินกำหนด ${-remaining} วัน`,kind:'bad'}:
         remaining===0?{label:'ครบกำหนดวันนี้',kind:'warn'}:{label:`เหลือ ${remaining} วัน`,kind:''};
     }
     output.push({person,procedure,lastAttempt,lastCounted,due,status});
   }
 }
 return output.sort((a,b)=>nameSort(`${a.person.first_name} ${a.person.last_name}`,`${b.person.first_name} ${b.person.last_name}`)||nameSort(a.procedure.name,b.procedure.name));
}
const certRowStatus = c => c.no_expiration?'ไม่หมดอายุ':prettyDate(c.expires_on);
const logTypeOutcome = x => x?`${exposureText(x.exposure_type)} / ${outcomeText(x.outcome)}`:'—';
const formatLastAction = x => x?`${prettyDate(x.performed_on)}${x.shift?' · '+x.shift:''}`:'—';


function render(){
 const latest=certificateLatest();
 const notices=latest.filter(c=>!c.no_expiration&&c.expires_on<=sixMonthsFrom(todayISO())).sort((a,b)=>a.expires_on.localeCompare(b.expires_on));
 const overdue=procedureAlerts();
 const approved=profiles.filter(p=>p.approval_status==='approved');
 const visibleLatest=latest.filter(c=>approved.some(p=>p.id===c.person_id));
 const overview=procedureOverview();
 $('dashboardTitle').textContent=isAdmin()?'Dashboard ภาพรวมหน่วยงาน':'Dashboard ของฉัน';
 $('statStaff').textContent=isAdmin()?approved.length:'1';
 $('statSoon').textContent=notices.filter(c=>c.expires_on>=todayISO()).length;
 $('statExpired').textContent=notices.filter(c=>c.expires_on<todayISO()).length;
 $('statOverdue').textContent=overdue.filter(x=>!x.never).length;
 $('neverCount').textContent=`ไม่เคยมีครั้งที่นับได้: ${overdue.filter(x=>x.never).length} รายการ`;
 $('certAlerts').innerHTML=notices.map(c=>`<tr><td>${esc(fullName(c.person_id))}</td><td>${esc(courseName(c))}</td><td>${esc(prettyDate(c.expires_on))}</td><td>${label(certificateStatus(c).label,certificateStatus(c).kind)}</td></tr>`).join('')||empty(4,'ไม่มีใบรับรองใกล้หมดอายุ');
 $('procedureAlerts').innerHTML=overdue.map(p=>`<tr><td>${esc(fullName(p.person.id))}</td><td>${esc(p.procedure.name)}</td><td>${p.last?esc(prettyDate(p.last.performed_on)):'—'}</td><td>${p.never?label('ไม่มีครั้งที่นับได้','neutral'):label(`เกิน ${p.over} วัน`,'bad')}</td></tr>`).join('')||empty(4,'ไม่มีรายการเกินกำหนด');
 // The person filter affects only the complete summary tables, not alert and KPI totals.
 const picker=$('dashboardPersonFilter');
 if(isAdmin()){
   const old=picker.value;
   picker.innerHTML='<option value="all">ทุกคน (ที่อนุมัติแล้ว)</option>'+approved.slice().sort((a,b)=>nameSort(`${a.first_name} ${a.last_name}`,`${b.first_name} ${b.last_name}`)).map(p=>`<option value="${esc(p.id)}">${esc(p.first_name)} ${esc(p.last_name)} (${esc(p.position)})</option>`).join('');
   picker.value=[...picker.options].some(o=>o.value===old)?old:'all';
 }else picker.value='all';
 const personId=isAdmin()&&picker.value!=='all'?picker.value:null;
 const dashCert=visibleLatest.filter(c=>!personId||c.person_id===personId).sort((a,b)=>nameSort(fullName(a.person_id),fullName(b.person_id))||nameSort(courseName(a),courseName(b)));
 const dashProc=overview.filter(x=>!personId||x.person.id===personId);
 $('dashboardCertTitle').textContent=isAdmin()?'Certificate บุคลากร (ล่าสุดต่อหลักสูตร)':'Certificate ของฉัน (ล่าสุดต่อหลักสูตร)';
 $('dashboardProcTitle').textContent=isAdmin()?'หัตถการบุคลากร (ล่าสุดต่อรายการ)':'หัตถการของฉัน (ล่าสุดต่อรายการ)';
 $('dashboardCertCount').textContent=`${dashCert.length} รายการ`;
 $('dashboardProcCount').textContent=`${dashProc.length} รายการ`;
 $('dashboardCertificateRows').innerHTML=dashCert.map(c=>{const p=profiles.find(x=>x.id===c.person_id);const s=certificateStatus(c);return `<tr><td>${esc(fullName(c.person_id))}<div class="muted">${esc(p?.position||'')}</div></td><td>${esc(courseName(c))}</td><td>${esc(prettyTrainingRange(c))}</td><td>${esc(certRowStatus(c))}</td><td>${label(s.label,s.kind)}</td></tr>`;}).join('')||empty(5,'ยังไม่มีประวัติ Certificate');
 $('dashboardProcedureRows').innerHTML=dashProc.map(x=>`<tr><td>${esc(fullName(x.person.id))}<div class="muted">${esc(x.person.position)}</div></td><td>${esc(x.procedure.name)}${!x.procedure.active?' '+label('ปิดใช้งาน','neutral'):''}</td><td>${esc(formatLastAction(x.lastAttempt))}</td><td>${esc(logTypeOutcome(x.lastAttempt))}</td><td>${esc(formatLastAction(x.lastCounted))}</td><td>${esc(prettyDate(x.due))}</td><td>${label(x.status.label,x.status.kind)}</td></tr>`).join('')||empty(7,'ยังไม่มีรายการหัตถการ');
 // Personal pages intentionally show only the signed-in user's data, including for Admin.
 const ownLatest=visibleLatest.filter(c=>c.person_id===mine.id).sort((a,b)=>nameSort(courseName(a),courseName(b)));
 const ownOverview=overview.filter(x=>x.person.id===mine.id);
 $('certificateSummaryRows').innerHTML=ownLatest.map(c=>{const s=certificateStatus(c);return `<tr><td>${esc(courseName(c))}</td><td>${esc(prettyTrainingRange(c))}</td><td>${esc(certRowStatus(c))}</td><td>${label(s.label,s.kind)}</td></tr>`;}).join('')||empty(4,'ยังไม่มี Certificate ของคุณ');
 $('procedureSummaryRows').innerHTML=ownOverview.map(x=>`<tr><td>${esc(x.procedure.name)}${!x.procedure.active?' '+label('ปิดใช้งาน','neutral'):''}</td><td>${esc(formatLastAction(x.lastAttempt))}</td><td>${esc(logTypeOutcome(x.lastAttempt))}</td><td>${esc(formatLastAction(x.lastCounted))}</td><td>${esc(prettyDate(x.due))}</td><td>${label(x.status.label,x.status.kind)}</td></tr>`).join('')||empty(6,'ยังไม่มีรายการหัตถการ');
 const latestIDs=new Set(latest.map(x=>x.id));
 $('certificateRows').innerHTML=[...certificates].filter(c=>c.person_id===mine.id).sort((a,b)=>b.trained_on.localeCompare(a.trained_on)).map(c=>{let s=certificateStatus(c),isLatest=latestIDs.has(c.id);return `<tr><td>${esc(fullName(c.person_id))}</td><td>${esc(courseName(c))}${!isLatest?' '+label('ประวัติเก่า','neutral'):''}</td><td>${esc(prettyTrainingRange(c))}</td><td>${esc(certRowStatus(c))}</td><td>${label(s.label,s.kind)}</td><td class="no-print"><div class="actions">${c.file_path?`<button class="btn small" data-file="${esc(c.id)}">ดูไฟล์</button><button class="btn small primary" data-download-cert="${esc(c.id)}">↓ ดาวน์โหลดใบรับรอง</button>`:'<span class="muted">ไม่มีไฟล์แนบ</span>'}${isLatest?`<button class="btn small" data-renew="${esc(c.id)}">ต่ออายุ</button>`:''}<button class="btn small" data-edit-cert="${esc(c.id)}">แก้ไข</button><button class="btn small danger" data-delete-cert="${esc(c.id)}">ลบ</button></div></td></tr>`}).join('')||empty(6,'ยังไม่มี Certificate');
 $('procedureRows').innerHTML=[...logs].filter(x=>x.person_id===mine.id).sort(logMoreRecent).map(x=>`<tr><td>${esc(fullName(x.person_id))}</td><td>${esc(catalog.find(p=>p.id===x.procedure_id)?.name||'—')}</td><td>${esc(prettyDate(x.performed_on))}</td><td>${esc(x.shift)}</td><td>${esc(exposureText(x.exposure_type))}</td><td>${esc(outcomeText(x.outcome))}</td><td class="no-print"><div class="actions"><button class="btn small" data-edit-log="${esc(x.id)}">แก้ไข</button><button class="btn small danger" data-delete-log="${esc(x.id)}">ลบ</button></div></td></tr>`).join('')||empty(7,'ยังไม่มีประวัติหัตถการ');
 fillCatalogOptions();if(isAdmin())renderAdmin();
}

function fillCatalogOptions(){let old=$('certificateCourse').value,items=courses.filter(x=>x.active);$('certificateCourse').innerHTML=items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')+'<option value="__other__">อื่น ๆ (โปรดระบุ)</option>';if([...$('certificateCourse').options].some(o=>o.value===old))$('certificateCourse').value=old;toggleCustom();
 let prev=$('procedureChoice').value;let applicable=catalog.filter(x=>x.active&&scopeAllows(x,mine));$('procedureChoice').innerHTML=applicable.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} (ทุก ${x.interval_days} วัน)</option>`).join('');if([...$('procedureChoice').options].some(x=>x.value===prev))$('procedureChoice').value=prev;}
function renderAdmin(){let pending=profiles.filter(x=>x.approval_status==='pending');$('pendingCount').textContent=pending.length;
 $('pendingRows').innerHTML=pending.map(x=>`<tr><td>${esc(x.first_name)} ${esc(x.last_name)}</td><td>${esc(x.username)}<div class="muted">${esc(x.email)}</div></td><td>${esc(x.position)}</td><td>${esc(new Date(x.created_at).toLocaleDateString('th-TH'))}</td><td class="no-print"><div class="actions"><button class="btn small primary" data-member="${esc(x.id)}" data-approval="approved">อนุมัติ</button><button class="btn small danger" data-member="${esc(x.id)}" data-approval="rejected">ไม่อนุมัติ</button></div></td></tr>`).join('')||empty(5,'ไม่มีคำขอรออนุมัติ');
 $('memberRows').innerHTML=profiles.map(p=>`<tr><td>${esc(p.first_name)} ${esc(p.last_name)}</td><td>${esc(p.username)}</td><td>${esc(p.position)}</td><td>${esc(p.access_role)}</td><td>${label(p.approval_status,p.approval_status==='approved'?'':p.approval_status==='pending'?'warn':'bad')}</td></tr>`).join('')||empty(5);
 $('coursesList').innerHTML=courses.map(c=>`<div class="row between section"><span>${esc(c.name)} ${!c.active?label('ปิดใช้งาน','neutral'):''}</span><button class="btn small no-print" data-course-toggle="${esc(c.id)}">${c.active?'ปิดใช้งาน':'เปิดใช้งาน'}</button></div>`).join('');
 $('procedureCatalogList').innerHTML=catalog.map(p=>`<div class="section" style="border-top:1px solid #e6edf4;padding-top:10px"><div class="row between"><strong>${esc(p.name)}</strong>${p.active?'':label('ปิดใช้งาน','neutral')}</div><div class="row section no-print"><label class="muted">รอบ <input class="mini-input" type="number" min="1" max="3650" value="${p.interval_days}" data-interval="${esc(p.id)}"> วัน</label><select class="mini-select" data-scope="${esc(p.id)}"><option value="BOTH" ${p.position_scope==='BOTH'?'selected':''}>RN / PN</option><option value="RN" ${p.position_scope==='RN'?'selected':''}>RN</option><option value="PN" ${p.position_scope==='PN'?'selected':''}>PN</option></select><label class="muted"><input type="checkbox" data-sim="${esc(p.id)}" ${p.count_simulation?'checked':''}> นับ Sim</label><button class="btn small" data-save-procedure="${esc(p.id)}">บันทึก</button><button class="btn small" data-toggle-procedure="${esc(p.id)}">${p.active?'ปิด':'เปิด'}</button></div></div>`).join('');
}
function toggleCustom(){const other=$('certificateCourse').value==='__other__';$('customCourseField').hidden=!other;$('customCourse').required=other;if(!other)$('customCourse').value='';}
function printTab(which){document.body.dataset.print=which;$('printDate').textContent=`พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')} · ${esc(mine.first_name)} ${esc(mine.last_name)}`;setTimeout(()=>window.print(),60)}
window.addEventListener('afterprint',()=>delete document.body.dataset.print);
// Self-service corrections: only owner can edit or soft-delete, enforced again by database RLS.
function resetCertificateForm(){
 certEditId=null;renewId=null;
 $('certificateForm').reset();$('certificateTrained').value=todayISO();$('certificateTrainedUntil').value=todayISO();
 $('certificateTrainedUntil').min=$('certificateTrained').value;
 $('certificateExpiry').disabled=false;$('certificateExpiry').required=true;
 $('renewHint').textContent='';$('cancelRenew').classList.add('hidden');
 $('cancelCertificateEdit').classList.add('hidden');$('certificateFormHeading').textContent='เพิ่ม / ต่ออายุ Certificate ของฉัน';
 $('saveCertificate').textContent='บันทึก Certificate';$('editCertificateNote').textContent='';
 fillCatalogOptions();toggleCustom();
}
function beginCertificateEdit(c){
 if(!current||c.person_id!==current.id)return;
 resetCertificateForm();certEditId=c.id;
 let sel=$('certificateCourse');const existing=c.course_id&&courses.find(x=>x.id===c.course_id);
 if(existing && ![...sel.options].some(o=>o.value===c.course_id)){
   const opt=document.createElement('option');opt.value=existing.id;opt.textContent=existing.name+' (ปิดใช้งาน)';sel.append(opt);
 }
 const validCourse=existing&&[...sel.options].some(o=>o.value===c.course_id);
 sel.value=validCourse?c.course_id:'__other__';toggleCustom();
 if(!validCourse)$('customCourse').value=courseName(c)||'';
 $('certificateTrained').value=c.trained_on;
 $('certificateTrainedUntil').value=c.trained_until||c.trained_on;
 $('certificateTrainedUntil').min=c.trained_on;
 $('certificateIssued').value=c.issued_on||'';$('certificateExpiry').value=c.expires_on||'';
 $('noExpiry').checked=!!c.no_expiration;$('certificateExpiry').disabled=!!c.no_expiration;
 $('certificateExpiry').required=!c.no_expiration;
 $('certificateIssuer').value=c.issuer||'';
 $('cancelCertificateEdit').classList.remove('hidden');
 $('certificateFormHeading').textContent='แก้ไข Certificate ของฉัน';$('saveCertificate').textContent='บันทึกการแก้ไข';
 $('editCertificateNote').textContent=c.file_path?'ถ้าไม่เลือกไฟล์ใหม่ จะเก็บหลักฐานเดิมไว้':'เลือกไฟล์หลักฐานได้ตามต้องการ';
 $('certificateForm').scrollIntoView({behavior:'smooth',block:'start'});
}
function resetProcedureForm(){
 procEditId=null;$('procedureForm').reset();$('performedOn').value=todayISO();
 $('procedureFormHeading').textContent='บันทึกหัตถการของฉัน';
 $('saveProcedure').textContent='บันทึกหัตถการ';$('cancelProcedureEdit').classList.add('hidden');
 fillCatalogOptions();
}
function beginProcedureEdit(log){
 if(!current||log.person_id!==current.id)return;
 resetProcedureForm();procEditId=log.id;
 const select=$('procedureChoice'),item=catalog.find(x=>x.id===log.procedure_id);
 if(item&&![...select.options].some(x=>x.value===item.id)){
   const option=document.createElement('option');option.value=item.id;
   option.textContent=item.name+' (รายการเดิม)';select.append(option);
 }
 select.value=log.procedure_id;$('performedOn').value=log.performed_on;
 $('performedShift').value=log.shift;$('exposureType').value=log.exposure_type;
 $('performedOutcome').value=log.outcome;
 $('procedureFormHeading').textContent='แก้ไขประวัติหัตถการของฉัน';
 $('saveProcedure').textContent='บันทึกการแก้ไข';$('cancelProcedureEdit').classList.remove('hidden');
 $('procedureForm').scrollIntoView({behavior:'smooth',block:'start'});
}
async function softDeleteOwn(table,record,description){
 if(!current||record.person_id!==current.id)return toast('แก้ไขได้เฉพาะข้อมูลของตัวเอง',true);
 if(!confirm(`ต้องการลบรายการ "${description}" ออกจาก Dashboard และประวัติของคุณใช่หรือไม่?\nระบบจะเก็บหลักฐานการลบไว้สำหรับ Admin ตรวจสอบย้อนหลัง`))return;
 try{
   const {error,count}=await sb.from(table).update({deleted_at:new Date().toISOString()},{count:'exact'})
     .eq('id',record.id).eq('person_id',current.id).is('deleted_at',null);
   if(error)throw error;
   if(count===0)throw Error('ลบไม่สำเร็จหรือรายการถูกแก้ไขไปแล้ว โปรดลองรีเฟรช');
   if(table==='certificates'&&certEditId===record.id)resetCertificateForm();
   if(table==='procedure_logs'&&procEditId===record.id)resetProcedureForm();
   toast('นำรายการออกจากประวัติแล้ว (เก็บบันทึกการลบไว้ในระบบ)');await load();
 }catch(e){reportError(e)}
}

async function init(){
 $('certificateTrained').value=todayISO();$('certificateTrainedUntil').value=todayISO();$('certificateTrainedUntil').min=$('certificateTrained').value;$('performedOn').value=todayISO();
 $('showLogin').onclick=()=>chooseAuth('login');$('showSignup').onclick=()=>chooseAuth('signup');
 const cfg=window.EMS_CONFIG||{};const valid=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.supabaseUrl||'')&&cfg.supabasePublishableKey&&!String(cfg.supabasePublishableKey).startsWith('PASTE_');
 if(!valid||!window.supabase){$('startup').hidden=true;showAuthPanel();$('unconfigured').hidden=false;return;}
 sb=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const recoveryParams = new URLSearchParams(location.search);
const recoveryHash = new URLSearchParams(location.hash.slice(1));
const recoveryLink =
  recoveryParams.get('type') === 'recovery' ||
  recoveryHash.get('type') === 'recovery';
function showRecoveryScreen() {
  recoveryMode = true;
  showAuthPanel();
  $('authCard').classList.add('hidden');
  $('pendingCard').classList.add('hidden');
  $('recoveryCard').classList.remove('hidden');
}
   sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    setTimeout(showRecoveryScreen, 0);
  }
});

if (recoveryLink) {
  const { data: { session }, error } = await sb.auth.getSession();

  if (!error && session) {
    showRecoveryScreen();
  } else {
    recoveryMode = false;
    showAuthPanel();
    $('recoveryCard').classList.add('hidden');
    $('authCard').classList.remove('hidden');
    toast('ไม่สามารถยืนยันลิงก์รีเซ็ตรหัสผ่านได้ กรุณาขอลิงก์ใหม่', true);
  }
}
$('recoveryForm').addEventListener('submit',async e=>{e.preventDefault();try{const {error}=await sb.auth.updateUser({password:$('recoveryPassword').value});if(error)throw error;recoveryMode=false;await sb.auth.signOut();$('recoveryCard').classList.add('hidden');$('authCard').classList.remove('hidden');chooseAuth('login');toast('เปลี่ยนรหัสผ่านเรียบร้อย กรุณาเข้าสู่ระบบอีกครั้ง');}catch(err){reportError(err)}});
 $('loginForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{const {error}=await sb.auth.signInWithPassword({email:$('loginEmail').value.trim(),password:$('loginPass').value});if(error)throw error;$('loginPass').value='';await load();}catch(err){reportError(err)}finally{btn.disabled=false}});
 $('signupForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.submitter;btn.disabled=true;try{let username=$('regUsername').value.trim().toLowerCase();if(!/^[a-z0-9_.-]{3,32}$/.test(username))throw Error('Username ต้องเป็นภาษาอังกฤษ/ตัวเลข/._- ยาว 3–32 ตัวอักษร');const {error}=await sb.auth.signUp({email:$('regEmail').value.trim(),password:$('regPassword').value,options:{emailRedirectTo:location.origin+location.pathname,data:{first_name:$('regFirst').value.trim(),last_name:$('regLast').value.trim(),position:$('regPosition').value,username}}});if(error)throw error;await sb.auth.signOut();e.target.reset();chooseAuth('login');toast('รับคำขอสมัครแล้ว กรุณาตรวจอีเมลเพื่อยืนยัน แล้วรอ Admin อนุมัติ (หาก Username ซ้ำอาจไม่สำเร็จ)');}catch(err){reportError(err)}finally{btn.disabled=false}});
 $('forgotPassword').onclick=async()=>{const email=$('loginEmail').value.trim();if(!email)return toast('กรอกอีเมลที่ใช้สมัครก่อนค่ะ',true);try{let {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname+'?type=recovery'});if(error)throw error;toast('หากมีบัญชีนี้ ระบบจะส่งลิงก์รีเซ็ตรหัสผ่านทางอีเมล')}catch(e){reportError(e)}};
 async function logout(){if(window.EMS_EQUIPMENT)window.EMS_EQUIPMENT.onLogout();await sb.auth.signOut();current=null;mine=null;profiles=[];courses=[];catalog=[];certificates=[];logs=[];showAuthPanel();$('authCard').classList.remove('hidden');$('pendingCard').classList.add('hidden')}
 $('logoutBtn').onclick=logout;$('pendingLogout').onclick=logout;$('checkApproval').onclick=load;$('refreshBtn').onclick=load;
 $('dashboardPersonFilter').addEventListener('change',render);
 for(const button of document.querySelectorAll('#mainNav [data-tab]'))button.addEventListener('click',()=>tab(button.dataset.tab));
 for(const [btn,which] of [['printDashboard','dashboard'],['printCertificates','certificates'],['printProcedures','procedures'],['printMembers','members']])$(btn).onclick=()=>printTab(which);
 $('certificateCourse').addEventListener('change',toggleCustom);$('certificateTrained').addEventListener('change',()=>{const start=$('certificateTrained').value;const end=$('certificateTrainedUntil');end.min=start;if(start&&(!end.value||end.value<start))end.value=start;});$('noExpiry').addEventListener('change',()=>{$('certificateExpiry').disabled=$('noExpiry').checked;$('certificateExpiry').required=!$('noExpiry').checked;if($('noExpiry').checked)$('certificateExpiry').value=''});
 $('cancelRenew').onclick=resetCertificateForm;
 $('cancelCertificateEdit').onclick=resetCertificateForm;
 $('cancelProcedureEdit').onclick=resetProcedureForm;
 $('certificateForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.submitter;btn.disabled=true;
  let uploaded=null;
  try{
    const choice=$('certificateCourse').value,isOther=choice==='__other__';
    const custom=isOther?$('customCourse').value.trim():null;
    if(isOther&&custom.length<2)throw Error('กรุณาระบุชื่อหลักสูตร');
    const start=$('certificateTrained').value,end=$('certificateTrainedUntil').value;
    if(!start||!end||end<start)throw Error('กรุณาระบุช่วงวันที่อบรมให้ถูกต้อง');
    if(!$('noExpiry').checked&&!$('certificateExpiry').value)throw Error('กรุณาระบุวันหมดอายุ');
    const original=certEditId?certificates.find(x=>x.id===certEditId&&x.person_id===mine.id):null;
    if(certEditId&&!original)throw Error('ไม่พบรายการของคุณที่จะแก้ไข');
    let filePath=original?.file_path||null;
    const file=$('certificateFile').files[0];
    if(file){
      if(!['application/pdf','image/png','image/jpeg'].includes(file.type)||file.size>5242880)throw Error('ไฟล์ต้องเป็น PDF/JPG/PNG และไม่เกิน 5 MB');
      const ext=file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg';
      uploaded=`${mine.id}/${crypto.randomUUID()}.${ext}`;
      const {error}=await sb.storage.from('ems-certificates').upload(uploaded,file,{contentType:file.type,upsert:false});
      if(error)throw error;filePath=uploaded;
    }
    const payload={course_id:isOther?null:choice,custom_course:custom||null,trained_on:start,trained_until:end,
      issued_on:$('certificateIssued').value||null,expires_on:$('noExpiry').checked?null:$('certificateExpiry').value,
      no_expiration:$('noExpiry').checked,issuer:$('certificateIssuer').value.trim()||null,file_path:filePath};
    if(original){
      const {error,count}=await sb.from('certificates').update(payload,{count:'exact'})
        .eq('id',original.id).eq('person_id',mine.id).is('deleted_at',null);
      if(error)throw error;if(count===0)throw Error('แก้ไขไม่สำเร็จหรือรายการถูกลบแล้ว');
      toast('แก้ไข Certificate สำเร็จ');
    }else{
      const {error}=await sb.from('certificates').insert({...payload,person_id:mine.id,renews_certificate_id:renewId});
      if(error)throw error;
      toast('เพิ่ม Certificate สำเร็จ');
    }
    resetCertificateForm();await load();
  }catch(err){reportError(err)}finally{btn.disabled=false}
 });
 $('procedureForm').addEventListener('submit',async e=>{
  e.preventDefault();const btn=e.submitter;btn.disabled=true;
  try{
    if(!$('procedureChoice').value)throw Error('กรุณาเลือกหัตถการ');
    if(!$('performedOn').value)throw Error('กรุณาระบุวันที่ทำหัตถการ');
    const payload={procedure_id:$('procedureChoice').value,performed_on:$('performedOn').value,
      shift:$('performedShift').value,exposure_type:$('exposureType').value,outcome:$('performedOutcome').value};
    if(procEditId){
      const previous=logs.find(x=>x.id===procEditId&&x.person_id===mine.id);
      if(!previous)throw Error('ไม่พบหัตถการของคุณที่จะแก้ไข');
      const {error,count}=await sb.from('procedure_logs').update(payload,{count:'exact'})
        .eq('id',previous.id).eq('person_id',mine.id).is('deleted_at',null);
      if(error)throw error;if(count===0)throw Error('แก้ไขไม่สำเร็จหรือรายการถูกลบแล้ว');
      toast('แก้ไขหัตถการสำเร็จ');
    }else{
      const {error}=await sb.from('procedure_logs').insert({...payload,person_id:mine.id});
      if(error)throw error;toast('บันทึกหัตถการสำเร็จ');
    }
    resetProcedureForm();await load();
  }catch(err){reportError(err)}finally{btn.disabled=false}
 });
// Fetch a private certificate through the current user's Supabase session.
// Storage RLS remains the final authority, regardless of UI checks.
async function downloadOwnCertificate(record,button){
  if(!current || !mine || record.person_id!==current.id || !record.file_path)
    throw Error('คุณไม่มีสิทธิ์ดาวน์โหลดไฟล์นี้ หรือยังไม่ได้แนบใบรับรอง');
  const originalLabel=button.textContent;
  button.disabled=true;
  button.textContent='กำลังดาวน์โหลด…';
  try{
    const {data:blob,error}=await sb.storage.from('ems-certificates').download(record.file_path);
    if(error)throw error;
    if(!blob)throw Error('ไม่พบไฟล์แนบ');
    const extension=(record.file_path.match(/\.(pdf|png|jpe?g)$/i)||[])[1]?.toLowerCase()||
      ({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png'}[blob.type]||'pdf');
    const safeCourse=(courseName(record)||'Certificate').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,80)||'Certificate';
    const fileName=`${safeCourse}_${record.trained_on||'training'}.${extension}`;
    const objectURL=URL.createObjectURL(blob);
    try{
      const link=document.createElement('a');
      link.href=objectURL;link.download=fileName;
      link.style.display='none';document.body.appendChild(link);link.click();link.remove();
      toast('เตรียมไฟล์ดาวน์โหลดแล้ว โปรดตรวจสอบ Downloads ของเบราว์เซอร์');
    } finally {setTimeout(()=>URL.revokeObjectURL(objectURL),60000);}
  } finally {button.textContent=originalLabel;button.disabled=false;}
}
 $('certificateRows').addEventListener('click',async e=>{
  const edit=e.target.closest('[data-edit-cert]');
  const del=e.target.closest('[data-delete-cert]');
  const download=e.target.closest('[data-download-cert]');
  if(download){const c=certificates.find(x=>x.id===download.dataset.downloadCert&&x.person_id===mine?.id);if(!c)return;try{await downloadOwnCertificate(c,download);}catch(err){reportError(err);}return;}
  if(edit){const c=certificates.find(x=>x.id===edit.dataset.editCert&&x.person_id===mine.id);if(c)beginCertificateEdit(c);return;}
  if(del){const c=certificates.find(x=>x.id===del.dataset.deleteCert&&x.person_id===mine.id);if(c)await softDeleteOwn('certificates',c,courseName(c));return;}
  const renew=e.target.closest('[data-renew]'),file=e.target.closest('[data-file]');
  if(renew){
    const c=certificates.find(x=>x.id===renew.dataset.renew&&x.person_id===mine.id);if(!c)return;
    resetCertificateForm();renewId=c.id;
    const active=c.course_id&&[...$('certificateCourse').options].some(o=>o.value===c.course_id);
    $('certificateCourse').value=active?c.course_id:'__other__';toggleCustom();
    if(!active)$('customCourse').value=courseName(c)||'';
    $('noExpiry').checked=!!c.no_expiration;$('certificateExpiry').disabled=!!c.no_expiration;
    $('certificateExpiry').required=!c.no_expiration;$('certificateIssuer').value=c.issuer||'';
    $('renewHint').textContent=`กำลังต่ออายุ: ${courseName(c)} (เก็บใบเดิมเป็นประวัติ)`;
    $('cancelRenew').classList.remove('hidden');$('certificateForm').scrollIntoView({behavior:'smooth'});return;
  }
  if(file){
    const c=certificates.find(x=>x.id===file.dataset.file&&x.person_id===mine.id);if(!c||!c.file_path)return;
    try{const {data,error}=await sb.storage.from('ems-certificates').createSignedUrl(c.file_path,90);
      if(error)throw error;window.open(data.signedUrl,'_blank','noopener,noreferrer');}
    catch(err){reportError(err)}
  }
 });
 $('procedureRows').addEventListener('click',async e=>{
   const edit=e.target.closest('[data-edit-log]'),del=e.target.closest('[data-delete-log]');
   if(edit){const log=logs.find(x=>x.id===edit.dataset.editLog&&x.person_id===mine.id);if(log)beginProcedureEdit(log);return;}
   if(del){const log=logs.find(x=>x.id===del.dataset.deleteLog&&x.person_id===mine.id);
      if(log)await softDeleteOwn('procedure_logs',log,catalog.find(p=>p.id===log.procedure_id)?.name||'หัตถการ');}
 });
 $('pendingRows').addEventListener('click',async e=>{const b=e.target.closest('[data-approval]');if(!b||!isAdmin())return;const p=profiles.find(x=>x.id===b.dataset.member);if(!p||!confirm(`${b.dataset.approval==='approved'?'อนุมัติ':'ไม่อนุมัติ'}บัญชี ${p.first_name} ${p.last_name} ใช่หรือไม่?`))return;b.disabled=true;try{const {error}=await sb.from('profiles').update({approval_status:b.dataset.approval,approved_by:mine.id,approved_at:b.dataset.approval==='approved'?new Date().toISOString():null}).eq('id',p.id);if(error)throw error;toast('อัปเดตสถานะสมาชิกแล้ว');await load();}catch(err){reportError(err)}finally{b.disabled=false}});
 $('addCourseForm').addEventListener('submit',async e=>{e.preventDefault();try{const {error}=await sb.from('certificate_courses').insert({name:$('newCourseName').value.trim()});if(error)throw error;e.target.reset();toast('เพิ่มหลักสูตรเรียบร้อย');await load();}catch(err){reportError(err)}});
 $('coursesList').addEventListener('click',async e=>{const b=e.target.closest('[data-course-toggle]');if(!b)return;const c=courses.find(x=>x.id===b.dataset.courseToggle);if(!c)return;try{const {error}=await sb.from('certificate_courses').update({active:!c.active}).eq('id',c.id);if(error)throw error;await load();}catch(err){reportError(err)}});
 $('addProcedureForm').addEventListener('submit',async e=>{e.preventDefault();try{const {error}=await sb.from('procedure_catalog').insert({name:$('newProcedureName').value.trim(),interval_days:Number($('newProcedureInterval').value),position_scope:$('newProcedureScope').value,count_simulation:$('newProcedureSimulation').checked});if(error)throw error;e.target.reset();toast('เพิ่มรายการหัตถการแล้ว');await load();}catch(err){reportError(err)}});
 $('procedureCatalogList').addEventListener('click',async e=>{const save=e.target.closest('[data-save-procedure]'),toggle=e.target.closest('[data-toggle-procedure]');if(!save&&!toggle)return;let p=catalog.find(x=>x.id===(save?.dataset.saveProcedure||toggle?.dataset.toggleProcedure));if(!p)return;try{let patch=toggle?{active:!p.active}:{interval_days:Number(document.querySelector(`[data-interval="${p.id}"]`).value),position_scope:document.querySelector(`[data-scope="${p.id}"]`).value,count_simulation:document.querySelector(`[data-sim="${p.id}"]`).checked};const {error}=await sb.from('procedure_catalog').update(patch).eq('id',p.id);if(error)throw error;toast('บันทึกการตั้งค่าหัตถการแล้ว');await load();}catch(err){reportError(err)}});
  $('myAvatarFile').addEventListener('change',()=>{
    const file=$('myAvatarFile').files[0];
    if(file)$('myAvatarStatus').textContent=`เลือกรูป: ${file.name} — กดอัปโหลดเพื่อบันทึก`;
  });
  $('myAvatarUpload').addEventListener('click',async()=>{
    if(!current||!mine||mine.approval_status!=='approved')return toast('กรุณา Login ด้วยบัญชีที่อนุมัติแล้ว',true);
    const file=$('myAvatarFile').files[0];
    if(!file)return toast('กรุณาเลือกรูปโปรไฟล์ก่อนค่ะ',true);
    const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    if(!extensions[file.type])return toast('เลือกได้เฉพาะ JPEG, PNG หรือ WebP',true);
    if(!file.size||file.size>2*1024*1024)return toast('ขนาดรูปต้องไม่เกิน 2 MB',true);
    if(!confirm('อัปโหลดรูปนี้เป็นรูปโปรไฟล์ของคุณใช่หรือไม่?'))return;
    const userId=current.id,oldPath=mine.avatar_path||null;
    const newPath=`${userId}/${crypto.randomUUID()}.${extensions[file.type]}`;
    let uploaded=false,profileUpdated=false;
    setAvatarActionBusy(true);
    $('myAvatarStatus').textContent='กำลังอัปโหลดรูป…';
    try{
      const upload=await sb.storage.from('ems-avatars').upload(newPath,file,{contentType:file.type,upsert:false});
      if(upload.error)throw upload.error;
      uploaded=true;
      const saved=await sb.rpc('ems_set_my_avatar',{p_avatar_path:newPath});
      if(saved.error)throw saved.error;
      profileUpdated=true;
      $('myAvatarFile').value='';
      await load();
      let oldFileCleanupFailed=false;
      if(oldPath && oldPath!==newPath){
        const remove=await sb.storage.from('ems-avatars').remove([oldPath]);
        oldFileCleanupFailed=!!remove.error;
      }
      toast(oldFileCleanupFailed?'เปลี่ยนรูปแล้ว แต่ลบไฟล์รูปเก่าไม่สำเร็จ โปรดแจ้ง Admin':'อัปโหลดรูปโปรไฟล์สำเร็จ',oldFileCleanupFailed);
    }catch(err){
      if(uploaded&&!profileUpdated){
        try{await sb.storage.from('ems-avatars').remove([newPath]);}catch(_err){console.error('Avatar cleanup failed:',_err);}
      }
      reportError(err);
      $('myAvatarStatus').textContent='อัปโหลดไม่สำเร็จ ตรวจสอบว่ารัน SQL ems_set_my_avatar แล้ว';
    }finally{setAvatarActionBusy(false);}
  });
  $('myAvatarDelete').addEventListener('click',async()=>{
    if(!current||!mine||mine.approval_status!=='approved'||!mine.avatar_path)return;
    if(!confirm('ต้องการลบรูปโปรไฟล์ของคุณใช่หรือไม่?'))return;
    const oldPath=mine.avatar_path;
    setAvatarActionBusy(true);
    $('myAvatarStatus').textContent='กำลังลบรูปโปรไฟล์…';
    try{
      const saved=await sb.rpc('ems_set_my_avatar',{p_avatar_path:null});
      if(saved.error)throw saved.error;
      await load();
      const removed=await sb.storage.from('ems-avatars').remove([oldPath]);
      if(removed.error){
        toast('นำรูปออกจากโปรไฟล์แล้ว แต่ลบไฟล์เก่าไม่สำเร็จ โปรดแจ้ง Admin',true);
      }else toast('ลบรูปโปรไฟล์แล้ว');
    }catch(err){reportError(err);}
    finally{setAvatarActionBusy(false);}
  });
  $('myProfileStart').addEventListener('change',refreshStaffTenure);
  $('myProfileForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!current||!mine||mine.approval_status!=='approved')return toast('กรุณาเข้าสู่ระบบและรออนุมัติบัญชีก่อน',true);
    const btn=$('myProfileSave');btn.disabled=true;
    const first=$('myProfileFirst').value.trim(),last=$('myProfileLast').value.trim();
    const phone=$('myProfilePhone').value.trim(),start=$('myProfileStart').value||null;
    try{
      if(!first||!last||first.length>100||last.length>100)throw Error('กรุณากรอกชื่อและนามสกุลให้ถูกต้อง');
      if(phone.length>30)throw Error('เบอร์โทรยาวเกินกำหนด');
      if(start&&start>todayISO())throw Error('วันที่เริ่มทำงานต้องไม่เป็นวันในอนาคต');
      const {error}=await sb.rpc('ems_update_my_profile',{
        p_first_name:first,p_last_name:last,p_phone_number:phone,p_employment_start_date:start
      });
      if(error)throw error;
      $('myProfileStatus').textContent='บันทึกเรียบร้อย';
      toast('บันทึกข้อมูลสมาชิกของฉันแล้ว');
      await load();
    }catch(err){reportError(err);}finally{btn.disabled=false;}
  });
  await load();
}
window.addEventListener('DOMContentLoaded' ,()=>init().catch(reportError));
