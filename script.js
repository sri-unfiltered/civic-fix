
"use strict";

const API_BASE = "http://localhost:3000/api";
const DRAFT_KEY = "civicfix_phase2_draft";
const QUEUE_KEY = "civicfix_phase2_queue";
const LOCAL_REPORTS_KEY = "civicfix_phase2_reports";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let toastTimer = null;
let previewUrl = null;
let submitting = false;
let syncing = false;

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
    showToast("Storage is unavailable. Copy your report details somewhere safe.");
    return false;
  }
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

function setMessage(selector, message) {
  const element = $(selector);
  if (element) element.textContent = message;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.hidden = false;
  document.body.classList.add("modal-open");

  const focusable = modal.querySelector(
    "input:not([type=file]), select, textarea, button"
  );

  if (focusable) {
    setTimeout(() => focusable.focus(), 50);
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.hidden = true;
  document.body.classList.toggle(
    "modal-open",
    $$(".modal-backdrop").some(item => !item.hidden)
  );
}

// ------------------------------------------
// Offline queue migration
// Preserves reports saved by the older Phase 2 code.
// ------------------------------------------

function normalizeQueueItem(item) {
  if (!item || typeof item !== "object") return item;

  // Already in the current queue format.
  if (
    item.localId &&
    item.report &&
    typeof item.report === "object"
  ) {
    return item;
  }

  // Older Phase 2 format stored report fields directly on the item.
  if (item.id && (
    item.category ||
    item.issueType ||
    item.location ||
    item.description
  )) {
    const locationVerification =
      item.locationVerification ||
      (item.locationSource === "gps"
        ? "gps"
        : item.locationSource === "approximate"
          ? "approximate"
          : item.location
            ? "manual"
            : "unverified");

    return {
      localId: item.id,
      report: {
        issueType: item.issueType || item.category || "",
        location: item.location || "",
        description: item.description || "",
        severity: item.severity || "",
        locationVerification
      },
      queuedAt:
        item.queuedAt ||
        item.updatedAt ||
        new Date().toISOString()
    };
  }

  // Keep unknown entries rather than deleting potentially useful data.
  return item;
}

function getQueue() {
  const raw = readStorage(QUEUE_KEY, []);
  if (!Array.isArray(raw)) return [];

  let changed = false;

  const normalized = raw.map(item => {
    const result = normalizeQueueItem(item);

    if (JSON.stringify(result) !== JSON.stringify(item)) {
      changed = true;
    }

    return result;
  });

  if (changed) {
    writeStorage(QUEUE_KEY, normalized);
  }

  return normalized;
}

function saveQueue(queue) {
  return writeStorage(QUEUE_KEY, queue);
}

function getLocalReports() {
  const reports = readStorage(LOCAL_REPORTS_KEY, []);
  return Array.isArray(reports) ? reports : [];
}

function saveLocalReport(report) {
  const reports = getLocalReports();
  const index = reports.findIndex(item => item.id === report.id);

  if (index >= 0) {
    reports[index] = { ...reports[index], ...report };
  } else {
    reports.unshift(report);
  }

  writeStorage(LOCAL_REPORTS_KEY, reports);
}

function updateQueueStatus() {
  const queue = getQueue();

  setMessage(
    "#queueStatus",
    queue.length
      ? `${queue.length} report(s) waiting to sync.`
      : "No reports waiting to sync."
  );
}

// ------------------------------------------
// Backend requests
// ------------------------------------------

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
      "Cannot connect to the backend. Your report can be saved for retry."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an unexpected response.");
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.message || `Request failed (${response.status}).`
    );
  }

  return data;
}

// ------------------------------------------
// Draft saving
// ------------------------------------------

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
    if (!confirm("Discard this saved draft? This cannot be undone.")) {
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    form.reset();
    clearPhotoPreview();

    setMessage(
      "#locationStatus",
      "You can enter the location manually."
    );
    setMessage("#reportFormMessage", "");
    setMessage("#draftStatus", "Saved draft discarded.");

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
    draft.issueType ||
    draft.location ||
    draft.description ||
    draft.severity
  );

  if (!hasContent) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }

  if (writeStorage(DRAFT_KEY, draft)) {
    setMessage(
      "#draftStatus",
      `Draft saved on this device at ${new Date().toLocaleTimeString()}.`
    );
  }
}

function restoreDraft() {
  const draft = readStorage(DRAFT_KEY, null);
  if (!draft || typeof draft !== "object") return;

  if ($("#issueType")) {
    $("#issueType").value = draft.issueType || "";
  }

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

  setMessage(
    "#draftStatus",
    `Previous draft restored${
      draft.savedAt
        ? ` (saved ${new Date(draft.savedAt).toLocaleString()})`
        : ""
    }. Photos must be selected again.`
  );

  setMessage(
    "#locationStatus",
    draft.locationVerification === "gps"
      ? "Previously entered GPS location. Please verify it."
      : "Restored location. Please verify it."
  );
}

