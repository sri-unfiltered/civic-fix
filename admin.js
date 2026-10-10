"use strict";

const API_BASE = "http://localhost:3000/api";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let allReports = [];
let activeFilter = "all";
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
}

async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error("Cannot connect to the backend. Start your CivicFix server first.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The backend returned an invalid response.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }
  return data;
}

function getDate(value) {
  if (!value) return "Not provided";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function makeCellText(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function addCellText(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = makeCellText(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function updateStats() {
  $("#totalReports").textContent = allReports.length;
  $("#reviewReports").textContent =
    allReports.filter((r) => r.status === "Under Review").length;
  $("#highReports").textContent =
    allReports.filter((r) => ["High", "Critical"].includes(r.severity)).length;
  $("#resolvedReports").textContent =
    allReports.filter((r) => r.status === "Resolved").length;
}

function showReportDetails(report) {
  $("#detailTitle").textContent = report.trackingId || "Report details";
  const grid = $("#adminDetailGrid");
  grid.replaceChildren();

  const details = [
    ["Tracking ID", report.trackingId],
    ["Category", report.issueType],
    ["Location", report.location],
    ["Priority", report.severity],
    ["Status", report.status],
    ["Submitted", getDate(report.createdAt)],
    ["Description", report.description]
  ];

  details.forEach(([label, value]) => {
    const cell = document.createElement("div");
    cell.className = "detail-cell";

    const name = document.createElement("span");
    name.textContent = label;

    const content = document.createElement("strong");
    content.textContent = makeCellText(value);

    cell.append(name, content);
    grid.appendChild(cell);
  });

  $("#adminDetailModal").hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetails() {
  $("#adminDetailModal").hidden = true;
  document.body.classList.remove("modal-open");
}

$("#closeAdminModal")?.addEventListener("click", closeDetails);
$("#adminDetailModal")?.addEventListener("click", (event) => {
  if (event.target.id === "adminDetailModal") closeDetails();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#adminDetailModal").hidden) closeDetails();
});

function renderReports() {
  const body = $("#reportsTableBody");
  body.replaceChildren();

  const filtered = activeFilter === "all"
    ? allReports
    : allReports.filter((report) => report.status === activeFilter);

  $("#reportCountLabel").textContent =
    `${filtered.length} report${filtered.length === 1 ? "" : "s"} shown`;

  $("#emptyState").hidden = filtered.length !== 0;

  filtered.forEach((report) => {
    const row = document.createElement("tr");

    addCellText(row, report.trackingId, "admin-id");
    addCellText(row, report.issueType);
    addCellText(row, report.location);
    addCellText(row, report.severity);

    const statusCell = document.createElement("td");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Status for ${report.trackingId}`);

    const statuses = [
      "Submitted", "Under Review", "In Progress", "Resolved", "Rejected"
    ];

    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = status === report.status;
      select.appendChild(option);
    });

    select.addEventListener("change", async () => {
      const newStatus = select.value;
      select.disabled = true;

      try {
        await apiRequest(`/reports/${encodeURIComponent(report.trackingId)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus })
        });

        report.status = newStatus;
        updateStats();
        renderReports();
        showToast(`Report status updated to "${newStatus}".`);
      } catch (error) {
        select.value = report.status;
        $("#adminError").textContent = error.message;
      } finally {
        select.disabled = false;
      }
    });

    statusCell.appendChild(select);
    row.appendChild(statusCell);

    const detailsCell = document.createElement("td");
    const detailsButton = document.createElement("button");
    detailsButton.className = "button button-outline";
    detailsButton.style.padding = "7px 10px";
    detailsButton.textContent = "View";
    detailsButton.addEventListener("click", () => showReportDetails(report));
    detailsCell.appendChild(detailsButton);
    row.appendChild(detailsCell);

    body.appendChild(row);
  });
}

async function loadReports() {
  const refresh = $("#refreshDashboard");
  const error = $("#adminError");
  refresh.disabled = true;
  error.textContent = "";
  $("#reportCountLabel").textContent = "Loading reports…";

  try {
    const data = await apiRequest("/reports");
    allReports = Array.isArray(data.reports) ? data.reports : [];

    // Newest first when the backend includes timestamps.
    allReports.sort((a, b) =>
      new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    );

    updateStats();
    renderReports();
  } catch (problem) {
    error.textContent = problem.message;
    $("#reportCountLabel").textContent = "Could not load reports.";
    $("#emptyState").hidden = false;
  } finally {
    refresh.disabled = false;
  }
}

$$(".admin-filter").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".admin-filter").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeFilter = button.dataset.filter;
    renderReports();
  });
});

$("#refreshDashboard")?.addEventListener("click", loadReports);

loadReports();