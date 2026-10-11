

"use strict";

const API_BASE = "http://localhost:3000/api";
const DRAFT_KEY = "civicfix_phase2_draft";
const QUEUE_KEY = "civicfix_phase2_queue";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let lastTrackingId = "";
let toastTimer = null;
let previewUrl = null;
let submitting = false;

function readStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    showToast("Browser storage is unavailable. Keep a copy of your report.");
    return false;
  }
}

function getQueue() {
  return readStorage(QUEUE_KEY, []);
}

function saveQueue(queue) {
  return writeStorage(QUEUE_KEY, queue);
}

function showToast(message) {
  const toast = $("#toast");
  if (!toast) {
    console.info(message);
    return;
  }

  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 3500);
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
  document.body.classList.toggle(
    "modal-open",
    $$(".modal-backdrop").some((item) => !item.hidden)
  );
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
        ...(options.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {})
      }
    });
  } catch {
    throw new Error(
      "Cannot connect to the backend. Your report can be kept for retry."
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

// Phase 2 status panel and discard control.
function addPhaseTwoControls() {
  const form = $("#reportForm");
  if (!form || $("#draftStatus")) return;

  const status = document.createElement("p");
  status.id = "draftStatus";
  status.className = "field-note";
  status.setAttribute("aria-live", "polite");
  status.textContent = "Draft saving is ready.";

  const discard = document.createElement("button");
  discard.type = "button";
  discard.id = "discardDraftBtn";
  discard.className = "text-button";
  discard.textContent = "Discard saved draft";

  const queueStatus = document.createElement("p");
  queueStatus.id = "queueStatus";
  queueStatus.className = "field-note";
  queueStatus.setAttribute("aria-live", "polite");

  form.append(status, discard, queueStatus);

  discard.addEventListener("click", () => {
    if (!confirm("Discard this saved draft? This cannot be undone.")) return;

    localStorage.removeItem(DRAFT_KEY);
    form.reset();
    clearPhotoPreview();

    $("#locationStatus").textContent =
      "You can enter the location manually.";
    $("#reportFormMessage").textContent = "";
    status.textContent = "Saved draft discarded.";
    showToast("Draft discarded.");
    updateQueueStatus();
  });
}

function getFormDraft() {
  return {
    issueType: $("#issueType")?.value || "",
    location: $("#issueLocation")?.value.trim() || "",
    description: $("#issueDescription")?.value.trim() || "",
    severity: $("#issueSeverity")?.value || "",
    locationVerification:
      $("#issueLocation")?.dataset.verification || "unverified",
    savedAt: new Date().toISOString()
  };
}

function saveDraft() {
  const draft = getFormDraft();
  const hasContent = Boolean(
    draft.issueType || draft.location || draft.description || draft.severity
  );

  if (!hasContent) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }

  if (writeStorage(DRAFT_KEY, draft)) {
    const status = $("#draftStatus");
    if (status) {
      status.textContent =
        `Draft saved on this device at ${new Date().toLocaleTimeString()}.`;
    }
  }
}

function restoreDraft() {
  const draft = readStorage(DRAFT_KEY, null);
  if (!draft) return;

  if ($("#issueType")) $("#issueType").value = draft.issueType || "";
  if ($("#issueLocation")) {
    $("#issueLocation").value = draft.location || "";
    $("#issueLocation").dataset.verification =
      draft.locationVerification || "unverified";
  }
  if ($("#issueDescription")) {
    $("#issueDescription").value = draft.description || "";
  }
  if ($("#issueSeverity")) {
    $("#issueSeverity").value = draft.severity || "";
  }

  const status = $("#draftStatus");
  if (status) {
    status.textContent =
      `Previous draft restored${draft.savedAt
        ? ` (saved ${new Date(draft.savedAt).toLocaleString()})`
        : ""}. Photos must be selected again.`;
  }

  if ($("#locationStatus")) {
    $("#locationStatus").textContent =
      draft.locationVerification === "gps"
        ? "Previously entered GPS location. Please verify it."
        : "Restored location. Please verify it.";
  }
}

$("#reportForm")?.addEventListener("input", (event) => {
  if (event.target.matches("input:not([type=file]), textarea, select")) {
    saveDraft();
  }
});

$("#reportForm")?.addEventListener("change", saveDraft);

// Modal controls.
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
  if ($("#successModal") && !$("#successModal").hidden) return;

  const modal = $$(".modal-backdrop").find((item) => !item.hidden);
  if (modal) closeModal(modal.id);
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
      card.hidden =
        filter !== "all" && card.dataset.category !== filter;
    });
  });
});

