// Serve os vídeos guardados no R2 (/v/<arquivo>.mp4) e importa vídeos do Metricool.
// Todo o resto é servido pelos arquivos estáticos de /public.
const METRICOOL = /^https:\/\/static\.metricool\.com\/planner\/\d{6}\/8366136-file-\d+\.(mp4|jpe?g)$/;
const KEY = /^[a-z0-9-]+\.(mp4|jpg)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/v/")) return serveVideo(request, env, url.pathname.slice(3));
    if (url.pathname === "/sitemap.xml") return sitemap(env, url);
    if (url.pathname === "/") return home(env, url);
    const m = url.pathname.match(/^\/video\/([a-z0-9-]+)\/?$/);
    if (m) return videoPage(env, url, m[1]);

    if (url.pathname === "/__import" && request.method === "POST") {
      const { key, src } = await request.json().catch(() => ({}));
      if (!KEY.test(key || "") || !METRICOOL.test(src || "")) return json({ ok: false, erro: "key ou src inválido" }, 400);
      if (await env.VIDEOS.head(key)) return json({ ok: true, key, ja_existia: true });
      const r = await fetch(src);
      if (!r.ok) return json({ ok: false, erro: `origem respondeu ${r.status}` }, 502);
      const obj = await env.VIDEOS.put(key, r.body, {
        httpMetadata: { contentType: key.endsWith(".mp4") ? "video/mp4" : "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
      });
      return json({ ok: true, key, bytes: obj.size });
    }

    return Response.redirect(new URL("/", url).toString(), 302);
  },
};

async function serveVideo(request, env, key) {
  if (!KEY.test(key)) return new Response("Não encontrado", { status: 404 });
  const obj = await env.VIDEOS.get(key, { range: request.headers, onlyIf: request.headers });
  if (obj === null) return new Response("Não encontrado", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  if (!("body" in obj)) return new Response(null, { status: 304, headers });
  if (obj.range) {
    const start = obj.range.offset ?? 0;
    const end = obj.range.length !== undefined ? start + obj.range.length - 1 : obj.size - 1;
    headers.set("content-range", `bytes ${start}-${end}/${obj.size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(obj.size));
  return new Response(obj.body, { headers });
}

// Lista de vídeos já publicados (data de publicação no passado), mais novo primeiro.
async function publicados(env, url) {
  const r = await env.ASSETS.fetch(new URL("/videos.json", url));
  const all = r.ok ? await r.json() : [];
  const now = Date.now();
  return all.filter(v => new Date(v.publicado).getTime() <= now).sort((a, b) => new Date(b.publicado) - new Date(a.publicado));
}

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const capa = (v, origin) => v.capa ? new URL(v.capa, origin).href : v.youtube && !v.video ? `https://i.ytimg.com/vi/${v.youtube}/hqdefault.jpg` : `${origin}/capas/${v.slug}.jpg`;

// Sitemap gerado na hora a partir do videos.json: entra sozinho cada vídeo que chega na data de publicação.
async function sitemap(env, url) {
  const o = url.origin.replace("://www.", "://");
  const vids = await publicados(env, url);
  const last = vids[0] ? new Date(vids[0].publicado).toISOString() : new Date().toISOString();
  const items = vids.map(v => {
    const media = v.youtube && !v.video
      ? `<video:player_loc>https://www.youtube.com/embed/${esc(v.youtube)}</video:player_loc>`
      : `<video:content_loc>${o}${esc(v.video)}</video:content_loc>`;
    return `<url><loc>${o}/video/${v.slug}</loc><lastmod>${new Date(v.publicado).toISOString()}</lastmod>
<video:video><video:thumbnail_loc>${esc(capa(v, o))}</video:thumbnail_loc><video:title>${esc(v.titulo)}</video:title><video:description>${esc(v.resumo)}</video:description>${media}${v.duracao ? `<video:duration>${v.duracao}</video:duration>` : ""}<video:publication_date>${esc(v.publicado)}</video:publication_date><video:family_friendly>yes</video:family_friendly></video:video></url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
<url><loc>${o}/</loc><lastmod>${last}</lastmod></url>
${items}
</urlset>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=600" } });
}

// Página inicial: já entrega a lista de vídeos e a capa do destaque no HTML (carrega mais rápido).
async function home(env, url) {
  const [page, all] = await Promise.all([env.ASSETS.fetch(new URL("/", url)), env.ASSETS.fetch(new URL("/videos.json", url)).then(r => r.ok ? r.json() : null)]);
  if (!all) return page;
  const v = (await publicados(env, url)).find(x => x.tipo !== "documentario"); // destaque do topo é sempre um vídeo curto
  const img = v ? (v.capa || (v.youtube && !v.video ? capa(v, url.origin) : `/capas/${v.slug}.webp`)) : null;
  const rw = new HTMLRewriter()
    .on("head", { element(e) {
      e.append(`<script>window.__V=${JSON.stringify(all).replace(/</g, "\\u003c")}</script>`, { html: true });
      if (img) e.append(`<link rel="preload" as="image" href="${esc(img)}" fetchpriority="high">`, { html: true });
    } });
  if (img) rw.on("#feat img", { element(e) { e.setAttribute("src", img); } });
  const h = new Headers(page.headers); h.set("content-type", "text/html; charset=utf-8"); h.set("cache-control", "public, max-age=0, must-revalidate");
  h.delete("content-length"); h.delete("etag");
  return rw.transform(new Response(page.body, { status: 200, headers: h }));
}

// Página própria de cada vídeo (/video/<slug>): a mesma página inicial, com título, descrição e prévia do vídeo.
async function videoPage(env, url, slug) {
  const o = url.origin;
  const v = (await publicados(env, url)).find(x => x.slug === slug);
  if (!v) return Response.redirect(new URL("/", url).toString(), 302);
  const page = await env.ASSETS.fetch(new URL("/", url));
  const img = capa(v, o), link = `${o.replace("://www.", "://")}/video/${slug}`;
  const ld = { "@context": "https://schema.org", "@type": "VideoObject", name: v.titulo, description: v.resumo, thumbnailUrl: img, uploadDate: v.publicado,
    ...(v.duracao ? { duration: `PT${Math.floor(v.duracao / 60)}M${v.duracao % 60}S` } : {}),
    ...(v.youtube && !v.video ? { embedUrl: `https://www.youtube.com/embed/${v.youtube}` } : { contentUrl: o + v.video }) };
  if (v.youtube && Array.isArray(v.capitulos) && v.capitulos.length) {
    const watch = `https://www.youtube.com/watch?v=${v.youtube}`;
    ld.hasPart = v.capitulos.map((c, i) => ({ "@type": "Clip", name: c.titulo, startOffset: c.t,
      ...(v.capitulos[i + 1] ? { endOffset: v.capitulos[i + 1].t } : v.duracao ? { endOffset: v.duracao } : {}), url: `${watch}&t=${c.t}s` }));
  }
  const setContent = val => ({ element(e) { e.setAttribute("content", val); } });
  return new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(`${v.titulo} | Fatos de Fortuna`); } })
    .on('meta[name="description"]', setContent(v.resumo))
    .on('meta[property="og:title"]', setContent(v.titulo))
    .on('meta[property="og:description"]', setContent(v.resumo))
    .on('meta[property="og:type"]', setContent("video.other"))
    .on('meta[property="og:image"]', setContent(img))
    .on("head", { element(e) { e.append(`<link rel="canonical" href="${link}"><meta property="og:url" content="${link}"><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>`, { html: true }); } })
    .transform(new Response(page.body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }));
}

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
