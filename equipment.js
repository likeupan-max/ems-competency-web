/* EMS Suandok Daily Equipment OK. Uses existing Supabase Auth/session from app.js.
   No secret keys in browser. Server-side shift/RLS/audit rules live in supabase/*.sql. */
'use strict';
(function(){
  const $e = id=>document.getElementById(id);
  const escapeHTML = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={night:'ดึก',morning:'เช้า',evening:'บ่าย'};
  const five=['มีครบพร้อมใช้งาน','มีไม่ครบ','มีไม่พร้อมใช้งาน','ไม่มี','ส่งซ่อม'];
  const statusClass={'มีครบพร้อมใช้งาน':'eq-good','มีไม่ครบ':'eq-warn','มีไม่พร้อมใช้งาน':'eq-orange','ไม่มี':'eq-bad','ส่งซ่อม':'eq-purple','พอใช้':'eq-good','ไม่พอใช้':'eq-bad'};
  const stationCodes={Triage:'triage','Referral Center':'referral','Active Refer':'active_refer',RRT:'rrt','Dressing Wound Room':'dressing'};
  let stations=[],items=[],selectedCheck=null,selectedEntries=[],currentDashboard=null,editingItemId=null,channel=null,refreshTimer=null,initDone=false;
  const notify=(message,error=false)=>{ if(typeof toast==='function')toast(message,error);else alert(message); };
  const db=()=> typeof sb!=='undefined'?sb:null;
  const authorized=()=> typeof mine!=='undefined' && mine?.approval_status==='approved';
  const admin=()=> typeof isAdmin==='function' && isAdmin();
  const ownId=()=>typeof current!=='undefined'?current?.id:null;
  function bangkokParts(d=new Date()){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
    return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
  }
  const bkkDate=()=>bangkokParts().date;
  function addDays(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
  function addMonths(iso,months){const [y,m,d]=iso.split('-').map(Number);const start=new Date(Date.UTC(y,m-1+months,1));const end=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();start.setUTCDate(Math.min(d,end));return start.toISOString().slice(0,10)}
  function localOpen(date,shift){const n=bangkokParts();const now=n.date+'T'+n.time;let begin='',end='';
    if(shift==='night'){begin=addDays(date,-1)+'T23:45';end=date+'T08:00';}
    if(shift==='morning'){begin=date+'T07:45';end=date+'T16:00';}
    if(shift==='evening'){begin=date+'T15:45';end=addDays(date,1)+'T00:00';}
    return now>=begin&&now<end;
  }
  function timeThai(value){if(!value)return '—';return new Date(value).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});}
  const readableDate=date=>date?new Date(date+'T12:00:00Z').toLocaleDateString('th-TH',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}):'—';
  const isAvailable=(ws,s)=>stations.find(x=>x.code===ws)?.shifts?.includes(s)??false;
  const pct=(done,total)=>total?`${(100*done/total).toFixed(1).replace('.0','')}%`:'—';
  const currentItems=ws=>items.filter(i=>i.workstation===ws&&i.active&&!i.is_placeholder).sort((a,b)=>a.sort_order-b.sort_order);
  const itemSnap=i=>({name:i.name,category:i.category,bag_group:i.bag_group,required_qty:i.required_qty,unit:i.unit,input_type:i.input_type,options:i.options,extra_fields:i.extra_fields,source_code:i.source_code,sort_order:i.sort_order});
  const escAttr=escapeHTML;
  function badge(v){if(!v)return '<span class="eq-chip eq-pending">รอตรวจ</span>';return `<span class="eq-chip ${statusClass[v]||'eq-neutral'}">${escapeHTML(v)}</span>`;}
  function renderAmount(snap,answer){ const typ=snap.input_type,val=answer||{};
    if(typ==='stock'){
      if(val.opening===''||val.opening==null||val.closing===''||val.closing==null)return '<span class="eq-chip eq-pending">รอตรวจ</span>';
      const op=Number(val.opening),cl=Number(val.closing),rec=Number(val.received||0),need=Math.max(0,Number(snap.required_qty||0)-cl);
      const used=op+rec-cl;
      return `<span class="eq-chip ${need>0?'eq-warn':'eq-good'}">ต้น ${escapeHTML(op)} · ใช้ ${escapeHTML(used)} · เหลือ ${escapeHTML(cl)} · เติม ${escapeHTML(need)}</span>`;
    }
    if(val.value===''||val.value==null)return '<span class="eq-chip eq-pending">รอตรวจ</span>';
    return badge(val.value);
  }
  async function getRows(table,query){let result=[];for(let offset=0;offset<10000;offset+=500){const {data,error}=await query(offset,offset+499);if(error)throw error;result.push(...(data||[]));if(!data||data.length<500)return result;}throw Error('ข้อมูลมากเกินขอบเขต โปรดติดต่อ Admin');}
  async function reloadTemplates(){
    const [ws,it]=await Promise.all([db().from('equipment_workstations').select('*').order('sort_order'),getRows('equipment_items',(a,b)=>db().from('equipment_items').select('*').order('sort_order').range(a,b))]);
    if(ws.error)throw ws.error;stations=ws.data||[];items=it;
    $e('eqCheckStation').innerHTML=stations.map(s=>`<option value="${escAttr(s.code)}">${escapeHTML(s.display_name)}</option>`).join('');
    $e('eqAdminStation').innerHTML=stations.map(s=>`<option value="${escAttr(s.code)}">${escapeHTML(s.display_name)}</option>`).join('');
    const old=$e('eqCheckShift').value||'morning';$e('eqCheckShift').value=old;
    updateAllowedShifts();renderAdmin();
  }
  function updateAllowedShifts(){const station=stations.find(s=>s.code===$e('eqCheckStation').value),select=$e('eqCheckShift');if(!station)return;
    const val=select.value;
    select.innerHTML=station.shifts.map(s=>`<option value="${s}">เวร${labels[s]}</option>`).join('');
    if(station.shifts.includes(val))select.value=val;
  }
  async function onLogin(){
    if(!authorized())return;
    try{
      await reloadTemplates();
      $e('eqDashDate').value=bkkDate();$e('eqDashDate').max=addDays(bkkDate(),1);$e('eqDashDate').min=addMonths(bkkDate(),-6);
      const n=bangkokParts();let shift='morning',date=n.date;
      if(n.time>='23:45'){shift='night';date=addDays(n.date,1)}
      else if(n.time<'08:00'){shift='night'}
      else if(n.time>='15:45'){shift='evening'}
      $e('eqCheckDate').value=date;$e('eqCheckShift').value=shift;updateAllowedShifts();
      await Promise.all([loadDashboard(),loadChecklist()]);
      setupChannel();
    }catch(e){$e('eqDashboardBody').innerHTML=`<p class="error">ยังโหลด Equipment OK ไม่ได้: ${escapeHTML(e.message)}</p><p class="muted">โปรดรัน SQL schema และ seed ใน Supabase เดิมก่อนใช้งาน</p>`;$e('eqCheckBody').innerHTML='<p class="muted">ยังไม่มีข้อมูลอุปกรณ์ กรุณาตรวจสอบการตั้งค่า Supabase</p>';console.error('equipment setup:',e);}
  }
  function onLogout(){selectedCheck=null;selectedEntries=[];currentDashboard=null;items=[];stations=[];if(channel&&db()){db().removeChannel(channel);channel=null;}if(refreshTimer){clearTimeout(refreshTimer);refreshTimer=null;}}
  function onTab(id){if(!authorized())return;if(id==='equipmentDashboard')loadDashboard().catch(error);else if(id==='equipmentCheck')loadChecklist().catch(error);else if(id==='equipmentAdmin')renderAdmin();}
  function error(e){console.error(e);notify(e.message||String(e),true)}
  function setupChannel(){if(channel){db().removeChannel(channel);channel=null;}
    channel=db().channel('ems-equipment-dashboard').on('postgres_changes',{event:'*',schema:'public',table:'equipment_checks'},()=>scheduleUpdate()).on('postgres_changes',{event:'*',schema:'public',table:'equipment_entries'},()=>scheduleUpdate()).subscribe();
    if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setInterval(()=>{if(document.getElementById('equipmentDashboard')?.classList.contains('active'))loadDashboard().catch(console.error)},60000);
  }
  let updateTimeout=null;
  function scheduleUpdate(){if(updateTimeout)clearTimeout(updateTimeout);updateTimeout=setTimeout(()=>{if(authorized())loadDashboard().catch(console.error)},700)}
  async function findCheck(date,ws,shift){const {data,error:err}=await db().from('equipment_checks').select('*').eq('shift_date',date).eq('workstation',ws).eq('shift',shift).maybeSingle();if(err)throw err;return data;}
  async function checkEntries(id){return getRows('equipment_entries',(a,b)=>db().from('equipment_entries').select('*').eq('check_id',id).order('id').range(a,b));}
  async function loadChecklist(){
    if(!authorized()||!stations.length)return;
    const date=$e('eqCheckDate').value,ws=$e('eqCheckStation').value,shift=$e('eqCheckShift').value;
    if(!date||!ws)return;
    if(!isAvailable(ws,shift)){selectedCheck=null;selectedEntries=[];$e('eqCheckBody').innerHTML='<div class="banner">เวรนี้ไม่ต้อง OK อุปกรณ์ของจุดนี้</div>';return;}
    selectedCheck=await findCheck(date,ws,shift);
    selectedEntries=selectedCheck?await checkEntries(selectedCheck.id):[];
    renderChecklist();
  }
  function inputWidget(snap,ans,entryId,readonly){
    const ty=snap.input_type, v=ans||{}, dis=readonly?'disabled':'', options=Array.isArray(snap.options)?snap.options:[];
    const field=(part,html)=>`<label class="field eq-mini-field">${part}${html}</label>`;
    let out='';
    if(ty==='status'||ty==='binary'){
      const opts=ty==='status'?five:options;
      out=field('สถานะ',`<select data-eq-part="value" ${dis}><option value="">— เลือก —</option>${opts.map(op=>`<option value="${escAttr(op)}" ${op===v.value?'selected':''}>${escapeHTML(op)}</option>`).join('')}</select>`);
    }else if(ty==='stock'){
      out=`<div class="eq-stock-fields">
       ${field('ต้นเวร',`<input type="number" min="0" step="1" data-eq-part="opening" value="${escAttr(v.opening??'')}" ${dis}>`)}
       ${field('รับเพิ่ม',`<input type="number" min="0" step="1" data-eq-part="received" value="${escAttr(v.received??'0')}" ${dis}>`)}
       ${field('เหลือปลายเวร',`<input type="number" min="0" step="1" data-eq-part="closing" value="${escAttr(v.closing??'')}" ${dis}>`)}
      </div><div class="eq-stock-result" data-eq-stock-result>ระบบคำนวณจำนวนที่ต้องเตรียมเมื่อกรอกจำนวนปลายเวร</div>`;
    }else{
      const type=ty==='date'?'date':ty==='number'?'number':'text';
      out=field(ty==='date'?'วันที่':ty==='number'?'จำนวน':'รายละเอียด',`<input data-eq-part="value" type="${type}" ${ty==='number'?'min="0" step="any"':''} value="${escAttr(v.value??'')}" ${dis}>`);
    }
    for(const f of (snap.extra_fields||[])){
      const typ=['date','number','text'].includes(f.type)?f.type:'text';
      out+=field(escapeHTML(f.label||f.key)+(f.required?' *':''),`<input type="${typ}" ${typ==='number'?'min="0"':''} data-eq-extra="${escAttr(f.key)}" value="${escAttr((v.fields||{})[f.key]??'')}" ${dis}>`);
    }
    return out;
  }
  function renderChecklist(){
    const date=$e('eqCheckDate').value,shift=$e('eqCheckShift').value,ws=$e('eqCheckStation').value;
    const active=localOpen(date,shift), mineCheck=selectedCheck&&(selectedCheck.checked_by===ownId()||admin());
    const canEdit=active&&(!selectedCheck||mineCheck);
    const station=stations.find(s=>s.code===ws);
    const title=`${station?.display_name||ws} • ${readableDate(date)} • เวร${labels[shift]}`;
    let rows=selectedCheck?selectedEntries.map(e=>({id:e.id,snap:e.item_snapshot,answer:e.answer||{},remark:e.remark||'',stored:e})):currentItems(ws).map(i=>({id:i.id,snap:itemSnap(i),answer:{},remark:'',stored:null}));
    rows.sort((a,b)=>(a.snap.sort_order||0)-(b.snap.sort_order||0));
    const completed=rows.filter(x=>isComplete(x.snap,x.answer,x.remark)).length;
    let lastGroup='';
    const body=rows.map((r,i)=>{
      const category=[r.snap.bag_group,r.snap.category].filter(Boolean).join(' / ')||'อุปกรณ์';
      let hdr='';if(lastGroup!==category){lastGroup=category;hdr=`<tr class="eq-group"><td colspan="3">${escapeHTML(category)}</td></tr>`;}
      return hdr+`<tr data-eq-row="${escAttr(r.id)}"><td class="eq-item-name">${escapeHTML(r.snap.name)}<small>${r.snap.required_qty!=null?'ต้องมี '+escapeHTML(r.snap.required_qty)+' '+escapeHTML(r.snap.unit||''):''}</small></td>
        <td class="eq-item-form">${inputWidget(r.snap,r.answer,r.id,!canEdit||!selectedCheck)}</td>
        <td><textarea class="eq-note" rows="2" maxlength="2000" placeholder="หมายเหตุ (ถ้ามี)" ${!canEdit||!selectedCheck?'disabled':''}>${escapeHTML(r.remark)}</textarea>
        ${r.stored&&r.stored.updated_by_name?`<small>แก้ไข: ${escapeHTML(r.stored.updated_by_name)}<br>${escapeHTML(timeThai(r.stored.updated_at))}</small>`:''}</td></tr>`;
    }).join('');
    const owner=selectedCheck?`<p class="muted">ผู้เริ่มตรวจ: ${escapeHTML(selectedCheck.checked_by_name)} · ${escapeHTML(timeThai(selectedCheck.created_at))}<br>ผู้ยืนยัน: ${escapeHTML(selectedCheck.submitted_by_name||'ยังไม่มีผู้ยืนยันผล')} ${selectedCheck.submitted_at?'· '+escapeHTML(timeThai(selectedCheck.submitted_at)):''}</p>`:'';
    $e('eqCheckBody').innerHTML=`<div class="card section"><div class="top"><div><h3>${escapeHTML(title)}</h3><p class="muted">${active?'กำลังอยู่ในเวลาเวร':'อยู่นอกเวลาเวร — อ่านอย่างเดียว'} · ${selectedCheck?selectedCheck.status==='submitted'?'ยืนยันผลแล้ว':'ฉบับร่าง':'ยังไม่ได้เริ่มบันทึก'}</p></div><span class="eq-chip ${completed===rows.length&&rows.length?'eq-good':'eq-pending'}">กรอกครบ ${completed}/${rows.length}</span></div>
      ${rows.length?`<div class="tablewrap eq-table-wrap"><table class="eq-form-table"><thead><tr><th>รายการอุปกรณ์</th><th>ข้อมูลที่ต้อง OK</th><th>หมายเหตุ</th></tr></thead><tbody>${body}</tbody></table></div>`:'<p>ไม่มีรายการอุปกรณ์ที่เปิดใช้งาน กรุณาให้ Admin กำหนดรายการก่อน</p>'}
      <div class="field section"><label for="eqOverallRemark">หมายเหตุรวมประจำเวร</label><textarea id="eqOverallRemark" maxlength="2000" rows="2" ${!canEdit||!selectedCheck?'disabled':''}>${escapeHTML(selectedCheck?.overall_remark||'')}</textarea></div>
      ${owner}<div class="row no-print">${!selectedCheck&&canEdit&&rows.length?'<button class="btn primary" type="button" id="eqStartBtn">เริ่ม OK อุปกรณ์</button>':''}
      ${selectedCheck&&canEdit?'<button class="btn" type="button" id="eqSaveDraftBtn">บันทึกข้อมูล</button><button class="btn primary" type="button" id="eqSubmitBtn">ยืนยันผล OK</button>':''}
      <button class="btn" type="button" id="eqPrintCheckBtn">⎙ พิมพ์ Checklist / PDF</button></div></div>`;
    $e('eqStartBtn')?.addEventListener('click',()=>startChecklist().catch(error));
    $e('eqSaveDraftBtn')?.addEventListener('click',()=>saveChecklist(false).catch(error));
    $e('eqSubmitBtn')?.addEventListener('click',()=>saveChecklist(true).catch(error));
    $e('eqPrintCheckBtn')?.addEventListener('click',()=>printEquipment('check'));
    $e('eqCheckBody').querySelectorAll('[data-eq-row]').forEach(row=>row.addEventListener('input',()=>updateStock(row)));
    $e('eqCheckBody').querySelectorAll('[data-eq-row]').forEach(row=>updateStock(row));
  }
  function updateStock(row){const val=part=>row.querySelector(`[data-eq-part="${part}"]`)?.value??'';
    const node=row.querySelector('[data-eq-stock-result]');if(!node)return;
    const e=selectedEntries.find(x=>x.id===row.dataset.eqRow),i=items.find(x=>x.id===row.dataset.eqRow),snap=e?.item_snapshot||itemSnap(i||{});
    if(val('opening')===''||val('closing')===''){node.textContent='กรอกจำนวนต้นเวรและปลายเวร เพื่อคำนวณจำนวนที่ต้องเตรียม';return;}
    const op=Number(val('opening')),cl=Number(val('closing')),rec=Number(val('received')||0);
    if(cl>op+rec){node.textContent='จำนวนเหลือมากกว่าจำนวนต้นเวร + รับเพิ่ม กรุณาตรวจสอบ';return;}
    node.textContent=`ใช้ ${op+rec-cl} · เหลือ ${cl} · ต้องเตรียม ${Math.max(0,Number(snap.required_qty||0)-cl)}`;
  }
  async function startChecklist(){
    const date=$e('eqCheckDate').value,ws=$e('eqCheckStation').value,shift=$e('eqCheckShift').value;
    if(!localOpen(date,shift))throw Error('อยู่ภายนอกเวลาเวร ไม่สามารถสร้าง Checklist ย้อนหลังได้');
    const {error:err}=await db().from('equipment_checks').insert({workstation:ws,shift_date:date,shift});
    if(err&&!String(err.code).includes('23505'))throw err;
    await loadChecklist();notify('เปิด Checklist แล้ว สามารถกรอกและบันทึกผลได้');
  }
  function readRow(row,snap){
    let answer={};
    if(snap.input_type==='stock'){
      for(const part of ['opening','received','closing'])answer[part]=row.querySelector(`[data-eq-part="${part}"]`)?.value??'';
    }else answer.value=row.querySelector('[data-eq-part="value"]')?.value??'';
    const fields={};row.querySelectorAll('[data-eq-extra]').forEach(el=>{fields[el.dataset.eqExtra]=el.value});if(Object.keys(fields).length)answer.fields=fields;
    return {answer,remark:row.querySelector('.eq-note')?.value.trim()||''};
  }
  function isComplete(snap,ans,remark){
    const t=snap.input_type,v=String(ans?.value??'').trim();
    if(t==='stock'){
      const op=ans?.opening,cl=ans?.closing,rec=ans?.received??0;
      if(op===''||cl===''||op==null||cl==null||Number(op)<0||Number(cl)<0||Number(rec)<0||!Number.isFinite(Number(op))||!Number.isFinite(Number(cl))||Number(cl)>Number(op)+Number(rec))return false;
    }else if(t==='status'){if(!five.includes(v)||(v!==five[0]&&!remark?.trim()))return false;}
    else if(t==='binary'){if(!(snap.options||[]).includes(v)||(v==='ไม่พอใช้'&&!remark?.trim()))return false;}
    else if(t==='number'){if(v===''||!Number.isFinite(Number(v))||Number(v)<0)return false;}
    else if(!v)return false;
    return (snap.extra_fields||[]).every(f=>!f.required||String(ans?.fields?.[f.key]??'').trim());
  }
  function hasInput(answer){if(!answer)return false;if(typeof answer.value==='string')return answer.value!=='';return answer.opening!==''||answer.closing!=='';}
  async function saveChecklist(submit){
    if(!selectedCheck)throw Error('โปรดเริ่ม Checklist ก่อน');
    if(!localOpen(selectedCheck.shift_date,selectedCheck.shift))throw Error('หมดเวลาเวรแล้ว ไม่สามารถบันทึกย้อนหลัง');
    const changes=[];let complete=0;
    for(const e of selectedEntries){
      const row=$e('eqCheckBody').querySelector(`[data-eq-row="${e.id}"]`);if(!row)continue;
      const v=readRow(row,e.item_snapshot);if(isComplete(e.item_snapshot,v.answer,v.remark))complete++;
      if(JSON.stringify(v.answer)!==JSON.stringify(e.answer||{})||v.remark!==(e.remark||'')){
        if(!hasInput(v.answer)&&!v.remark&&(JSON.stringify(e.answer||{})==='{}'))continue;
        changes.push({entry_id:e.id,...v});
      }
    }
    if(submit&&complete!==selectedEntries.length){throw Error(`กรอกข้อมูลยังไม่ครบ (${complete}/${selectedEntries.length}) กรุณาตรวจสอบรายการและหมายเหตุปัญหา`);}
    if(changes.length){const {error:err}=await db().rpc('ems_equipment_save_entries',{p_check_id:selectedCheck.id,p_entries:changes});if(err)throw err;}
    const remark=$e('eqOverallRemark').value.trim();
    if(submit||remark!==selectedCheck.overall_remark){
      const patch={overall_remark:remark};if(submit)patch.status='submitted';
      const {error:err}=await db().from('equipment_checks').update(patch).eq('id',selectedCheck.id);
      if(err)throw err;
    }
    notify(submit?'ยืนยันผล OK สำเร็จ พร้อมชื่อผู้ OK และเวลาจาก Server':'บันทึกข้อมูลแล้ว');
    await Promise.all([loadChecklist(),loadDashboard()]);
  }
  async function loadDashboard(){
    if(!authorized()||!stations.length)return;
    const date=$e('eqDashDate').value||bkkDate();
    if(date<addMonths(bkkDate(),-6)||date>addDays(bkkDate(),1)){throw Error('เลือกวันที่ได้ย้อนหลังไม่เกิน 6 เดือน');}
    const {data:checks,error:err}=await db().from('equipment_checks').select('*').eq('shift_date',date);
    if(err)throw err;
    const idList=(checks||[]).map(c=>c.id);let entries=[];
    for(let i=0;i<idList.length;i+=25){
      const ids=idList.slice(i,i+25);
      entries.push(...await getRows('equipment_entries',(a,b)=>db().from('equipment_entries').select('*').in('check_id',ids).order('id').range(a,b)));
    }
    currentDashboard={date,checks:checks||[],entries};renderDashboard();
  }
  function renderDashboard(){
    if(!currentDashboard)return;
    const {date,checks,entries}=currentDashboard;
    const bySlot=new Map(checks.map(c=>[`${c.workstation}|${c.shift}`,c]));
    const byCheck=new Map();for(const e of entries){if(!byCheck.has(e.check_id))byCheck.set(e.check_id,[]);byCheck.get(e.check_id).push(e)}
    const stats={night:{all:0,done:0},morning:{all:0,done:0},evening:{all:0,done:0}};
    for(const station of stations.filter(s=>s.active))for(const shift of station.shifts){stats[shift].all++;if(bySlot.get(`${station.code}|${shift}`)?.status==='submitted')stats[shift].done++}
    const all=Object.values(stats).reduce((s,v)=>s+v.all,0),done=Object.values(stats).reduce((s,v)=>s+v.done,0);
    $e('eqDashSummary').innerHTML=`<div class="eq-stats">${[{key:'all',title:'OK ครบประจำวัน',done,all},...['night','morning','evening'].map(s=>({key:s,title:'เวร'+labels[s],...stats[s]}))].map(s=>`<div class="card eq-stat"><small>${escapeHTML(s.title)}</small><strong>${pct(s.done,s.all)}</strong><span>${s.done}/${s.all} จุด-เวร</span></div>`).join('')}</div>`;
    const sections=[];
    for(const station of stations.filter(s=>s.active)){
      const maps={};const rowMap=new Map();
      for(const i of currentItems(station.code))rowMap.set(i.id,{key:i.id,snap:itemSnap(i),values:{}});
      for(const shift of station.shifts){
        const c=bySlot.get(`${station.code}|${shift}`);if(!c)continue;
        maps[shift]=c;
        for(const e of (byCheck.get(c.id)||[])){
          let row=rowMap.get(e.item_id);
          if(!row){row={key:e.item_id,snap:e.item_snapshot,values:{}};rowMap.set(e.item_id,row)}
          row.values[shift]=e;
          // Always display the historical name/quantity from the recorded snapshot when present.
          if(!row.snapshotSaved){row.snap=e.item_snapshot;row.snapshotSaved=true;}
        }
      }
      const rows=[...rowMap.values()].sort((a,b)=>(a.snap.sort_order||0)-(b.snap.sort_order||0));
      const markup=rows.map(r=>`<tr><td class="eq-item-name">${escapeHTML(r.snap.name)}${r.snap.required_qty!=null?`<small>ต้องมี ${escapeHTML(r.snap.required_qty)} ${escapeHTML(r.snap.unit||'')}</small>`:''}${r.snap.category?`<small>${escapeHTML(r.snap.bag_group||r.snap.category)}</small>`:''}</td>
        ${['night','morning','evening'].map(shift=>{
          if(!station.shifts.includes(shift))return '<td><span class="eq-chip eq-muted">N/A</span></td>';
          const e=r.values[shift];if(!e)return '<td><span class="eq-chip eq-pending">รอตรวจ</span></td>';
          return `<td>${renderAmount(e.item_snapshot,e.answer)}${e.remark?`<div class="eq-remark">หมายเหตุ: ${escapeHTML(e.remark)}</div>`:''}${hasInput(e.answer)||e.remark?`<small>${escapeHTML(timeThai(e.updated_at))}${e.updated_by_name?' · '+escapeHTML(e.updated_by_name):''}</small>`:''}</td>`;
        }).join('')}</tr>`).join('');
      const footer=`<tr class="eq-check-footer"><td>ผู้ OK / เวลา</td>${['night','morning','evening'].map(shift=>{
        if(!station.shifts.includes(shift))return '<td>N/A</td>';
        const c=maps[shift];
        if(!c)return '<td>ยังไม่มีผู้ยืนยันผล</td>';
        return `<td><b>${c.status==='submitted'?escapeHTML(c.submitted_by_name||c.checked_by_name):'ยังไม่มีผู้ยืนยันผล (Draft)'}</b><small>${c.submitted_at?escapeHTML(timeThai(c.submitted_at)):'—'}<br>แก้ไขล่าสุด: ${escapeHTML(c.updated_by_name||c.checked_by_name)} ${escapeHTML(timeThai(c.updated_at))}</small>${c.overall_remark?`<div class="eq-remark">หมายเหตุเวร: ${escapeHTML(c.overall_remark)}</div>`:''}</td>`;
      }).join('')}</tr>`;
      sections.push(`<section class="card eq-station-section"><div class="top"><h3>${escapeHTML(station.display_name)}</h3><span class="eq-chip eq-neutral">${rows.length} รายการ</span></div><div class="tablewrap eq-table-wrap"><table class="eq-matrix"><thead><tr><th>รายการอุปกรณ์</th><th>ดึก (23:45–08:00)</th><th>เช้า (07:45–16:00)</th><th>บ่าย (15:45–00:00)</th></tr></thead><tbody>${markup||'<tr><td colspan="4">ไม่มีรายการ</td></tr>'}${footer}</tbody></table></div></section>`);
    }
    $e('eqDashboardBody').innerHTML=sections.join('');
    $e('eqDashTitle').textContent=`ผล OK อุปกรณ์รายวัน • ${readableDate(date)}`;
  }
  function csv(rows,name){const q=v=>'"'+String(v??'').replaceAll('"','""')+'"';const blob=new Blob(['\ufeff'+rows.map(r=>r.map(q).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'});
    const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000);
  }
  function exportDashboard(){if(!currentDashboard)return;
    const {date,checks,entries}=currentDashboard, byId=new Map(checks.map(c=>[c.id,c]));
    const rows=[['วันที่','จุด','เวร','รายการ','จำนวนต้องมี','ประเภทข้อมูล','ค่าที่บันทึก','หมายเหตุ','ผู้ OK','เวลายืนยัน','แก้ไขล่าสุด','ผู้แก้ไข']];
    for(const e of entries){const c=byId.get(e.check_id);if(!c)continue;rows.push([date,stations.find(s=>s.code===c.workstation)?.display_name,c.shift,e.item_snapshot.name,e.item_snapshot.required_qty,e.item_snapshot.input_type,JSON.stringify(e.answer||{}),e.remark,c.submitted_by_name||'ยังไม่มีผู้ยืนยัน',timeThai(c.submitted_at),timeThai(e.updated_at),e.updated_by_name]);}
    csv(rows,`EMS-Equipment-${date}.csv`);
  }
  function printEquipment(mode){
    if(!authorized())return;
    let contents='';
    if(mode==='check'){
      const check=selectedCheck,title=`${$e('eqCheckStation').selectedOptions[0]?.text||''} / เวร${labels[$e('eqCheckShift').value]} / ${readableDate($e('eqCheckDate').value)}`;
      contents=`<h2>Daily Equipment OK — ${escapeHTML(title)}</h2><p>ผู้ OK: ${escapeHTML(check?.submitted_by_name||'ยังไม่มีผู้ยืนยันผล')} · ${escapeHTML(timeThai(check?.submitted_at))}</p><table><thead><tr><th>รายการ</th><th>จำนวนต้องมี</th><th>ผลตรวจ/จำนวน</th><th>หมายเหตุ</th><th>แก้ไขล่าสุด</th></tr></thead><tbody>${selectedEntries.map(e=>`<tr><td>${escapeHTML(e.item_snapshot.name)}</td><td>${escapeHTML(e.item_snapshot.required_qty??'—')}</td><td>${renderAmount(e.item_snapshot,e.answer)}</td><td>${escapeHTML(e.remark)}</td><td>${escapeHTML(timeThai(e.updated_at))}</td></tr>`).join('')}</tbody></table>`;
    }else{
      contents=`<h2>Equipment Dashboard — ${escapeHTML(readableDate(currentDashboard?.date))}</h2>${$e('eqDashSummary').innerHTML}${$e('eqDashboardBody').innerHTML}`;
    }
    $e('eqPrintLayout').innerHTML=`<header class="eq-print-header"><h1>EMS Suandok Competency & Operations Hub</h1><p>รายงานข้อมูลอุปกรณ์ • พิมพ์เมื่อ ${escapeHTML(timeThai(new Date().toISOString()))}</p></header>${contents}`;
    document.body.dataset.print='equipment';setTimeout(()=>window.print(),80);
  }
  function adminFields(){
    const types=[['status','Dropdown สถานะ'],['date','วันที่'],['text','ข้อความ'],['number','ตัวเลข'],['binary','ตัวเลือกกำหนดเอง'],['stock','สต็อกต้น/ปลายเวร']];
    $e('eqAdminType').innerHTML=types.map(x=>`<option value="${x[0]}">${x[1]}</option>`).join('');
  }
  function resetAdmin(){editingItemId=null;$e('eqAdminForm').reset();$e('eqAdminHeading').textContent='เพิ่มรายการอุปกรณ์';$e('eqAdminActive').checked=true;$e('eqAdminRequired').value='';$e('eqAdminExtra').value='[]';}
  function fillAdmin(i){editingItemId=i.id;$e('eqAdminHeading').textContent='แก้ไขรายการอุปกรณ์';$e('eqAdminStation').value=i.workstation;$e('eqAdminName').value=i.name;$e('eqAdminCategory').value=i.category;$e('eqAdminGroup').value=i.bag_group;$e('eqAdminRequired').value=i.required_qty??'';$e('eqAdminUnit').value=i.unit;$e('eqAdminType').value=i.input_type;$e('eqAdminChoices').value=(i.options||[]).join(', ');$e('eqAdminExtra').value=JSON.stringify(i.extra_fields||[],null,2);$e('eqAdminGuidance').value=i.guidance||'';$e('eqAdminOrder').value=i.sort_order;$e('eqAdminActive').checked=i.active;$e('eqAdminPlaceholder').checked=i.is_placeholder;tab('equipmentAdmin');$e('eqAdminForm').scrollIntoView({behavior:'smooth'});}
  function renderAdmin(){
    if(!admin())return;
    const ws=$e('eqAdminFilter')?.value||'all';
    const match=items.filter(i=>ws==='all'||i.workstation===ws);
    $e('eqAdminFilter').innerHTML='<option value="all">ทุกตำแหน่ง</option>'+stations.map(s=>`<option value="${s.code}" ${ws===s.code?'selected':''}>${escapeHTML(s.display_name)}</option>`).join('');
    $e('eqAdminList').innerHTML=`<div class="tablewrap"><table><thead><tr><th>ตำแหน่ง</th><th>รายการ / หมวด</th><th>จำนวน</th><th>ช่องกรอก</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>${match.map(i=>`<tr><td>${escapeHTML(stations.find(s=>s.code===i.workstation)?.display_name||i.workstation)}</td><td>${escapeHTML(i.name)}<small>${escapeHTML(i.category||'')} ${escapeHTML(i.bag_group||'')}</small></td><td>${i.required_qty??'—'} ${escapeHTML(i.unit||'')}</td><td>${escapeHTML(i.input_type)}</td><td>${i.active?'ใช้งาน':'ปิดใช้งาน'}</td><td><button type="button" class="btn small" data-eq-edit="${i.id}">แก้ไข</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  async function submitAdmin(e){e.preventDefault();if(!admin())throw Error('เฉพาะ Admin');
    let extras;try{extras=JSON.parse($e('eqAdminExtra').value||'[]');if(!Array.isArray(extras))throw Error('ต้องเป็น array');}catch(_){throw Error('Extra Fields ต้องเป็น JSON array ที่ถูกต้อง')}
    const payload={workstation:$e('eqAdminStation').value,name:$e('eqAdminName').value.trim(),category:$e('eqAdminCategory').value.trim()||'ทั่วไป',bag_group:$e('eqAdminGroup').value.trim(),required_qty:$e('eqAdminRequired').value===''?null:Number($e('eqAdminRequired').value),unit:$e('eqAdminUnit').value.trim(),input_type:$e('eqAdminType').value,options:$e('eqAdminChoices').value.split(',').map(x=>x.trim()).filter(Boolean),extra_fields:extras,guidance:$e('eqAdminGuidance').value.trim(),sort_order:Number($e('eqAdminOrder').value||0),active:$e('eqAdminActive').checked,is_placeholder:$e('eqAdminPlaceholder').checked};
    if(!payload.name)throw Error('กรอกชื่อรายการ');if(payload.input_type==='binary'&&!payload.options.length)throw Error('กรอกตัวเลือกสำหรับ Dropdown เช่น พอใช้,ไม่พอใช้');
    const result=editingItemId?await db().from('equipment_items').update(payload).eq('id',editingItemId):await db().from('equipment_items').insert(payload);
    if(result.error)throw result.error;notify(editingItemId?'แก้ไขรายการแล้ว':'เพิ่มรายการแล้ว');resetAdmin();await reloadTemplates();await loadDashboard();
  }
  function installHandlers(){if(initDone)return;initDone=true;
    adminFields();$e('eqCheckStation').addEventListener('change',()=>{updateAllowedShifts();loadChecklist().catch(error)});
    for(const id of ['eqCheckDate','eqCheckShift'])$e(id).addEventListener('change',()=>loadChecklist().catch(error));
    $e('eqDashDate').addEventListener('change',()=>loadDashboard().catch(error));
    $e('eqDashToday').addEventListener('click',()=>{$e('eqDashDate').value=bkkDate();loadDashboard().catch(error)});
    for(const [id,dir] of [['eqDashPrev',-1],['eqDashNext',1]])$e(id).addEventListener('click',()=>{
      const next=addDays($e('eqDashDate').value,dir);if(next<addMonths(bkkDate(),-6)||next>addDays(bkkDate(),1))return notify('เลือกย้อนหลังได้ไม่เกิน 6 เดือน',true);
      $e('eqDashDate').value=next;loadDashboard().catch(error);
    });
    $e('eqDashRefresh').addEventListener('click',()=>loadDashboard().catch(error));
    $e('eqDashPrint').addEventListener('click',()=>printEquipment('dashboard'));
    $e('eqDashExport').addEventListener('click',exportDashboard);
    $e('eqAdminForm').addEventListener('submit',e=>submitAdmin(e).catch(error));
    $e('eqAdminReset').addEventListener('click',resetAdmin);
    $e('eqAdminFilter').addEventListener('change',renderAdmin);
    $e('eqAdminList').addEventListener('click',e=>{const b=e.target.closest('[data-eq-edit]');if(b){const i=items.find(x=>x.id===b.dataset.eqEdit);if(i)fillAdmin(i)}});
    window.addEventListener('afterprint',()=>{if(document.body.dataset.print==='equipment'){delete document.body.dataset.print;$e('eqPrintLayout').innerHTML='';}});
  }
  window.EMS_EQUIPMENT={onLogin,onLogout,onTab,installHandlers};
  document.addEventListener('DOMContentLoaded',installHandlers);
})();
