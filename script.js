"use strict";

const API_BASE = "http://localhost:3000/api";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let lastTrackingId = "";
let toastTimer = null;
let previewUrl = null;

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

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");

  const focusable = modal.querySelector(
    "input:not([type=file]), select, textarea, button"
  );
  if (focusable) setTimeout(() => focusable.focus(), 50);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = true;

  const anyOpen = $$(".modal-backdrop").some((item) => !item.hidden);
  document.body.classList.toggle("modal-open", anyOpen);
}

function closeAllModals() {
  $$(".modal-backdrop").forEach((modal) => {
    modal.hidden = true;
  });
  document.body.classList.remove("modal-open");
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
  } catch (error) {
    throw new Error(
      "Cannot connect to CivicFix's backend. Make sure the backend server is running."
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status}).`);
  }

  return data;
}

// Open report and tracking modals.
$$("[data-open-report]").forEach((button) => {
  button.addEventListener("click", () => openModal("reportModal"));
});

$("#openTracker")?.addEventListener("click", () => openModal("trackerModal"));

$$("[data-close-modal]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.dataset.closeModal));
});

$$(".modal-backdrop").forEach((backdrop) => {
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop && backdrop.id !== "successModal") {
      closeModal(backdrop.id);
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  // Keep the success popup until the user explicitly closes it.
  const success = $("#successModal");
  if (success && !success.hidden) return;

  const open = $$(".modal-backdrop").find((modal) => !modal.hidden);
  if (open) closeModal(open.id);
});

// Mobile navigation.
$("#menuBtn")?.addEventListener("click", () => {
  const nav = $("#mobileNav");
  const isOpen = nav.classList.toggle("open");
  $("#menuBtn").setAttribute("aria-expanded", String(isOpen));
});

$$('#mobileNav a').forEach((link) => {
  link.addEventListener("click", () => {
    $("#mobileNav").classList.remove("open");
    $("#menuBtn")?.setAttribute("aria-expanded", "false");
  });
});

// Category filters.
$$(".filter-btn").forEach((button) => {
  button.addEventListener("click", () => {
    $$(".filter-btn").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");

    const filter = button.dataset.filter;
    $$(".issue-card").forEach((card) => {
      card.hidden = filter !== "all" && card.dataset.category !== filter;
    });
  });
});

// Location helper. GPS requires browser permission and usually localhost or HTTPS.
$("#getLocationBtn")?.addEventListener("click", () => {
  const status = $("#locationStatus");
  const button = $("#getLocationBtn");

  if (!navigator.geolocation) {
    status.textContent = "GPS is not supported in this browser. Enter the location manually.";
    return;
  }

  button.disabled = true;
  status.textContent = "Getting your location…";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      $("#issueLocation").value = `GPS coordinates: ${latitude}, ${longitude}`;
      status.textContent = "Location added. You can edit it if needed.";
      button.disabled = false;
    },
    () => {
      status.textContent = "Location permission failed. Please type the location manually.";
      button.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

// Local photo preview only. This prototype does not upload photos to the API.
$("#issuePhoto")?.addEventListener("change", () => {
  const input = $("#issuePhoto");
  const preview = $("#photoPreview");

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  preview.replaceChildren();
  preview.hidden = true;

  const file = input.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    input.value = "";
    showToast("Please choose an image file.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    input.value = "";
    showToast("Choose an image smaller than 5 MB.");
    return;
  }

  previewUrl = URL.createObjectURL(file);
  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = "Selected report photo preview";
  preview.appendChild(image);
  preview.hidden = false;
});

// Submit a report.
$("#reportForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const submitButton = $("#submitReportBtn");
  const message = $("#reportFormMessage");
  message.textContent = "";

  const report = {
    issueType: $("#issueType").value,
    location: $("#issueLocation").value.trim(),
    description: $("#issueDescription").value.trim(),
    severity: $("#issueSeverity").value
  };

  if (!report.issueType || !report.location || !report.description || !report.severity) {
    message.textContent = "Please complete every required field.";
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = "Submitting…";

  try {
    const data = await apiRequest("/reports", {
      method: "POST",
      body: JSON.stringify(report)
    });

    lastTrackingId = data.report?.trackingId || "";

    if (!lastTrackingId) {
      throw new Error("The report was submitted, but the server did not return a tracking ID.");
    }

    $("#trackingId").textContent = lastTrackingId;
    $("#successMessage").textContent =
      data.message || "Your report was received. Keep your tracking ID to check progress.";

    $("#reportForm").reset();
    $("#photoPreview").replaceChildren();
    $("#photoPreview").hidden = true;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $("#locationStatus").textContent = "You can enter the location manually.";

    closeModal("reportModal");
    openModal("successModal");

    // IMPORTANT: no timer closes the success modal.
    // It remains visible until the user presses a button to close it.
    refreshStats();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitButton.disabled = false;
    submitButton.innerHTML = 'Submit report <span>↗</span>';
  }
});

// Success modal controls.
$("#closeSuccessBtn")?.addEventListener("click", () => {
  closeModal("successModal");
});

$("#copyTrackingBtn")?.addEventListener("click", async () => {
  const value = $("#trackingId").textContent.trim();

  try {
    await navigator.clipboard.writeText(value);
    showToast("Tracking ID copied.");
  } catch {
    // Fallback for browsers without clipboard permission.
    const field = document.createElement("textarea");
    field.value = value;
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    showToast(copied ? "Tracking ID copied." : `Your tracking ID is ${value}`);
  }
});

$("#trackAfterSubmit")?.addEventListener("click", () => {
  const id = $("#trackingId").textContent.trim();
  closeModal("successModal");
  $("#trackerInput").value = id;
  $("#trackerResult").replaceChildren();
  openModal("trackerModal");
  $("#trackerForm").requestSubmit();
});

// Report tracking.
$("#trackerForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const id = $("#trackerInput").value.trim().toUpperCase();
  const result = $("#trackerResult");
  const button = $("#trackSubmitBtn");

  result.replaceChildren();
  if (!id) {
    result.textContent = "Enter a tracking ID.";
    return;
  }

  button.disabled = true;
  button.textContent = "Searching…";

  try {
    const data = await apiRequest(`/reports/${encodeURIComponent(id)}`);
    const report = data.report;

    if (!report) throw new Error("No report was returned.");

    const card = document.createElement("div");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.textContent = report.trackingId || id;

    const status = document.createElement("span");
    status.className = "status-pill";
    status.textContent = report.status || "Submitted";

    const details = [
      ["Category", report.issueType],
      ["Location", report.location],
      ["Description", report.description],
      ["Priority", report.severity],
      ["Submitted", report.createdAt ? new Date(report.createdAt).toLocaleString() : "Not available"]
    ];

    card.append(title, status);

    details.forEach(([label, value]) => {
      if (!value) return;
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = `${label}: `;
      p.append(strong, document.createTextNode(String(value)));
      card.appendChild(p);
    });

    const timeline = document.createElement("div");
    timeline.className = "timeline";

    const history = document.createElement("div");
    history.className = "timeline-item";
    history.textContent = `Current status: ${report.status || "Submitted"}`;
    timeline.appendChild(history);

    const note = document.createElement("p");
    note.className = "field-note";
    note.textContent = "This prototype displays the latest saved status. It does not yet store a full status-change history.";

    card.append(timeline, note);
    result.appendChild(card);
  } catch (error) {
    const errorMessage = document.createElement("p");
    errorMessage.className = "form-message";
    errorMessage.textContent = error.message;
    result.appendChild(errorMessage);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Find my report <span>→</span>';
  }
});

// Update home-page statistics from the backend.
async function refreshStats() {
  try {
    const data = await apiRequest("/reports");
    const reports = Array.isArray(data.reports) ? data.reports : [];

    const total = reports.length;
    const resolved = reports.filter((report) => report.status === "Resolved").length;
    const active = reports.filter((report) =>
      ["Submitted", "Under Review", "In Progress"].includes(report.status)
    ).length;

    $("#statTotal").textContent = total;
    $("#statProgress").textContent = active;
    $("#statResolved").textContent = resolved;
  } catch {
    $("#statTotal").textContent = "—";
    $("#statProgress").textContent = "—";
    $("#statResolved").textContent = "—";
  }
}

async function checkBackend() {
  try {
    await apiRequest("/health");
    console.info("CivicFix backend connected.");
  } catch (error) {
    console.warn(error.message);
    showToast("Backend is offline. Start it to submit and track reports.");
  }
}

checkBackend();
refreshStats();