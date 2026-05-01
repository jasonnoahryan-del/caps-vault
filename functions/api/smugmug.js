async function hmacSha1(key, data) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g,'%21').replace(/'/g,'%27')
    .replace(/\(/g,'%28').replace(/\)/g,'%29').replace(/\*/g,'%2A');
}

async function smugmugGet(endpoint, params, env) {
  const API_KEY = env.SMUGMUG_API_KEY;
  const API_SECRET = env.SMUGMUG_API_SECRET;
  const ACCESS_TOKEN = env.SMUGMUG_ACCESS_TOKEN;
  const ACCESS_TOKEN_SECRET = env.SMUGMUG_ACCESS_TOKEN_SECRET;

  const baseUrl = `https://api.smugmug.com${endpoint}`;
  const oauthParams = {
    oauth_consumer_key: API_KEY,
    oauth_nonce: randomHex(16),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now()/1000).toString(),
    oauth_token: ACCESS_TOKEN,
    oauth_version: '1.0'
  };
  const allParams = {...params, ...oauthParams};
  const sortedParams = Object.keys(allParams).sort()
    .map(k=>`${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');
  const baseString = ['GET', percentEncode(baseUrl), percentEncode(sortedParams)].join('&');
  const signingKey = `${percentEncode(API_SECRET)}&${percentEncode(ACCESS_TOKEN_SECRET)}`;
  const signature = await hmacSha1(signingKey, baseString);
  oauthParams.oauth_signature = signature;
  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .map(k=>`${percentEncode(k)}="${percentEncode(oauthParams[k])}"`).join(', ');
  const qs = Object.keys(params).map(k=>`${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const fullUrl = qs ? `${baseUrl}?${qs}` : baseUrl;
  const resp = await fetch(fullUrl, {
    headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
  });
  const text = await resp.text();
  try { return { status: resp.status, data: JSON.parse(text) }; }
  catch(e) { return { status: resp.status, data: {} }; }
}

function getSizedUrl(thumbUrl, size) {
  if (!thumbUrl) return '';
  return thumbUrl.replace(/\/Th\/(.+?)-Th\./, `/${size}/$1-${size}.`);
}

export async function onRequest(context) {
  const { request, env } = context;
  const USERNAME = 'sportsdadphotos';
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (request.method === 'OPTIONS') return new Response('', { headers: corsHeaders });

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    // Save album URL to KV
    if (action === 'save' && request.method === 'POST') {
      const body = await request.json();
      const { key, albumUrl } = body;
      if (!key || !albumUrl) return new Response(JSON.stringify({ error: 'Missing key or albumUrl' }), { status: 400, headers: corsHeaders });
      await env.CAPS_VAULT_KV.put(key, albumUrl);
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Save chosen cover URL for a gallery to KV (so all visitors see it).
    // Pass coverUrl: null to clear the saved cover.
    if (action === 'save-cover' && request.method === 'POST') {
      const body = await request.json();
      const { key, coverUrl } = body;
      if (!key) return new Response(JSON.stringify({ error: 'Missing key' }), { status: 400, headers: corsHeaders });
      if (coverUrl) {
        await env.CAPS_VAULT_KV.put('cover:' + key, coverUrl);
      } else {
        await env.CAPS_VAULT_KV.delete('cover:' + key);
      }
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get all saved cover URLs from KV (returns { "<catId>__<playerName>": coverUrl, ... })
    if (action === 'list-covers') {
      const list = await env.CAPS_VAULT_KV.list({ prefix: 'cover:' });
      const data = {};
      for (const k of list.keys) {
        const realKey = k.name.slice('cover:'.length);
        data[realKey] = await env.CAPS_VAULT_KV.get(k.name);
      }
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // Save a single editable-text entry (about/contact paragraphs, player
    // bios, etc.) to KV. Body: { key, text }. Pass text="" to clear.
    if (action === 'save-text' && request.method === 'POST') {
      const body = await request.json();
      const { key, text } = body;
      if (!key) return new Response(JSON.stringify({ error: 'Missing key' }), { status: 400, headers: corsHeaders });
      const stored = await env.CAPS_VAULT_KV.get('texts');
      const texts = stored ? JSON.parse(stored) : {};
      if (text == null || text === '') delete texts[key];
      else texts[key] = String(text);
      await env.CAPS_VAULT_KV.put('texts', JSON.stringify(texts));
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get all editable-text overrides as a { key: text } map.
    if (action === 'list-texts') {
      const stored = await env.CAPS_VAULT_KV.get('texts');
      const texts = stored ? JSON.parse(stored) : {};
      return new Response(JSON.stringify({ texts }), { headers: corsHeaders });
    }

    // Save the order of categories on the Browse page. Body:
    // { order: ["home-jerseys", "sticks", ...] }
    if (action === 'save-portfolio-order' && request.method === 'POST') {
      const body = await request.json();
      const { order } = body;
      if (!Array.isArray(order)) return new Response(JSON.stringify({ error: 'Missing order' }), { status: 400, headers: corsHeaders });
      await env.CAPS_VAULT_KV.put('portfolioOrder', JSON.stringify(order));
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get the saved Browse-page order. Returns { order: [id, id, ...] }
    if (action === 'list-portfolio-order') {
      const stored = await env.CAPS_VAULT_KV.get('portfolioOrder');
      const order = stored ? JSON.parse(stored) : [];
      return new Response(JSON.stringify({ order }), { headers: corsHeaders });
    }

    // Save the order of sub-galleries within a category. Body:
    // { categoryId, order: ["Player Name", "Player Name", ...] }
    if (action === 'save-gallery-order' && request.method === 'POST') {
      const body = await request.json();
      const { categoryId, order } = body;
      if (!categoryId || !Array.isArray(order)) return new Response(JSON.stringify({ error: 'Missing categoryId or order' }), { status: 400, headers: corsHeaders });
      const stored = await env.CAPS_VAULT_KV.get('galleryOrders');
      const orders = stored ? JSON.parse(stored) : {};
      orders[categoryId] = order;
      await env.CAPS_VAULT_KV.put('galleryOrders', JSON.stringify(orders));
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get all saved gallery orders. Returns { categoryId: [name, name, ...], ... }
    if (action === 'list-gallery-orders') {
      const stored = await env.CAPS_VAULT_KV.get('galleryOrders');
      const orders = stored ? JSON.parse(stored) : {};
      return new Response(JSON.stringify({ orders }), { headers: corsHeaders });
    }

    // Save a Browse-page (category) cover URL to KV. Body: { categoryId, coverUrl }.
    // Pass null/empty coverUrl to clear it.
    if (action === 'save-portfolio-cover' && request.method === 'POST') {
      const body = await request.json();
      const { categoryId, coverUrl } = body;
      if (!categoryId) return new Response(JSON.stringify({ error: 'Missing categoryId' }), { status: 400, headers: corsHeaders });
      const stored = await env.CAPS_VAULT_KV.get('portfolioCovers');
      const covers = stored ? JSON.parse(stored) : {};
      if (coverUrl) covers[categoryId] = coverUrl;
      else delete covers[categoryId];
      await env.CAPS_VAULT_KV.put('portfolioCovers', JSON.stringify(covers));
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get all saved Browse-page (category) covers as { categoryId: coverUrl, ... }
    if (action === 'list-portfolio-covers') {
      const stored = await env.CAPS_VAULT_KV.get('portfolioCovers');
      const covers = stored ? JSON.parse(stored) : {};
      return new Response(JSON.stringify({ covers }), { headers: corsHeaders });
    }

    // Save the home page Featured Pieces array to KV (whole array at once,
    // so toggling adds/removes are simple and atomic).
    if (action === 'save-featured' && request.method === 'POST') {
      const body = await request.json();
      const featured = Array.isArray(body.featured) ? body.featured : [];
      await env.CAPS_VAULT_KV.put('featured', JSON.stringify(featured));
      return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
    }

    // Get the saved Featured Pieces array
    if (action === 'list-featured') {
      const stored = await env.CAPS_VAULT_KV.get('featured');
      const featured = stored ? JSON.parse(stored) : [];
      return new Response(JSON.stringify({ featured }), { headers: corsHeaders });
    }

    // Get all saved album URLs from KV (excludes cover and featured entries)
    if (action === 'list') {
      const list = await env.CAPS_VAULT_KV.list();
      const data = {};
      for (const key of list.keys) {
        if (key.name.startsWith('cover:')) continue;
        if (key.name === 'featured') continue;
        if (key.name === 'texts') continue;
        if (key.name === 'portfolioCovers') continue;
        if (key.name === 'galleryOrders') continue;
        if (key.name === 'portfolioOrder') continue;
        data[key.name] = await env.CAPS_VAULT_KV.get(key.name);
      }
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // Load photos from SmugMug
    const albumPath = url.searchParams.get('path');
    if (!albumPath) return new Response(JSON.stringify({ error: 'Missing path' }), { status: 400, headers: corsHeaders });
    if (!env.SMUGMUG_API_KEY) return new Response(JSON.stringify({ error: 'Missing env vars' }), { status: 500, headers: corsHeaders });

    const lookup = await smugmugGet(`/api/v2/user/${USERNAME}!urlpathlookup`, {
      urlpath: albumPath, _accept: 'application/json'
    }, env);

    let albumKey = null, albumWebUri = null;
    if (lookup.data?.Response?.Album) {
      albumKey = lookup.data.Response.Album.AlbumKey;
      albumWebUri = lookup.data.Response.Album.WebUri;
    } else if (lookup.data?.Response?.Node?.Uris?.Album?.Uri) {
      albumKey = lookup.data.Response.Node.Uris.Album.Uri.split('/').pop();
      albumWebUri = lookup.data.Response.Node.WebUri;
    }

    if (!albumKey) return new Response(JSON.stringify({ error: 'Album not found' }), { status: 404, headers: corsHeaders });

    const imgResult = await smugmugGet(`/api/v2/album/${albumKey}!images`, {
      count: '500', _accept: 'application/json',
      _filter: 'Uri,FileName,Title,Caption,IsVideo,ThumbnailUrl,WebUri'
    }, env);

    if (!imgResult.data?.Response?.AlbumImage) return new Response(JSON.stringify({ images: [], count: 0 }), { headers: corsHeaders });

    const images = imgResult.data.Response.AlbumImage.map(img => {
      const isVideo = img.IsVideo || false;
      const thumbUrl = img.ThumbnailUrl || '';
      return {
        name: img.Title || img.FileName || 'Photo',
        caption: img.Caption || '',
        isVideo,
        thumbUrl: getSizedUrl(thumbUrl, 'M') || thumbUrl,
        largeUrl: isVideo ? '' : getSizedUrl(thumbUrl, 'X3Large'),
        videoUrl: '',
        posterUrl: isVideo ? (getSizedUrl(thumbUrl, 'M') || thumbUrl) : '',
        webUri: img.WebUri || albumWebUri || ''
      };
    });

    return new Response(JSON.stringify({ images, count: images.length }), { headers: corsHeaders });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
