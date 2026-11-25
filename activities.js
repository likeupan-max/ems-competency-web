/* EMS Suandok Hub — Activities & Participation Log v1.0
   Independent of Certificates, Procedures, Equipment, and EMS Operations.
   Requires 01_activities_schema.sql and app.js login/logout hooks.
   Never put service_role keys or other secrets in this file. */
(() => {
  'use strict';
  const CATS = {
    training: 'การอบรมทั่วไป (ไม่มีใบ Certification ก็ได้)',
    deployment: 'การออกหน่วย / กิจกรรมภาคสนาม',
    teaching: 'การสอน / วิทยากร',
    other: 'กิจกรรมอื่น ๆ'
  };
  const SHORT = {training:'อบรม',deployment:'ออกหน่วย',teaching:'การสอน',other:'อื่น ๆ'};
  const state = {
    sb:null,user:null,profile:null,topics:[],entries:[],mounted:false,request:0,
    editingTopic:null,editingEntry:null,filterCat:'all',search:'',onlyMine:false,loading:false
  };
  const el = (id) => document.getElementById(id);
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const text = x => String(x??'').trim();
  const fmt = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}) : '—';
  const when = x => x ? new Date(x).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short',timeZone:'Asia/Bangkok'}) : '—';
  const today = () => {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(i=>i.type!=='literal').map(i=>[i.type,i.value]));
    return `${p.year}-${p.month}-${p.day}`;
  };
  const friendlyError = (err) => {
    if(err?.code==='23505')return 'มีชื่อหัวข้อนี้อยู่ในประเภทเดียวกันแล้ว';
    return err?.message || 'เกิดข้อผิดพลาด กรุณาลองอีกครั้ง';
  };
  const notify = (msg,error=false) => {
    if(typeof toast==='function')toast(msg,error);
    else if(error)alert(msg);
  };
  const errReport = err => {console.error('[EMS Activities]',err); notify(friendlyError(err),true);};
  const myName = () => [state.profile?.first_name,state.profile?.last_name].filter(Boolean).join(' ').trim();

  function mount() {
    if (state.mounted) return;
    const nav=el('mainNav'),app=el('appPanel'),dashboard=el('dashboard');
    if(!nav||!app||!dashboard)throw Error('ไม่พบแถบเมนูหรือ Dashboard ของระบบหลัก');
    const link=document.createElement('button');
    link.type='button';link.dataset.tab='emsActivities';link.textContent='✦ กิจกรรม / อบรม / ออกหน่วย';
    link.addEventListener('click',()=>tab('emsActivities'));
    const near=nav.querySelector('[data-tab="procedures"]');
    if(near)near.insertAdjacentElement('afterend',link);else nav.append(link);

    const mini=document.createElement('div');
    mini.id='eaDashboardPreview';mini.className='card section no-print';
    mini.innerHTML=`<div class="top"><div><h3>✦ Activities & Participation</h3>
      <p class="muted">อบรมทั่วไป · ออกหน่วย · การสอน · กิจกรรมอื่น ๆ (ไม่เกี่ยวกับ Certificates)</p></div>
      <button class="btn primary" type="button" id="eaOpen">ดู Dashboard กิจกรรม</button></div>
      <div id="eaMiniText" class="ea-mini">กำลังโหลดข้อมูลกิจกรรม...</div>`;
    const preview=el('opsDashboardPreview');
    if(preview)preview.insertAdjacentElement('afterend',mini);
    else {const stats=dashboard.querySelector('.stats');if(stats)stats.insertAdjacentElement('afterend',mini);else dashboard.prepend(mini);}
    el('eaOpen').addEventListener('click',()=>tab('emsActivities'));

    const panel=document.createElement('section');panel.id='emsActivities';panel.className='tab';
    panel.innerHTML=`
      <div class="ea-heading">
        <div><div class="ea-kicker">EMS SUANDOK • ACTIVITY LOG</div>
        <h2>กิจกรรม / การอบรม / การออกหน่วย / การสอน</h2>
        <p>บันทึกการมีส่วนร่วมที่ <b>ไม่ใช่ Certificate</b> · ดูว่าใครเคยเข้าร่วม และใครเข้าร่วมล่าสุด</p></div>
        <button class="btn" type="button" id="eaRefresh">↻ รีเฟรช</button>
      </div>
      <div id="eaStats" class="ea-stats section"></div>
      <div class="ea-columns section">
        <div class="card ea-create-card">
          <h3 id="eaTopicHeading">เพิ่มหัวข้อกิจกรรม</h3>
          <p class="muted">สมาชิกที่ได้รับอนุมัติทุกคนเพิ่มและจัดการหัวข้อได้</p>
          <form id="eaTopicForm" class="ea-form">
            <label class="field">ประเภทกิจกรรม<select id="eaTopicCategory" required>
              <option value="training">การอบรมทั่วไป</option><option value="deployment">การออกหน่วย</option>
              <option value="teaching">การสอน</option><option value="other">อื่น ๆ</option></select></label>
            <label class="field">ชื่อหัวข้อ<input id="eaTopicTitle" maxlength="180" required placeholder="เช่น Workshop Non-Technical Skills"></label>
            <label class="field">รายละเอียดหัวข้อ (ถ้ามี)<textarea id="eaTopicDescription" maxlength="800" rows="2" placeholder="คำอธิบายสั้น ๆ"></textarea></label>
            <div class="ea-actions"><button class="btn primary" type="submit" id="eaTopicSave">+ บันทึกหัวข้อ</button>
              <button class="btn" type="button" id="eaTopicCancel" hidden>ยกเลิกแก้ไข</button></div>
          </form>
        </div>
        <div class="card ea-create-card">
          <h3 id="eaEntryHeading">บันทึกกิจกรรมของฉัน</h3>
          <p class="muted" id="eaEntrySubtitle">ชื่อผู้เข้าร่วมจะดึงจากบัญชีที่ Login โดยอัตโนมัติ</p>
          <form id="eaEntryForm" class="ea-form">
            <label class="field">ประเภทกิจกรรม<select id="eaEntryCategory" required>
              <option value="training">การอบรมทั่วไป</option><option value="deployment">การออกหน่วย</option>
              <option value="teaching">การสอน</option><option value="other">อื่น ๆ</option></select></label>
            <label class="field">เลือกหัวข้อ<select id="eaEntryTopic" required></select></label>
            <div class="ea-input-grid">
              <label class="field">วันที่เข้าร่วม<input type="date" id="eaDate" required></label>
              <label class="field">วันที่สิ้นสุด (ถ้ามี)<input type="date" id="eaEndDate"></label>
            </div>
            <label class="field">สถานที่ / หน่วยงาน (ถ้ามี)<input id="eaVenue" maxlength="200" placeholder="เช่น ห้องประชุม / หน่วยงาน"></label>
            <label class="field">บทบาทหรือรายละเอียด (ถ้ามี)<textarea id="eaNote" maxlength="1000" rows="2" placeholder="เช่น ผู้เข้าร่วม, วิทยากร, ทีมปฏิบัติการ (ไม่ใส่ข้อมูลผู้ป่วย)"></textarea></label>
            <div class="ea-actions"><button class="btn primary" type="submit" id="eaEntrySave">+ บันทึกการเข้าร่วม</button>
              <button class="btn" type="button" id="eaEntryCancel" hidden>ยกเลิกแก้ไข</button></div>
          </form>
        </div>
      </div>
      <div class="card section ea-overview">
        <div class="top"><div><h3>Dashboard กลาง — ประวัติการเข้าร่วมแต่ละหัวข้อ</h3>
          <p class="muted">แสดงจำนวนครั้ง ผู้ที่เคยเข้าร่วม และผู้เข้าร่วมล่าสุด · สมาชิกทุกคนดูได้</p></div></div>
        <div class="ea-filters">
          <label class="field">ประเภท<select id="eaFilterCat"><option value="all">ทุกประเภท</option>
            <option value="training">อบรมทั่วไป</option><option value="deployment">ออกหน่วย</option>
            <option value="teaching">การสอน</option><option value="other">อื่น ๆ</option></select></label>
          <label class="field ea-search">ค้นหาหัวข้อ<input id="eaSearch" type="search" placeholder="ค้นหาชื่อกิจกรรม..."></label>
          <label class="ea-check"><input id="eaOnlyMine" type="checkbox"> เฉพาะกิจกรรมที่ฉันเคยเข้าร่วม</label>
        </div>
        <div id="eaTopicCards" class="ea-topic-cards"></div>
      </div>
      <div class="card section"><h3>ประวัติการเข้าร่วมล่าสุดของทุกคน</h3>
        <div id="eaEntryList"></div></div>
      <p class="muted ea-footnote">หมายเหตุ: บันทึกนี้แยกจาก Certificates และ Procedures โดยสิ้นเชิง ไม่ต้องแนบใบรับรองหรือกรอกวันหมดอายุ · ห้ามใส่ชื่อหรือข้อมูลระบุตัวผู้ป่วยในหมายเหตุ</p>
    `;
    app.appendChild(panel);
    injectStyle();
    el('eaRefresh').addEventListener('click',refresh);
    el('eaTopicForm').addEventListener('submit',submitTopic);
    el('eaEntryForm').addEventListener('submit',submitEntry);
    el('eaTopicCancel').addEventListener('click',resetTopic);
    el('eaEntryCancel').addEventListener('click',resetEntry);
    el('eaEntryCategory').addEventListener('change',fillTopicOptions);
    el('eaFilterCat').addEventListener('change',ev=>{state.filterCat=ev.target.value;render();});
    el('eaSearch').addEventListener('input',ev=>{state.search=text(ev.target.value).toLocaleLowerCase();render();});
    el('eaOnlyMine').addEventListener('change',ev=>{state.onlyMine=ev.target.checked;render();});
    panel.addEventListener('click',delegateAction);
    el('eaDate').value=today();
    state.mounted=true;
  }

  function injectStyle(){
    if(el('eaActivityStyles'))return;
    const style=document.createElement('style');style.id='eaActivityStyles';style.textContent=`
    #emsActivities{--ea-navy:#153956;--ea-teal:#117c8d;--ea-soft:#f3f9fc;color:#253e53}
    #emsActivities .ea-heading{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;
      padding:26px 28px;border-radius:18px;background:linear-gradient(112deg,#153b59,#146e8d 72%,#13a6ac);color:white}
    #emsActivities .ea-heading h2{margin:6px 0 8px;color:#fff;font-size:clamp(20px,2.5vw,29px)}
    #emsActivities .ea-heading p{margin:0;color:#dff7fb;font-size:13px}
    #emsActivities .ea-kicker{font-size:11px;letter-spacing:1.2px;font-weight:750;color:#b9eff6}
    #emsActivities .ea-heading .btn{background:white;color:#174663;white-space:nowrap}
    #emsActivities .ea-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    #emsActivities .ea-stat{background:#fff;border:1px solid #dbe8ef;border-radius:14px;padding:16px 18px}
    #emsActivities .ea-stat small{display:block;color:#60798b;font-size:12px}
    #emsActivities .ea-stat b{display:block;font-size:25px;margin-top:5px;color:#1b5575}
    #emsActivities .ea-stat b.ea-small-stat{font-size:15px;line-height:1.55}
    #emsActivities .ea-columns{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
    #emsActivities .ea-form{display:grid;gap:11px;margin-top:12px}
    #emsActivities .ea-form .field{display:grid;gap:6px}
    #emsActivities textarea{width:100%;resize:vertical;min-height:70px;padding:10px 12px;border:1px solid #d0dfeb;border-radius:10px;font:inherit;color:#25455b}
    #emsActivities .ea-input-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    #emsActivities .ea-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
    #emsActivities .ea-filters{display:flex;gap:12px;flex-wrap:wrap;align-items:end;margin:16px 0}
    #emsActivities .ea-filters .field{min-width:170px}
    #emsActivities .ea-filters .ea-search{flex:1 1 220px}
    #emsActivities .ea-check{display:flex;align-items:center;gap:8px;font-size:13px;padding:12px 4px}
    #emsActivities .ea-check input{width:17px;height:17px}
    #emsActivities .ea-topic-cards{display:grid;gap:13px}
    #emsActivities .ea-topic-card{border:1px solid #dce8ee;border-radius:14px;padding:17px;background:linear-gradient(180deg,#fff,#faffff)}
    #emsActivities .ea-topic-top{display:flex;gap:12px;justify-content:space-between;align-items:start;flex-wrap:wrap}
    #emsActivities .ea-topic-title{margin:4px 0 0;font-size:17px;color:#173e59}
    #emsActivities .ea-chip{display:inline-block;padding:4px 9px;border-radius:30px;background:#e8f4f8;color:#1c7287;font-size:11px;font-weight:750}
    #emsActivities .ea-meta{font-size:13px;color:#526d80;display:flex;gap:15px;flex-wrap:wrap;margin:13px 0}
    #emsActivities .ea-participants{padding:12px;background:#f3f9fb;border-radius:10px;font-size:13px;line-height:1.8}
    #emsActivities .ea-participants strong{color:#23546c}
    #emsActivities .ea-entry{display:flex;align-items:start;justify-content:space-between;gap:15px;padding:12px 3px;border-bottom:1px solid #e9eff4;flex-wrap:wrap}
    #emsActivities .ea-entry:last-child{border-bottom:0}
    #emsActivities .ea-entry-main{min-width:220px;flex:1}
    #emsActivities .ea-entry-main b{display:block;color:#214a65}
    #emsActivities .ea-muted{font-size:12px;color:#6b8190;line-height:1.7}
    #emsActivities .ea-row-actions{display:flex;gap:6px;flex-wrap:wrap}
    #emsActivities .ea-empty{text-align:center;padding:22px;color:#6b8290;background:#f6f9fb;border-radius:10px}
    #emsActivities .ea-footnote{margin:15px 3px;font-size:12px}
    #eaDashboardPreview .ea-mini{font-size:13px;color:#466074;line-height:1.7}
    @media(max-width:860px){#emsActivities .ea-columns{grid-template-columns:1fr}#emsActivities .ea-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:520px){#emsActivities .ea-heading{padding:19px}#emsActivities .ea-input-grid{grid-template-columns:1fr}
      #emsActivities .ea-stat{padding:13px}#emsActivities .ea-stat b{font-size:21px}
      #emsActivities .ea-topic-top{display:block}#emsActivities .ea-row-actions{margin-top:10px}}
    @media print {#emsActivities,#eaDashboardPreview{display:none!important}}
    `;document.head.appendChild(style);
  }

  async function getAll(table, sortColumn, ascending=false) {
    const result=[];
    // paginate because PostgREST may limit the number of rows in one response
    for(let offset=0;offset<10000;offset+=500){
      const {data,error}=await state.sb.from(table).select('*').is('deleted_at',null)
        .order(sortColumn,{ascending}).range(offset,offset+499);
      if(error)throw error;
      result.push(...(data||[]));
      if((data||[]).length<500)return result;
    }
    throw Error('พบข้อมูลเกิน 10,000 รายการ กรุณาติดต่อผู้ดูแลเพื่อเพิ่มระบบแบ่งหน้า');
  }
  async function refresh() {
    if(!state.sb||!state.user)return;
    const req=++state.request;
    state.loading=true;
    if(el('eaMiniText'))el('eaMiniText').textContent='กำลังอัปเดตข้อมูลกิจกรรม...';
    try{
      const [topics,entries]=await Promise.all([
        getAll('ems_activity_topics','created_at',false),
        getAll('ems_activity_entries','activity_date',false)
      ]);
      if(req!==state.request)return;
      state.topics=topics;state.entries=entries.filter(r=>topics.some(t=>t.id===r.topic_id));
      fillTopicOptions();render();
    }catch(err){if(req===state.request)errReport(err);}
    finally{if(req===state.request)state.loading=false;}
  }

  function fillTopicOptions(){
    if(!el('eaEntryTopic'))return;
    const selected=el('eaEntryTopic').value;
    const cat=el('eaEntryCategory').value;
    const list=state.topics.filter(t=>t.category===cat).sort((a,b)=>a.title.localeCompare(b.title,'th'));
    el('eaEntryTopic').innerHTML='<option value="">เลือกหัวข้อ</option>'+list.map(t=>`<option value="${esc(t.id)}">${esc(t.title)}</option>`).join('');
    if(list.some(t=>t.id===selected))el('eaEntryTopic').value=selected;
    else el('eaEntryTopic').value='';
  }
  function resetTopic(){
    state.editingTopic=null;
    el('eaTopicForm').reset();el('eaTopicHeading').textContent='เพิ่มหัวข้อกิจกรรม';
    el('eaTopicSave').textContent='+ บันทึกหัวข้อ';el('eaTopicCancel').hidden=true;
  }
  function resetEntry(){
    state.editingEntry=null;
    el('eaEntryForm').reset();el('eaDate').value=today();
    el('eaEntryHeading').textContent='บันทึกกิจกรรมของฉัน';
    el('eaEntrySubtitle').textContent=`ชื่อผู้เข้าร่วม: ${myName()||'บัญชีที่เข้าสู่ระบบ'}`;
    el('eaEntrySave').textContent='+ บันทึกการเข้าร่วม';el('eaEntryCancel').hidden=true;
    fillTopicOptions();
  }
  async function submitTopic(e){
    e.preventDefault();if(!state.sb)return;
    const title=text(el('eaTopicTitle').value),category=el('eaTopicCategory').value;
    if(title.length<2||!CATS[category])return notify('กรุณาระบุประเภทและชื่อหัวข้อให้ถูกต้อง',true);
    const payload={category,title,description:text(el('eaTopicDescription').value)||null};
    const b=el('eaTopicSave');b.disabled=true;
    try{
      const q=state.editingTopic
        ? state.sb.from('ems_activity_topics').update(payload).eq('id',state.editingTopic)
        : state.sb.from('ems_activity_topics').insert(payload);
      const {data,error}=await q.select('id').single();if(error)throw error;
      if(!data)throw Error('ไม่ได้รับผลการบันทึกจากฐานข้อมูล');
      notify('บันทึกหัวข้อกิจกรรมสำเร็จ');resetTopic();await refresh();
    }catch(err){errReport(err);}finally{b.disabled=false;}
  }
  async function submitEntry(e){
    e.preventDefault();if(!state.sb)return;
    const topic_id=el('eaEntryTopic').value;
    const topic=state.topics.find(t=>t.id===topic_id);
    if(!topic)return notify('กรุณาเลือกหัวข้อกิจกรรม',true);
    const activity_date=el('eaDate').value,end_date=el('eaEndDate').value||null;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(activity_date))return notify('กรุณากรอกวันที่เข้าร่วม',true);
    if(end_date&&end_date<activity_date)return notify('วันสิ้นสุดต้องไม่ก่อนวันที่เริ่ม',true);
    const payload={topic_id,activity_date,end_date,venue:text(el('eaVenue').value)||null,note:text(el('eaNote').value)||null};
    const b=el('eaEntrySave');b.disabled=true;
    try{
      const q=state.editingEntry
        ? state.sb.from('ems_activity_entries').update(payload).eq('id',state.editingEntry)
        : state.sb.from('ems_activity_entries').insert(payload);
      const {data,error}=await q.select('id').single();if(error)throw error;
      if(!data)throw Error('ไม่ได้รับผลการบันทึกจากฐานข้อมูล');
      notify('บันทึกประวัติการเข้าร่วมสำเร็จ');resetEntry();await refresh();
    }catch(err){errReport(err);}finally{b.disabled=false;}
  }

  function topicStats(t){
    const entries=state.entries.filter(e=>e.topic_id===t.id).sort((a,b)=>
      b.activity_date.localeCompare(a.activity_date)||String(b.created_at).localeCompare(String(a.created_at)));
    const people=new Map();
    for(const r of entries){
      const old=people.get(r.participant_id);
      if(!old)people.set(r.participant_id,{name:r.participant_name,last:r.activity_date,count:1});
      else old.count++;
    }
    return {entries,people,latest:entries[0]||null};
  }
  function relevantTopics(){
    return state.topics.filter(t=>
      (state.filterCat==='all'||t.category===state.filterCat)&&
      (!state.search||[t.title,t.description].join(' ').toLocaleLowerCase().includes(state.search))&&
      (!state.onlyMine||state.entries.some(r=>r.topic_id===t.id&&r.participant_id===state.user?.id))
    ).sort((a,b)=>{
      const x=topicStats(a).latest?.activity_date||'0000-00-00';
      const y=topicStats(b).latest?.activity_date||'0000-00-00';
      return y.localeCompare(x)||a.title.localeCompare(b.title,'th');
    });
  }
  function renderTopicCard(t){
    const {entries,people,latest}=topicStats(t);
    const personList=[...people.values()].sort((a,b)=>b.last.localeCompare(a.last)||a.name.localeCompare(b.name,'th'));
    return `<article class="ea-topic-card">
      <div class="ea-topic-top"><div><span class="ea-chip">${esc(SHORT[t.category]||t.category)}</span>
      <h4 class="ea-topic-title">${esc(t.title)}</h4>
      ${t.description?`<p class="ea-muted">${esc(t.description)}</p>`:''}</div>
      <div class="ea-row-actions">
        <button class="btn small" type="button" data-ea-action="join" data-id="${esc(t.id)}">+ ลงชื่อของฉัน</button>
        <button class="btn small" type="button" data-ea-action="edit-topic" data-id="${esc(t.id)}">แก้ไขหัวข้อ</button>
        <button class="btn small danger" type="button" data-ea-action="delete-topic" data-id="${esc(t.id)}">ลบหัวข้อ</button>
      </div></div>
      <div class="ea-meta"><span>👥 เคยเข้าร่วม <b>${people.size}</b> คน</span>
        <span>🗓 บันทึก <b>${entries.length}</b> ครั้ง</span>
        <span>⏱ ล่าสุด: <b>${latest?`${esc(latest.participant_name)} · ${fmt(latest.activity_date)}`:'ยังไม่มีผู้เข้าร่วม'}</b></span></div>
      <details><summary>ดูรายชื่อผู้ที่เคยเข้าร่วม (${people.size} คน)</summary>
        <div class="ea-participants">${personList.length?personList.map(p=>
          `<div>• <strong>${esc(p.name)}</strong> — ล่าสุด ${fmt(p.last)} (${p.count} ครั้ง)</div>`).join(''):
          'ยังไม่มีบันทึกการเข้าร่วม'}</div></details>
    </article>`;
  }
  function renderEntry(r){
    const t=state.topics.find(x=>x.id===r.topic_id);
    const duration=r.end_date&&r.end_date!==r.activity_date?`${fmt(r.activity_date)} – ${fmt(r.end_date)}`:fmt(r.activity_date);
    return `<div class="ea-entry"><div class="ea-entry-main">
      <b>${esc(r.participant_name)} · ${esc(t?.title||'หัวข้อที่ลบแล้ว')}</b>
      <div class="ea-muted">${esc(SHORT[t?.category]||'กิจกรรม')} · ${duration}
      ${r.venue?` · ${esc(r.venue)}`:''}</div>
      ${r.note?`<div class="ea-muted">${esc(r.note)}</div>`:''}
      <div class="ea-muted">แก้ไขล่าสุด ${when(r.updated_at)}</div></div>
      <div class="ea-row-actions"><button class="btn small" type="button" data-ea-action="edit-entry" data-id="${esc(r.id)}">แก้ไข</button>
      <button class="btn small danger" type="button" data-ea-action="delete-entry" data-id="${esc(r.id)}">ลบ</button></div></div>`;
  }
  function render(){
    if(!state.mounted||!state.user)return;
    const active=state.topics;
    const people=new Set(state.entries.map(e=>e.participant_id)).size;
    const latest=[...state.entries].sort((a,b)=>b.activity_date.localeCompare(a.activity_date)||String(b.created_at).localeCompare(String(a.created_at)))[0];
    el('eaStats').innerHTML=`<div class="ea-stat"><small>หัวข้อทั้งหมด</small><b>${active.length}</b></div>
      <div class="ea-stat"><small>บันทึกการเข้าร่วม</small><b>${state.entries.length}</b></div>
      <div class="ea-stat"><small>เจ้าหน้าที่ที่เคยเข้าร่วม</small><b>${people}</b></div>
      <div class="ea-stat"><small>กิจกรรมล่าสุด</small><b class="ea-small-stat">${latest?`${esc(latest.participant_name)}<br>${fmt(latest.activity_date)}`:'ยังไม่มีข้อมูล'}</b></div>`;
    const topics=relevantTopics();
    el('eaTopicCards').innerHTML=topics.length?topics.map(renderTopicCard).join(''):
      '<div class="ea-empty">ไม่พบหัวข้อในตัวกรองนี้ · เพิ่มหัวข้อใหม่ได้จากแบบฟอร์มด้านบน</div>';
    const topicIds=new Set(topics.map(t=>t.id));
    const records=state.entries.filter(r=>topicIds.has(r.topic_id));
    el('eaEntryList').innerHTML=records.length?records.slice(0,120).map(renderEntry).join(''):
      '<div class="ea-empty">ยังไม่มีประวัติการเข้าร่วมในหัวข้อที่เลือก</div>';
    const latestThree=[...state.entries].sort((a,b)=>b.activity_date.localeCompare(a.activity_date)).slice(0,3);
    el('eaMiniText').innerHTML=`<b>${active.length}</b> หัวข้อ · <b>${people}</b> เจ้าหน้าที่ · <b>${state.entries.length}</b> ครั้ง`+
      (latestThree.length?`<div style="margin-top:8px">ล่าสุด: ${latestThree.map(r=>{
        const t=state.topics.find(x=>x.id===r.topic_id);
        return `${esc(r.participant_name)} (${esc(t?.title||'กิจกรรม')}, ${fmt(r.activity_date)})`;
      }).join(' • ')}</div>`:'<div style="margin-top:8px">ยังไม่มีบันทึกการเข้าร่วม</div>');
  }
  function toFormTop(){el('eaTopicForm').scrollIntoView({behavior:'smooth',block:'center'});}
  function toFormEntry(){el('eaEntryForm').scrollIntoView({behavior:'smooth',block:'center'});}
  async function delegateAction(e){
    const b=e.target.closest('button[data-ea-action]');if(!b||!state.user)return;
    const action=b.dataset.eaAction,id=b.dataset.id;
    if(action==='join'){
      const t=state.topics.find(x=>x.id===id);if(!t)return;
      resetEntry();el('eaEntryCategory').value=t.category;fillTopicOptions();el('eaEntryTopic').value=t.id;toFormEntry();return;
    }
    if(action==='edit-topic'){
      const t=state.topics.find(x=>x.id===id);if(!t)return;
      resetTopic();state.editingTopic=t.id;
      el('eaTopicCategory').value=t.category;el('eaTopicTitle').value=t.title;
      el('eaTopicDescription').value=t.description||'';
      el('eaTopicHeading').textContent='แก้ไขหัวข้อกิจกรรม';el('eaTopicSave').textContent='บันทึกการแก้ไข';
      el('eaTopicCancel').hidden=false;toFormTop();return;
    }
    if(action==='edit-entry'){
      const r=state.entries.find(x=>x.id===id);if(!r)return;
      const t=state.topics.find(x=>x.id===r.topic_id);if(!t)return;
      resetEntry();state.editingEntry=r.id;
      el('eaEntryCategory').value=t.category;fillTopicOptions();el('eaEntryTopic').value=t.id;
      el('eaDate').value=r.activity_date;el('eaEndDate').value=r.end_date||'';
      el('eaVenue').value=r.venue||'';el('eaNote').value=r.note||'';
      el('eaEntryHeading').textContent=`แก้ไขรายการ: ${r.participant_name}`;
      el('eaEntrySubtitle').textContent='ทุกคนแก้ไขข้อมูลรายการได้ แต่ไม่สามารถเปลี่ยนเจ้าของประวัติได้';
      el('eaEntrySave').textContent='บันทึกการแก้ไข';el('eaEntryCancel').hidden=false;toFormEntry();return;
    }
    if(action==='delete-topic'||action==='delete-entry'){
      const isTopic=action==='delete-topic';
      const item=isTopic?state.topics.find(x=>x.id===id):state.entries.find(x=>x.id===id);
      if(!item)return;
      const promptText=isTopic?
        `ลบหัวข้อ “${item.title}” จาก Dashboard? ประวัติการเข้าร่วมเดิมจะเก็บไว้ในระบบ แต่ถูกซ่อนจากหน้ารายการ`:
        `ลบรายการของ “${item.participant_name}” วันที่ ${fmt(item.activity_date)}? รายการจะถูกซ่อน แต่มีบันทึกการแก้ไขไว้`;
      if(!window.confirm(promptText))return;
      b.disabled=true;
      try{
        const tbl=isTopic?'ems_activity_topics':'ems_activity_entries';
        const {data,error}=await state.sb.from(tbl).update({deleted_at:new Date().toISOString()}).eq('id',id).select('id').single();
        if(error)throw error;if(!data)throw Error('ไม่พบรายการที่จะลบ');
        notify('นำรายการออกจาก Dashboard แล้ว');
        if(isTopic&&state.editingTopic===id)resetTopic();
        if(!isTopic&&state.editingEntry===id)resetEntry();
        await refresh();
      }catch(err){errReport(err);}finally{b.disabled=false;}
    }
  }
  async function onLogin(sb,user,profile){
    if(!sb||!user||!profile||profile.approval_status!=='approved')return;
    mount();state.sb=sb;state.user=user;state.profile=profile;
    resetEntry();await refresh();
  }
  function onLogout(){
    state.request++;
    state.sb=null;state.user=null;state.profile=null;state.topics=[];state.entries=[];
    if(el('eaMiniText'))el('eaMiniText').textContent='กรุณาเข้าสู่ระบบ';
    if(el('eaTopicCards'))el('eaTopicCards').textContent='';
    if(el('eaEntryList'))el('eaEntryList').textContent='';
    if(state.mounted){resetTopic();resetEntry();}
  }
  window.EMS_ACTIVITIES={onLogin,onLogout,refresh};
})();
