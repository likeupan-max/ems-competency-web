/* EMS Suandok Daily Operations Dashboard v2.1 — role-filtered staff directory + printable report
   Add-on to the existing classic-script app.js. Requires Supabase SQL migration.
   Does NOT contain service keys, patient data, or modifications to other modules. */
(function () {
  'use strict';

  const state = {
    sb: null, user: null, profile: null, admin: false,
    roles: [], types: [], roster: [], contacts: [], editors: [], directory: [],
    selectedDate: '', selectedShift: 'morning', loadedDate: '', loadedShift: '',
    rosterEditId: null, contactEditId: null, directoryEditId: null, ready: false, requestId: 0
  };
  const $o = (id) => document.getElementById(id);
  const html = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const shiftText = {night: 'เวรดึก', morning: 'เวรเช้า', evening: 'เวรบ่าย'};
  const showError = (e) => {
    console.error('[EMS Operations]', e);
    if (typeof reportError === 'function') reportError(e);
    else alert(e?.message || 'เกิดข้อผิดพลาด');
  };
  const notify = (text, error = false) => {
    if (typeof toast === 'function') toast(text, error);
    else if (error) alert(text);
  };
  const fmt = (iso) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('th-TH',
    {day:'numeric',month:'long',year:'numeric'}) : '—';
  const cleanPhone = (str) => String(str || '').replace(/[^0-9+]/g, '');
  const canEditContacts = () => state.admin || state.editors.some(x => x.user_id === state.user?.id);
  const myName = () => [state.profile?.first_name, state.profile?.last_name].filter(Boolean).join(' ').trim();
  const dateTimeText = x => x ? new Date(x).toLocaleString('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'short',timeStyle:'short'}) : '';
  const isValidDate = x => /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(new Date(x+'T12:00:00').getTime());

  function bangkokSelection() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hourCycle:'h23'
    }).formatToParts(new Date()).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
    let date = `${parts.year}-${parts.month}-${parts.day}`;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    let shift = 'morning';
    if (minutes < 8 * 60) shift = 'night';
    else if (minutes < 15 * 60 + 45) shift = 'morning';
    else if (minutes < 23 * 60 + 45) shift = 'evening';
    else {
      shift = 'night';
      const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate()+1);
      date = [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    }
    return {date, shift};
  }

  function mount() {
    if ($o('operations')) return;
    const nav = $o('mainNav'), app = $o('appPanel'), dashboard = $o('dashboard');
    if (!nav || !app || !dashboard) throw Error('ไม่พบส่วน Dashboard ของระบบเดิม');
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.tab = 'operations';
    button.textContent = '☷ EMS Roster & Fast Track';
    button.addEventListener('click', () => tab('operations'));
    const first = nav.querySelector('[data-tab="dashboard"]');
    if (first) first.insertAdjacentElement('afterend', button); else nav.append(button);

    const preview = document.createElement('div');
    preview.className = 'card section no-print ops-dashboard-preview';
    preview.id = 'opsDashboardPreview';
    preview.innerHTML = `<div class="top"><div><h3>EMS Daily Operations</h3>
       <p class="muted">EMS Daily Roster และ Fast Track Contacts · สมาชิกทุกวิชาชีพดูได้</p></div>
       <button type="button" class="btn primary" id="opsOpenFull">ดูรายชื่อทั้งหมด</button></div>
       <div id="opsPreviewBody" class="ops-preview-body"><p class="muted">กำลังโหลด...</p></div>`;
    const stats = dashboard.querySelector('.stats');
    if (stats) stats.insertAdjacentElement('afterend', preview); else dashboard.prepend(preview);
    $o('opsOpenFull').addEventListener('click', () => tab('operations'));

    const panel = document.createElement('section');
    panel.className = 'tab'; panel.id = 'operations';
    panel.innerHTML = `<div class="top"><div><h2>EMS Daily Operations Dashboard</h2>
       <p class="muted">รายชื่อเวรและเบอร์แพทย์ Fast Track สำหรับผู้ใช้งานที่ผ่านการอนุมัติทุกตำแหน่ง</p></div>
       <div class="ops-header-actions"><button class="btn" type="button" id="opsPrint">🖨 พิมพ์ / PDF</button>
       <button class="btn" type="button" id="opsRefresh">↻ รีเฟรช</button></div></div>
       <div class="card section"><div class="row ops-filters">
         <label class="field">วันที่ปฏิบัติงาน<input type="date" id="opsDate"></label>
         <label class="field">เวร<select id="opsShift">
           <option value="night">เวรดึก</option><option value="morning">เวรเช้า</option>
           <option value="evening">เวรบ่าย</option></select></label>
         <button class="btn" type="button" id="opsToday">วันนี้ / เวรปัจจุบัน</button>
       </div><p class="muted">เวรดึกใช้วันที่สิ้นสุดเวร (23:45 วันก่อน–08:00) · ทุกเวลาตามประเทศไทย</p></div>
       <div class="two ops-columns section">
         <div class="card"><h3>👥 EMS Daily Roster</h3><div id="opsRosterList"></div></div>
         <div class="card"><h3>☎ Fast Track Contacts</h3><div id="opsContactsList"></div></div>
       </div>
       <div class="two ops-columns section">
         <div class="card ops-form-card"><h3 id="opsRosterFormTitle">ลงชื่อปฏิบัติงาน</h3>
           <form id="opsRosterForm" class="ops-form">
             <label class="field">1. ตำแหน่งหน้าที่<select id="opsRoleSelect" required></select></label>
             <label class="field">2. เลือกรายชื่อเจ้าหน้าที่<select id="opsStaffSelect" required></select></label>
             <div class="ops-actions ops-directory-buttons">
               <button class="btn small" type="button" id="opsUseMyName">ใช้ชื่อของฉัน</button>
               <button class="btn small" type="button" id="opsDirectoryAdd">+ เพิ่มชื่อ</button>
               <button class="btn small" type="button" id="opsDirectoryEdit">แก้ไขชื่อ</button>
               <button class="btn small danger" type="button" id="opsDirectoryDelete">ลบชื่อ</button>
             </div>
             <p class="muted" id="opsRoleHelp">เลือกรายชื่อในตำแหน่งนี้ หรือเลือกอื่น ๆ เพื่อกรอกชื่อเอง</p>
             <div id="opsDirectoryEditor" class="ops-directory-editor hidden">
               <h4 id="opsDirectoryFormTitle">เพิ่มชื่อใน Dropdown</h4>
               <div id="opsDirectoryForm" class="ops-form">
                 <label class="field">ชื่อ–นามสกุล<input id="opsDirectoryName" maxlength="150"></label>
                 <label class="field">เบอร์โทรในทะเบียน (ถ้ามี)<input id="opsDirectoryPhone" type="tel" maxlength="30"></label>
                 <div class="row"><button class="btn primary" type="button" id="opsDirectorySave">บันทึกชื่อ</button>
                   <button class="btn" type="button" id="opsDirectoryCancel">ยกเลิก</button></div>
               </div>
             </div>
             <label class="field">3. ชื่อผู้ปฏิบัติงาน<input id="opsStaffName" maxlength="150" required></label>
             <label class="field">4. เบอร์โทร (แก้ไขเฉพาะเวรนี้ได้)<input id="opsStaffPhone" type="tel" maxlength="30" autocomplete="tel"></label>
             <label class="field">หมายเหตุเวร (ไม่ใส่ข้อมูลผู้ป่วย)<input id="opsRosterNote" maxlength="250"></label>
             <div class="row"><button class="btn primary" type="submit" id="opsRosterSave">บันทึกเวร</button>
               <button class="btn hidden" id="opsRosterCancel" type="button">ยกเลิกแก้ไข</button></div>
           </form>
           <p class="muted">สมาชิกที่ได้รับอนุมัติทุกคนเพิ่ม แก้ไข และลบรายการเวร รวมถึงจัดการรายชื่อใน Dropdown ได้ · การลบชื่อจาก Dropdown ไม่ลบประวัติเวรเดิม</p>
         </div>
         <div class="card ops-form-card" id="opsContactEditorPanel">
           <h3 id="opsContactFormTitle">กรอกแพทย์เวร Fast Track</h3>
           <form id="opsContactForm" class="ops-form">
             <label class="field">ประเภท Fast Track<select id="opsTypeSelect" required></select></label>
             <label class="field">ชื่อแพทย์เวร<input id="opsDoctorName" maxlength="150" required></label>
             <label class="field">เบอร์โทรติดต่อ<input id="opsDoctorPhone" type="tel" maxlength="30" required></label>
             <label class="field">หมายเหตุ (ไม่ใส่ข้อมูลผู้ป่วย)<input id="opsContactNote" maxlength="250"></label>
             <div class="row"><button class="btn primary" type="submit" id="opsContactSave">บันทึกเบอร์ติดต่อ</button>
               <button class="btn hidden" id="opsContactCancel" type="button">ยกเลิกแก้ไข</button></div>
           </form><p class="muted">แก้ไขข้อมูลได้เฉพาะ Admin หรือเจ้าหน้าที่ที่ได้รับมอบหมาย</p>
         </div>
       </div>
       <details id="opsAdminPanel" class="card section" hidden><summary><strong>⚙ จัดการตำแหน่งและประเภท Fast Track (Admin)</strong></summary>
         <div class="two ops-columns section">
           <div><h3>จัดการตำแหน่ง Roster</h3><form id="opsAddRole" class="ops-form">
             <label class="field">ชื่อตำแหน่ง<input id="opsRoleName" maxlength="100" required></label>
             <button class="btn" type="submit">+ เพิ่มตำแหน่ง</button></form>
             <div id="opsRoleAdminList" class="section"></div></div>
           <div><h3>ประเภท Fast Track</h3><form id="opsAddType" class="ops-form">
             <label class="field">ชื่อ Fast Track<input id="opsTypeName" maxlength="100" required></label>
             <button class="btn" type="submit">+ เพิ่มประเภท</button></form>
             <div id="opsTypeAdminList" class="section"></div></div>
         </div><div class="section"><h3>มอบหมายผู้แก้ไข Fast Track</h3>
           <form id="opsAddEditor" class="row">
             <select class="ops-admin-select" id="opsEditorPerson" required></select>
             <button class="btn" type="submit">เพิ่มผู้ได้รับมอบหมาย</button></form>
           <div id="opsEditorList" class="section"></div></div>
       </details>`;
    app.append(panel);

    const style = document.createElement('style');
    style.textContent = `
      #operations > .top .ops-header-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}
      #operations > .top #opsPrint{background:rgba(255,255,255,.94);border:1px solid #b6e4ee;color:#12546b;border-radius:10px;min-height:42px;font-weight:700}
      #operations > .top #opsPrint:hover{background:#e8f7fa}
      @media(max-width:700px){#operations > .top .ops-header-actions{width:100%;justify-content:stretch}#operations > .top #opsPrint{flex:1 1 160px}}
      #operations .ops-filters{align-items:end;gap:14px}#operations .ops-filters .field{min-width:170px}
      #operations .ops-form{display:grid;gap:11px;margin-top:13px}
      #operations .ops-form-card{align-self:start}#operations .ops-admin-select{padding:10px;border:1px solid #c9d8e5;border-radius:9px;min-width:220px}
      #operations .ops-directory-buttons{gap:7px}
      #operations .ops-directory-editor{padding:12px;border:1px solid #c9d8e5;background:#f1f7fb;border-radius:11px}
      #operations .ops-directory-editor h4{margin:0;color:#23536e}
      #operations .ops-directory-editor .ops-form{margin-top:8px}
      .ops-group{padding:11px 0;border-top:1px solid #e4edf3}.ops-group:first-child{border-top:0}
      .ops-group h4{font-size:14px;margin:0 0 8px;color:#23536e}.ops-entry{padding:8px 10px;margin:6px 0;background:#f3f8fc;border-radius:9px}
      .ops-entry strong{display:block;margin-bottom:3px}.ops-entry small{display:block;color:#657f90;overflow-wrap:anywhere}
      .ops-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ops-actions .btn{font-size:12px;padding:6px 9px}
      .ops-blank{color:#8494a2;font-size:12px;padding:5px 0}.ops-check{display:flex;align-items:center;gap:8px;color:#45657b}
      .ops-admin-row{border-bottom:1px solid #e6edf4;padding:8px 0;display:flex;align-items:center;flex-wrap:wrap;gap:6px;justify-content:space-between}
      .ops-preview-body{display:grid;grid-template-columns:1fr 1fr;gap:15px}
      .ops-preview-body section{min-width:0}.ops-preview-body h4{margin:0 0 8px;color:#23536e}
      .ops-preview-body p{font-size:13px;margin:5px 0;overflow-wrap:anywhere}
      .ops-preview-body .ops-mini-people{border-top:1px solid #e6edf4;padding:6px 0;font-size:13px}
      @media(max-width:720px){.ops-preview-body{grid-template-columns:1fr}#operations .ops-filters .field{flex:1 1 130px}}
      @media print{#operations,#opsDashboardPreview{display:none!important}}
    `;
    document.head.append(style);
    const selection = bangkokSelection();
    state.selectedDate = selection.date; state.selectedShift = selection.shift;
    $o('opsDate').value = selection.date; $o('opsShift').value = selection.shift;
    $o('opsDate').addEventListener('change', filtersChanged);
    $o('opsShift').addEventListener('change', filtersChanged);
    $o('opsRefresh').addEventListener('click', refresh);
    $o('opsPrint').addEventListener('click', printDashboard);
    $o('opsToday').addEventListener('click', () => {
      const now=bangkokSelection(); state.selectedDate=now.date; state.selectedShift=now.shift;
      $o('opsDate').value=now.date; $o('opsShift').value=now.shift; refresh();
    });
    $o('opsRoleSelect').addEventListener('change', () => {updateRoleMode();closeDirectoryEditor();});
    $o('opsStaffSelect').addEventListener('change', applyStaffSelection);
    $o('opsUseMyName').addEventListener('click', () => { $o('opsStaffSelect').value = 'self'; applyStaffSelection(); });
    $o('opsDirectoryAdd').addEventListener('click', () => openDirectoryEditor('add'));
    $o('opsDirectoryEdit').addEventListener('click', () => openDirectoryEditor('edit'));
    $o('opsDirectoryDelete').addEventListener('click', deleteDirectoryEntry);
    $o('opsDirectoryCancel').addEventListener('click', closeDirectoryEditor);
    $o('opsDirectorySave').addEventListener('click', submitDirectory);
    $o('opsRosterForm').addEventListener('submit', submitRoster);
    $o('opsRosterCancel').addEventListener('click', resetRosterForm);
    $o('opsContactForm').addEventListener('submit', submitContact);
    $o('opsContactCancel').addEventListener('click', resetContactForm);
    $o('opsAddRole').addEventListener('submit', addRole);
    $o('opsAddType').addEventListener('submit', addType);
    $o('opsAddEditor').addEventListener('submit', addEditor);
    panel.addEventListener('click', delegatedClick);
    preview.addEventListener('click', delegatedClick);
    state.ready = true;
  }

  async function filtersChanged() {
    if (!isValidDate($o('opsDate').value)) return notify('กรุณาเลือกวันที่ให้ถูกต้อง', true);
    state.selectedDate = $o('opsDate').value;
    state.selectedShift = $o('opsShift').value;
    resetRosterForm(); resetContactForm();
    await refresh();
  }

  function directoryForRole() {
    const roleId=$o('opsRoleSelect')?.value;
    return state.directory.filter(p=>p.active && p.role_id===roleId)
      .sort((a,b)=>a.display_name.localeCompare(b.display_name,'th'));
  }
  function updateDirectoryButtons() {
    const id=$o('opsStaffSelect')?.value?.startsWith('person:')
      ? $o('opsStaffSelect').value.slice(7) : '';
    const exists=directoryForRole().some(p=>p.id===id);
    $o('opsDirectoryEdit').disabled=!exists;
    $o('opsDirectoryDelete').disabled=!exists;
  }
  function fillStaffNames(preserve=false) {
    const previous=preserve ? $o('opsStaffSelect').value : '';
    const entries=directoryForRole();
    $o('opsStaffSelect').innerHTML='<option value="">— เลือกรายชื่อ —</option>'+
      entries.map(p=>`<option value="person:${html(p.id)}">${html(p.display_name)}</option>`).join('')+
      '<option value="self">ใช้ชื่อของฉัน</option><option value="manual">อื่น ๆ — พิมพ์ชื่อเอง</option>';
    if (previous && Array.from($o('opsStaffSelect').options).some(o=>o.value===previous)) {
      $o('opsStaffSelect').value=previous;
    } else {
      $o('opsStaffSelect').value='';
    }
    updateDirectoryButtons();
  }
  function applyStaffSelection() {
    const choice=$o('opsStaffSelect').value;
    const entry=choice.startsWith('person:')
      ? state.directory.find(x=>x.id===choice.slice(7) && x.active && x.role_id===$o('opsRoleSelect').value) : null;
    const manual=choice==='manual';
    $o('opsStaffName').readOnly=!manual;
    if(choice==='self') {
      $o('opsStaffName').value=myName();
      $o('opsStaffPhone').value=state.profile?.phone_number||'';
    } else if (entry) {
      $o('opsStaffName').value=entry.display_name;
      $o('opsStaffPhone').value=entry.phone||'';
    } else {
      $o('opsStaffName').value='';
      $o('opsStaffPhone').value='';
    }
    $o('opsRoleHelp').textContent=manual
      ? 'พิมพ์ชื่อและเบอร์เฉพาะเวรนี้ได้ โดยไม่เพิ่มลงทะเบียนกลาง'
      : choice==='self' ? 'ใช้ชื่อจากบัญชีของคุณ และเบอร์จากโปรไฟล์ (แก้เบอร์เฉพาะเวรได้)'
      : entry ? 'เติมชื่อและเบอร์จากทะเบียนกลางแล้ว (เบอร์แก้เฉพาะเวรได้)'
      : 'เลือกรายชื่อในตำแหน่งนี้ หรือเลือกอื่น ๆ เพื่อกรอกชื่อเอง';
    updateDirectoryButtons();
  }
  function updateRoleMode() {
    fillStaffNames(false);
    applyStaffSelection();
  }
  function fillSelectors() {
    const roles=state.roles.filter(r=>r.active)
      .sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name,'th'));
    const types=state.types.filter(t=>t.active)
      .sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name,'th'));
    const prevRole=$o('opsRoleSelect').value, prevType=$o('opsTypeSelect').value;
    const prevStaff=$o('opsStaffSelect').value;
    $o('opsRoleSelect').innerHTML=roles.map(r=>`<option value="${html(r.id)}">${html(r.name)}</option>`).join('');
    $o('opsTypeSelect').innerHTML=types.map(t=>`<option value="${html(t.id)}">${html(t.name)}</option>`).join('');
    if(roles.some(r=>r.id===prevRole))$o('opsRoleSelect').value=prevRole;
    if(types.some(t=>t.id===prevType))$o('opsTypeSelect').value=prevType;
    fillStaffNames(false);
    if(prevStaff && Array.from($o('opsStaffSelect').options).some(o=>o.value===prevStaff)){
      $o('opsStaffSelect').value=prevStaff;
    }
    applyStaffSelection();
    $o('opsRosterSave').disabled=!roles.length;
    $o('opsContactSave').disabled=!types.length;
  }
  function closeDirectoryEditor() {
    state.directoryEditId=null;
    $o('opsDirectoryEditor').classList.add('hidden');
    $o('opsDirectoryName').value='';$o('opsDirectoryPhone').value='';
  }
  function openDirectoryEditor(mode) {
    const role=state.roles.find(r=>r.id===$o('opsRoleSelect').value && r.active);
    if(!role)return notify('กรุณาเลือกตำแหน่งก่อน',true);
    const choice=$o('opsStaffSelect').value;
    const entry=mode==='edit' && choice.startsWith('person:')
      ? state.directory.find(p=>p.id===choice.slice(7) && p.role_id===role.id && p.active) : null;
    if(mode==='edit' && !entry)return notify('กรุณาเลือกชื่อจาก Dropdown ที่ต้องการแก้ไข',true);
    state.directoryEditId=entry?.id||null;
    $o('opsDirectoryFormTitle').textContent=(entry?'แก้ไข':'เพิ่ม')+'ชื่อใน Dropdown · '+role.name;
    $o('opsDirectoryName').value=entry?.display_name||'';
    $o('opsDirectoryPhone').value=entry?.phone||'';
    $o('opsDirectoryEditor').classList.remove('hidden');
    $o('opsDirectoryName').focus();
  }
  async function submitDirectory(e) {
    e.preventDefault();if(!state.user)return;
    const role=state.roles.find(r=>r.id===$o('opsRoleSelect').value && r.active);
    if(!role)return notify('กรุณาเลือกตำแหน่งก่อน',true);
    const name=$o('opsDirectoryName').value.trim(),phone=$o('opsDirectoryPhone').value.trim();
    if(name.length<2)return notify('กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร',true);
    const button=$o('opsDirectorySave');button.disabled=true;
    try{
      let selectedId=state.directoryEditId;
      if(selectedId){
        const {error}=await state.sb.from('ems_ops_staff_directory')
          .update({display_name:name,phone:phone||null}).eq('id',selectedId);
        if(error)throw error;
      }else{
        const {data,error}=await state.sb.from('ems_ops_staff_directory')
          .insert({role_id:role.id,display_name:name,phone:phone||null,created_by:state.user.id})
          .select('id').single();
        if(error)throw error;selectedId=data.id;
      }
      closeDirectoryEditor();
      await readConfigs();
      $o('opsRoleSelect').value=role.id;
      fillStaffNames(false);
      $o('opsStaffSelect').value='person:'+selectedId;
      applyStaffSelection();
      notify('บันทึกรายชื่อใน Dropdown เรียบร้อย');
    }catch(err){showError(err);}finally{button.disabled=false;}
  }
  async function deleteDirectoryEntry() {
    const choice=$o('opsStaffSelect').value;
    if(!choice.startsWith('person:'))return;
    const entry=directoryForRole().find(p=>p.id===choice.slice(7));
    if(!entry)return;
    if(!confirm(`ลบ ${entry.display_name} ออกจาก Dropdown?\nประวัติเวรเดิมจะยังคงอยู่`))return;
    try{
      const {error}=await state.sb.from('ems_ops_staff_directory')
        .update({active:false}).eq('id',entry.id);
      if(error)throw error;
      closeDirectoryEditor();
      await readConfigs();
      $o('opsStaffSelect').value='';applyStaffSelection();
      notify('ลบชื่อจาก Dropdown แล้ว (ไม่กระทบรายการเวรเดิม)');
    }catch(err){showError(err);}
  }
  function resetRosterForm() {
    if(!$o('opsRosterForm'))return;
    state.rosterEditId=null;
    $o('opsRosterForm').reset();
    $o('opsRosterFormTitle').textContent='ลงชื่อปฏิบัติงาน';
    $o('opsRosterCancel').classList.add('hidden');
    closeDirectoryEditor();
    fillSelectors();
    $o('opsStaffSelect').value='self';applyStaffSelection();
  }
  function resetContactForm() {
    if (!$o('opsContactForm')) return;
    state.contactEditId = null;
    $o('opsContactForm').reset();
    $o('opsContactFormTitle').textContent='กรอกแพทย์เวร Fast Track';
    $o('opsContactCancel').classList.add('hidden');
    fillSelectors();
  }

  async function queryList(table, orderColumn='sort_order') {
    const {data,error} = await state.sb.from(table).select('*').order(orderColumn,{ascending:true});
    if (error) throw error;
    return data || [];
  }
  async function readConfigs() {
    const [roles,types,editors,directory] = await Promise.all([
      queryList('ems_ops_roles'),queryList('ems_ops_fast_track_types'),
      queryList('ems_ops_contact_editors','granted_at'),
      queryList('ems_ops_staff_directory','display_name')
    ]);
    state.roles=roles;state.types=types;state.editors=editors;state.directory=directory;
    fillSelectors();
    const editable = canEditContacts();
    $o('opsContactEditorPanel').hidden = !editable;
    $o('opsAdminPanel').hidden = !state.admin;
    if (state.admin) renderAdmin();
  }
  async function refresh() {
    if (!state.sb || !state.profile || !state.ready) return;
    const myRequest = ++state.requestId;
    if (!isValidDate(state.selectedDate)) return;
    const req = {duty_date:state.selectedDate,shift:state.selectedShift};
    try {
      const [r,c] = await Promise.all([
        state.sb.from('ems_ops_roster').select('*').eq('duty_date',req.duty_date).eq('shift',req.shift).order('created_at'),
        state.sb.from('ems_ops_fast_track_contacts').select('*').eq('duty_date',req.duty_date).eq('shift',req.shift).order('created_at')
      ]);
      if (r.error) throw r.error;
      if (c.error) throw c.error;
      if (myRequest !== state.requestId) return;
      state.roster=r.data||[];state.contacts=c.data||[];
      state.loadedDate=req.duty_date;state.loadedShift=req.shift;
      renderAll();
    } catch(e) { showError(e); }
  }
  // Print a standalone, clean report rather than the full management page.
  // Data is taken from the same approved-account dashboard state already loaded.
  function printDashboard() {
    if (!state.user || state.profile?.approval_status !== 'approved')
      return notify('กรุณาเข้าสู่ระบบด้วยบัญชีที่ได้รับอนุมัติ', true);
    if (state.loadedDate !== state.selectedDate || state.loadedShift !== state.selectedShift)
      return notify('ข้อมูลวันที่/เวรนี้ยังโหลดไม่เสร็จ กรุณากดรีเฟรชแล้วลองใหม่', true);

    const roles = roleOrder(state.roles.filter(r => r.active || state.roster.some(p => p.role_id === r.id)));
    const types = roleOrder(state.types.filter(t => t.active || state.contacts.some(p => p.type_id === t.id)));
    let rosterRows = '';
    for (const role of roles) {
      const entries = state.roster.filter(r => r.role_id === role.id);
      if (!entries.length) {
        rosterRows += `<tr class="empty"><td>${html(role.name)}</td><td colspan="3">— ยังไม่มีผู้ลงชื่อ —</td></tr>`;
      } else {
        for (const [i, r] of entries.entries()) {
          rosterRows += `<tr><td>${i === 0 ? html(role.name) : ''}</td>
            <td>${html(r.display_name)}</td><td class="phone">${html(r.phone || '—')}</td>
            <td>${html(r.note || '—')}</td></tr>`;
        }
      }
    }
    let contactRows = '';
    for (const type of types) {
      const entries = state.contacts.filter(c => c.type_id === type.id);
      if (!entries.length) {
        contactRows += `<tr class="empty"><td>${html(type.name)}</td><td colspan="3">— ยังไม่มีเบอร์ติดต่อ —</td></tr>`;
      } else {
        for (const [i, c] of entries.entries()) {
          contactRows += `<tr><td>${i === 0 ? html(type.name) : ''}</td>
            <td>นพ./พญ. ${html(c.doctor_name)}</td><td class="phone">${html(c.phone)}</td>
            <td>${html(c.note || '—')}</td></tr>`;
        }
      }
    }
    const generatedAt = new Date().toLocaleString('th-TH', {
      timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short'
    });
    const documentTitle = `EMS Daily Operations – ${state.selectedDate} – ${shiftText[state.selectedShift]}`;
    const report = `<!doctype html><html lang="th"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${html(documentTitle)}</title>
      <style>
        @page{size:A4 portrait;margin:13mm 12mm}
        *{box-sizing:border-box}
        body{margin:0;background:#fff;color:#202f3e;font-family:Arial,"Noto Sans Thai",Tahoma,sans-serif;font-size:11px;line-height:1.48}
        .report-header{border-bottom:3px solid #126c84;padding-bottom:13px;margin-bottom:18px}
        .eyebrow{color:#14748b;font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase}
        h1{font-size:22px;line-height:1.24;margin:5px 0 12px;color:#143d56}
        .meta{display:flex;flex-wrap:wrap;gap:10px 22px;font-size:12px}
        .meta strong{color:#1d536c}
        h2{font-size:16px;color:#174e68;margin:20px 0 8px;page-break-after:avoid}
        table{width:100%;border-collapse:collapse;table-layout:fixed}
        th,td{text-align:left;vertical-align:top;padding:7px 8px;border:1px solid #d4e1e8;overflow-wrap:anywhere}
        th{background:#e9f3f7;color:#244d62;font-weight:700}
        tbody tr:nth-child(even){background:#f8fbfc}
        tr{break-inside:avoid;page-break-inside:avoid}
        .empty{color:#7c8b97}
        .phone{white-space:normal;font-variant-numeric:tabular-nums}
        .footnote{font-size:10px;color:#6b7d89;margin-top:18px;border-top:1px solid #d9e5e9;padding-top:8px}
        .print-actions{display:flex;gap:8px;margin:12px 0 20px}
        button{border:0;border-radius:8px;background:#126c84;color:#fff;padding:10px 16px;cursor:pointer}
        @media print{.print-actions{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
      </style></head><body>
      <div class="print-actions"><button onclick="window.print()">🖨 พิมพ์ / บันทึก PDF</button></div>
      <header class="report-header"><div class="eyebrow">EMS SUANDOK · OPERATIONS</div>
      <h1>EMS Daily Operations Dashboard</h1>
      <div class="meta"><div><strong>วันที่:</strong> ${html(fmt(state.selectedDate))}</div>
      <div><strong>เวร:</strong> ${html(shiftText[state.selectedShift])}</div>
      <div><strong>ข้อมูล ณ:</strong> ${html(generatedAt)} น.</div></div></header>
      <h2>👥 EMS Daily Roster (${state.roster.length} คน)</h2>
      <table aria-label="EMS Daily Roster"><colgroup><col style="width:25%"><col style="width:30%"><col style="width:19%"><col style="width:26%"></colgroup>
      <thead><tr><th>ตำแหน่ง</th><th>ชื่อผู้ปฏิบัติงาน</th><th>เบอร์โทรศัพท์</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${rosterRows || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}</tbody></table>
      <h2>☎ Fast Track Contacts (${state.contacts.length} รายชื่อ)</h2>
      <table aria-label="Fast Track Contacts"><colgroup><col style="width:25%"><col style="width:30%"><col style="width:19%"><col style="width:26%"></colgroup>
      <thead><tr><th>ประเภท</th><th>แพทย์เวร</th><th>เบอร์โทรศัพท์</th><th>หมายเหตุ</th></tr></thead>
      <tbody>${contactRows || '<tr><td colspan="4">ไม่มีข้อมูล</td></tr>'}</tbody></table>
      <p class="footnote">รายงานแสดงข้อมูลของวันที่และเวรที่เลือก ณ เวลาที่พิมพ์ · เวรดึกใช้วันที่สิ้นสุดเวร (23:45 วันก่อน–08:00 น.) · เวลาประเทศไทย</p>
      </body></html>`;
    const popup = window.open('', '_blank');
    if (!popup) return notify('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-ups แล้วลองอีกครั้ง', true);
    popup.document.open();
    popup.document.write(report);
    popup.document.close();
    popup.focus();
    // Delayed automatic dialog allows the new document to finish laying out.
    // The visible print button in the new tab is a fallback on restrictive browsers.
    popup.setTimeout(() => popup.print(), 350);
  }

  function rosterActionButtons(row) {
    if (!state.user || state.profile?.approval_status!=='approved') return '';
    return `<button class="btn small" type="button" data-ops-action="edit-roster" data-id="${html(row.id)}">แก้ไข</button>
      <button class="btn small danger" type="button" data-ops-action="delete-roster" data-id="${html(row.id)}">ลบ</button>`;
  }
  function contactActionButtons(row) {
    if (!canEditContacts()) return '';
    return `<button class="btn small" type="button" data-ops-action="edit-contact" data-id="${html(row.id)}">แก้ไข</button>
      <button class="btn small danger" type="button" data-ops-action="delete-contact" data-id="${html(row.id)}">ลบ</button>`;
  }
  function phoneControls(number) {
    if (!number?.trim()) return '';
    const phone = number.trim(), tel = cleanPhone(phone);
    return `<span>${html(phone)}</span><div class="ops-actions">
      ${tel?`<a class="btn small" href="tel:${encodeURIComponent(tel)}">โทร</a>`:''}
      <button class="btn small" type="button" data-ops-action="copy" data-value="${html(phone)}">คัดลอกเบอร์</button></div>`;
  }
  function roleOrder(list) {return list.slice().sort((a,b)=>a.sort_order-b.sort_order||a.name.localeCompare(b.name,'th'));}
  function renderAll() {
    $o('opsRosterList').innerHTML = roleOrder(state.roles.filter(x=>x.active || state.roster.some(r=>r.role_id===x.id))).map(role => {
      const list = state.roster.filter(r => r.role_id===role.id);
      return `<section class="ops-group"><h4>${html(role.name)} <span class="pill neutral">${list.length} คน</span></h4>
       ${list.length ? list.map(row => `<div class="ops-entry"><strong>${html(row.display_name)}</strong>
         ${row.phone?phoneControls(row.phone):''}${row.note?`<small>${html(row.note)}</small>`:''}
         ${row.last_edited_by_name?`<small>แก้ไขล่าสุดโดย ${html(row.last_edited_by_name)} · ${html(dateTimeText(row.updated_at))}</small>`:''}
         <div class="ops-actions">${rosterActionButtons(row)}</div></div>`).join('')
         : '<div class="ops-blank">ยังไม่มีผู้ลงชื่อในเวรนี้</div>'}</section>`;
    }).join('') || '<p class="muted">ยังไม่มีตำแหน่งที่เปิดใช้งาน</p>';
    $o('opsContactsList').innerHTML = roleOrder(state.types.filter(x=>x.active || state.contacts.some(c=>c.type_id===x.id))).map(type => {
      const list = state.contacts.filter(c => c.type_id===type.id);
      return `<section class="ops-group"><h4>${html(type.name)} <span class="pill neutral">${list.length} รายชื่อ</span></h4>
        ${list.length?list.map(row=>`<div class="ops-entry"><strong>นพ./พญ. ${html(row.doctor_name)}</strong>
          ${phoneControls(row.phone)}${row.note?`<small>${html(row.note)}</small>`:''}
          <div class="ops-actions">${contactActionButtons(row)}</div></div>`).join('')
          : '<div class="ops-blank">ยังไม่มีเบอร์ติดต่อเวรนี้</div>'}</section>`;
    }).join('') || '<p class="muted">ยังไม่มีประเภท Fast Track</p>';
    const rosterRows = roleOrder(state.roles.filter(x=>x.active)).map(role => {
      const names = state.roster.filter(x=>x.role_id===role.id);
      return `<div class="ops-mini-people"><strong>${html(role.name)}:</strong> ${names.length?
        names.map(x=>`<span>${html(x.display_name)}${x.phone?' · '+phoneControls(x.phone):''}</span>`).join('<hr style="border:0;border-top:1px solid #e6edf4">'):'<span class="muted">ยังไม่มีผู้ลงชื่อ</span>'}</div>`;
    }).join('');
    const typeRows = roleOrder(state.types.filter(x=>x.active)).map(type => {
      const names=state.contacts.filter(x=>x.type_id===type.id);
      return `<div class="ops-mini-people"><strong>${html(type.name)}:</strong> ${names.length?
        names.map(x=>`<span>${html(x.doctor_name)} · ${phoneControls(x.phone)}</span>`).join('<hr style="border:0;border-top:1px solid #e6edf4">'):'<span class="muted">ยังไม่มีข้อมูล</span>'}</div>`;
    }).join('');
    $o('opsPreviewBody').innerHTML = `<section><h4>👥 EMS Roster</h4>${rosterRows||'<p>ยังไม่มีรายการตำแหน่ง</p>'}</section>
      <section><h4>☎ Fast Track</h4>${typeRows||'<p>ยังไม่มีประเภท Fast Track</p>'}</section>
      <p class="muted" style="grid-column:1/-1">${html(fmt(state.selectedDate))} · ${html(shiftText[state.selectedShift])} · กดดูรายชื่อทั้งหมดเพื่อโทรหรือคัดลอกเบอร์</p>`;
  }

  async function submitRoster(e) {
    e.preventDefault();if(!state.user)return;
    const role=state.roles.find(r=>r.id===$o('opsRoleSelect').value && r.active);
    if(!role)return notify('กรุณาเลือกตำแหน่งที่เปิดใช้งาน',true);
    const choice=$o('opsStaffSelect').value;
    if(!choice)return notify('กรุณาเลือกชื่อจาก Dropdown หรือเลือกอื่น ๆ',true);
    const person=choice.startsWith('person:')
      ? directoryForRole().find(p=>p.id===choice.slice(7)) : null;
    if(choice.startsWith('person:') && !person)return notify('ชื่อที่เลือกไม่อยู่ในทะเบียนแล้ว กรุณาเลือกใหม่',true);
    const name=choice==='self'?myName():person?person.display_name:$o('opsStaffName').value.trim();
    if(name.length<2)return notify('กรุณาระบุชื่อผู้ปฏิบัติงาน',true);
    const previous=state.rosterEditId?state.roster.find(r=>r.id===state.rosterEditId):null;
    const preserveLinked=previous?.staff_user_id && choice!=='self'
      && previous.display_name===name && previous.staff_user_id!==state.user.id;
    const payload={duty_date:state.selectedDate,shift:state.selectedShift,role_id:role.id,
      staff_user_id:choice==='self'?state.user.id:(preserveLinked?previous.staff_user_id:null),
      staff_directory_id:person?.id||null,
      display_name:name,phone:$o('opsStaffPhone').value.trim()||null,
      note:$o('opsRosterNote').value.trim()||null};
    const button=$o('opsRosterSave');button.disabled=true;
    try{
      const query=state.rosterEditId
        ?state.sb.from('ems_ops_roster').update(payload).eq('id',state.rosterEditId)
        :state.sb.from('ems_ops_roster').insert({...payload,created_by:state.user.id});
      const {error}=await query;if(error)throw error;
      notify('บันทึกรายชื่อเวรเรียบร้อย');resetRosterForm();await refresh();
    }catch(err){showError(err);}finally{button.disabled=false;}
  }
  async function submitContact(e) {
    e.preventDefault();if (!canEditContacts()) return notify('ไม่มีสิทธิ์แก้ไข Fast Track',true);
    const payload={duty_date:state.selectedDate,shift:state.selectedShift,type_id:$o('opsTypeSelect').value,
      doctor_name:$o('opsDoctorName').value.trim(),phone:$o('opsDoctorPhone').value.trim(),
      note:$o('opsContactNote').value.trim()||null};
    const button=$o('opsContactSave');button.disabled=true;
    try {
      const query=state.contactEditId
        ? state.sb.from('ems_ops_fast_track_contacts').update(payload).eq('id',state.contactEditId)
        : state.sb.from('ems_ops_fast_track_contacts').insert({...payload,created_by:state.user.id});
      const {error}=await query;if(error) throw error;
      notify('บันทึกข้อมูล Fast Track เรียบร้อย');resetContactForm();await refresh();
    } catch(err){showError(err);} finally{button.disabled=false;}
  }
  function openRosterEdit(id) {
    const row=state.roster.find(r=>r.id===id);
    if(!row || !state.user || state.profile?.approval_status!=='approved')return;
    state.rosterEditId=row.id;
    if(!$o('opsRoleSelect').querySelector(`option[value="${CSS.escape(row.role_id)}"]`)){
      const opt=document.createElement('option');opt.value=row.role_id;
      opt.textContent=state.roles.find(r=>r.id===row.role_id)?.name||'ตำแหน่งเดิม';$o('opsRoleSelect').add(opt);
    }
    $o('opsRoleSelect').value=row.role_id;
    fillStaffNames(false);
    const matched=directoryForRole().find(p=>p.id===row.staff_directory_id)
      || directoryForRole().find(p=>p.display_name===row.display_name);
    const choice=row.staff_user_id===state.user.id?'self':matched && matched.display_name===row.display_name?'person:'+matched.id:'manual';
    $o('opsStaffSelect').value=choice;
    applyStaffSelection();
    // A roster is a dated snapshot: preserve its saved contact number on edit.
    $o('opsStaffPhone').value=row.phone||'';
    $o('opsStaffName').value=row.display_name;
    $o('opsRosterNote').value=row.note||'';
    $o('opsRosterFormTitle').textContent='แก้ไขรายชื่อเวร';
    $o('opsRosterCancel').classList.remove('hidden');
    closeDirectoryEditor();
    $o('opsRosterForm').scrollIntoView({behavior:'smooth',block:'center'});
  }
  function openContactEdit(id){
    if(!canEditContacts())return;
    const row=state.contacts.find(r=>r.id===id);if(!row)return;
    state.contactEditId=row.id;
    if(!$o('opsTypeSelect').querySelector(`option[value="${CSS.escape(row.type_id)}"]`)){
      const opt=document.createElement('option');opt.value=row.type_id;
      opt.textContent=state.types.find(t=>t.id===row.type_id)?.name||'ประเภทเดิม';$o('opsTypeSelect').add(opt);
    }
    $o('opsTypeSelect').value=row.type_id;
    $o('opsDoctorName').value=row.doctor_name;$o('opsDoctorPhone').value=row.phone;$o('opsContactNote').value=row.note||'';
    $o('opsContactFormTitle').textContent='แก้ไข Fast Track Contact';
    $o('opsContactCancel').classList.remove('hidden');
    $o('opsContactForm').scrollIntoView({behavior:'smooth',block:'center'});
  }
  async function delegatedClick(e){
    const button=e.target.closest('[data-ops-action]');if(!button)return;
    const action=button.dataset.opsAction, id=button.dataset.id;
    if(action==='copy'){
      const value=button.dataset.value||'';
      try{await navigator.clipboard.writeText(value);notify('คัดลอกเบอร์โทรแล้ว');}
      catch(err){window.prompt('คัดลอกเบอร์โทร',value);}
      return;
    }
    if(action==='edit-roster')return openRosterEdit(id);
    if(action==='edit-contact')return openContactEdit(id);
    const roster=state.roster.find(r=>r.id===id), contact=state.contacts.find(r=>r.id===id);
    if(action==='delete-roster' && roster && state.user && state.profile?.approval_status==='approved'){
      if(!confirm('ลบรายชื่อเวรนี้ใช่หรือไม่?'))return;
      try{const {error}=await state.sb.from('ems_ops_roster').delete().eq('id',id);if(error)throw error;await refresh();}
      catch(err){showError(err);}return;
    }
    if(action==='delete-contact' && contact && canEditContacts()){
      if(!confirm('ลบเบอร์ติดต่อ Fast Track นี้ใช่หรือไม่?'))return;
      try{const {error}=await state.sb.from('ems_ops_fast_track_contacts').delete().eq('id',id);if(error)throw error;await refresh();}
      catch(err){showError(err);}return;
    }
    if(!state.admin)return;
    const item=state.roles.find(r=>r.id===id),type=state.types.find(t=>t.id===id);
    try {
      let result;
      if(action==='toggle-role'&&item)result=await state.sb.from('ems_ops_roles').update({active:!item.active}).eq('id',id);
      if(action==='rename-role'&&item){const name=prompt('ชื่อตำแหน่งใหม่',item.name)?.trim();if(!name||name===item.name)return;
        result=await state.sb.from('ems_ops_roles').update({name}).eq('id',id);}
      if(action==='toggle-type'&&type)result=await state.sb.from('ems_ops_fast_track_types').update({active:!type.active}).eq('id',id);
      if(action==='rename-type'&&type){const name=prompt('ชื่อ Fast Track ใหม่',type.name)?.trim();if(!name||name===type.name)return;
        result=await state.sb.from('ems_ops_fast_track_types').update({name}).eq('id',id);}
      if(action==='remove-editor'){
        if(!confirm('ยกเลิกสิทธิ์แก้ไข Fast Track ของบุคลากรนี้?'))return;
        result=await state.sb.from('ems_ops_contact_editors').delete().eq('user_id',id);
      }
      if(result){if(result.error)throw result.error;await readConfigs();await refresh();}
    }catch(err){showError(err);}
  }
  async function addRole(e){
    e.preventDefault();if(!state.admin)return;
    const name=$o('opsRoleName').value.trim();if(name.length<2)return;
    try{const {error}=await state.sb.from('ems_ops_roles').insert({name,allows_manual_name:true});
      if(error)throw error;e.target.reset();await readConfigs();await refresh();}
    catch(err){showError(err);}
  }
  async function addType(e){
    e.preventDefault();if(!state.admin)return;
    const name=$o('opsTypeName').value.trim();if(name.length<2)return;
    try{const {error}=await state.sb.from('ems_ops_fast_track_types').insert({name});
      if(error)throw error;e.target.reset();await readConfigs();await refresh();}
    catch(err){showError(err);}
  }
  async function addEditor(e){
    e.preventDefault();if(!state.admin)return;
    const userId=$o('opsEditorPerson').value;
    if(!userId)return;
    try{const {error}=await state.sb.from('ems_ops_contact_editors').insert({user_id:userId});
      if(error)throw error;await readConfigs();}
    catch(err){showError(err);}
  }
  function renderAdmin(){
    $o('opsRoleAdminList').innerHTML=roleOrder(state.roles).map(r=>`<div class="ops-admin-row"><span>${html(r.name)} ${r.active?'':'· ปิดใช้งาน'}</span>
      <div class="ops-actions"><button class="btn small" type="button" data-ops-action="rename-role" data-id="${html(r.id)}">แก้ชื่อ</button>
      <button class="btn small" type="button" data-ops-action="toggle-role" data-id="${html(r.id)}">${r.active?'ปิด':'เปิด'}</button></div></div>`).join('');
    $o('opsTypeAdminList').innerHTML=roleOrder(state.types).map(t=>`<div class="ops-admin-row"><span>${html(t.name)} ${t.active?'':'· ปิดใช้งาน'}</span>
      <div class="ops-actions"><button class="btn small" type="button" data-ops-action="rename-type" data-id="${html(t.id)}">แก้ชื่อ</button>
      <button class="btn small" type="button" data-ops-action="toggle-type" data-id="${html(t.id)}">${t.active?'ปิด':'เปิด'}</button></div></div>`).join('');
    // 'profiles' is the existing app's admin-only, RLS-protected personnel collection.
    const people=(typeof profiles !== 'undefined' && Array.isArray(profiles) ? profiles : [])
      .filter(p=>p.approval_status==='approved' && !state.editors.some(e=>e.user_id===p.id));
    $o('opsEditorPerson').innerHTML='<option value="">เลือกบุคลากร</option>'+
      people.map(p=>`<option value="${html(p.id)}">${html(p.first_name)} ${html(p.last_name)} (${html(p.position)})</option>`).join('');
    const lookup=(id)=>{
      const p=(typeof profiles !== 'undefined' && Array.isArray(profiles)?profiles:[]).find(p=>p.id===id);
      return p?[p.first_name,p.last_name].join(' '):id;
    };
    $o('opsEditorList').innerHTML=state.editors.length?state.editors.map(e=>
      `<div class="ops-admin-row"><span>${html(lookup(e.user_id))}</span><button class="btn small danger" type="button" data-ops-action="remove-editor" data-id="${html(e.user_id)}">ยกเลิกสิทธิ์</button></div>`
    ).join(''):'<p class="muted">ยังไม่มีผู้ได้รับมอบหมายเพิ่มเติม (Admin แก้ไขได้เสมอ)</p>';
  }
  function onLogout(){
    state.requestId++;
    state.sb=null;state.user=null;state.profile=null;state.admin=false;
    state.roster=[];state.contacts=[];state.roles=[];state.types=[];state.editors=[];state.directory=[];
    if($o('opsPreviewBody'))$o('opsPreviewBody').textContent='กรุณาเข้าสู่ระบบ';
    if($o('opsRosterList'))$o('opsRosterList').textContent='';
    if($o('opsContactsList'))$o('opsContactsList').textContent='';
  }
  async function onLogin(client,user,profile){
    if(!client||!user||!profile||profile.approval_status!=='approved')return;
    mount();
    state.sb=client;state.user=user;state.profile=profile;
    state.admin=profile.access_role==='admin';
    try {
      await readConfigs();
      if(!state.rosterEditId) resetRosterForm();
      await refresh();
    } catch(e) {showError(e);}
  }
  window.EMS_OPERATIONS={onLogin,onLogout,refresh};
})();
