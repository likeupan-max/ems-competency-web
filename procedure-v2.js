/* EMS SUANDOK Procedure Logbook V2
   Configurable per-position qualifications. Staff Certificate records are self-entered.
   The SQL activation migration enforces eligibility on NEW logs and Admin-only settings.
   This client never stores Supabase service_role or bypasses RLS. */
'use strict';
window.EMS_PROC_V2 = (() => {
  const POSITIONS = ['RN','PN','Physician','Paramedic','Driver'];
  let sb=null, mine=null, profiles=[], courses=[], certificates=[], qualifications=[], roleRules=[], requirements=[], ready=false;
  const escapeHTML = val => String(val ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize = val => String(val ?? '').trim().toLocaleLowerCase();
  const bangkokToday = () => {
    const values=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const isAdmin = () => mine?.access_role === 'admin' && mine?.approval_status === 'approved';
  const findCourse = c => courses.find(x=>x.id===c.course_id)?.name || c.custom_course;

  async function fetchRecords(table){
    const out=[];
    for(let i=0;i<60;i++){
      const {data,error}=await sb.from(table).select('*').order('created_at',{ascending:false}).range(i*500,(i+1)*500-1);
      if(error)throw error;
      out.push(...(data||[]));
      if(!data||data.length<500)return out;
    }
    throw new Error('Procedure V2 มีข้อมูลจำนวนมากเกินช่วงโหลด');
  }
  async function onLogin(db,user,profile,allProfiles,allCourses,allCertificates){
    sb=db; mine=profile; profiles=allProfiles; courses=allCourses; certificates=allCertificates;
    ready=false;
    try{
      [qualifications,roleRules,requirements]=await Promise.all([
        fetchRecords('ems_proc_v2_qualifications'),
        fetchRecords('ems_proc_v2_role_rules'),
        fetchRecords('ems_proc_v2_rule_requirements')
      ]);
      ready=true;
      showLoadError('');
    }catch(error){
      console.error('[Procedure V2]',error);
      qualifications=[]; roleRules=[]; requirements=[];
      showLoadError('โหลดกติกา Procedure V2 ไม่สำเร็จ: ไม่เปิดให้บันทึกหัตถการใหม่เพื่อป้องกันการบันทึกผิดเงื่อนไข กรุณาตรวจ SQL และกด Refresh');
    }
  }
  function onLogout(){sb=null;mine=null;profiles=[];courses=[];certificates=[];qualifications=[];roleRules=[];requirements=[];ready=false;}
  function showLoadError(message){
    for(const id of ['pv2LoadStatus','pv2AdminStatus']){
      const el=document.getElementById(id);if(!el)continue;
      el.textContent=message;el.hidden=!message;
    }
  }
  function hasCertificate(personId,q){
    if(!q?.active)return false;
    const date=bangkokToday();
    return certificates.some(c=>{
      if(c.person_id!==personId || c.deleted_at || !c.trained_on || c.trained_on>date)return false;
      if(!c.no_expiration && (!c.expires_on || c.expires_on<date))return false;
      return (q.certificate_course_id && c.course_id===q.certificate_course_id)
        || normalize(findCourse(c))===normalize(q.name);
    });
  }
  function ruleFor(procedureId,position){
    return roleRules.find(r=>r.procedure_id===procedureId && r.position===position && r.active);
  }
  function allows(procedure,person){
    if(!ready || !procedure?.active || person?.access_role!=='staff' || person?.approval_status!=='approved')return false;
    const rule=ruleFor(procedure.id,person.position);
    if(!rule)return false;
    if(rule.requirement_mode==='none')return true;
    const required=requirements.filter(r=>r.procedure_id===procedure.id && r.position===person.position)
      .map(r=>qualifications.find(q=>q.id===r.qualification_id));
    if(!required.length || required.some(q=>!q))return false;
    return rule.requirement_mode==='any'
      ?required.some(q=>hasCertificate(person.id,q))
      :required.every(q=>hasCertificate(person.id,q));
  }
  function roleSummary(procedure){
    const list=roleRules.filter(r=>r.procedure_id===procedure.id && r.active);
    return list.map(r=>{
      const names=requirements.filter(x=>x.procedure_id===procedure.id && x.position===r.position)
        .map(x=>qualifications.find(q=>q.id===x.qualification_id)?.name||'ไม่พบคุณสมบัติ');
      const mode=r.requirement_mode==='any'?'อย่างใดอย่างหนึ่ง':r.requirement_mode==='all'?'ครบทุกข้อ':'ไม่กำหนดเพิ่มเติม';
      return `${r.position}: ${names.length?names.join(' / ')+` (${mode})`:mode}`;
    }).join(' · ') || 'ยังไม่ได้กำหนดตำแหน่ง';
  }
  function editorHTML(key,rules=[]){
    const activeQuals=qualifications.filter(q=>q.active).sort((a,b)=>a.name.localeCompare(b.name,'th'));
    return `<div class="pv2-editor" data-pv2-editor="${escapeHTML(key)}">
      ${POSITIONS.map(position=>{
        const existing=rules.find(r=>r.position===position && r.active);
        const chosen=existing?.requirement_mode||'none';
        const ids=new Set(requirements.filter(x=>x.procedure_id===key && x.position===position).map(x=>x.qualification_id));
        return `<div class="pv2-role-row" data-pv2-row="${escapeHTML(position)}">
          <label class="pv2-role-checkbox"><input type="checkbox" data-pv2-role="${escapeHTML(position)}" ${existing?'checked':''}> <strong>${escapeHTML(position)}</strong></label>
          <div class="pv2-role-config" ${existing?'':'hidden'}>
            <select class="mini-select" data-pv2-mode aria-label="เงื่อนไขคุณสมบัติ ${escapeHTML(position)}">
              <option value="none" ${chosen==='none'?'selected':''}>ไม่กำหนด Certification เพิ่มเติม</option>
              <option value="any" ${chosen==='any'?'selected':''}>มีอย่างใดอย่างหนึ่ง</option>
              <option value="all" ${chosen==='all'?'selected':''}>ต้องมีครบทุกใบ</option>
            </select>
            <div class="pv2-requirements" ${chosen==='none'?'hidden':''}>
              ${activeQuals.length?activeQuals.map(q=>`<label class="pv2-qual-check"><input type="checkbox" data-pv2-req="${escapeHTML(q.id)}" ${ids.has(q.id)?'checked':''}> ${escapeHTML(q.name)}</label>`).join(''):'<span class="muted">เพิ่มชื่อ Certification ด้านล่างก่อน แล้วกลับมาเลือก</span>'}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }
  function renderProcedureCard(p){
    const rules=roleRules.filter(r=>r.procedure_id===p.id && r.active);
    return `<div class="section pv2-procedure-card" data-pv2-card="${escapeHTML(p.id)}">
      <div class="row between"><strong>${escapeHTML(p.name)}</strong>${p.active?'':'<span class="pill neutral">ปิดใช้งาน</span>'}</div>
      <div class="pv2-proc-basic">
        <label class="field">ชื่อหัตถการ<input class="mini-input" data-proc-name="${escapeHTML(p.id)}" maxlength="120" value="${escapeHTML(p.name)}"></label>
        <label class="field">รอบทบทวน (วัน)<input class="mini-input" type="number" min="1" max="3650" value="${p.interval_days}" data-interval="${escapeHTML(p.id)}"></label>
        <label class="pv2-check-sim"><input type="checkbox" data-sim="${escapeHTML(p.id)}" ${p.count_simulation?'checked':''}> นับ Simulation ที่สำเร็จ</label>
      </div>
      <details class="pv2-details"><summary>กำหนดตำแหน่งและ Certification <small>(${rules.length} ตำแหน่ง)</small></summary>
        ${editorHTML(p.id,rules)}
      </details>
      <div class="pv2-actions row no-print">
        <button type="button" class="btn small primary" data-save-procedure="${escapeHTML(p.id)}">บันทึกการตั้งค่า</button>
        <button type="button" class="btn small" data-toggle-procedure="${escapeHTML(p.id)}">${p.active?'ปิดใช้งาน':'เปิดใช้งาน'}</button>
      </div>
      <p class="muted pv2-rule-summary">${escapeHTML(roleSummary(p))}</p>
    </div>`;
  }
  function renderAdmin(){
    if(!isAdmin())return;
    const qlist=document.getElementById('pv2QualificationList');
    if(qlist){
      qlist.innerHTML=qualifications.slice().sort((a,b)=>a.name.localeCompare(b.name,'th')).map(q=>`
        <div class="pv2-qualification-item" data-pv2-q="${escapeHTML(q.id)}">
          <input class="mini-input" data-pv2-qname value="${escapeHTML(q.name)}" maxlength="120" aria-label="ชื่อ Certification">
          <button class="btn small" type="button" data-pv2-qsave="${escapeHTML(q.id)}">แก้ชื่อ</button>
          <button class="btn small ${q.active?'danger':''}" type="button" data-pv2-qtoggle="${escapeHTML(q.id)}">${q.active?'ปิดใช้งาน':'เปิดใช้งาน'}</button>
          ${q.active?'':'<span class="pill neutral">ปิดใช้งาน</span>'}
        </div>`).join('') || '<p class="muted">ยังไม่มี Certification สำหรับเงื่อนไขหัตถการ</p>';
    }
    const create=document.getElementById('newProcedureV2Rules');
    if(create){
      create.innerHTML=editorHTML('new', [{position:'RN',requirement_mode:'none',active:true}]);
      syncEditor(create);
    }
  }
  function syncEditor(root){
    for(const row of root.querySelectorAll('[data-pv2-row]')){
      const checked=row.querySelector('[data-pv2-role]').checked;
      row.querySelector('.pv2-role-config').hidden=!checked;
      const mode=row.querySelector('[data-pv2-mode]').value;
      row.querySelector('.pv2-requirements').hidden=!checked||mode==='none';
    }
  }
  function readRules(root){
    if(!ready)throw new Error('Procedure V2 ยังไม่พร้อม กรุณารีเฟรชหน้าเว็บไซต์');
    if(!root)throw new Error('ไม่พบฟอร์มกำหนดตำแหน่ง');
    const selected=[];
    for(const row of root.querySelectorAll('[data-pv2-row]')){
      const checkbox=row.querySelector('[data-pv2-role]');
      if(!checkbox.checked)continue;
      const mode=row.querySelector('[data-pv2-mode]').value;
      const reqs=mode==='none'?[]:[...row.querySelectorAll('[data-pv2-req]:checked')].map(x=>x.dataset.pv2Req);
      if(mode!=='none'&&!reqs.length)throw new Error(`${checkbox.dataset.pv2Role}: โปรดเลือก Certification อย่างน้อย 1 รายการ`);
      selected.push({position:checkbox.dataset.pv2Role,mode,requirements:reqs});
    }
    if(!selected.length)throw new Error('กรุณาเลือกตำแหน่งอย่างน้อย 1 ตำแหน่ง');
    return selected;
  }
  async function saveProcedure(id,options){
    if(!isAdmin()||!ready)throw new Error('เฉพาะ Admin ที่ระบบพร้อมใช้งานเท่านั้น');
    const root=id?document.querySelector(`[data-pv2-card="${id}"]`):document.getElementById('addProcedureForm');
    if(!root)throw new Error('ไม่พบฟอร์มหัตถการ');
    const name=id?root.querySelector('[data-proc-name]').value.trim():document.getElementById('newProcedureName').value.trim();
    const days=Number(id?root.querySelector('[data-interval]').value:document.getElementById('newProcedureInterval').value);
    const sim=!!(id?root.querySelector('[data-sim]').checked:document.getElementById('newProcedureSimulation').checked);
    const rules=readRules(root.querySelector('[data-pv2-editor]'));
    const {data,error}=await sb.rpc('ems_proc_v2_save_procedure',{
      p_procedure_id:id||null,p_name:name,p_interval_days:days,p_count_simulation:sim,
      p_active:options?.active??true,p_rules:rules
    });
    if(error)throw error;
    return data;
  }
  async function addQualification(name){
    if(!isAdmin())throw Error('เฉพาะ Admin เท่านั้น');
    const trimmed=name.trim();
    if(trimmed.length<2||trimmed.length>120)throw Error('ชื่อ Certification ต้องมี 2–120 ตัวอักษร');
    const match=courses.find(c=>normalize(c.name)===normalize(trimmed));
    const {error}=await sb.from('ems_proc_v2_qualifications').insert({name:trimmed,certificate_course_id:match?.id||null});
    if(error)throw error;
  }
  async function saveQualification(id,newName){
    if(!isAdmin())throw Error('เฉพาะ Admin เท่านั้น');
    const trimmed=newName.trim();
    if(trimmed.length<2||trimmed.length>120)throw Error('ชื่อ Certification ต้องมี 2–120 ตัวอักษร');
    const match=courses.find(c=>normalize(c.name)===normalize(trimmed));
    const {error}=await sb.from('ems_proc_v2_qualifications').update({name:trimmed,certificate_course_id:match?.id||null,updated_at:new Date().toISOString()}).eq('id',id);
    if(error)throw error;
  }
  async function toggleQualification(id){
    if(!isAdmin())throw Error('เฉพาะ Admin เท่านั้น');
    const q=qualifications.find(x=>x.id===id);if(!q)return;
    if(q.active && !confirm(`ปิดใช้งาน ${q.name} ใช่หรือไม่? หัตถการที่กำหนดคุณสมบัตินี้อาจไม่เข้าเกณฑ์ จนกว่าจะเปิดใช้งานอีกครั้ง`))return;
    const {error}=await sb.from('ems_proc_v2_qualifications').update({active:!q.active,updated_at:new Date().toISOString()}).eq('id',q.id);
    if(error)throw error;
  }
  function eligibilityHint(person,procs){
    const element=document.getElementById('pv2EligibilityHint');if(!element)return;
    if(!ready){element.textContent='ไม่สามารถโหลดเงื่อนไขหัตถการได้ กรุณา Refresh หรือติดต่อ Admin';return;}
    const relevant=procs.filter(p=>p.active&&!!ruleFor(p.id,person?.position));
    const eligible=relevant.filter(p=>allows(p,person));
    element.textContent=`หัตถการที่เข้าเงื่อนไข ${eligible.length} / ${relevant.length} รายการสำหรับ ${person?.position||'ตำแหน่งของคุณ'} · ตรวจจากข้อมูล Certificate ที่บันทึกและยังไม่หมดอายุ`;
  }
  function wireUI(){
    const add=document.getElementById('pv2AddQualificationForm');
    if(add)add.addEventListener('submit',async e=>{
      e.preventDefault();const button=e.submitter; if(button)button.disabled=true;
      try{
        await addQualification(document.getElementById('pv2NewQualification').value);
        document.getElementById('pv2NewQualification').value='';
        toast('เพิ่ม Certification แล้ว');
        await load();
      }catch(err){reportError(err);}finally{if(button)button.disabled=false;}
    });
    const list=document.getElementById('pv2QualificationList');
    if(list)list.addEventListener('click',async e=>{
      const save=e.target.closest('[data-pv2-qsave]');const toggle=e.target.closest('[data-pv2-qtoggle]');
      if(!save&&!toggle)return;
      const id=save?.dataset.pv2Qsave||toggle?.dataset.pv2Qtoggle;
      const button=save||toggle;button.disabled=true;
      try{
        if(save)await saveQualification(id,save.closest('[data-pv2-q]').querySelector('[data-pv2-qname]').value);
        else await toggleQualification(id);
        await load();
      }catch(err){reportError(err);}finally{button.disabled=false;}
    });
    const settings=document.getElementById('settings');
    if(settings)settings.addEventListener('change',e=>{
      if(e.target.matches('[data-pv2-role],[data-pv2-mode]')){
        const root=e.target.closest('[data-pv2-editor]');if(root)syncEditor(root);
      }
    });
  }
  document.addEventListener('DOMContentLoaded',wireUI);
  return {onLogin,onLogout,allows,renderProcedureCard,renderAdmin,saveProcedure,eligibilityHint,ready:()=>ready};
})();