$("#reportForm")?.addEventListener("input", event => {
  if (
    event.target.matches(
      "input:not([type=file]), textarea, select"
    )
  ) {
    saveDraft();
  }
});

$("#reportForm")?.addEventListener("change", saveDraft);

// ------------------------------------------
// Modal controls
// ------------------------------------------

$$("[data-open-report]").forEach(button => {
  button.addEventListener("click", () => openModal("reportModal"));
});

$("#openTracker")?.addEventListener("click", () => {
  openModal("trackerModal");
});

$$("[data-close-modal]").forEach(button => {
  button.addEventListener("click", () => {
    closeModal(button.dataset.closeModal);
  });
});

$$(".modal-backdrop").forEach(backdrop => {
  backdrop.addEventListener("click", event => {
    if (
      event.target === backdrop &&
      backdrop.id !== "successModal"
    ) {
      closeModal(backdrop.id);
    }
  });
});

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if ($("#successModal") && !$("#successModal").hidden) return;

  const modal = $$(".modal-backdrop").find(item => !item.hidden);
  if (modal) closeModal(modal.id);
});

// ------------------------------------------
// Mobile navigation and category filters
// ------------------------------------------

$("#menuBtn")?.addEventListener("click", () => {
  const nav = $("#mobileNav");
  if (!nav) return;

  const isOpen = nav.classList.toggle("open");
  $("#menuBtn")?.setAttribute("aria-expanded", String(isOpen));
});

$$("#mobileNav a").forEach(link => {
  link.addEventListener("click", () => {
    $("#mobileNav")?.classList.remove("open");
    $("#menuBtn")?.setAttribute("aria-expanded", "false");
  });
});

$$(".filter-btn").forEach(button => {
  button.addEventListener("click", () => {
    $$(".filter-btn").forEach(item => item.classList.remove("active"));
    button.classList.add("active");

    const filter = button.dataset.filter;

    $$(".issue-card").forEach(card => {
      card.hidden =
        filter !== "all" && card.dataset.category !== filter;
    });
  });
});

// ------------------------------------------
// Optional GPS location
// ------------------------------------------

$("#getLocationBtn")?.addEventListener("click", () => {
  const button = $("#getLocationBtn");

  if (!navigator.geolocation) {
    setMessage(
      "#locationStatus",
      "GPS unavailable. Enter the location manually."
    );
    return;
  }

  button.disabled = true;
  setMessage("#locationStatus", "Requesting location permission…");

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);

      if ($("#issueLocation")) {
        $("#issueLocation").value =
          `GPS coordinates: ${lat}, ${lon}`;
        $("#issueLocation").dataset.verification = "gps";
      }

      if ($("#locationConfidence")) {
        $("#locationConfidence").value =
          position.coords.accuracy <= 100 ? "gps" : "approximate";
      }

      setMessage(
        "#locationStatus",
        "GPS location added. Please verify the correct place."
      );

      button.disabled = false;
      saveDraft();
    },
    () => {
      setMessage(
        "#locationStatus",
        "GPS unavailable or permission denied. Enter the location manually."
      );

      button.disabled = false;

      if ($("#issueLocation")) {
        $("#issueLocation").dataset.verification = "unverified";
      }

      if ($("#locationConfidence")) {
        $("#locationConfidence").value = "manual";
      }

      saveDraft();
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
  );
});

$("#issueLocation")?.addEventListener("input", () => {
  const input = $("#issueLocation");

  if (!input.value.startsWith("GPS coordinates:")) {
    input.dataset.verification = "manual";

    setMessage(
      "#locationStatus",
      "Manual location entered. It may need verification."
    );
  }
});

// ------------------------------------------
// Photo preview
// Photos are previewed locally, not uploaded.
// ------------------------------------------

function clearPhotoPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;

  $("#photoPreview")?.replaceChildren();

  if ($("#photoPreview")) {
    $("#photoPreview").hidden = true;
  }
}

$("#issuePhoto")?.addEventListener("change", () => {
  const input = $("#issuePhoto");
  const preview = $("#photoPreview");

  clearPhotoPreview();

  const file = input?.files?.[0];
  if (!file || !preview) return;

  if (!file.type.startsWith("image/")) {
    input.value = "";
    showToast("Choose an image file or continue without a photo.");
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    input.value = "";
    showToast("Choose a photo smaller than 5 MB.");
    return;
  }

  previewUrl = URL.createObjectURL(file);

  const image = document.createElement("img");
  image.src = previewUrl;
  image.alt = "Selected report photo preview";

  preview.appendChild(image);

  const note = document.createElement("p");
  note.className = "field-note";
  note.textContent =
    "Photo preview only. The current backend does not upload photos.";

  preview.appendChild(note);
  preview.hidden = false;
});

