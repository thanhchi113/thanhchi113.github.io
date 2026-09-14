/* File-list adapters. All mutations keep the signed-in admin's existing RLS. */
(() => {
    'use strict';
    if (!window.AdminBulkActions) return;
    const controllers = [];
    const labels = {
        publish: 'Hiển thị', hide: 'Ẩn', delete: 'Xóa vĩnh viễn',
        move: 'Chuyển danh mục', unlock: 'Mở khóa code', lock: 'Khóa code',
        approve: 'Duyệt yêu cầu', reject: 'Từ chối yêu cầu'
    };
    const categoryOptions = () => state.categories.map(row => ({ value: String(row.id), label: row.name }));
    const action = id => ({ id, label: labels[id], danger: id === 'delete' });
    const fileActions = () => ['publish', 'hide', 'delete'].map(action);
    const moveCategory = () => ({ ...action('move'), options: categoryOptions() });
    const canRun = () => Boolean(verifiedAdminId) && !$('adminPanel').classList.contains('hidden');

    function category(value) {
        const result = state.categories.find(row => String(row.id) === String(value));
        if (!result) throw new Error('Hãy chọn danh mục đích hợp lệ.');
        return result;
    }

    async function update(table, row, patch) {
        if (!canRun()) throw new Error('Phiên quản trị đã kết thúc. Hãy đăng nhập lại.');
        const values = { ...patch, updated_at: new Date().toISOString() };
        const { data, error } = await supabaseClient.from(table).update(values).eq('id', row.id).select('id').single();
        if (error) throw error;
        if (!data?.id) throw new Error('Mục không còn tồn tại hoặc bạn không có quyền chỉnh sửa.');
        Object.assign(row, values);
        const collection = {
            math_documents: state.documents, tikz_drawings: state.tikz,
            achievement_evidence: state.evidence, document_contributions: state.documentContributions,
            math_requests: state.materialRequests
        }[table];
        const current = collection?.find(item => String(item.id) === String(row.id));
        if (current) Object.assign(current, values);
    }

    async function remove(table, row, bucket, fields, resetEditor) {
        if (!canRun()) throw new Error('Phiên quản trị đã kết thúc. Hãy đăng nhập lại.');
        // Use paths returned by DELETE, not stale list data. Never remove a file
        // before the database confirms that its selected record was deleted.
        const { data, error } = await supabaseClient.from(table).delete().eq('id', row.id)
            .select(['id', ...fields].join(',')).single();
        if (error) throw error;
        if (!data?.id) throw new Error('Chưa xác nhận được mục đã xóa. Hãy tải lại danh sách.');
        resetEditor?.(data.id);
        const paths = [...new Set(fields.map(field => data[field]).filter(Boolean))];
        if (!bucket || !paths.length) return;
        try {
            const { error: storageError } = await supabaseClient.storage.from(bucket).remove(paths);
            if (storageError) throw storageError;
        } catch (storageError) {
            return { warning: `Đã xóa mục khỏi danh sách nhưng chưa xóa được tệp trong kho (${paths.join(', ')}): ${storageError.message || 'Lỗi kết nối'}` };
        }
    }

    function mount(config) {
        const list = $(config.listId);
        if (!list) return;
        const { listId, elementAttribute, ...options } = config;
        controllers.push(window.AdminBulkActions.create({
            ...options, list, canRun,
            getTitle: row => row.title || row.file_name || row.name || 'Không có tiêu đề',
            getElementId: element => element.getAttribute(elementAttribute)
                || element.querySelector(`[${elementAttribute}]`)?.getAttribute(elementAttribute)
        }));
    }

    mount({
        key: 'documents', listId: 'adminList', rowSelector: '.admin-doc', elementAttribute: 'data-doc-id',
        getRows: getFilteredDocs,
        actions: () => [moveCategory(), ...fileActions()],
        async perform(id, row, value) {
            if (id === 'delete') return remove('math_documents', row, 'math-pdfs', ['file_path'], deletedId => {
                if (String(state.editingId) === String(deletedId)) resetForm();
            });
            if (id === 'move') {
                const target = category(value);
                if (String(row.category_id) === String(target.id)) return;
                const nextOrder = state.documents.filter(doc => String(doc.category_id) === String(target.id))
                    .reduce((max, doc) => Math.max(max, Number(doc.sort_order) || 0), 0) + 1;
                await update('math_documents', row, { category_id: target.id, sort_order: nextOrder });
                row.math_categories = { name: target.name, slug: target.slug };
                const current = state.documents.find(doc => String(doc.id) === String(row.id));
                if (current) current.math_categories = row.math_categories;
                return;
            }
            if (id === 'publish' || id === 'hide') return update('math_documents', row, { published: id === 'publish' });
            throw new Error('Thao tác không hợp lệ.');
        },
        async reload() { await loadDocs(); renderCategoryManager(); }
    });

    mount({
        key: 'tikz', listId: 'tikzAdminList', rowSelector: '.admin-doc', elementAttribute: 'data-tikz-edit',
        getRows: () => {
            const query = ($('tikzAdminSearch')?.value || '').trim().toLowerCase();
            return state.tikz.filter(row => !query || [row.title, row.description, row.tags, row.code].filter(Boolean).join(' ').toLowerCase().includes(query));
        },
        actions: () => [...fileActions(), action('unlock'), action('lock')],
        async perform(id, row) {
            if (id === 'delete') return remove('tikz_drawings', row, TIKZ_RENDER_BUCKET, ['render_path'], deletedId => {
                if (String(state.editingTikzId) === String(deletedId)) resetTikzForm();
            });
            if (id === 'publish' || id === 'hide') return update('tikz_drawings', row, { published: id === 'publish' });
            if (id === 'unlock' || id === 'lock') return update('tikz_drawings', row, { code_unlocked: id === 'unlock' });
            throw new Error('Thao tác không hợp lệ.');
        },
        reload: loadTikzAdmin
    });

    mount({
        key: 'pdf-contributions', listId: 'pdfContributionList', rowSelector: '.review-item', elementAttribute: 'data-pdf-contribution-delete',
        getRows: () => {
            if (state.documentContributionSetupError) return [];
            const filter = $('pdfContributionFilter')?.value || 'pending';
            return state.documentContributions.filter(row => filter === 'all' || row.status === filter);
        },
        actions: () => [moveCategory(), action('delete')],
        async perform(id, row, value) {
            if (id === 'delete') return remove('document_contributions', row, 'document-submissions', ['file_path']);
            if (id === 'move') {
                if (row.status === 'approved') throw new Error('PDF đã được duyệt. Hãy chuyển tài liệu đã đăng tại mục Tài liệu PDF.');
                const target = category(value);
                return update('document_contributions', row, { category_id: target.id });
            }
            throw new Error('Thao tác không hợp lệ.');
        },
        async reload() { await loadDocumentContributions(); if (state.documentContributionSetupError) throw state.documentContributionSetupError; }
    });

    mount({
        key: 'requests', listId: 'materialRequestList', rowSelector: '.review-item', elementAttribute: 'data-request-delete',
        getRows: () => {
            if (state.requestSetupError) return [];
            const filter = $('materialRequestFilter')?.value || 'pending';
            return state.materialRequests.filter(row => filter === 'all' || row.status === filter);
        },
        actions: () => [action('approve'), action('reject'), moveCategory(), action('delete')],
        async perform(id, row, value) {
            if (id === 'delete') return remove('math_requests', row, null, []);
            if (id === 'move') return update('math_requests', row, { category_id: category(value).id });
            if (id === 'approve' || id === 'reject') return update('math_requests', row, {
                status: id === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString()
            });
            throw new Error('Thao tác không hợp lệ.');
        },
        async reload() { await loadMaterialRequests(); if (state.requestSetupError) throw state.requestSetupError; }
    });

    window.adminFileBulk = {
        clear() { controllers.forEach(controller => controller.clear()); },
        sync() { controllers.forEach(controller => controller.sync()); }
    };
    new MutationObserver(() => { if (!canRun()) window.adminFileBulk.clear(); else window.adminFileBulk.sync(); })
        .observe($('adminPanel'), { attributes: true, attributeFilter: ['class'] });
})();
