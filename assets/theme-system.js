(function () {
  'use strict';
  var palettes = {
    creative: 'Sáng tạo hồng–cam',
    aurora: 'Cực quang xanh–tím',
    ocean: 'Đại dương',
    violet: 'Tím đêm',
    ember: 'Than hồng'
  };
  var userKey = 'site-theme-user';
  var defaultKey = 'site-theme-default';
  var isAdmin = /(^|\/)admin\.html$/i.test(location.pathname);
  function valid(value) { return Object.prototype.hasOwnProperty.call(palettes, value) ? value : 'creative'; }
  function getDefault() { try { return valid(localStorage.getItem(defaultKey) || 'creative'); } catch (_) { return 'creative'; } }
  function getUser() { try { return localStorage.getItem(userKey); } catch (_) { return null; } }
  function apply(theme) {
    theme = valid(theme);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--theme-name', theme);
    // Inline page styles contain many legacy colour literals.  Keep one late
    // override sheet so a palette change is visible immediately everywhere.
    var palette = {
      creative: ['#0b1020','#111827','#1f2937','#ff2d7a','#ff3b5c','#ff6b3d','#ffc24b','#f8fafc','#94a3b8'],
      aurora: ['#071526','#0e2237','#163a55','#39e6c3','#36a3ff','#8b5cf6','#b7f7ff','#effcff','#8eb4c8'],
      ocean: ['#06131d','#0b2634','#103d4b','#22d3ee','#14b8a6','#38bdf8','#facc15','#effcff','#8bb4bd'],
      violet: ['#100b24','#1b123b','#2d1f52','#c084fc','#a855f7','#ec4899','#f0abfc','#faf5ff','#b7a7d4'],
      ember: ['#1a0f0b','#2a1711','#472318','#fb923c','#ef4444','#f59e0b','#fde047','#fff7ed','#c6a58d']
    }[theme];
    var id = 'site-theme-runtime-overrides';
    var style = document.getElementById(id) || document.createElement('style');
    style.id = id;
    style.textContent = ':root{--theme-bg:'+palette[0]+';--theme-panel:'+palette[1]+';--theme-surface:'+palette[2]+';--theme-accent:'+palette[3]+';--theme-accent-2:'+palette[4]+';--theme-accent-3:'+palette[5]+';--theme-highlight:'+palette[6]+';--theme-text:'+palette[7]+';--theme-muted:'+palette[8]+'}'+
      'body{background-color:'+palette[0]+' !important;color:'+palette[7]+' !important}'+
      '.site-nav,.admin-nav,.evidence-nav,.navbar,.topbar{background:linear-gradient(110deg,'+palette[1]+'ee,'+palette[0]+'e8) !important;border-color:'+palette[3]+'55 !important}'+
      '.card,.project-card,.document-card,.document-category-card,.evidence-card,.achievement-card,.achievement-card-large,.skill-card,.skill-item,.highlight-item,.about-content,.contact-item,.tikz-card,.tikz-project-card,.exam-student-card,.admin-card,.admin-doc,.modal-card,.workspace-tabs,.workspace-panel,.glass-card{background:linear-gradient(145deg,'+palette[1]+'ee,'+palette[0]+'dd) !important;border-color:'+palette[3]+'66 !important;color:'+palette[7]+' !important}'+
      '.card h1,.card h2,.card h3,.card h4,.card p,.project-card h3,.project-card p,.document-card h3,.document-card p,.document-category-card h3,.document-category-card p,.achievement-card-large h3,.achievement-card-large p,.skill-item h3,.skill-item p,.admin-card h1,.admin-card h2,.admin-card h3,.admin-card p,.admin-doc h3,.admin-doc p{color:'+palette[7]+' !important}'+
      '.admin-taskbar,.admin-taskbar-btn,#siteHeader,.site-nav,.admin-nav,.topbar{background:linear-gradient(110deg,'+palette[1]+'f2,'+palette[0]+'e8) !important;border-color:'+palette[3]+'66 !important;color:'+palette[7]+' !important}'+
      '.admin-taskbar-btn,.admin-nav a,#siteHeader .nav-link{color:'+palette[7]+' !important}'+
      '.admin-taskbar-btn:hover,.admin-taskbar-btn.active,#siteHeader .nav-link.active{color:'+palette[6]+' !important;border-color:'+palette[3]+'aa !important}'+
      'a,.nav-link,.document-action,.project-link,.evidence-type,.kicker,.admin-section-title,.section-kicker{color:'+palette[3]+' !important}'+
      'button,.btn,.admin-btn,.cta,.page-btn.active,.workspace-tab.active{background:linear-gradient(135deg,'+palette[3]+','+palette[5]+') !important;border-color:'+palette[3]+'99 !important;color:'+palette[7]+' !important}'+
      'input,textarea,select,.admin-filter,.admin-search{background:'+palette[0]+'cc !important;color:'+palette[7]+' !important;border-color:'+palette[3]+'55 !important}'+
      '.muted,.admin-status,.document-card p,.evidence-content p,.stat-label,.section-title p,.admin-help,.admin-form label,.field-label{color:'+palette[8]+' !important}'+
      '.theme-switcher{background:'+palette[1]+'ee !important;border-color:'+palette[3]+'88 !important}';
    if (!style.parentNode) document.head.appendChild(style);
    document.querySelectorAll('[data-theme-select]').forEach(function (s) { s.value = theme; });
    window.dispatchEvent(new CustomEvent('site-theme-change', { detail: { theme: theme } }));
  }
  function save(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function makeSwitcher(admin) {
    var box = document.createElement('div'); box.className = 'theme-switcher' + (admin ? ' admin-theme-switcher' : ''); box.setAttribute('role','region'); box.setAttribute('aria-label','Bộ màu giao diện');
    var label = document.createElement('label'); label.textContent = admin ? 'Bộ màu mặc định' : 'Bộ màu';
    var select = document.createElement('select'); select.setAttribute('data-theme-select',''); select.setAttribute('aria-label','Chọn bộ màu');
    Object.keys(palettes).forEach(function (key) { var option=document.createElement('option'); option.value=key; option.textContent=palettes[key]; select.appendChild(option); });
    var button = document.createElement('button'); button.type='button'; button.textContent=admin ? 'Lưu mặc định' : 'Áp dụng';
    var state = document.createElement('span'); state.className='theme-state';
    select.addEventListener('change', function () { apply(select.value); if (!admin) { save(userKey, select.value); state.textContent='Đã lưu trên thiết bị'; } });
    button.addEventListener('click', function () { if (admin) { save(defaultKey, select.value); save(userKey, select.value); state.textContent='Đã đặt mặc định'; } else { save(userKey, select.value); state.textContent='Đã lưu trên thiết bị'; } apply(select.value); });
    box.append(label, select, button, state); return box;
  }
  function mount() {
    var current = getUser() || getDefault(); apply(current);
    var box = makeSwitcher(isAdmin);
    if (isAdmin) { var target = document.querySelector('.admin-page') || document.querySelector('main') || document.body; target.insertBefore(box, target.firstChild); }
    else document.body.appendChild(box);
    window.addEventListener('storage', function (event) { if (event.key === defaultKey && !getUser()) apply(event.newValue || 'creative'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.SiteTheme = { palettes: palettes, apply: apply, setDefault: function (theme) { save(defaultKey, valid(theme)); apply(theme); } };
}());
