const routes = {
  home: () => renderDashboard(),
  toolkit: () => renderToolkit(),
  notes: () => renderNotes(),
  todo: () => renderTodo(),
  login: () => renderLogin(),
  kanban: () => renderKanban(),
  // testgame: () => renderGame(),
};

// const protectedRoutes = ["home", "toolkit", "notes", "todo", "kanban"];

function navigate(route) {
  if (!routes[route]) {
    return;
  }

  const protectedRoutes = ["home", "toolkit", "notes", "todo", "kanban"];
  // const loggedIn = localStorage.getItem("userID") !== null;
  const loggedIn = isUserLoggedIn();

  if (protectedRoutes.includes(route) && !loggedIn) {
    console.warn("Access denied: No active session cookie found.");
    return navigate("login");
  }

  routes[route]();
  setActiveNav(route);

  if (window.location.hash !== `#${route}`) {
    history.replaceState(null, "", `#${route}`);
  }
}

window.addEventListener("load", () => {
  let route = window.location.hash.replace("#", "");
  if (!route || !routes[route]) {
    route = "home";
  }
  navigate(route);
});

window.addEventListener("hashchange", () => {
  const route = window.location.hash.replace("#", "");
  if (routes[route]) {
    navigate(route);
  }
});

// function isAuth() {
//   return localStorage.getItem("uuid") === "true";
// }

function isUserLoggedIn() {
  return document.cookie.split(';').some(item => item.trim().startsWith('auth='));
}