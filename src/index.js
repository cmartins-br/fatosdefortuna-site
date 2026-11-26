// Serve os vídeos guardados no R2 (/v/<arquivo>.mp4) e importa vídeos do Metricool.
// Todo o resto é servido pelos arquivos estáticos de /public.
const METRICOOL = /^https:\/\/static\.metricool\.com\/planner\/\d{6}\/8366136-file-\d+\.(mp4|jpe?g)$/;
const KEY = /^[a-z0-9-]+\.(mp4|jpg)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/v/")) return serveVideo(request, env, url.pathname.slice(3));

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

const json = (d, status = 200) => new Response(JSON.stringify(d), { status, headers: { "content-type": "application/json" } });
