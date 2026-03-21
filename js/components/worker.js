
/**
 * Obscyra Shell Worker - API Backend
 * Handles authentication and todo synchronization
 */

/* ============================================================================
   CONFIG & CONSTANTS
   ============================================================================ */

const CONFIG = {
  ALLOWED_ORIGINS: [
    "https://newui.obscyrashell.pages.dev",  // production
    "http://127.0.0.1:5500"                  // local development
  ],
  DEFAULT_ORIGIN: "https://newui.obscyrashell.pages.dev",
  TOKEN_EXPIRY: 60 * 60,  // 1 hour in seconds
  COOKIE_CONFIG: {
    name: "token",
    httpOnly: true,
    secure: true,
    sameSite: "None",
    partitioned: true,
    maxAge: 3600
  }
};

/* ============================================================================
   ENTRY POINT
   ============================================================================ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Handle preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(origin)
      });
    }

    try {
      // Route requests to appropriate handlers
      if (url.pathname === "/api/login" && request.method === "POST") {
        return await login(request, env);
      }

      if (url.pathname === "/api/register" && request.method === "POST") {
        return await register(request, env);
      }

      if (url.pathname === "/api/todo/save" && request.method === "POST") {
        return await saveTodos(request, env);
      }

      return errorResponse({ error: "Not Found" }, 404, origin);
    } catch (err) {
      console.error("Unhandled error:", err.message);
      return errorResponse({ error: "Internal Server Error" }, 500, origin);
    }
  }
};

/* ============================================================================
   CORS & RESPONSE HELPERS
   ============================================================================ */

function buildCorsHeaders(origin) {
  const safeOrigin = CONFIG.ALLOWED_ORIGINS.includes(origin)
    ? origin
    : CONFIG.DEFAULT_ORIGIN;

  return {
    "Access-Control-Allow-Origin": safeOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true"
  };
}

/**
 * Send JSON response with proper CORS headers
 */
function jsonResponse(data, options = {}, request = null) {
  const status = options.status || 200;
  const origin = request?.headers.get("Origin") || CONFIG.DEFAULT_ORIGIN;

  const headers = {
    "Content-Type": "application/json",
    ...buildCorsHeaders(origin),
    ...(options.headers || {})
  };

  return new Response(JSON.stringify(data), { status, headers });
}

/**
 * Send error response
 */
function errorResponse(data, status = 400, origin = null) {
  const headers = {
    "Content-Type": "application/json",
    ...buildCorsHeaders(origin || CONFIG.DEFAULT_ORIGIN)
  };
  return new Response(JSON.stringify(data), { status, headers });
}

/* ============================================================================
   AUTHENTICATION HANDLERS
   ============================================================================ */

/**
 * Register a new user
 */
async function register(request, env) {
  const { body, error } = await parseRequestBody(request);
  if (error) return errorResponse(error, 400, request.headers.get("Origin"));

  const { email, password, username } = body;

  // Validate required fields
  if (!email || !password || !username) {
    return jsonResponse(
      { error: "Missing required fields: email, password, username" },
      { status: 400 },
      request
    );
  }

  const normEmail = email.toLowerCase().trim();
  const normUsername = username.trim();

  try {
    const hash = await hashPassword(password);
    const userUuid = crypto.randomUUID();
    const now = new Date().toISOString();

    await env.DB.prepare(
      "INSERT INTO users (uuid, username, email, password_hash, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(userUuid, normUsername, normEmail, hash, now, "Never").run();

    return jsonResponse({ success: true }, {}, request);
  } catch (err) {
    return jsonResponse(
      { error: "Email already exists" },
      { status: 400 },
      request
    );
  }
}

/**
 * User login
 */
async function login(request, env) {
  const { body, error } = await parseRequestBody(request);
  if (error) return errorResponse(error, 400, request.headers.get("Origin"));

  const { email, password, browser } = body;

  if (!email || !password) {
    return jsonResponse(
      { error: "Missing email or password" },
      { status: 400 },
      request
    );
  }

  try {
    const normEmail = email.toLowerCase().trim();

    // Find user by email
    const user = await env.DB.prepare(
      "SELECT * FROM users WHERE email = ?"
    ).bind(normEmail).first();

    if (!user) {
      return jsonResponse(
        { error: "Invalid credentials" },
        { status: 401 },
        request
      );
    }

    // Verify password
    const passwordValid = await verifyPassword(password, user.password_hash);
    if (!passwordValid) {
      return jsonResponse(
        { error: "Invalid credentials" },
        { status: 401 },
        request
      );
    }

    // Update last login
    const lastLogin = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE users SET last_login = ?, browser = ? WHERE email = ?"
    ).bind(lastLogin, browser || "", normEmail).run();

    // Create auth token and cookie
    const token = await createAuthToken(user, env.JWT_SECRET);
    const cookieHeader = createCookieHeader(token);

    return jsonResponse(
      {
        success: true,
        user_username: user.username,
        user_uuid: user.uuid
      },
      {
        status: 200,
        headers: { "Set-Cookie": cookieHeader }
      },
      request
    );
  } catch (err) {
    console.error("Login error:", err.message);
    return jsonResponse(
      { error: "Login failed" },
      { status: 500 },
      request
    );
  }
}

