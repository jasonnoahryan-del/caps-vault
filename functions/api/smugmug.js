async function hmacSha1(key, data) {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
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

    if (!albumKey) return new Response(JSON.stringify({ error: 'Album not found', details: lookup.data }), { status: 404, headers: corsHeaders });

    const imgResult = await smugmugGet(`/api/v2/album/${albumKey}!images`, {
      count: '500', _accept: 'application/json',
      _filter: 'Uri,FileName,Title,Caption,IsVideo,ThumbnailUrl,WebUri,Uris'
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
