// Cloudflare Worker: Document Upload Vault (R2 / KV + D1) & Automation Hub
// Lớp Toán Anh Chí — Thầy Huỳnh Thanh Chí

const VAULT_CIPHER_KEY = [
  0x4c, 0x54, 0x41, 0x43, 0x9a, 0x37, 0xe5, 0x6d,
  0xb2, 0x19, 0x8f, 0xc4, 0x53, 0x71, 0xa8, 0x2e,
];

const KV_SINGLE_LIMIT = 22 * 1024 * 1024; // 22 MiB per chunk (under 25 MiB KV limit)

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-CF-Upload-Key, X-Doc-Meta",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function jsonResp(data, status = 200, request = null, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(request ? corsHeaders(request) : { "Access-Control-Allow-Origin": "*" }),
      ...extraHeaders,
    },
  });
}

async function verifyUploadSecret(request, env) {
  const expected = env.UPLOAD_API_KEY;
  if (!expected) return false;
  let provided = request.headers.get("X-CF-Upload-Key") || "";
  if (!provided) {
    const auth = request.headers.get("Authorization") || "";
    if (auth.toLowerCase().startsWith("bearer ")) {
      provided = auth.slice(7).trim();
    }
  }
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(String(provided))),
    crypto.subtle.digest("SHA-256", encoder.encode(String(expected))),
  ]);
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function ensureLtacVaultBytes(arrayBuffer) {
  const src = new Uint8Array(arrayBuffer);
  if (
    src.length > 4 &&
    src[0] === 0x4c &&
    src[1] === 0x54 &&
    src[2] === 0x41 &&
    src[3] === 0x43
  ) {
    return src;
  }
  const out = new Uint8Array(src.length + 4);
  out[0] = 0x4c;
  out[1] = 0x54;
  out[2] = 0x41;
  out[3] = 0x43;
  for (let i = 0; i < src.length; i++) {
    out[i + 4] = src[i] ^ VAULT_CIPHER_KEY[i & 15] ^ ((i * 13) & 0xff);
  }
  return out;
}

