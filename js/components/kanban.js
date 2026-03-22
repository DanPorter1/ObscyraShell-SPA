/* EXAMPLE LOCALSTORAGE OBJ
  {
      "id": "6f05a6a9-bb96-48b5-a3a1-faa8a6e5b8d0",
      "title": "Testing 2",
      "description": "Testing new add btn",
      "column_name": "Suggestions",
      "position": 1,
      "created_at": "21/03/2026, 22:44:56",
      "updated_at": "22/03/2026, 19:00:38"
  }
*/

const kanbanColumns = [
  "Suggestions",
  "inProgress",
  "Testing",
  "Complete",
];

function renderKanban() {
  setContent(`
    <section class="panel kanban-panel">
      <h1>Kanban Board</h1>
      <p class="text-soft">Some Kanban Boards</p>

      <form id="kanban-add-form" class="kanban-add-form">
        <input id="kanban-title" type="text" placeholder="New task title" required />
        <input id="kanban-desc" type="text" placeholder="New task description" />
      </form>
      <div class="kanban-sync">
        <div class="kanban-sync-left">
          <button class="btn-small" type="submit" id="addKBtn">Add</button>
        </div>
        <div class="kanban-sync-right">
          <button id="btn-save-kanban" value="Save" class="btn-small">Save</button>
          <button id="btn-sync-kanban" value="Sync" class="btn-small">Load</button>
        </div>
      </div>

      <div id="kanban-board" class="kanban-board">
        ${kanbanColumns
          .map(
            (column) => `
            <div class="kanban-column">
              <h2>${column}</h2>
              <div class="kanban-column-cards" data-column="${column}"></div>
            </div>
          `
          )
          .join("")}
      </div>
    </section>
  `);

  initKanban();
}

let kanbanTasks = [];

function renderKanbanCards() {
  document.querySelectorAll(".kanban-column-cards").forEach(col => col.innerHTML = "");

  kanbanTasks.forEach((task, index) => {
    const columnContainer = document.querySelector(`[data-column="${task.column_name}"]`);
    if (!columnContainer) return;

    const card = document.createElement("div");
    card.className = "kanban-card";

    // TODO : Pen icon for edit
    card.innerHTML = `
      <div class="card-content">
        <h3 class="card-title">${task.title}</h3>
        <p class="card-desc text-soft">${task.description || ""}</p>
        <div class="card-meta">
          <span class="card-time">${task.created_at}</span>
        </div>
      </div>
      <div class="card-actions">
         <button class="move-btn" data-index="${index}" data-dir="prev">←</button>
         <button class="move-btn" data-index="${index}" data-dir="next">→</button>
         <button class="edit-btn" data-index="${index}">E</button>
         <button class="delete-btn btn-right" data-index="${index}">×</button>
      </div>
    `;
    columnContainer.appendChild(card);
  });
}

function addKanbanCard(title, description) {
  const newTask = {
    id: crypto.randomUUID(),
    title: title,
    description: description || "",
    column_name: "Suggestions",
    position: kanbanTasks.length,
    created_at: new Date().toLocaleString("en-GB"),
    updated_at: new Date().toLocaleString("en-GB")
  };

  kanbanTasks.push(newTask);
  saveKanbanLocal();
  renderKanbanCards();
}

function moveCard(index, direction) {
  const columns = ["Suggestions", "inProgress", "Testing", "Complete"];
  let currentIndex = columns.indexOf(kanbanTasks[index].column_name);
  
  if (direction === "next" && currentIndex < columns.length - 1) {
    currentIndex++;
  } else if (direction === "prev" && currentIndex > 0) {
    currentIndex--;
  }

  kanbanTasks[index].column_name = columns[currentIndex];
  kanbanTasks[index].updated_at = new Date().toLocaleString("en-GB");
  saveKanbanLocal();
  renderKanbanCards();
}

function initKanban() {
  loadKanbanLocal();
  renderKanbanCards();

  const addKBtn = document.getElementById("addKBtn");

  // on("#kanban-add-form", "submit", (e) => {
  addKBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const title = document.getElementById("kanban-title").value.trim();;
    const desc = document.getElementById("kanban-desc").value.trim();
    if (!title) return;
    addKanbanCard(title, desc);
    input.value = "";
  });

  document.getElementById("kanban-board").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const index = btn.dataset.index;

    if (btn.classList.contains("move-btn")) {
      moveCard(index, btn.dataset.dir);
    }

    if (btn.classList.contains("delete-btn")) {
      kanbanTasks.splice(index, 1);
      saveKanbanLocal();
      renderKanbanCards();
    }

  });
  on("#btn-save-kanban", "click", cloudSaveKanban);
  on("#btn-sync-kanban", "click", cloudSyncKanban);
}

function saveKanbanLocal() {
  localStorage.setItem("kanban_tasks", JSON.stringify(kanbanTasks));
}

function loadKanbanLocal() {
  const saved = localStorage.getItem("kanban_tasks");
  kanbanTasks = saved ? JSON.parse(saved) : [];
}

/* ---------- ---------- ----- ---------- ---------- */
/* ---------- ---------- CLOUD ---------- ---------- */
/* ---------- ---------- ----- ---------- ---------- */
async function cloudSaveKanban() {
  const response = await fetch("https://the-tree-army-767051.danporter-36a.workers.dev/api/kanban/save", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ 
      kanbanItems: kanbanTasks})
  });

  if (response.ok) {
    const data = await response.json();
    console.log(data);
    alert("Saved to Cloud!");
  } else {
    console.error("Failed to save to Cloud");
  }
}

/* Remove local storage and sync with cloud */
async function cloudSyncKanban() {
  const response = await fetch("https://the-tree-army-767051.danporter-36a.workers.dev/api/kanban/sync", {
    method: "GET",
    credentials: "include",
    headers: {
      "Content-Type": "application/json"
    }
  });

  if (response.ok) {
    const data = await response.json();
    console.log(data.results);
    kanbanTasks = data.results.map(item => ({
      column_name: item.column_name,
      created_at: item.created_at,
      description: item.created_at,
      id: item.id,
      position: item.position,
      title: item.title,
      updated_at: item.updated_at
    }));
    saveKanbanLocal();
    renderKanbanCards();
  }
}