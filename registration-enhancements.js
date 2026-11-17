/* EMS Suandok – Registration enhancements v1
 * Add Driver to registration profession list.
 * Accessible show/hide password control for registration.
 * Additive enhancement: does not modify authentication or Supabase logic.
 */
(() => {
  'use strict';

  const ICON_EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.5 10.5 0 0 1 12 5c6.3 0 10 7 10 7a13.8 13.8 0 0 1-3.1 3.8"/><path d="M6.2 6.2C3.6 8.1 2 12 2 12s3.7 7 10 7c1.6 0 3-.4 4.2-1"/><path d="M10 10a3 3 0 0 0 4 4"/></svg>';

  function addDriverOption() {
    const select = document.getElementById('regPosition');
    if (!select) return;
    if (!Array.from(select.options).some(option => option.value === 'Driver')) {
      const option = new Option('Driver (พนักงานขับรถ)', 'Driver');
      select.add(option);
    }
  }

  function addPasswordToggle(id) {
    const input = document.getElementById(id);
    if (!input || input.dataset.emsEyeInstalled === '1') return;
    if (input.type !== 'password' && input.type !== 'text') return;

    // The input lives inside a form label in the existing site. Keeping the
    // button beside it preserves form submission, validation and autocomplete.
    const wrapper = document.createElement('span');
    wrapper.className = 'ems-password-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ems-password-eye';
    button.setAttribute('aria-label', 'แสดงรหัสผ่าน');
    button.setAttribute('title', 'แสดงรหัสผ่าน');
    button.setAttribute('aria-pressed', 'false');
    button.innerHTML = ICON_EYE;
    button.addEventListener('click', event => {
      event.preventDefault();
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-label', visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      button.setAttribute('title', visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      button.setAttribute('aria-pressed', String(visible));
      button.innerHTML = visible ? ICON_EYE_OFF : ICON_EYE;
      input.focus({ preventScroll: true });
    });
    wrapper.appendChild(button);
    input.dataset.emsEyeInstalled = '1';
  }

  function init() {
    addDriverOption();
    addPasswordToggle('regPassword');
  }

  const style = document.createElement('style');
  style.textContent = `
    .ems-password-wrapper { display:block; position:relative; width:100%; }
    .ems-password-wrapper > input { width:100%; padding-right:52px !important; }
    .ems-password-eye { position:absolute; right:5px; top:50%; transform:translateY(-50%);
      display:flex; align-items:center; justify-content:center; width:40px; height:40px;
      background:transparent; border:0; border-radius:8px; color:#47657d;
      cursor:pointer; padding:0; }
    .ems-password-eye:hover { background:#edf5fa; }
    .ems-password-eye:focus-visible { outline:2px solid #177ea3; outline-offset:1px; }
    @media print { .ems-password-eye { display:none !important; } }
  `;
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once:true });
  } else {
    init();
  }
})();
