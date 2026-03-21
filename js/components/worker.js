
/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run "npm run dev" in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run "npm run deploy" to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://newui.obscyrashell.pages.dev",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true"
};

export default { 
  async fetch(request, env) { 
    const url = new URL(request.url); 

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      return await login(request, env); } 

    if (url.pathname === "/api/register" && request.method === "POST") {
      console.log("Path, url.pathname")
      return await register(request, env);
    }

    if (url.pathname === "/api/verify" && request.method === "GET") {
      return await verify(request, env); 
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      return new Response("Running");
    }

    if (url.pathname === "/api/todo/save" && request.method === "POST") {
      return await saveTodos(request);
    }

    // if (url.pathname === "/api/status" && request.method === "GET") {
    //   return new Response("Running");
    // }
      
    return new Response("Not Found! Sorry... ", { status: 404 });
   }
};

async function register(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid or missing JSON body"}, 400);
  }

  const {email, password, username} = body;

  if (!email || !password) {
    return json({ error: "Missing fields" }, 400);
  }

  const normEmail = email.toLowerCase().trim();
  const normUsername = username.trim();
  const hash = await hashPassword(password);
  const userUuid = crypto.randomUUID(); 
  const now = new Date().toISOString();

  try {
    const createdAt = new Date().toISOString(); 
    await env.DB.prepare(
      "INSERT INTO users (uuid, username, email, password_hash, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)"
    ) 
    .bind(userUuid, normUsername, normEmail, hash, now, "Never")
    .run();

  } catch (err) {
    return json({ error: "Email already exists" }, 400);
  }
  return json({ success: true });
};

async function login(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { 
      headers: corsHeaders 
    }); 
  }
  const { email, password, browser } = await request.json();

  const normemail = email.toLowerCase().trim();

  const user = await env.DB.prepare(
    "SELECT * FROM users WHERE email = ?"
  )
  .bind(normemail)
  .first();

  if (!user) return json({ error: "Invalid credentials" }, 400);
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return json({ error: "Invalid credentials" }, 400);

  const lastLogin = new Date().toISOString(); 
  await env.DB.prepare(
    "UPDATE users SET last_login = ?, browser = ? WHERE email = ?"
  )
  .bind(lastLogin, browser, normemail)
  .run();

  const token = await createJWT({ 
    sub: user.uuid,
    username: user.username,
    exp: Math.floor(Date.now() /1000) +  60 * 60 * 1 //60 * 60 // 1 Hour exp * 12 = 12 hours 
    }, 
    env.JWT_SECRET
  );

  // const cookieValue = `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
  // const cookieValue = `token=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`;
  const cookieValue = `token=${token}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=3600; Partitioned;`;
  return json({ 
    success: true, 
    user_uuid: user.uuid,
    user_username: user.username
  }, 
  { 
    status: 200, 
    headers: { "Set-Cookie": cookieValue } 
  }
)};

async function verify(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  
  const token = cookieHeader
    .split('; ')
    .find(row => row.startsWith('token='))
    ?.split('=')[1];

  if (!token) {
    return new Response(JSON.stringify({ error: "No session found" }), { 
      status: 401, 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);

    return { valid: true, user: payload };

  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid or expired session" }), { 
      status: 401, 
      headers: { "Content-Type": "application/json", ...corsHeaders } 
    });
  }
}

async function verifyJWT(token, secret) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");
  
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("Invalid token format");
  } 
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false, 
    ["verify"] 
    );

    const data = `${headerB64}.${payloadB64}`;
    const signature = Uint8Array.from( base64UrlDecode(signatureB64),
    c => c.charCodeAt(0) 
    ); 

    const valid = await crypto.subtle.verify(
      "HMAC", 
      key, 
      signature, 
      encoder.encode(data) 
    ); 
    
    if (!valid) throw new Error("Invalid signature");
    
    const payloadJson = base64UrlDecode(payloadB64);
    const payload = JSON.parse(payloadJson);
    const now = Math.floor(Date.now() / 1000);
    
    if (payload.exp && now > payload.exp) {
      throw new Error("Token expired"); 

    } return payload; 
  }

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = str.length % 4; if (pad) str += '='.repeat(4 - pad);
    return atob(str); 
  }


/* -------------------- PASSWORD HASHING -------------------- */

async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

async function verifyPassword(password, storedHash) {
  const hash = await hashPassword(password);
  return hash === storedHash;
}

/* -------------------- JWT (NO DEPENDENCIES) -------------------- */

async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };

  const enc = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerEncoded = enc(header);

  const exp = payload.exp ?? (Math.floor(Date.now() / 1000) + 60 * 60);

  const payloadEncoded = enc({
    ...payload,
    exp
  });

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${headerEncoded}.${payloadEncoded}`)
  );

  const signatureEncoded = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
}

/* -------------------- UTIL -------------------- */

function json(obj, options = {}, request) {
  const status = options.status || 200;
  
  const headers = {
    "Content-Type": "application/json",
    ...corsHeaders,
    ...options.headers
    
  };

  return new Response(JSON.stringify(obj), { status, headers });
}

/* -------------------- ToDo -------------------- */
async function saveTodos(request, env) {
    const authResult = await verify(request, env);
    if (authResult instanceof Response) return authResult;
    const user = authResult.user;
    console.log("Saving data for user:", user.email);
    return json ({
      message: "Done some auth",
      user: user
    })
    // ... your save logic ...
  }