// ------------------------------------------
// Queue and local report storage
// ------------------------------------------

function makeLocalId() {
  return "CF-LOCAL-" +
    Date.now().toString(36).toUpperCase() +
    "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function queueReport(item) {
  const queue = getQueue();
  const index = queue.findIndex(
    entry => entry.localId === item.localId
  );

  if (index >= 0) {
    queue[index] = item;
  } else {
    queue.push(item);
  }

  if (!saveQueue(queue)) {
    throw new Error(
      "Could not save this report locally. Copy its details somewhere safe."
    );
  }

  saveLocalReport({
    id: item.localId,
    ...item.report,
    syncStatus: "pending-sync",
    serverAccepted: false,
    updatedAt: new Date().toISOString()
  });

  updateQueueStatus();
}

async function sendQueuedReport(item) {
  if (!item?.localId || !item?.report) {
    throw new Error(
      "A saved queue entry has an unknown format. It has been preserved."
    );
  }

  const report = item.report;

  const data = await apiRequest("/reports", {
    method: "POST",
    body: JSON.stringify({
      issueType: report.issueType || report.category || "",
      location: report.location || "",
      description: report.description || "",
      severity: report.severity || "",
      locationVerification:
        report.locationVerification || "unverified",
      clientId: item.localId,
      photoStatus: "not_uploaded"
    })
  });

  // The backend returns { success: true, report: { trackingId, ... } }.
  const trackingId = data.report?.trackingId;

  if (!trackingId) {
    throw new Error("Server did not return a tracking ID.");
  }

  saveLocalReport({
    id: item.localId,
    ...report,
    serverReportId: trackingId,
    serverAccepted: true,
    syncStatus: "synced",
    syncedAt: new Date().toISOString()
  });

  // Remove only the item confirmed by the server.
  const remaining = getQueue().filter(
    entry => entry.localId !== item.localId
  );

  saveQueue(remaining);

  return trackingId;
}

async function retryQueue() {
  if (syncing || !navigator.onLine) {
    updateQueueStatus();
    return;
  }

  syncing = true;

  try {
    // getQueue safely migrates old Phase 2 queue entries first.
    const queue = getQueue();

    for (const item of queue) {
      if (!item?.localId || !item?.report) {
        console.warn(
          "An unfamiliar queue entry was preserved and not submitted."
        );
        continue;
      }

      try {
        const trackingId = await sendQueuedReport(item);
        showToast(`Report synced. Server tracking ID: ${trackingId}`);
      } catch (error) {
        console.warn("Report still pending sync:", error.message);
      }
    }
  } finally {
    syncing = false;
    updateQueueStatus();
    refreshStats();
  }
}

window.addEventListener("online", retryQueue);
window.addEventListener("offline", updateQueueStatus);

// ------------------------------------------
// Report submission
// ------------------------------------------

$("#reportForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  if (submitting) return;

  const message = $("#reportFormMessage");
  const button = $("#submitReportBtn");
  const originalButtonHTML = button?.innerHTML;

  if (message) message.textContent = "";

  const report = getFormDraft();

  if (
    !report.issueType ||
    !report.location ||
    !report.description ||
    !report.severity
  ) {
    setMessage(
      "#reportFormMessage",
      "Please complete the category, location, description and priority."
    );
    return;
  }

  const item = {
    localId: makeLocalId(),
    report,
    queuedAt: new Date().toISOString()
  };

  submitting = true;

  if (button) {
    button.disabled = true;
    button.textContent = "Submitting…";
  }

  try {
    if (!navigator.onLine) {
      queueReport(item);

      setMessage(
        "#reportFormMessage",
        "Saved on this device. The server has not received this report yet."
      );

      showToast("Report saved offline and queued for retry.");
      return;
    }

    try {
      const trackingId = await sendQueuedReport(item);

      $("#trackingId").textContent = trackingId;
      setMessage(
        "#successMessage",
        "Your report was accepted by the server. Keep this tracking ID."
      );

      localStorage.removeItem(DRAFT_KEY);

      $("#reportForm").reset();
      clearPhotoPreview();

      if ($("#issueLocation")) {
        $("#issueLocation").dataset.verification = "unverified";
      }

      setMessage(
        "#locationStatus",
        "You can enter the location manually."
      );

      closeModal("reportModal");
      openModal("successModal");

      refreshStats();
      updateQueueStatus();
    } catch (error) {
      queueReport(item);

      setMessage(
        "#reportFormMessage",
        "The server did not confirm receipt. Your report is saved locally and pending sync. " +
          error.message
      );

      showToast("Report pending sync; server receipt is not confirmed.");
    }
  } catch (error) {
    setMessage("#reportFormMessage", error.message);
  } finally {
    submitting = false;

    if (button) {
      button.disabled = false;

      if (originalButtonHTML) {
        button.innerHTML = originalButtonHTML;
      }
    }

    updateQueueStatus();
  }
});

