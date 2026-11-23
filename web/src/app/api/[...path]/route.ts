import {NextRequest,NextResponse} from 'next/server';

const base=process.env.INTERNAL_API_URL||'http://localhost:4000';

// Browser → Next (HTTPS) → API (HTTP). API needs X-Forwarded-Proto so secure session cookies are issued.
const buildUpstreamHeaders=(req:NextRequest)=>{
  const headers=new Headers();
  for (const k of ['content-type','cookie','authorization']) {
    const v=req.headers.get(k);
    if (v) headers.set(k,v);
  }
  const proto=
    req.headers.get('x-forwarded-proto')||
    process.env.TRUST_FORWARDED_PROTO||
    (process.env.NODE_ENV==='production'?'https':req.nextUrl.protocol.replace(':',''));
  const host=req.headers.get('x-forwarded-host')||req.headers.get('host');
  const forw=req.headers.get('x-forwarded-for')||req.headers.get('x-real-ip');
  headers.set('x-forwarded-proto',proto);
  if (host) headers.set('x-forwarded-host',host);
  if (forw) headers.set('x-forwarded-for',forw);
  return headers;
};

const attachUpstreamHeaders=(upstream:Response,out:NextResponse)=>{
  const ct=upstream.headers.get('content-type');
  if (ct) out.headers.set('content-type',ct);
  const cc=upstream.headers.get('cache-control');
  if (cc) out.headers.set('cache-control',cc);
  const cookies=typeof upstream.headers.getSetCookie==='function'?upstream.headers.getSetCookie():[];
  if (cookies.length) {
    for (const c of cookies) out.headers.append('set-cookie',c);
  } else {
    const single=upstream.headers.get('set-cookie');
    if (single) out.headers.set('set-cookie',single);
  }
};

async function proxy(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const {path}=await params;
  const url=`${base}/${path.join('/')}${req.nextUrl.search}`;
  const headers=buildUpstreamHeaders(req);
  const body=['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer();
  const upstream=await fetch(url,{method:req.method,headers,body,redirect:'manual',cache:'no-store'});
  const out=new NextResponse(upstream.body,{status:upstream.status});
  attachUpstreamHeaders(upstream,out);
  return out;
}

export const GET=proxy,POST=proxy,PUT=proxy,PATCH=proxy,DELETE=proxy;