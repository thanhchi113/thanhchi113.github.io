// Cloudflare Worker: Max-Free-Pool Document Vault (10x D1 = 5GB + 1GB KV + Gzip + Edge Cache + R2 Ready)
// Lớp Toán Anh Chí — Thầy Huỳnh Thanh Chí

const VAULT_CIPHER_KEY = [
  0x4c, 0x54, 0x41, 0x43, 0x9a, 0x37, 0xe5, 0x6d,
  0xb2, 0x19, 0x8f, 0xc4, 0x53, 0x71, 0xa8, 0x2e,
];

const KV_SINGLE_LIMIT = 22 * 1024 * 1024; // 22 MiB per KV value (under 25 MiB hard cap)
const D1_CHUNK_LIMIT = 950 * 1024;        // 950 KB per D1 BLOB row (under 2 MB row cap)
const D1_SHARD_SAFE_CAP = 450 * 1024 * 1024; // 450 MB safe usable per 500 MB D1 shard
const KV_SAFE_CAP = 920 * 1024 * 1024;       // 920 MB safe usable per 1 GB KV free tier
const SHARD_COUNT = 9;

function corsHeaders(request) {
  const origin = request ? request.headers.get("Origin") || "*" : "*";
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

function unwrapLtacToRawPdf(arrayBuffer) {
  const src = new Uint8Array(arrayBuffer);
  if (
    src.length > 4 &&
    src[0] === 0x4c &&
    src[1] === 0x54 &&
    src[2] === 0x41 &&
    src[3] === 0x43
  ) {
    const raw = new Uint8Array(src.length - 4);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = src[i + 4] ^ VAULT_CIPHER_KEY[i & 15] ^ ((i * 13) & 0xff);
    }
    return raw;
  }
  return src;
}

function wrapRawPdfToLtac(rawUint8) {
  const out = new Uint8Array(rawUint8.length + 4);
  out[0] = 0x4c;
  out[1] = 0x54;
  out[2] = 0x41;
  out[3] = 0x43;
  for (let i = 0; i < rawUint8.length; i++) {
    out[i + 4] = rawUint8[i] ^ VAULT_CIPHER_KEY[i & 15] ^ ((i * 13) & 0xff);
  }
  return out;
}

function xorScrambleCopy(srcUint8) {
  const out = new Uint8Array(srcUint8.length);
  for (let i = 0; i < srcUint8.length; i++) {
    out[i] = srcUint8[i] ^ VAULT_CIPHER_KEY[i & 15] ^ ((i * 13) & 0xff);
  }
  return out;
}

async function gzipCompressUint8(uint8) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(uint8);
  writer.close();
  const ab = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(ab);
}

async function gzipDecompressUint8(uint8) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(uint8);
  writer.close();
  const ab = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(ab);
}