// GPS is optional. Manual locations are always accepted.
$("#getLocationBtn")?.addEventListener("click", () => {
  const status = $("#locationStatus");
  const button = $("#getLocationBtn");

  if (!navigator.geolocation) {
    status.textContent =
      "GPS unavailable. Enter the location manually.";
    return;
  }

  button.disabled = true;
  status.textContent = "Requesting location permission…";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);

      $("#issueLocation").value = `GPS coordinates: ${lat}, ${lon}`;
      $("#issueLocation").dataset.verification = "gps";
      status.textContent =
        "GPS location added. Please verify that it identifies the correct place.";
      button.disabled = false;
      saveDraft();
    },
    () => {
      status.textContent =
        "GPS unavailable or permission denied. Enter the location manually.";
      button.disabled = false;
      $("#issueLocation").dataset.verification = "unverified";
      saveDraft();
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

$("#issueLocation")?.addEventListener("input", () => {
  const input = $("#issueLocation");
  if (!input.value.startsWith("GPS coordinates:")) {
    input.dataset.verification = "manual";
    if ($("#locationStatus")) {
      $("#locationStatus").textContent =
        "Manual location entered. It may need verification.";
    }
  }
});

// Optional photo preview. Photos are not uploaded or persisted by this code.
function clearPhotoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;

  $("#photoPreview")?.replaceChildren();
  if ($("#photoPreview")) $("#photoPreview").hidden = true;
}

$("#issuePhoto")?.addEventListener("change", () => {
  const input = $("#issuePhoto");
  const preview = $("#photoPreview");
  clearPhotoPreview();

  const file = input.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    input.value = "";
    showToast("That file is not an image. You can submit without a photo.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    input.value = "";
    showToast("Photo exceeds 5 MB. Choose a smaller photo or continue without one.");
    return;
  }

  previewUrl = URL.createObjectURL(file);

  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = "Selected report photo preview";

  image.onerror = () => {
    clearPhotoPreview();
    showToast("This photo could not be previewed. You can still submit without it.");
  };

  preview.appendChild(image);
  preview.hidden = false;

  const note = document.createElement("p");
  note.className = "field-note";
  note.textContent =
    "Photo preview only. It is not uploaded or saved with your report.";
  preview.appendChild(note);
});

// Local queue: reports remain pending until the server confirms success.
function updateQueueStatus() {
  const queue = getQueue();
  const element = $("#queueStatus");
  if (!element) return;

  element.textContent = queue.length
    ? `${queue.length} report(s) pending sync on this device. They are not yet confirmed as server reports.`
    : "No reports waiting to sync.";
}

