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
  function apply(theme) { theme = valid(theme); document.documentElement.dataset.theme = theme; document.documentElement.style.setProperty('--theme-name', theme); document.querySelectorAll('[data-theme-select]').forEach(function (s) { s.value = theme; }); window.dispatchEvent(new CustomEvent('site-theme-change', { detail: { theme: theme } })); }
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
