// Setup inactivity
let lastActivity = Date.now();
window.addEventListener("mousemove", resetActivity);
window.addEventListener("keydown", resetActivity);
window.addEventListener("click", resetActivity);
window.addEventListener("scroll", resetActivity);

const inactivity_limit = 60 * 60 * 1000; // 60 minutes
// const inactivity_limit =1 * 60 * 1000; // 1 minute testing

// Check inactivity - 30 seconds
setInterval(() => {
  const now = Date.now();
  const inactiveFor = now - lastActivity;
  if (inactiveFor > inactivity_limit) {
    console.log("Logging out due to inactivity.");
    localStorage.removeItem("userID");
    window.location.href = "#login";
  }
}, 30000);


// Main
function setContent(html) {
  const root = document.getElementById("app-root");
  root.innerHTML = html;
}

function on(selector, event, handler) {
  const elements = document.querySelector(selector);
  if (elements) elements.addEventListener(event, handler);
}

function setActiveNav(route) {
  document.querySelectorAll("#top-nav .nav-links a").forEach((link) => {
    link.classList.toggle("active", link.dataset.route === route);
  });
}

// Set login expiry - LocalStorage
function setWithExpiry(key, value, ttlSeconds) {
  const now = Date.now();

  const item = {
    value,
    expiry: now + ttlSeconds * 1000
  };

  localStorage.setItem(key, JSON.stringify(item));
}

// Remove expired login - LocalStorage
function cleanupExpired(key) {
  const itemStr = localStorage.getItem(key);
  if (!itemStr) return;

  try {
    const item = JSON.parse(itemStr);
    const now = Date.now();

    if (item.expiry && now > item.expiry) {
      localStorage.removeItem(key);
    }
  } catch {
    localStorage.removeItem(key);
  }
}

// Activity Monitor
function resetActivity() {
  lastActivity = Date.now();
}

// Util
function getUserValue() {
  const itemStr = localStorage.getItem("userID");
  if (!itemStr) return null;

  try {
    const item = JSON.parse(itemStr);
    return item.value || null;
  } catch {
    return null;
  }
}

function formatDateTime(date = new Date()) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} ${h}:${min}`;
}

// TODO: Add logout api - Add to inactivity / logout btn / timer check