function makeLocalId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `cf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function queueReport(report) {
  const queue = getQueue();
  const existing = queue.find((item) => item.localId === report.localId);

  if (!existing) queue.push(report);

  if (!saveQueue(queue)) {
    throw new Error(
      "Could not save the offline queue. Keep this report text copied before closing the page."
    );
  }

  updateQueueStatus();
}

async function sendQueuedReport(item) {
  // The server must support clientId idempotency for guaranteed
  // duplicate prevention when a response is lost.
  const data = await apiRequest("/reports", {
    method: "POST",
    body: JSON.stringify({
      ...item.report,
      clientId: item.localId,
      locationVerification: item.report.locationVerification || "unverified",
      photoStatus: "not_uploaded"
    })
  });

  const trackingId = data.report?.trackingId;
  if (!trackingId) {
    throw new Error("Server did not return a tracking ID.");
  }

  const queue = getQueue().filter((entry) => entry.localId !== item.localId);
  saveQueue(queue);

  return trackingId;
}

async function retryQueue() {
  if (!navigator.onLine) {
    updateQueueStatus();
    return;
  }

  let queue = getQueue();

  for (const item of queue) {
    try {
      const trackingId = await sendQueuedReport(item);
      showToast(`A queued report synced: ${trackingId}`);
      queue = getQueue();
    } catch (error) {
      console.warn("Report still pending sync:", error.message);
      // Keep failed item for another retry.
    }
  }

  updateQueueStatus();
  refreshStats();
}

window.addEventListener("online", retryQueue);
window.addEventListener("offline", updateQueueStatus);

// Submit report. Failed/offline submissions are queued locally.
$("#reportForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitting) return;

  const message = $("#reportFormMessage");
  const button = $("#submitReportBtn");
  message.textContent = "";

  const report = getFormDraft();

  if (!report.issueType || !report.location || !report.description || !report.severity) {
    message.textContent = "Please complete all required fields.";
    return;
  }

  const item = {
    localId: makeLocalId(),
    report,
    queuedAt: new Date().toISOString()
  };

  submitting = true;
  button.disabled = true;
  button.textContent = "Submitting…";

  try {
    if (!navigator.onLine) {
      queueReport(item);
      message.textContent =
        "You're offline. This report is saved on this device and is pending sync. It has not been submitted to the server.";
      showToast("Offline report saved for retry.");
      return;
    }

    try {
      const trackingId = await sendQueuedReport(item);
      lastTrackingId = trackingId;

      $("#trackingId").textContent = trackingId;
      $("#successMessage").textContent =
        "Your report was confirmed by the server. Save this tracking ID.";

      localStorage.removeItem(DRAFT_KEY);
      $("#reportForm").reset();
      clearPhotoPreview();

      $("#issueLocation").dataset.verification = "unverified";
      $("#locationStatus").textContent =
        "You can enter the location manually.";

      closeModal("reportModal");
      openModal("successModal");
      refreshStats();
      updateQueueStatus();
    } catch (error) {
      // Preserve the report for retry, without claiming server receipt.
      queueReport(item);
      message.textContent =
        "The server did not confirm receipt. Your report is saved locally and pending sync. " +
        error.message;
      showToast("Report pending sync. It has not been confirmed by the server.");
    }
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submitting = false;
    button.disabled = false;
    button.innerHTML = 'Submit report <span>↗</span>';
    updateQueueStatus();
  }
});

// Success modal controls.
$("#closeSuccessBtn")?.addEventListener("click", () => closeModal("successModal"));

$("#copyTrackingBtn")?.addEventListener("click", async () => {
  const value = $("#trackingId").textContent.trim();

  try {
    await navigator.clipboard.writeText(value);
    showToast("Tracking ID copied.");
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    showToast(copied ? "Tracking ID copied." : `Tracking ID: ${value}`);
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

// Tracking.
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

    card.append(title, status);

    [
      ["Category", report.issueType],
      ["Location", report.location],
      ["Description", report.description],
      ["Priority", report.severity],
      ["Submitted", report.createdAt
        ? new Date(report.createdAt).toLocaleString()
        : "Not available"]
    ].forEach(([label, value]) => {
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
    card.appendChild(timeline);
    result.appendChild(card);
  } catch (error) {
    const p = document.createElement("p");
    p.className = "form-message";
    p.textContent = error.message;
    result.appendChild(p);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Find my report <span>→</span>';
  }
});

// Statistics.
async function refreshStats() {
  try {
    const data = await apiRequest("/reports");
    const reports = Array.isArray(data.reports) ? data.reports : [];

    $("#statTotal").textContent = reports.length;
    $("#statProgress").textContent = reports.filter((report) =>
      ["Submitted", "Under Review", "In Progress"].includes(report.status)
    ).length;
    $("#statResolved").textContent = reports.filter(
      (report) => report.status === "Resolved"
    ).length;
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
    showToast("Backend unavailable. Drafts can still be saved locally.");
  }
}

// Start Phase 2 features.
addPhaseTwoControls();
restoreDraft();
updateQueueStatus();
checkBackend();
refreshStats();
retryQueue();