function makeRandomToken(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

function getShardBinding(env, backendName) {
  const m = String(backendName || "").match(/^d1_shard_(\d+)$/);
  if (!m) return null;
  return env["DOCS_SHARD_" + m[1]] || null;
}

function getAvailableShardNames(env) {
  const names = [];
  for (let i = 1; i <= SHARD_COUNT; i++) {
    if (env["DOCS_SHARD_" + i]) names.push("d1_shard_" + i);
  }
  return names;
}

async function getStoragePoolStats(env) {
  const rows = await env.DOCS_DB.prepare(
    "SELECT backend, COUNT(*) AS files, COALESCE(SUM(raw_bytes), 0) AS raw_used, COALESCE(SUM(stored_bytes), 0) AS stored_used FROM storage_ledger GROUP BY backend"
  ).all();
  const map = {};
  for (const r of rows.results || []) {
    map[r.backend] = {
      files: Number(r.files || 0),
      rawBytes: Number(r.raw_used || 0),
      storedBytes: Number(r.stored_used || 0),
    };
  }
  const shardNames = getAvailableShardNames(env);
  const shardDetails = shardNames.map((name) => ({
    backend: name,
    quotaMB: 500,
    safeCapBytes: D1_SHARD_SAFE_CAP,
    files: map[name]?.files || 0,
    rawBytes: map[name]?.rawBytes || 0,
    storedBytes: map[name]?.storedBytes || 0,
  }));
  const kvStat = {
    backend: "kv",
    quotaMB: 1000,
    safeCapBytes: KV_SAFE_CAP,
    files: map.kv?.files || 0,
    rawBytes: map.kv?.rawBytes || 0,
    storedBytes: map.kv?.storedBytes || 0,
  };
  const r2Enabled = Boolean(env.DOCS_R2);
  const totalRawBytes = Object.values(map).reduce((s, v) => s + v.rawBytes, 0);
  const totalStoredBytes = Object.values(map).reduce((s, v) => s + v.storedBytes, 0);
  const totalQuotaMB = (r2Enabled ? 10000 : 0) + 1000 + 500 + shardNames.length * 500;
  const safeUsableMB = Math.round(
    ((r2Enabled ? 9500 * 1024 * 1024 : 0) + KV_SAFE_CAP + shardNames.length * D1_SHARD_SAFE_CAP) / (1024 * 1024)
  );
  return {
    mode: r2Enabled ? "cloudflare-r2+free-cluster" : "cloudflare-max-free-cluster",
    r2Enabled,
    edgeCacheEnabled: true,
    gzipCompressionEnabled: true,
    totalQuotaMB,
    safeUsableMB,
    totalRawBytes,
    totalStoredBytes,
    savedByCompressionBytes: Math.max(0, totalRawBytes - totalStoredBytes),
    d1CatalogQuotaMB: 500,
    d1ShardsCount: shardNames.length,
    d1ShardsQuotaMB: shardNames.length * 500,
    kvQuotaMB: 1000,
    kv: kvStat,
    shards: shardDetails,
  };
}

async function pickBestStorageBackend(env, byteLength, forceKv = false) {
  if (env.DOCS_R2 && !forceKv) return "r2";
  const stats = await getStoragePoolStats(env);

  // D1 shards have 100,000 writes/day on Free plan vs 1,000/day on KV,
  // and 9 shards x 450 MB = 4,050 MB safe usable capacity!
  // Route files <= 32 MB to the least-loaded D1 shard first, then overflow to KV (920 MB).
  if (!forceKv && byteLength <= 32 * 1024 * 1024 && stats.shards.length > 0) {
    const eligibleShards = stats.shards
      .filter((s) => s.storedBytes + byteLength <= s.safeCapBytes)
      .sort((a, b) => a.storedBytes - b.storedBytes);
    if (eligibleShards.length > 0) {
      return eligibleShards[0].backend;
    }
  }

  if (env.DOCS_KV && stats.kv.storedBytes + byteLength <= stats.kv.safeCapBytes) {
    return "kv";
  }

  // Fallback if approaching cap: pick whichever shard has the lowest storedBytes
  if (stats.shards.length > 0 && byteLength <= 32 * 1024 * 1024) {
    const sorted = [...stats.shards].sort((a, b) => a.storedBytes - b.storedBytes);
    return sorted[0].backend;
  }
  return "kv";
}

async function storeVaultPayload(env, key, inputArrayBuffer, preferredBackend = "") {
  const rawPdf = unwrapLtacToRawPdf(inputArrayBuffer);
  const rawBytes = rawPdf.byteLength;

  // Compress with lossless Gzip if it saves space, then XOR-encrypt before storing at rest
  let payloadPlain = rawPdf;
  let compressed = 0;
  try {
    const gz = await gzipCompressUint8(rawPdf);
    if (gz.byteLength + 32 < rawBytes) {
      payloadPlain = gz;
      compressed = 1;
    }
  } catch {}

  const encryptedAtRest = xorScrambleCopy(payloadPlain);
  const storedBytes = encryptedAtRest.byteLength;
  const now = new Date().toISOString();

  const backend = preferredBackend || (await pickBestStorageBackend(env, storedBytes));

  if (backend === "r2" && env.DOCS_R2) {
    await env.DOCS_R2.put(key, encryptedAtRest, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { compressed: String(compressed), rawBytes: String(rawBytes) },
    });
  } else if (backend.startsWith("d1_shard_")) {
    const shardDb = getShardBinding(env, backend);
    if (!shardDb) throw new Error("Missing shard binding " + backend);
    const totalChunks = Math.max(1, Math.ceil(storedBytes / D1_CHUNK_LIMIT));
    const stmts = [];
    for (let idx = 0; idx < totalChunks; idx++) {
      const slice = encryptedAtRest.subarray(idx * D1_CHUNK_LIMIT, (idx + 1) * D1_CHUNK_LIMIT);
      const abSlice = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
      stmts.push(
        shardDb
          .prepare("INSERT OR REPLACE INTO vault_chunks (obj_key, chunk_idx, data, byte_len) VALUES (?, ?, ?, ?)")
          .bind(key, idx, abSlice, slice.byteLength)
      );
    }
    stmts.push(
      shardDb
        .prepare(
          "INSERT OR REPLACE INTO vault_objects (obj_key, chunks, raw_bytes, stored_bytes, compressed, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(key, totalChunks, rawBytes, storedBytes, compressed, now)
    );
    await shardDb.batch(stmts);
  } else {
    // KV backend (note: legacy pre-upgrade KV items stored full LTAC bytes with compressed=undefined;
    // new KV items store encryptedAtRest with metadata.v = 2)
    if (storedBytes <= KV_SINGLE_LIMIT) {
      await env.DOCS_KV.put(key, encryptedAtRest, {
        metadata: { v: 2, chunks: 1, size: storedBytes, rawBytes, compressed },
      });
    } else {
      const totalChunks = Math.ceil(storedBytes / KV_SINGLE_LIMIT);
      for (let idx = 0; idx < totalChunks; idx++) {
        const slice = encryptedAtRest.subarray(idx * KV_SINGLE_LIMIT, (idx + 1) * KV_SINGLE_LIMIT);
        await env.DOCS_KV.put(key + ":part" + idx, slice);
      }
      await env.DOCS_KV.put(key, new Uint8Array(0), {
        metadata: { v: 2, chunks: totalChunks, size: storedBytes, rawBytes, compressed },
      });
    }
  }

  await env.DOCS_DB.prepare(
    "INSERT OR REPLACE INTO storage_ledger (obj_key, backend, raw_bytes, stored_bytes, compressed, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(key, backend, rawBytes, storedBytes, compressed, now)
    .run();

  return { backend, rawBytes, storedBytes, compressed };
}

async function deleteVaultBytes(env, key, backendHint = "") {
  if (!key) return;
  try {
    const ledger = await env.DOCS_DB.prepare("SELECT backend FROM storage_ledger WHERE obj_key = ?")
      .bind(key)
      .first();
    const backend = ledger?.backend || backendHint || "";

    if ((backend === "r2" || !backend) && env.DOCS_R2) {
      await env.DOCS_R2.delete(key);
    }
    if (backend.startsWith("d1_shard_")) {
      const shardDb = getShardBinding(env, backend);
      if (shardDb) {
        await shardDb.batch([
          shardDb.prepare("DELETE FROM vault_chunks WHERE obj_key = ?").bind(key),
          shardDb.prepare("DELETE FROM vault_objects WHERE obj_key = ?").bind(key),
        ]);
      }
    }
    if ((backend === "kv" || !backend) && env.DOCS_KV) {
      const { metadata } = await env.DOCS_KV.getWithMetadata(key, { type: "text" });
      const chunks = Number(metadata?.chunks || 1);
      if (chunks > 1) {
        for (let i = 0; i < chunks; i++) {
          await env.DOCS_KV.delete(key + ":part" + i);
        }
      }
      await env.DOCS_KV.delete(key);
    }
    await env.DOCS_DB.prepare("DELETE FROM storage_ledger WHERE obj_key = ?").bind(key).run();
  } catch (err) {
    console.error(JSON.stringify({ event: "delete_vault_error", key, error: String(err) }));
  }
}

async function readLtacBytesFromBackend(env, key, backendHint = "") {
  const ledger = await env.DOCS_DB.prepare("SELECT backend, compressed FROM storage_ledger WHERE obj_key = ?")
    .bind(key)
    .first();
  const backend = ledger?.backend || backendHint || "kv";

  // 1. D1 Shard Backend
  if (backend.startsWith("d1_shard_")) {
    const shardDb = getShardBinding(env, backend);
    if (!shardDb) return null;
    const objMeta = await shardDb.prepare("SELECT * FROM vault_objects WHERE obj_key = ?").bind(key).first();
    if (!objMeta) return null;
    const rows = await shardDb
      .prepare("SELECT chunk_idx, data FROM vault_chunks WHERE obj_key = ? ORDER BY chunk_idx ASC")
      .bind(key)
      .all();
    const list = rows.results || [];
    if (!list.length) return null;

    const merged = new Uint8Array(Number(objMeta.stored_bytes));
    let offset = 0;
    for (const r of list) {
      const part = r.data instanceof Uint8Array ? r.data : new Uint8Array(r.data);
      merged.set(part, offset);
      offset += part.byteLength;
    }
    let plain = xorScrambleCopy(merged);
    if (Number(objMeta.compressed) === 1) {
      plain = await gzipDecompressUint8(plain);
    }
    return wrapRawPdfToLtac(plain);
  }

  // 2. R2 Backend
  if (backend === "r2" && env.DOCS_R2) {
    const obj = await env.DOCS_R2.get(key);
    if (obj) {
      const ab = await obj.arrayBuffer();
      const raw = new Uint8Array(ab);
      if (obj.customMetadata && obj.customMetadata.compressed !== undefined) {
        let plain = xorScrambleCopy(raw);
        if (obj.customMetadata.compressed === "1") {
          plain = await gzipDecompressUint8(plain);
        }
        return wrapRawPdfToLtac(plain);
      }
      return raw;
    }
  }

  // 3. KV Backend (supports both v2 compressed+XOR and v1 legacy LTAC)
  if (env.DOCS_KV) {
    const { value: firstAb, metadata } = await env.DOCS_KV.getWithMetadata(key, {
      type: "arrayBuffer",
      cacheTtl: 86400,
    });
    const chunks = Number(metadata?.chunks || 1);
    let fullUint8 = null;
    if (chunks <= 1) {
      if (!firstAb) return null;
      fullUint8 = new Uint8Array(firstAb);
    } else {
      const totalSize = Number(metadata?.size || 0);
      const parts = [];
      let sum = 0;
      for (let i = 0; i < chunks; i++) {
        const pAb = await env.DOCS_KV.get(key + ":part" + i, { type: "arrayBuffer", cacheTtl: 86400 });
        if (pAb) {
          const u = new Uint8Array(pAb);
          parts.push(u);
          sum += u.byteLength;
        }
      }
      fullUint8 = new Uint8Array(totalSize || sum);
      let off = 0;
      for (const p of parts) {
        fullUint8.set(p, off);
        off += p.byteLength;
      }
    }
    if (metadata && metadata.v === 2) {
      let plain = xorScrambleCopy(fullUint8);
      if (Number(metadata.compressed) === 1) {
        plain = await gzipDecompressUint8(plain);
      }
      return wrapRawPdfToLtac(plain);
    }
    return fullUint8;
  }

  return null;
}

async function serveVaultWithEdgeCache(env, ctx, key, backendHint, request) {
  if (!key) return jsonResp({ ok: false, error: "missing_storage_path" }, 404, request);

  const reqUrl = new URL(request.url);
  const cacheUrl = new URL("/__edge_vault_cache/" + encodeURIComponent(key), reqUrl.origin);
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  const edgeCache = caches.default;

  const cached = await edgeCache.match(cacheKey);
  if (cached) {
    const headers = new Headers(cached.headers);
    const cors = corsHeaders(request);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("X-Edge-Cache", "HIT");
    return new Response(cached.body, { status: 200, headers });
  }

  const ltacBytes = await readLtacBytesFromBackend(env, key, backendHint);
  if (!ltacBytes) {
    return jsonResp({ ok: false, error: "object_not_found" }, 404, request);
  }

  const cacheHeaders = {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=604800, immutable",
    "X-Vault-Format": "LTAC",
  };

  ctx.waitUntil(
    edgeCache.put(
      cacheKey,
      new Response(ltacBytes.slice(0), {
        status: 200,
        headers: cacheHeaders,
      })
    )
  );

  return new Response(ltacBytes, {
    status: 200,
    headers: {
      ...cacheHeaders,
      ...corsHeaders(request),
      "X-Edge-Cache": "MISS",
    },
  });
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
    storageBackend: row.storage_backend || "d1_shard_1",
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
    : String(meta.id || "").trim() || ("DOC_" + Date.now().toString(36).toUpperCase() + "_" + makeRandomToken(4).toUpperCase());

  let storagePath = existing ? existing.storage_path : (meta.storagePath || null);
  let ansStoragePath = existing ? existing.ans_storage_path : null;
  let storageBackend = existing ? (existing.storage_backend || "d1_shard_1") : "d1_shard_1";
  let fileSize = existing ? Number(existing.file_size || 0) : 0;

  if (fileBuf && fileBuf.byteLength > 0) {
    const newKey = "cfvault_" + docId + "_" + makeRandomToken(10) + ".bin";
    const savedInfo = await storeVaultPayload(env, newKey, fileBuf, meta.preferredBackend || "");
    if (existing && existing.storage_path && existing.storage_path !== newKey && existing.storage_path.startsWith("cfvault_")) {
      await deleteVaultBytes(env, existing.storage_path, existing.storage_backend || "");
    }
    storagePath = newKey;
    storageBackend = savedInfo.backend;
    fileSize = savedInfo.rawBytes;
  }

  if (ansBuf && ansBuf.byteLength > 0) {
    const newAnsKey = "cfvault_" + docId + "_ANS_" + makeRandomToken(10) + ".bin";
    await storeVaultPayload(env, newAnsKey, ansBuf, "");
    if (existing && existing.ans_storage_path && existing.ans_storage_path !== newAnsKey) {
      await deleteVaultBytes(env, existing.ans_storage_path, "");
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
    "INSERT INTO pdf_documents (id, title, cat, badge, accent, pages, description, svg_type, storage_path, ans_storage_path, storage_backend, allow_download, has_uploaded_pdf, status, source_pipeline, source_ref, file_size, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, cat = excluded.cat, badge = excluded.badge, accent = excluded.accent, pages = excluded.pages, description = excluded.description, svg_type = excluded.svg_type, storage_path = excluded.storage_path, ans_storage_path = excluded.ans_storage_path, storage_backend = excluded.storage_backend, allow_download = excluded.allow_download, has_uploaded_pdf = excluded.has_uploaded_pdf, status = excluded.status, source_pipeline = excluded.source_pipeline, source_ref = COALESCE(excluded.source_ref, pdf_documents.source_ref), file_size = excluded.file_size, updated_at = excluded.updated_at"
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
        const [config, storagePool, recentRuns] = await Promise.all([
          getAutomationConfig(env),
          getStoragePoolStats(env),
          env.DOCS_DB.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 10").all(),
        ]);
        return jsonResp(
          {
            ok: true,
            service: "lop-toan-anh-chi-cloudflare-docs",
            storageBackend: storagePool.mode,
            authenticated: isAuth,
            publishedCount,
            pendingCount,
            storagePool,
            config,
            recentRuns: recentRuns.results || [],
          },
          200,
          request
        );
      }

      if (path === "/api/docs" && request.method === "GET") {
        const wantPending = url.searchParams.get("include_pending") === "1";
        const isAuth = wantPending ? await verifyUploadSecret(request, env) : false;

        const querySql = isAuth
          ? "SELECT * FROM pdf_documents ORDER BY CASE WHEN id GLOB 'DOC0[1-9]' THEN 1 ELSE 0 END ASC, updated_at DESC, id ASC"
          : "SELECT * FROM pdf_documents WHERE status = 'published' ORDER BY CASE WHEN id GLOB 'DOC0[1-9]' THEN 1 ELSE 0 END ASC, updated_at DESC, id ASC";
        const rows = await env.DOCS_DB.prepare(querySql).all();
        const docs = (rows.results || []).map(mapDocRow);

        if (isAuth) {
          const [config, storagePool, runs] = await Promise.all([
            getAutomationConfig(env),
            getStoragePoolStats(env),
            env.DOCS_DB.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 20").all(),
          ]);
          return jsonResp({ ok: true, docs, storagePool, config, recentRuns: runs.results || [] }, 200, request);
        }
        return jsonResp({ ok: true, docs }, 200, request);
      }

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
        return serveVaultWithEdgeCache(env, ctx, targetKey, row.storage_backend || "", request);
      }

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
            id: primaryDoc.id + "_ANS",
            sourceRef: meta.sourceRef ? meta.sourceRef + ":ans" : null,
            title: primaryDoc.title + " (Đề & Lời giải chi tiết)",
            badge: "CÓ LỜI GIẢI",
          };
          ansDoc = await upsertSingleDocument(env, ansMeta, ansBuf, null);
        }

        const storagePool = await getStoragePoolStats(env);
        console.log(
          JSON.stringify({
            event: "doc_uploaded",
            id: primaryDoc.id,
            backend: primaryDoc.storageBackend,
            pipeline: primaryDoc.sourcePipeline,
            status: primaryDoc.status,
            size: primaryDoc.fileSize,
          })
        );
        return jsonResp({ ok: true, doc: primaryDoc, ansDoc, storagePool }, 200, request);
      }

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
            await deleteVaultBytes(env, existing.storage_path, existing.storage_backend || "");
          }
          if (existing.ans_storage_path) {
            await deleteVaultBytes(env, existing.ans_storage_path, "");
          }
          await env.DOCS_DB.prepare("DELETE FROM pdf_documents WHERE id = ?").bind(docId).run();
          return jsonResp({ ok: true, deletedId: docId, storagePool: await getStoragePoolStats(env) }, 200, request);
        }

        const patch = await request.json();
        const updated = await upsertSingleDocument(env, { ...mapDocRow(existing), ...patch, id: docId }, null, null);
        return jsonResp({ ok: true, doc: updated }, 200, request);
      }

      if (path === "/api/automations" && request.method === "GET") {
        const [config, storagePool, runs] = await Promise.all([
          getAutomationConfig(env),
          getStoragePoolStats(env),
          env.DOCS_DB.prepare("SELECT * FROM automation_runs ORDER BY created_at DESC LIMIT 25").all(),
        ]);
        return jsonResp({ ok: true, config, storagePool, recentRuns: runs.results || [] }, 200, request);
      }

      if (path === "/api/automations/config" && request.method === "PUT") {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const body = await request.json();
        const cur = await getAutomationConfig(env);
        const nowIso = new Date().toISOString();
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
          "INSERT INTO automation_config (id, publish_mode, variant_mode, allow_download_default, enable_toanmath, enable_fb_latex, enable_toan12, updated_at) VALUES ('main', ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET publish_mode = excluded.publish_mode, variant_mode = excluded.variant_mode, allow_download_default = excluded.allow_download_default, enable_toanmath = excluded.enable_toanmath, enable_fb_latex = excluded.enable_fb_latex, enable_toan12 = excluded.enable_toan12, updated_at = excluded.updated_at"
        )
          .bind(
            next.publishMode,
            next.variantMode,
            next.allowDownloadDefault ? 1 : 0,
            next.enableToanmath ? 1 : 0,
            next.enableFbLatex ? 1 : 0,
            next.enableToan12 ? 1 : 0,
            nowIso
          )
          .run();
        return jsonResp({ ok: true, config: await getAutomationConfig(env) }, 200, request);
      }

      if (path === "/api/automations/log" && request.method === "POST") {
        if (!(await verifyUploadSecret(request, env))) {
          return jsonResp({ ok: false, error: "unauthorized" }, 401, request);
        }
        const body = await request.json();
        const nowIso = new Date().toISOString();
        const runId = "RUN_" + Date.now().toString(36).toUpperCase() + "_" + makeRandomToken(4).toUpperCase();
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
            nowIso
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