function makeRandomToken(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

async function storeVaultBytes(env, key, vaultUint8) {
  if (env.DOCS_R2) {
    await env.DOCS_R2.put(key, vaultUint8, {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    return "r2";
  }
  if (vaultUint8.byteLength <= KV_SINGLE_LIMIT) {
    await env.DOCS_KV.put(key, vaultUint8, {
      metadata: { chunks: 1, size: vaultUint8.byteLength },
    });
    return "kv";
  }
  const totalChunks = Math.ceil(vaultUint8.byteLength / KV_SINGLE_LIMIT);
  for (let idx = 0; idx < totalChunks; idx++) {
    const slice = vaultUint8.subarray(idx * KV_SINGLE_LIMIT, (idx + 1) * KV_SINGLE_LIMIT);
    await env.DOCS_KV.put(`${key}:part${idx}`, slice);
  }
  await env.DOCS_KV.put(key, new Uint8Array(0), {
    metadata: { chunks: totalChunks, size: vaultUint8.byteLength },
  });
  return "kv";
}

async function deleteVaultBytes(env, key) {
  if (!key) return;
  try {
    if (env.DOCS_R2) {
      await env.DOCS_R2.delete(key);
    }
    if (env.DOCS_KV) {
      const { metadata } = await env.DOCS_KV.getWithMetadata(key, { type: "text" });
      const chunks = Number(metadata?.chunks || 1);
      if (chunks > 1) {
        for (let i = 0; i < chunks; i++) {
          await env.DOCS_KV.delete(`${key}:part${i}`);
        }
      }
      await env.DOCS_KV.delete(key);
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "delete_vault_error", key, error: String(err) }));
  }
}

async function streamVaultResponse(env, ctx, key, request) {
  if (!key) return jsonResp({ ok: false, error: "missing_storage_path" }, 404, request);

  const baseHeaders = {
    ...corsHeaders(request),
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
    "X-Vault-Format": "LTAC",
  };

  if (env.DOCS_R2) {
    const obj = await env.DOCS_R2.get(key);
    if (obj && obj.body) {
      return new Response(obj.body, { status: 200, headers: baseHeaders });
    }
  }

  if (env.DOCS_KV) {
    const { value: firstStream, metadata } = await env.DOCS_KV.getWithMetadata(key, {
      type: "stream",
      cacheTtl: 86400,
    });
    const chunks = Number(metadata?.chunks || 1);
    if (chunks <= 1) {
      if (!firstStream) return jsonResp({ ok: false, error: "object_not_found" }, 404, request);
      return new Response(firstStream, { status: 200, headers: baseHeaders });
    }

    const { readable, writable } = new TransformStream();
    ctx.waitUntil(
      (async () => {
        try {
          for (let i = 0; i < chunks; i++) {
            const partStream = await env.DOCS_KV.get(`${key}:part${i}`, {
              type: "stream",
              cacheTtl: 86400,
            });
            if (partStream) {
              await partStream.pipeTo(writable, { preventClose: true });
            }
          }
          await writable.close();
        } catch (err) {
          console.error(JSON.stringify({ event: "kv_chunk_stream_error", key, error: String(err) }));
          try { await writable.abort(err); } catch {}
        }
      })()
    );
    return new Response(readable, { status: 200, headers: baseHeaders });
  }

  return jsonResp({ ok: false, error: "no_storage_bound" }, 500, request);
}

function mapDocRow(row) {
  return {
    id: row.id,
    title: row.title,
    cat: row.cat,
    badge: row.badge || "TÀI LIỆU MỚI",
    accent: row.accent || "#650f12",
    pages: Number(row.pages) || 4,
    desc: row.description || "",
    svgType: row.svg_type || "pdf_a4",
    storagePath: row.storage_path || null,
    ansStoragePath: row.ans_storage_path || null,
    storageBackend: row.storage_backend || "kv",
    allowDownload: Boolean(row.allow_download),
    hasUploadedPdf: Boolean(row.has_uploaded_pdf || row.storage_path),
    status: row.status || "published",
    sourcePipeline: row.source_pipeline || "manual",
    sourceRef: row.source_ref || null,
    fileSize: Number(row.file_size || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getAutomationConfig(env) {
  const row = await env.DOCS_DB.prepare("SELECT * FROM automation_config WHERE id = 'main'").first();
  if (!row) {
    return {
      publishMode: "published",
      variantMode: "de_only",
      allowDownloadDefault: false,
      enableToanmath: true,
      enableFbLatex: true,
      enableToan12: true,
    };
  }
  return {
    publishMode: row.publish_mode || "published",
    variantMode: row.variant_mode || "de_only",
    allowDownloadDefault: Boolean(row.allow_download_default),
    enableToanmath: row.enable_toanmath !== 0,
    enableFbLatex: row.enable_fb_latex !== 0,
    enableToan12: row.enable_toan12 !== 0,
    updatedAt: row.updated_at,
  };
}

async function upsertSingleDocument(env, meta, fileBuf, ansBuf) {
  const now = new Date().toISOString();
  const sourceRef = meta.sourceRef ? String(meta.sourceRef).trim() : null;

  let existing = null;
  if (meta.id) {
    existing = await env.DOCS_DB.prepare("SELECT * FROM pdf_documents WHERE id = ?")
      .bind(String(meta.id).trim())
      .first();
  }
  if (!existing && sourceRef) {
    existing = await env.DOCS_DB.prepare("SELECT * FROM pdf_documents WHERE source_ref = ?")
      .bind(sourceRef)
      .first();
  }

  const docId = existing
    ? existing.id
    : String(meta.id || "").trim() || `DOC_${Date.now().toString(36).toUpperCase()}_${makeRandomToken(4).toUpperCase()}`;

  let storagePath = existing ? existing.storage_path : (meta.storagePath || null);
  let ansStoragePath = existing ? existing.ans_storage_path : null;
  let storageBackend = existing ? (existing.storage_backend || "kv") : (env.DOCS_R2 ? "r2" : "kv");
  let fileSize = existing ? Number(existing.file_size || 0) : 0;

  if (fileBuf && fileBuf.byteLength > 0) {
    const vaultBytes = ensureLtacVaultBytes(fileBuf);
    const newKey = `cfvault_${docId}_${makeRandomToken(10)}.bin`;
    storageBackend = await storeVaultBytes(env, newKey, vaultBytes);
    if (existing && existing.storage_path && existing.storage_path !== newKey && existing.storage_path.startsWith("cfvault_")) {
      await deleteVaultBytes(env, existing.storage_path);
    }
    storagePath = newKey;
    fileSize = fileBuf.byteLength;
  }

  if (ansBuf && ansBuf.byteLength > 0) {
    const ansVaultBytes = ensureLtacVaultBytes(ansBuf);
    const newAnsKey = `cfvault_${docId}_ANS_${makeRandomToken(10)}.bin`;
    await storeVaultBytes(env, newAnsKey, ansVaultBytes);
    if (existing && existing.ans_storage_path && existing.ans_storage_path !== newAnsKey) {
      await deleteVaultBytes(env, existing.ans_storage_path);
    }
    ansStoragePath = newAnsKey;
  }

  const title = String(meta.title ?? existing?.title ?? "Tài liệu Toán mới").trim();
  const cat = String(meta.cat ?? existing?.cat ?? "Khối 12 · THPT QG").trim();
  const badge = String(meta.badge ?? existing?.badge ?? "TÀI LIỆU MỚI").trim();
  const accent = String(meta.accent ?? existing?.accent ?? "#650f12").trim();
  const pages = Math.max(1, Number(meta.pages ?? existing?.pages ?? 4) || 4);
  const description = String(meta.desc ?? meta.description ?? existing?.description ?? "").trim();
  const svgType = String(meta.svgType ?? existing?.svg_type ?? "pdf_a4").trim();
  const allowDownload =
    meta.allowDownload !== undefined ? (meta.allowDownload ? 1 : 0) : (existing ? Number(existing.allow_download) : 0);
  const hasUploadedPdf = storagePath || meta.hasUploadedPdf ? 1 : (existing ? Number(existing.has_uploaded_pdf) : 0);
  const status = String(meta.status ?? existing?.status ?? "published").trim();
  const sourcePipeline = String(meta.sourcePipeline ?? existing?.source_pipeline ?? "manual").trim();
  const createdAt = existing?.created_at || now;

  await env.DOCS_DB.prepare(
    `INSERT INTO pdf_documents (
      id, title, cat, badge, accent, pages, description, svg_type,
      storage_path, ans_storage_path, storage_backend, allow_download,
      has_uploaded_pdf, status, source_pipeline, source_ref, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      cat = excluded.cat,
      badge = excluded.badge,
      accent = excluded.accent,
      pages = excluded.pages,
      description = excluded.description,
      svg_type = excluded.svg_type,
      storage_path = excluded.storage_path,
      ans_storage_path = excluded.ans_storage_path,
      storage_backend = excluded.storage_backend,
      allow_download = excluded.allow_download,
      has_uploaded_pdf = excluded.has_uploaded_pdf,
      status = excluded.status,
      source_pipeline = excluded.source_pipeline,
      source_ref = COALESCE(excluded.source_ref, pdf_documents.source_ref),
      file_size = excluded.file_size,
      updated_at = excluded.updated_at`
  )
    .bind(
      docId, title, cat, badge, accent, pages, description, svgType,
      storagePath, ansStoragePath, storageBackend, allowDownload,
      hasUploadedPdf, status, sourcePipeline, sourceRef, fileSize, createdAt, now
    )
    .run();

  const saved = await env.DOCS_DB.prepare("SELECT * FROM pdf_documents WHERE id = ?").bind(docId).first();
  return mapDocRow(saved);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      // 1. Health & Connection Check
      if ((path === "/" || path === "/api/health") && request.method === "GET") {
        const isAuth = await verifyUploadSecret(request, env);
        const counts = await env.DOCS_DB.prepare(
          "SELECT status, COUNT(*) as cnt FROM pdf_documents GROUP BY status"
        ).all();
        let publishedCount = 0;
        let pendingCount = 0;
        for (const r of counts.results || []) {
          if (r.status === "pending") pendingCount += Number(r.cnt || 0);
          else publishedCount += Number(r.cnt || 0);
        }
        const config = await getAutomationConfig(env);
        const recentRuns = await env.DOCS_DB.prepare(
          "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 10"
        ).all();
        return jsonResp(
          {
            ok: true,
            service: "lop-toan-anh-chi-cloudflare-docs",
            storageBackend: env.DOCS_R2 ? "cloudflare-r2" : "cloudflare-kv-d1",
            authenticated: isAuth,
            publishedCount,
            pendingCount,
            config,
            recentRuns: recentRuns.results || [],
          },
          200,
          request
        );
      }

      // 2. List Documents (Public published, or Admin full list with pending + automation runs)
      if (path === "/api/docs" && request.method === "GET") {
        const wantPending = url.searchParams.get("include_pending") === "1";
        const isAuth = wantPending ? await verifyUploadSecret(request, env) : false;

        const querySql = isAuth
          ? "SELECT * FROM pdf_documents ORDER BY CASE WHEN id GLOB 'DOC0[1-9]' THEN 1 ELSE 0 END ASC, updated_at DESC, id ASC"
          : "SELECT * FROM pdf_documents WHERE status = 'published' ORDER BY CASE WHEN id GLOB 'DOC0[1-9]' THEN 1 ELSE 0 END ASC, updated_at DESC, id ASC";
        const rows = await env.DOCS_DB.prepare(querySql).all();
        const docs = (rows.results || []).map(mapDocRow);

        if (isAuth) {
          const config = await getAutomationConfig(env);
          const runs = await env.DOCS_DB.prepare(
            "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 20"
          ).all();
          return jsonResp({ ok: true, docs, config, recentRuns: runs.results || [] }, 200, request);
        }
        return jsonResp({ ok: true, docs }, 200, request);
      }

      // 3. Stream Protected Vault File Binary (/api/docs/:id/file)
      const fileMatch = path.match(/^\/api\/docs\/([^/]+)\/file$/);
      if (fileMatch && request.method === "GET") {
        const docId = decodeURIComponent(fileMatch[1]);
        const variant = url.searchParams.get("variant") || "de";
        const row = await env.DOCS_DB.prepare("SELECT * FROM pdf_documents WHERE id = ?")
          .bind(docId)
          .first();
        if (!row) return jsonResp({ ok: false, error: "doc_not_found" }, 404, request);

        if (row.status !== "published") {
          const isAuth = await verifyUploadSecret(request, env);
          if (!isAuth) return jsonResp({ ok: false, error: "doc_pending_approval" }, 403, request);
        }

        const targetKey = variant === "ans" && row.ans_storage_path ? row.ans_storage_path : row.storage_path;
        return streamVaultResponse(env, ctx, targetKey, request);
      }

      // 4. Upload / Upsert Document (Manual Admin Upload OR Automated Pipeline Upload)
      if (path === "/api/docs/upload" && request.method === "POST") {
        const isAuth = await verifyUploadSecret(request, env);
        if (!isAuth) {
          return jsonResp({ ok: false, error: "unauthorized_upload_key" }, 401, request);
        }

        let meta = {};
        let fileBuf = null;
        let ansBuf = null;
        const ctype = (request.headers.get("Content-Type") || "").toLowerCase();

        if (ctype.includes("multipart/form-data")) {
          const form = await request.formData();
          const metaPart = form.get("metadata");
          if (typeof metaPart === "string" && metaPart.trim()) {
            meta = JSON.parse(metaPart);
          } else if (metaPart && typeof metaPart.text === "function") {
            meta = JSON.parse(await metaPart.text());
          }
          const filePart = form.get("file");
          if (filePart && typeof filePart.arrayBuffer === "function") {
            fileBuf = await filePart.arrayBuffer();
          }
          const ansPart = form.get("ans_file");
          if (ansPart && typeof ansPart.arrayBuffer === "function") {
            ansBuf = await ansPart.arrayBuffer();
          }
        } else if (ctype.includes("application/json")) {
          meta = await request.json();
        } else {
          const metaHeader = request.headers.get("X-Doc-Meta") || "";
          if (metaHeader) {
            const decoded = new TextDecoder().decode(
              Uint8Array.from(atob(metaHeader), (c) => c.charCodeAt(0))
            );
            meta = JSON.parse(decoded);
          }
          fileBuf = await request.arrayBuffer();
        }

        const config = await getAutomationConfig(env);
        if (meta.fromAutomation) {
          const pipe = String(meta.sourcePipeline || "").toLowerCase();
          if (
            (pipe === "toanmath" && !config.enableToanmath) ||
            (pipe === "fb_latex" && !config.enableFbLatex) ||
            (pipe === "toan12" && !config.enableToan12)
          ) {
            return jsonResp({ ok: true, skipped: true, reason: "pipeline_disabled" }, 200, request);
          }
          if (!meta.status) meta.status = config.publishMode || "published";
          if (meta.allowDownload === undefined) meta.allowDownload = config.allowDownloadDefault;
        }

        const primaryDoc = await upsertSingleDocument(env, meta, fileBuf, ansBuf);
        let ansDoc = null;

        if (meta.fromAutomation && config.variantMode === "both" && ansBuf && ansBuf.byteLength > 0) {
          const ansMeta = {
            ...meta,
            id: `${primaryDoc.id}_ANS`,
            sourceRef: meta.sourceRef ? `${meta.sourceRef}:ans` : null,
            title: `${primaryDoc.title} (Đề & Lời giải chi tiết)`,
            badge: "CÓ LỜI GIẢI",
          };
          ansDoc = await upsertSingleDocument(env, ansMeta, ansBuf, null);
        }

        console.log(
          JSON.stringify({
            event: "doc_uploaded",
            id: primaryDoc.id,
            pipeline: primaryDoc.sourcePipeline,
            status: primaryDoc.status,
            size: primaryDoc.fileSize,
          })
        );
        return jsonResp({ ok: true, doc: primaryDoc, ansDoc }, 200, request);
      }

      // 5. Bulk Download Policy Update (/api/docs/bulk-policy)
      if (path === "/api/docs/bulk-policy" && request.method === "POST") {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const body = await request.json();
        if (typeof body.allowDownload === "boolean") {
          await env.DOCS_DB.prepare("UPDATE pdf_documents SET allow_download = ?, updated_at = ?")
            .bind(body.allowDownload ? 1 : 0, new Date().toISOString())
            .run();
        }
        return jsonResp({ ok: true }, 200, request);
      }

      // 6. Patch or Delete Specific Document (/api/docs/:id)
      const docMatch = path.match(/^\/api\/docs\/([^/]+)$/);
      if (docMatch && (request.method === "PATCH" || request.method === "DELETE")) {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const docId = decodeURIComponent(docMatch[1]);
        const existing = await env.DOCS_DB.prepare("SELECT * FROM pdf_documents WHERE id = ?")
          .bind(docId)
          .first();
        if (!existing) return jsonResp({ ok: false, error: "doc_not_found" }, 404, request);

        if (request.method === "DELETE") {
          if (existing.storage_path && existing.storage_path.startsWith("cfvault_")) {
            await deleteVaultBytes(env, existing.storage_path);
          }
          if (existing.ans_storage_path) {
            await deleteVaultBytes(env, existing.ans_storage_path);
          }
          await env.DOCS_DB.prepare("DELETE FROM pdf_documents WHERE id = ?").bind(docId).run();
          return jsonResp({ ok: true, deletedId: docId }, 200, request);
        }

        const patch = await request.json();
        const updated = await upsertSingleDocument(env, { ...mapDocRow(existing), ...patch, id: docId }, null, null);
        return jsonResp({ ok: true, doc: updated }, 200, request);
      }

      // 7. Automation Hub Config & Run Logs
      if (path === "/api/automations" && request.method === "GET") {
        const config = await getAutomationConfig(env);
        const runs = await env.DOCS_DB.prepare(
          "SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 25"
        ).all();
        return jsonResp({ ok: true, config, recentRuns: runs.results || [] }, 200, request);
      }

      if (path === "/api/automations/config" && request.method === "PUT") {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const body = await request.json();
        const cur = await getAutomationConfig(env);
        const now = new Date().toISOString();
        const next = {
          publishMode: body.publishMode || cur.publishMode || "published",
          variantMode: body.variantMode || cur.variantMode || "de_only",
          allowDownloadDefault:
            body.allowDownloadDefault !== undefined ? Boolean(body.allowDownloadDefault) : cur.allowDownloadDefault,
          enableToanmath: body.enableToanmath !== undefined ? Boolean(body.enableToanmath) : cur.enableToanmath,
          enableFbLatex: body.enableFbLatex !== undefined ? Boolean(body.enableFbLatex) : cur.enableFbLatex,
          enableToan12: body.enableToan12 !== undefined ? Boolean(body.enableToan12) : cur.enableToan12,
        };
        await env.DOCS_DB.prepare(
          `INSERT INTO automation_config (
            id, publish_mode, variant_mode, allow_download_default,
            enable_toanmath, enable_fb_latex, enable_toan12, updated_at
          ) VALUES ('main', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            publish_mode = excluded.publish_mode,
            variant_mode = excluded.variant_mode,
            allow_download_default = excluded.allow_download_default,
            enable_toanmath = excluded.enable_toanmath,
            enable_fb_latex = excluded.enable_fb_latex,
            enable_toan12 = excluded.enable_toan12,
            updated_at = excluded.updated_at`
        )
          .bind(
            next.publishMode,
            next.variantMode,
            next.allowDownloadDefault ? 1 : 0,
            next.enableToanmath ? 1 : 0,
            next.enableFbLatex ? 1 : 0,
            next.enableToan12 ? 1 : 0,
            now
          )
          .run();
        return jsonResp({ ok: true, config: await getAutomationConfig(env) }, 200, request);
      }

      if (path === "/api/automations/log" && request.method === "POST") {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const body = await request.json();
        const now = new Date().toISOString();
        const runId = `RUN_${Date.now().toString(36).toUpperCase()}_${makeRandomToken(4).toUpperCase()}`;
        await env.DOCS_DB.prepare(
          "INSERT INTO automation_runs (id, pipeline, summary, docs_uploaded, status, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            runId,
            String(body.pipeline || "automation"),
            String(body.summary || "Đồng bộ tự động hoàn tất"),
            Number(body.docsUploaded || 0),
            String(body.status || "success"),
            JSON.stringify(body.details || {}),
            now
          )
          .run();
        ctx.waitUntil(
          env.DOCS_DB.prepare(
            "DELETE FROM automation_runs WHERE id NOT IN (SELECT id FROM automation_runs ORDER BY created_at DESC LIMIT 100)"
          ).run()
        );
        return jsonResp({ ok: true, id: runId }, 200, request);
      }

      return jsonResp({ ok: false, error: "not_found", path }, 404, request);
    } catch (err) {
      console.error(JSON.stringify({ event: "worker_unhandled_error", path, error: String(err?.stack || err) }));
      return jsonResp({ ok: false, error: "internal_error", message: String(err?.message || err) }, 500, request);
    }
  },
};