// ------------------------------------------
// Success modal controls
// ------------------------------------------

$("#closeSuccessBtn")?.addEventListener("click", () => {
  closeModal("successModal");
});

$("#copyTrackingBtn")?.addEventListener("click", async () => {
  const value = $("#trackingId")?.textContent.trim() || "";

  try {
    await navigator.clipboard.writeText(value);
    showToast("Tracking ID copied.");
  } catch {
    showToast(`Tracking ID: ${value}`);
  }
});

$("#trackAfterSubmit")?.addEventListener("click", () => {
  const id = $("#trackingId")?.textContent.trim() || "";

  closeModal("successModal");
  openModal("trackerModal");

  if ($("#trackerInput")) $("#trackerInput").value = id;
  $("#trackerForm")?.requestSubmit();
});

// ------------------------------------------
// Report tracking
// ------------------------------------------

$("#trackerForm")?.addEventListener("submit", async event => {
  event.preventDefault();

  const id = $("#trackerInput")?.value.trim().toUpperCase() || "";
  const result = $("#trackerResult");
  const button = $("#trackSubmitBtn");

  if (!result) return;

  result.replaceChildren();

  if (!id) {
    result.textContent = "Enter a tracking ID.";
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Searching…";
  }

  try {
    const data = await apiRequest(
      `/reports/${encodeURIComponent(id)}`
    );

    const report = data.report;

    if (!report) {
      throw new Error("No report was returned by the server.");
    }

    const card = document.createElement("div");
    card.className = "result-card";

    const title = document.createElement("h3");
    title.textContent = report.trackingId || id;

    const status = document.createElement("p");
    status.textContent = `Status: ${report.status || "Submitted"}`;

    card.append(title, status);

    [
      ["Category", report.issueType],
      ["Location", report.location],
      ["Description", report.description],
      ["Priority", report.severity],
      [
        "Submitted",
        report.createdAt
          ? new Date(report.createdAt).toLocaleString()
          : ""
      ]
    ].forEach(([label, value]) => {
      if (!value) return;

      const paragraph = document.createElement("p");
      const strong = document.createElement("strong");

      strong.textContent = `${label}: `;
      paragraph.append(strong, document.createTextNode(String(value)));
      card.appendChild(paragraph);
    });

    result.appendChild(card);
  } catch (error) {
    // If the server cannot find the ID, check this device's saved reports.
    const localReports = getLocalReports();

    const local = localReports.find(item =>
      item.id?.toUpperCase() === id ||
      item.localId?.toUpperCase() === id ||
      item.serverReportId?.toUpperCase() === id
    );

    const paragraph = document.createElement("p");

    if (local) {
      paragraph.textContent = local.serverAccepted
        ? `This device has a saved record. Server tracking ID: ${local.serverReportId || "not available"}.`
        : "This report is saved on this device but has not been confirmed by the server yet.";

      if (local.category || local.issueType) {
        paragraph.textContent +=
          ` Category: ${local.category || local.issueType}.`;
      }
    } else {
      paragraph.textContent = error.message;
    }

    result.appendChild(paragraph);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Find my report →";
    }
  }
});

// ------------------------------------------
// Dashboard statistics and backend health
// ------------------------------------------

async function refreshStats() {
  try {
    const data = await apiRequest("/reports");
    const reports = Array.isArray(data.reports) ? data.reports : [];

    setMessage("#statTotal", String(reports.length));

    setMessage(
      "#statProgress",
      String(reports.filter(report =>
        ["Submitted", "Under Review", "In Progress"].includes(
          report.status
        )
      ).length)
    );

    setMessage(
      "#statResolved",
      String(
        reports.filter(report => report.status === "Resolved").length
      )
    );
  } catch {
    setMessage("#statTotal", "—");
    setMessage("#statProgress", "—");
    setMessage("#statResolved", "—");
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

// ------------------------------------------
// Startup
// ------------------------------------------

addPhaseTwoControls();
restoreDraft();
updateQueueStatus();
checkBackend();
refreshStats();
retryQueue();
