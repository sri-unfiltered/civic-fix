
"use strict";

const API_BASE = "http://localhost:3000/api";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let allReports = [];
let activeFilter = "all";
let toastTimer;

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;

  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      "Cannot connect to the backend. Start your CivicFix server first."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The backend returned an invalid response.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message || `Request failed (${response.status}).`
    );
  }

  return data;
}

function getDate(value) {
  if (!value) return "Not provided";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

function makeCellText(value) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function addCellText(row, value, className = "") {
  const cell = document.createElement("td");

  cell.textContent = makeCellText(value);

  if (className) {
    cell.className = className;
  }

  row.appendChild(cell);
  return cell;
}

function getReportFlags(report) {
  const flags = [];

  const location = String(report.location || "").trim();
  const verification = String(
    report.locationVerification || ""
  ).toLowerCase();

  if (!location) {
    flags.push("Location missing");
  } else if (
    [
      "missing",
      "approximate",
      "needs-verification",
      "unverified"
    ].includes(verification)
  ) {
    flags.push("Location needs verification");
  }

  const photoStatus = String(
    report.photoStatus || ""
  ).toLowerCase();

  if (
    [
      "missing",
      "not-provided",
      "not-provided-optional",
      "none"
    ].includes(photoStatus)
  ) {
    flags.push("No photo provided");
  }

  if (!String(report.description || "").trim()) {
    flags.push("Description missing");
  }

  if (!String(report.issueType || "").trim()) {
    flags.push("Category missing");
  }

  return flags;
}

function updateStats() {
  $("#totalReports").textContent = allReports.length;

  $("#reviewReports").textContent = allReports.filter(
    (report) => report.status === "Under Review"
  ).length;

  $("#highReports").textContent = allReports.filter(
    (report) => ["High", "Critical"].includes(report.severity)
  ).length;

  $("#resolvedReports").textContent = allReports.filter(
    (report) => report.status === "Resolved"
  ).length;
}

function showReportDetails(report) {
  $("#detailTitle").textContent =
    report.trackingId || "Report details";

  const grid = $("#adminDetailGrid");
  grid.replaceChildren();

  const details = [
    ["Tracking ID", report.trackingId],
    ["Category", report.issueType],
    ["Location", report.location],
    [
      "Location verification",
      report.locationVerification || "Not specified"
    ],
    ["Photo status", report.photoStatus || "Not specified"],
    ["Priority", report.severity],
    ["Status", report.status],
    ["Submitted", getDate(report.createdAt)],
    ["Description", report.description],
    [
      "Review flags",
      getReportFlags(report).join(" • ") ||
        "No obvious missing details"
    ]
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
  if (event.target.id === "adminDetailModal") {
    closeDetails();
  }
});

document.addEventListener("keydown", (event) => {
  const modal = $("#adminDetailModal");

  if (event.key === "Escape" && modal && !modal.hidden) {
    closeDetails();
  }
});

function renderReports() {
  const body = $("#reportsTableBody");
  body.replaceChildren();

  const filtered = activeFilter === "all"
    ? allReports
    : allReports.filter(
        (report) => report.status === activeFilter
      );

  $("#reportCountLabel").textContent =
    `${filtered.length} report${filtered.length === 1 ? "" : "s"} shown`;

  $("#emptyState").hidden = filtered.length !== 0;

  filtered.forEach((report) => {
    const row = document.createElement("tr");

    addCellText(row, report.trackingId, "admin-id");
    addCellText(row, report.issueType);

    const locationCell = addCellText(row, report.location);
    const flags = getReportFlags(report);

    if (flags.length > 0) {
      const note = document.createElement("small");
      note.textContent = flags.join(" • ");
      note.style.display = "block";
      note.style.marginTop = "4px";
      note.style.opacity = "0.8";
      locationCell.appendChild(note);
    }

    addCellText(row, report.severity);

    const statusCell = document.createElement("td");
    const select = document.createElement("select");

    select.setAttribute(
      "aria-label",
      `Status for ${report.trackingId || "report"}`
    );

    const statuses = [
      "Submitted",
      "Under Review",
      "In Progress",
      "Resolved",
      "Rejected"
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
        await apiRequest(
          `/reports/${encodeURIComponent(report.trackingId)}`,
          {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus })
          }
        );

        report.status = newStatus;

        updateStats();
        renderReports();

        showToast(`Report status updated to "${newStatus}".`);
        $("#adminError").textContent = "";
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

    detailsButton.addEventListener("click", () => {
      showReportDetails(report);
    });

    detailsCell.appendChild(detailsButton);
    row.appendChild(detailsCell);

    body.appendChild(row);
  });
}

async function loadReports() {
  const refresh = $("#refreshDashboard");
  const error = $("#adminError");

  if (refresh) refresh.disabled = true;
  if (error) error.textContent = "";

  $("#reportCountLabel").textContent = "Loading reports…";

  try {
    const data = await apiRequest("/reports");

    allReports = Array.isArray(data.reports)
      ? data.reports
      : [];

    allReports.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();

      return dateB - dateA;
    });

    updateStats();
    renderReports();
  } catch (problem) {
    if (error) error.textContent = problem.message;

    $("#reportCountLabel").textContent =
      "Could not load reports.";

    $("#emptyState").hidden = false;
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

$$(".admin-filter").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".admin-filter").forEach((item) => {
      item.classList.remove("active");
    });

    button.classList.add("active");
    activeFilter = button.dataset.filter || "all";

    renderReports();
  });
});

$("#refreshDashboard")?.addEventListener("click", loadReports);

loadReports();
