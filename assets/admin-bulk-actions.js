/* Shared, scoped selection and batch actions for admin lists. */
(function () {
  'use strict';

  const instances = new WeakMap();

  function create(config) {
    const list = config.list;
    if (!(list instanceof HTMLElement)) throw new Error('Thiếu danh sách thao tác.');
    if (instances.has(list)) return instances.get(list);

    const selected = new Set();
    let busy = false;
    let generation = 0;
    let actionDefinitions = [];
    const getId = row => String(config.getId ? config.getId(row) : row.id);
    const getTitle = row => String(config.getTitle ? config.getTitle(row) : (row.title || row.name || row.id));
    const allowed = () => {
      try { return !config.canRun || Boolean(config.canRun()); } catch (_) { return false; }
    };
    const eligible = () => {
      const rows = config.getRows() || [];
      return new Map(rows.map(row => [getId(row), row]));
    };
    const element = (tag, className, text) => {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const button = (text, className) => {
      const node = element('button', 'admin-bulk-button' + (className ? ' ' + className : ''), text);
      node.type = 'button';
      return node;
    };
    const toolbar = element('section', 'admin-bulk-toolbar');
    toolbar.dataset.bulkKey = config.key || '';
    toolbar.setAttribute('aria-label', 'Chọn nhiều mục và thao tác hàng loạt');
    const fields = element('fieldset', 'admin-bulk-fields');
    fields.append(element('legend', 'admin-bulk-sr-only', 'Thao tác trên các mục đã chọn'));
    const selectionLine = element('div', 'admin-bulk-selection');
    const pageLabel = element('label', 'admin-bulk-page-label');
    const pageCheck = element('input');
    pageCheck.type = 'checkbox';
    pageCheck.dataset.bulkAction = 'page';
    pageCheck.setAttribute('aria-label', 'Chọn tất cả mục ở trang hiện tại');
    pageLabel.append(pageCheck, element('span', '', 'Chọn trang này'));
    const count = element('span', 'admin-bulk-count');
    const allButton = button('Chọn tất cả');
    const clearButton = button('Bỏ chọn');
    allButton.dataset.bulkAction = 'all';
    clearButton.dataset.bulkAction = 'clear';
    selectionLine.append(pageLabel, count, allButton, clearButton);
    const actionLine = element('div', 'admin-bulk-actions');
    const actionSelect = element('select', 'admin-bulk-select');
    actionSelect.dataset.bulkAction = 'action';
    actionSelect.setAttribute('aria-label', 'Thao tác với các mục đã chọn');
    const destinationSelect = element('select', 'admin-bulk-select admin-bulk-destination');
    destinationSelect.dataset.bulkAction = 'destination';
    destinationSelect.setAttribute('aria-label', 'Chọn nơi di chuyển đến');
    const applyButton = button('Áp dụng', 'admin-bulk-apply');
    applyButton.dataset.bulkAction = 'apply';
    actionLine.append(actionSelect, destinationSelect, applyButton);
    fields.append(selectionLine, actionLine);
    const status = element('p', 'admin-bulk-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const details = element('details', 'admin-bulk-details');
    details.hidden = true;
    toolbar.append(fields, status, details);
    list.before(toolbar);

    function pageRows() {
      const rows = eligible();
      return Array.from(list.children).filter(node => node.matches(config.rowSelector)).map(node => ({
        node,
        id: String(config.getElementId(node))
      })).filter(item => rows.has(item.id));
    }

    function addOptions(select, options, placeholder, previous) {
      select.replaceChildren();
      const first = element('option', '', placeholder);
      first.value = '';
      select.append(first);
      for (const option of options) {
        const node = element('option', '', option.label);
        node.value = String(option.value);
        select.append(node);
      }
      select.value = options.some(option => String(option.value) === previous) ? previous : '';
    }

    function syncActions() {
      const previousAction = actionSelect.value;
      const previousDestination = destinationSelect.value;
      actionDefinitions = config.actions() || [];
      addOptions(actionSelect, actionDefinitions.map(action => ({ value: action.id, label: action.label })), 'Chọn thao tác…', previousAction);
      const action = actionDefinitions.find(item => item.id === actionSelect.value);
      destinationSelect.hidden = !action || !Array.isArray(action.options);
      addOptions(destinationSelect, action?.options || [], 'Chọn nơi chuyển đến…', previousDestination);
      const validDestination = !action?.options || action.options.some(option => String(option.value) === destinationSelect.value);
      applyButton.disabled = busy || !allowed() || !selected.size || !action || !validDestination;
      applyButton.classList.toggle('admin-bulk-danger', Boolean(action?.danger));
    }

    function sync() {
      const rows = eligible();
      if (!allowed()) selected.clear();
      for (const id of selected) if (!rows.has(id)) selected.delete(id);
      const visible = pageRows();
      for (const { node, id } of visible) {
        node.classList.add('admin-bulk-row');
        node.classList.toggle('admin-bulk-selected', selected.has(id));
        let label = Array.from(node.children).find(child => child.classList.contains('admin-bulk-row-check'));
        if (!label) {
          label = element('label', 'admin-bulk-row-check');
          const checkbox = element('input');
          checkbox.type = 'checkbox';
          checkbox.dataset.bulkAction = 'row';
          label.append(checkbox);
          label.addEventListener('click', event => event.stopPropagation());
          checkbox.addEventListener('change', () => {
            if (busy || !allowed()) return sync();
            const currentId = String(config.getElementId(node));
            if (!eligible().has(currentId)) return sync();
            if (checkbox.checked) selected.add(currentId); else selected.delete(currentId);
            sync();
          });
          node.append(label);
        }
        const checkbox = label.querySelector('input');
        checkbox.checked = selected.has(id);
        checkbox.disabled = busy || !allowed();
        checkbox.setAttribute('aria-label', 'Chọn ' + getTitle(rows.get(id)));
      }
      const checkedOnPage = visible.filter(item => selected.has(item.id)).length;
      pageCheck.checked = visible.length > 0 && checkedOnPage === visible.length;
      pageCheck.indeterminate = checkedOnPage > 0 && checkedOnPage < visible.length;
      pageCheck.disabled = busy || !allowed() || !visible.length;
      count.textContent = 'Đã chọn ' + selected.size + '/' + rows.size + ' mục';
      allButton.textContent = 'Chọn tất cả ' + rows.size + ' mục';
      allButton.disabled = busy || !allowed() || !rows.size || selected.size === rows.size;
      clearButton.disabled = busy || !selected.size;
      fields.disabled = busy || !allowed();
      applyButton.textContent = busy ? 'Đang xử lý…' : 'Áp dụng';
      syncActions();
    }

    function reportDetails(failures, warnings) {
      details.replaceChildren();
      details.hidden = !failures.length && !warnings.length;
      if (details.hidden) return;
      details.append(element('summary', '', 'Xem chi tiết ' + (failures.length + warnings.length) + ' mục cần lưu ý'));
      const items = element('ul');
      for (const item of failures) items.append(element('li', '', item.title + ': ' + item.message));
      for (const item of warnings) items.append(element('li', '', item.title + ': ' + item.message));
      details.append(items);
    }

    async function run() {
      if (busy || !allowed()) return;
      sync();
      const action = actionDefinitions.find(item => item.id === actionSelect.value);
      if (!action || !selected.size) return;
      const optionValue = destinationSelect.value;
      const option = action.options?.find(item => String(item.value) === optionValue);
      if (action.options && !option) return;
      const snapshot = Array.from(eligible()).filter(([id]) => selected.has(id)).map(([id, row]) => ({ id, row: { ...row }, title: getTitle(row) }));
      if (!snapshot.length) return;
      const confirmation = action.label + ' ' + snapshot.length + ' mục đã chọn' + (option ? ' vào “' + option.label + '”' : '') + '?' + (action.danger ? '\nCác mục đã chọn và tệp đính kèm sẽ bị xóa vĩnh viễn, không thể hoàn tác.' : '');
      if (!window.confirm(confirmation) || !allowed()) return;
      busy = true;
      const runGeneration = generation;
      const previousInert = list.inert;
      const previousAriaBusy = list.getAttribute('aria-busy');
      list.inert = true;
      list.setAttribute('aria-busy', 'true');
      list.classList.add('admin-bulk-working');
      const failures = [];
      const warnings = [];
      let successes = 0;
      let processed = 0;
      let reloadError = '';
      details.hidden = true;
      sync();
      try {
        for (const item of snapshot) {
          if (runGeneration !== generation || !allowed()) break;
          // Only the confirmed snapshot is processed, even if filters change mid-batch.
          status.textContent = 'Đang xử lý ' + (processed + 1) + '/' + snapshot.length + ': ' + item.title;
          try {
            const result = await config.perform(action.id, item.row, optionValue);
            successes++;
            selected.delete(item.id);
            if (result?.warning) warnings.push({ title: item.title, message: String(result.warning) });
          } catch (error) {
            failures.push({ title: item.title, message: String(error?.message || error || 'Không thể hoàn tất thao tác.') });
          }
          processed++;
        }
      } catch (error) {
        failures.push({ title: 'Danh sách', message: String(error?.message || error) });
      } finally {
        // Never retry a completed mutation if refreshing the list fails.
        if (runGeneration === generation && allowed()) {
          try { await config.reload(); } catch (error) { reloadError = String(error?.message || error); }
        }
        busy = false;
        list.inert = previousInert;
        if (previousAriaBusy === null) list.removeAttribute('aria-busy'); else list.setAttribute('aria-busy', previousAriaBusy);
        list.classList.remove('admin-bulk-working');
        sync();
      }
      if (runGeneration !== generation) return;
      const skipped = snapshot.length - processed;
      const parts = [successes ? 'Đã xử lý ' + successes + '/' + snapshot.length + ' mục.' : 'Chưa xử lý thành công mục nào.'];
      if (failures.length) parts.push(failures.length + ' mục chưa thành công; các mục còn trong danh sách vẫn được chọn để bạn kiểm tra.');
      if (skipped) parts.push('Đã dừng; ' + skipped + ' mục chưa được xử lý. Hãy kiểm tra phiên đăng nhập.');
      if (warnings.length) parts.push(warnings.length + ' mục có lưu ý.');
      if (reloadError) parts.push('Chưa tải lại được danh sách: ' + reloadError + '. Các mục đã xử lý sẽ không được thực hiện lại.');
      status.textContent = parts.join(' ');
      status.classList.toggle('admin-bulk-has-errors', Boolean(failures.length || warnings.length || skipped || reloadError));
      reportDetails(failures, warnings);
      if (config.onComplete) {
        try { config.onComplete({ actionId: action.id, succeeded: successes, failed: failures, skipped, warnings, reloadError }); } catch (_) { /* The completed batch remains successful. */ }
      }
    }

    pageCheck.addEventListener('change', () => {
      if (busy || !allowed()) return sync();
      for (const { id } of pageRows()) if (pageCheck.checked) selected.add(id); else selected.delete(id);
      sync();
    });
    allButton.addEventListener('click', () => {
      if (busy || !allowed()) return;
      for (const id of eligible().keys()) selected.add(id);
      sync();
    });
    clearButton.addEventListener('click', () => { if (!busy) api.clear(); });
    actionSelect.addEventListener('change', () => { destinationSelect.value = ''; syncActions(); });
    destinationSelect.addEventListener('change', syncActions);
    applyButton.addEventListener('click', run);
    // Inert blocks keyboard and pointer input, including existing row action handlers.
    list.addEventListener('click', event => { if (busy) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
    list.addEventListener('dragstart', event => { if (busy) event.preventDefault(); }, true);
    const observer = new MutationObserver(sync);
    observer.observe(list, { childList: true });
    const api = {
      sync,
      clear() {
        generation++;
        selected.clear();
        status.textContent = '';
        status.classList.remove('admin-bulk-has-errors');
        details.hidden = true;
        sync();
      },
      get busy() { return busy; }
    };
    instances.set(list, api);
    sync();
    return api;
  }

  window.AdminBulkActions = { create };
})();
