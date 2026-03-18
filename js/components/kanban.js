const kanbanColumns = [
  "Backlog",
  "Coding",
  "Testing",
  "Approval",
  "Done",
];

const KANBAN_API_BASE = "/api/kanban";
let kanbanCards = [];

async function apiFetch(path = "", options = {}) {
  const response = await fetch(`${KANBAN_API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `API error ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function loadKanban() {
  try {
    kanbanCards = await apiFetch();
  } catch (err) {
    console.error("Failed to load kanban cards", err);
    kanbanCards = [];
  }
}

async function addKanbanCard(card) {
  const created = await apiFetch("", {
    method: "POST",
    body: JSON.stringify(card),
  });
  kanbanCards.push(created);
}

async function updateKanbanCard(id, fields) {
  const updated = await apiFetch(`/${id}`, {
    method: "PATCH",
    body: JSON.stringify(fields),
  });

  const idx = kanbanCards.findIndex((c) => c.id === id);
  if (idx !== -1) {
    kanbanCards[idx] = updated;
  }
}

async function deleteKanbanCard(id) {
  await apiFetch(`/${id}`, { method: "DELETE" });
  kanbanCards = kanbanCards.filter((c) => c.id !== id);
}

async function renderKanban() {
  await loadKanban();

  setContent(`
    <section class="panel kanban-panel">
      <h1>Kanban Board</h1>
      <p class="text-soft">Add cards, move work through columns, and save to Cloudflare D1.</p>

      <form id="kanban-add-form" class="kanban-add-form">
        <input id="kanban-title" type="text" placeholder="New task title" required />
        <select id="kanban-column-select">
          ${kanbanColumns
            .map((column) => `<option value="${column}">${column}</option>`)
            .join("")}
        </select>
        <button class="btn-small" type="submit">Add</button>
      </form>

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

  renderKanbanColumns();
  initKanban();
}

function renderKanbanColumns() {
  kanbanColumns.forEach((column) => {
    const container = document.querySelector(`.kanban-column-cards[data-column="${column}"]`);
    if (!container) return;

    container.innerHTML = "";

    kanbanCards
      .filter((card) => card.status === column)
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((card) => {
        const cardEl = document.createElement("div");
        cardEl.className = "kanban-card";
        cardEl.draggable = true;
        cardEl.dataset.id = card.id;

        const currentIndex = kanbanColumns.indexOf(card.status);
        const canMoveLeft = currentIndex > 0;
        const canMoveRight = currentIndex < kanbanColumns.length - 1;

        cardEl.innerHTML = `
          <div class="card-content">
            <div class="card-title">${escapeHtml(card.title)}</div>
            <div class="card-meta">${new Date(card.created_at).toLocaleString()}</div>
          </div>
          <div class="card-actions">
            <button data-action="move-left" data-id="${card.id}" ${!canMoveLeft ? "disabled" : ""}>◀</button>
            <button data-action="move-right" data-id="${card.id}" ${!canMoveRight ? "disabled" : ""}>▶</button>
            <button data-action="delete" data-id="${card.id}" class="btn-danger">✕</button>
          </div>
        `;

        container.appendChild(cardEl);
      });
  });
}

function initKanban() {
  const board = document.getElementById("kanban-board");

  on("#kanban-add-form", "submit", async (e) => {
    e.preventDefault();

    const titleInput = document.getElementById("kanban-title");
    const columnSelect = document.getElementById("kanban-column-select");
    const title = titleInput.value.trim();

    if (!title) return;

    try {
      await addKanbanCard({ title, status: columnSelect.value });
      titleInput.value = "";
      columnSelect.value = "Backlog";
      renderKanbanColumns();
    } catch (err) {
      console.error("Add card failed", err);
      alert("Could not add card: " + err.message);
    }
  });

  board.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;
    const card = kanbanCards.find((c) => c.id === id);
    if (!card) return;

    try {
      if (action === "delete") {
        await deleteKanbanCard(id);
      } else if (action === "move-left") {
        const idx = kanbanColumns.indexOf(card.status);
        if (idx > 0) {
          await updateKanbanCard(id, { status: kanbanColumns[idx - 1] });
        }
      } else if (action === "move-right") {
        const idx = kanbanColumns.indexOf(card.status);
        if (idx < kanbanColumns.length - 1) {
          await updateKanbanCard(id, { status: kanbanColumns[idx + 1] });
        }
      }
      renderKanbanColumns();
    } catch (err) {
      console.error("Kanban action failed", err);
      alert("Could not update card: " + err.message);
    }
  });

  document.querySelectorAll(".kanban-column-cards").forEach((columnEl) => {
    columnEl.addEventListener("dragstart", (e) => {
      const card = e.target.closest(".kanban-card");
      if (!card) return;
      e.dataTransfer.setData("text/plain", card.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });

    columnEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      columnEl.classList.add("kanban-drop-target");
    });

    columnEl.addEventListener("dragleave", () => {
      columnEl.classList.remove("kanban-drop-target");
    });

    columnEl.addEventListener("drop", async (e) => {
      e.preventDefault();
      columnEl.classList.remove("kanban-drop-target");

      const cardId = e.dataTransfer.getData("text/plain");
      const cardDropped = kanbanCards.find((c) => c.id === cardId);
      const targetColumn = columnEl.dataset.column;
      if (!cardDropped || !targetColumn || cardDropped.status === targetColumn) return;

      try {
        await updateKanbanCard(cardId, { status: targetColumn });
        renderKanbanColumns();
      } catch (err) {
        console.error("Drag-drop update failed", err);
        alert("Could not move card: " + err.message);
      }
    });
  });
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