/* ============================================================================
   AUTHORIZATION & TOKEN VERIFICATION
   ============================================================================ */

/**
 * Extract and verify JWT token from request cookies
 * Returns { valid: true, user: payload } or Response error
 */
async function verify(request, env) {
  const token = extractTokenFromCookies(request);

  if (!token) {
    return errorResponse(
      { error: "No session found" },
      401,
      request.headers.get("Origin")
    );
  }

  try {
    const payload = await verifyJWT(token, env.JWT_SECRET);
    return { valid: true, user: payload };
  } catch (err) {
    return errorResponse(
      { error: "Invalid or expired session" },
      401,
      request.headers.get("Origin")
    );
  }
}

/**
 * Extract token from Cookie header
 */
function extractTokenFromCookies(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const token = cookieHeader
    .split("; ")
    .find((row) => row.startsWith("token="))
    ?.split("=")[1];
  return token || null;
}

/* ============================================================================
   JWT & SECURITY
   ============================================================================ */

/**
 * Create JWT token for authenticated user
 */
async function createAuthToken(user, secret) {
  const payload = {
    sub: user.uuid,
    email: user.email,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + CONFIG.TOKEN_EXPIRY
  };
  return createJWT(payload, secret);
}

/**
 * Create JWT token
 * @param {Object} payload - Token payload
 * @param {string} secret - JWT secret key
 * @returns {Promise<string>} Encoded JWT token
 */
async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };

  const encode = (obj) =>
    btoa(JSON.stringify(obj))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

  const headerEncoded = encode(header);
  const payloadEncoded = encode(payload);

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

/**
 * Verify and decode JWT token
 */
async function verifyJWT(token, secret) {
  const [headerB64, payloadB64, signatureB64] = token.split(".");

  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("Invalid token format");
  }

  const encoder = new TextEncoder();

  // Import key for verification
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  // Verify signature
  const data = `${headerB64}.${payloadB64}`;
  const signature = Uint8Array.from(
    base64UrlDecode(signatureB64),
    (c) => c.charCodeAt(0)
  );

  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(data)
  );

  if (!isValid) throw new Error("Invalid signature");

  // Decode and validate payload
  const payloadJson = base64UrlDecode(payloadB64);
  const payload = JSON.parse(payloadJson);

  // Check expiration
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("Token expired");
  }

  return payload;
}

/**
 * Hash password using SHA-256
 */
async function hashPassword(password) {
  const enc = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

/**
 * Verify password against stored hash
 */
async function verifyPassword(password, storedHash) {
  const hash = await hashPassword(password);
  return hash === storedHash;
}

/**
 * Create HTTP cookie header with token
 */
function createCookieHeader(token) {
  const { name, httpOnly, secure, sameSite, partitioned, maxAge } = CONFIG.COOKIE_CONFIG;
  return `${name}=${token}; HttpOnly; Secure; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}; ${partitioned ? "Partitioned" : ""}`.trim();
}

/**
 * Decode base64url string
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad) str += "=".repeat(4 - pad);
  return atob(str);
}

/* ============================================================================
   TODO HANDLERS
   ============================================================================ */

/**
 * Save/sync user's todo list
 */
async function saveTodos(request, env) {
  // Verify authentication
  const authResult = await verify(request, env);
  if (authResult instanceof Response) return authResult;

  const userUuid = authResult.user.sub;
  if (!userUuid) {
    return jsonResponse(
      { error: "User UUID missing from auth token" },
      { status: 400 },
      request
    );
  }

  try {
    // Parse request body
    const { body, error } = await parseRequestBody(request);
    if (error) return jsonResponse(error, { status: 400 }, request);

    const { todoList } = body;
    if (!Array.isArray(todoList)) {
      return jsonResponse(
        { error: "Invalid data format: todoList must be an array" },
        { status: 400 },
        request
      );
    }

    // Delete existing todos for user
    await env.DB.prepare("DELETE FROM todos WHERE user_uuid = ?")
      .bind(userUuid)
      .run();

    // Insert new todos if any exist
    if (todoList.length > 0) {
      const statements = todoList.map((todo) =>
        env.DB.prepare(
          "INSERT INTO todos (id, user_uuid, task_text, completed, created_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(
          crypto.randomUUID(),
          userUuid,
          todo.text || "Untitled",
          todo.completed ? 1 : 0,
          todo.timestamp || new Date().toISOString()
        )
      );

      await env.DB.batch(statements);
    }

    return jsonResponse(
      {
        success: true,
        message: `Successfully synced ${todoList.length} tasks`,
        count: todoList.length
      },
      {},
      request
    );
  } catch (err) {
    console.error("Todo save error:", err.message);
    return jsonResponse(
      { error: "Failed to save todos to database" },
      { status: 500 },
      request
    );
  }
}

/* ============================================================================
   UTILITY HELPERS
   ============================================================================ */

/**
 * Parse and validate JSON request body
 * @returns {{ body: Object|null, error: Object|null }}
 */
async function parseRequestBody(request) {
  try {
    const body = await request.json();
    return { body, error: null };
  } catch (err) {
    return {
      body: null,
      error: { error: "Invalid JSON in request body" }
    };
  }
}