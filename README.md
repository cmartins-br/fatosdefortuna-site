# Fatos de Fortuna — site

Vitrine dos vídeos do canal em fatosdefortuna.com.br. Site estático publicado pela Cloudflare (Workers com static assets).

## Publicar um vídeo novo
1. Adicionar a capa em `public/capas/<slug>.jpg` (432x768).
2. Subir o MP4 para o R2 (POST /__import com {key: "<slug>.mp4", src: URL do Metricool}) e acrescentar o vídeo em `public/videos.json` com "video": "/v/<slug>.mp4".
3. Commit na `main`: a Cloudflare publica sozinha.

Vídeos com data de publicação no futuro ficam escondidos e aparecem sozinhos na hora marcada.
