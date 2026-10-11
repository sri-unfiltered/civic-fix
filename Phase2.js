
/* CIVICFIX PHASE 2
   Offline drafts, queued reports, reconnect sync and quality metadata.
*/
(() => {
  "use strict";

  const DRAFT_KEY = "civicfix_phase2_drafts";
  const QUEUE_KEY = "civicfix_phase2_queue";
  const LOCAL_REPORTS_KEY = "civicfix_phase2_reports";

  const $ = id => document.getElementById(id);
  const read = key => {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); }
    catch { return []; }
  };
  const write = (key, value) =>
    localStorage.setItem(key, JSON.stringify(value));

  const makeId = () =>
    "CF-" + Date.now().toString(36).toUpperCase() +
    "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  let activeDraftId = null;
  let photoData = "";
  let syncRunning = false;

  const getField = id => $(id)?.value?.trim() || "";

  function getLocationMetadata() {
    const value = getField("issueLocation");
    return {
      locationSource:
        $("locationConfidence")?.value ||
        (value ? "manual" : "unknown"),
      locationAccuracy:
        $("locationConfidence")?.value === "gps" ? "gps" :
        $("locationConfidence")?.value === "approximate" ? "approximate" :
        value ? "user-provided" : "unknown"
    };
  }

  function getPhotoQuality() {
    return $("photoQuality")?.value ||
      (photoData ? "unknown" : "unavailable");
  }

  function collectReport() {
    return {
      id: activeDraftId || makeId(),
      category: getField("issueType"),
      location: getField("issueLocation"),
      description: getField("issueDescription"),
      severity: getField("issueSeverity"),
      locationSource: getLocationMetadata().locationSource,
      locationAccuracy: getLocationMetadata().locationAccuracy,
      photoQuality: getPhotoQuality(),
      hasPhoto: Boolean(photoData),
      photoData: photoData || "",
      status: "draft",
      syncStatus: "not-submitted",
      completeness: "incomplete",
      updatedAt: new Date().toISOString()
    };
  }

  function setMessage(id, message) {
    if ($(id)) $(id).textContent = message;
  }

  function updateConnection() {
    const online = navigator.onLine;
    setMessage(
      "connectionStatusText",
      online ? "Online — reports can sync" :
        "Offline — reports will be saved on this device"
    );

    const status = $("connectionStatus");
    if (status) status.dataset.online = String(online);

    if (online) syncQueue();
  }

  function saveDraft() {
    const report = collectReport();
    report.status = "draft";
    report.syncStatus = "not-submitted";

    const drafts = read(DRAFT_KEY);
    const index = drafts.findIndex(item => item.id === report.id);

    if (index >= 0) drafts[index] = report;
    else drafts.unshift(report);

    try {
      write(DRAFT_KEY, drafts);
      activeDraftId = report.id;
      setMessage(
        "draftStatus",
        "Draft saved on this device. You can resume it later."
      );
      showToast("Draft saved successfully.");
    } catch {
      setMessage(
        "draftStatus",
        "Storage is full. Try removing the photo or old drafts."
      );
    }
  }

  function showDrafts() {
    const drafts = read(DRAFT_KEY);

    if (!drafts.length) {
      alert("No saved drafts yet.");
      return;
    }

    const choices = drafts.map((draft, i) =>
      `${i + 1}. ${draft.category || "Uncategorized"} — ` +
      `${draft.location || "Location not added"}`
    ).join("\n");

    const answer = prompt(
      "Enter the number of the draft to resume:\n\n" + choices
    );

    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 ||
        index >= drafts.length) return;

    const draft = drafts[index];
    activeDraftId = draft.id;

    if ($("issueType")) $("issueType").value = draft.category || "";
    if ($("issueLocation")) $("issueLocation").value = draft.location || "";
    if ($("issueDescription"))
      $("issueDescription").value = draft.description || "";
    if ($("issueSeverity")) $("issueSeverity").value = draft.severity || "";
    if ($("locationConfidence"))
      $("locationConfidence").value = draft.locationSource || "unknown";
    if ($("photoQuality"))
      $("photoQuality").value = draft.photoQuality || "unknown";

    photoData = draft.photoData || "";
    renderPhotoPreview();

    setMessage("draftStatus", "Draft resumed. Continue editing.");
    const modal = $("reportModal");
    if (modal) modal.hidden = false;
  }

  function renderPhotoPreview() {
    const preview = $("photoPreview");
    if (!preview) return;

    preview.replaceChildren();

    if (!photoData) {
      preview.hidden = true;
      return;
    }

    const img = document.createElement("img");
    img.src = photoData;
    img.alt = "Selected report photo preview";
    img.style.maxWidth = "100%";
    img.style.maxHeight = "180px";
    preview.appendChild(img);
    preview.hidden = false;
  }

  // Resize photos before saving to reduce local storage usage.
  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("Please select an image file."));
        return;
      }

      if (file.size > 12 * 1024 * 1024) {
        reject(new Error("Choose an image smaller than 12 MB."));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read the image."));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Could not open the image."));
        img.onload = () => {
          const max = 1000;
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function submitReport(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const report = collectReport();

    // Drafts may be incomplete, but final submission needs core details.
    if (!report.category || !report.location ||
        !report.description || !report.severity) {
      setMessage(
        "reportFormMessage",
        "Add a category, location, description and priority before submitting. You can save an incomplete draft."
      );
      return;
    }

    report.status = "Submitted";
    report.completeness =
      report.hasPhoto && report.locationAccuracy === "gps"
        ? "complete"
        : "needs-verification";
    report.syncStatus = "pending-sync";

    const queue = read(QUEUE_KEY);
    if (!queue.some(item => item.id === report.id)) {
      queue.push(report);
    } else {
      const index = queue.findIndex(item => item.id === report.id);
      queue[index] = report;
    }

    try {
      write(QUEUE_KEY, queue);
      setMessage("reportFormMessage", "");
    } catch {
      setMessage(
        "reportFormMessage",
        "This device is out of storage. Remove an old draft or photo and try again."
      );
      return;
    }

    if (navigator.onLine) {
      await syncQueue();
    }

    const reports = read(LOCAL_REPORTS_KEY);
    if (!reports.some(item => item.id === report.id)) {
      reports.unshift(report);
      write(LOCAL_REPORTS_KEY, reports);
    }

    const remainingQueue = read(QUEUE_KEY);
    const stillPending = remainingQueue.some(item => item.id === report.id);

    if (stillPending) {
      setMessage(
        "successMessage",
        "Saved on this device and waiting to sync. Keep this tracking ID."
      );
    } else {
      setMessage(
        "successMessage",
        "The server accepted your report. Keep this tracking ID."
      );
    }

    setMessage("trackingId", report.id);

    const successModal = $("successModal");
    const reportModal = $("reportModal");
    if (reportModal) reportModal.hidden = true;
    if (successModal) successModal.hidden = false;

    // Preserve the ID for tracking even when offline.
    if ($("trackerInput")) $("trackerInput").value = report.id;
  }

  async function syncQueue() {
    if (syncRunning || !navigator.onLine) return;
    syncRunning = true;

    try {
      const queue = read(QUEUE_KEY);
      const remaining = [];

      for (const report of queue) {
        try {
          // Do not send the local image data to a server that may not
          // support image uploads. Send the quality/availability metadata.
          const {
            photoData: ignoredPhoto,
            ...payload
          } = report;

          const response = await fetch("/api/reports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              clientReportId: report.id,
              photo: null,
              photoUploadStatus: report.hasPhoto
                ? "available-locally-not-uploaded"
                : "missing"
            })
          });

          if (!response.ok) {
            remaining.push(report);
            continue;
          }

          const serverResult = await response.json().catch(() => ({}));
          const reports = read(LOCAL_REPORTS_KEY);
          const updated = {
            ...report,
            serverReportId:
              serverResult.id || serverResult.reportId || null,
            serverAccepted: true,
            syncStatus: "synced",
            syncedAt: new Date().toISOString()
          };

          const index = reports.findIndex(item => item.id === report.id);
          if (index >= 0) reports[index] = updated;
          else reports.unshift(updated);
          write(LOCAL_REPORTS_KEY, reports);

          const drafts = read(DRAFT_KEY).filter(
            item => item.id !== report.id
          );
          write(DRAFT_KEY, drafts);
        } catch {
          remaining.push(report);
        }
      }

      write(QUEUE_KEY, remaining);
      updatePendingBadge();
    } finally {
      syncRunning = false;
    }
  }

  function updatePendingBadge() {
    const pending = read(QUEUE_KEY).length;
    setMessage(
      "draftStatus",
      pending
        ? `${pending} submitted report(s) waiting to sync.`
        : "All queued reports have been sent."
    );
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; }, 2500);
  }

  function openReport() {
    if ($("reportModal")) $("reportModal").hidden = false;
  }

  function closeModal(id) {
    if ($(id)) $(id).hidden = true;
  }

  function setup() {
    updateConnection();

    $("saveDraftBtn")?.addEventListener("click", saveDraft);
    $("viewDraftsBtn")?.addEventListener("click", showDrafts);

    // Capture phase prevents the original submit handler from submitting
    // the same report a second time.
    $("reportForm")?.addEventListener("submit", submitReport, true);

    $("issuePhoto")?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        photoData = await compressImage(file);
        renderPhotoPreview();
        if ($("photoQuality") && $("photoQuality").value === "unknown") {
          $("photoQuality").value = "clear";
        }
        showToast("Photo prepared for this draft.");
      } catch (error) {
        photoData = "";
        renderPhotoPreview();
        setMessage("reportFormMessage", error.message);
      }
    });

    $("getLocationBtn")?.addEventListener("click", () => {
      if (!navigator.geolocation) {
        setMessage("locationStatus", "GPS is not available. Enter the location manually.");
        return;
      }

      setMessage("locationStatus", "Requesting GPS location...");

      navigator.geolocation.getCurrentPosition(
        position => {
          const { latitude, longitude, accuracy } = position.coords;
          $("issueLocation").value =
            `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

          if ($("locationConfidence")) {
            $("locationConfidence").value =
              accuracy <= 100 ? "gps" : "approximate";
          }

          setMessage(
            "locationStatus",
            `GPS captured. Estimated accuracy: ${Math.round(accuracy)} metres.`
          );
        },
        () => {
          setMessage(
            "locationStatus",
            "GPS unavailable. Enter a street, area or landmark instead."
          );
          if ($("locationConfidence"))
            $("locationConfidence").value = "manual";
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });

    document.querySelectorAll("[data-open-report]").forEach(button => {
      button.addEventListener("click", openReport);
    });

    document.querySelectorAll("[data-close-modal]").forEach(button => {
      button.addEventListener("click", () =>
        closeModal(button.dataset.closeModal)
      );
    });

    $("closeSuccessBtn")?.addEventListener("click", () =>
      closeModal("successModal")
    );

    $("copyTrackingBtn")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(getField("trackingId"));
        showToast("Tracking ID copied.");
      } catch {
        showToast("Select and copy the tracking ID manually.");
      }
    });

    $("trackAfterSubmit")?.addEventListener("click", () => {
      closeModal("successModal");
      if ($("trackerModal")) $("trackerModal").hidden = false;
    });

    $("trackerForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const id = getField("trackerInput").toUpperCase();
      const result = $("trackerResult");
      if (!result) return;

      result.textContent = "Checking report...";
      try {
        const response = await fetch(
          "/api/reports/" + encodeURIComponent(id)
        );
        if (response.ok) {
          const data = await response.json();
          result.textContent =
            `Status: ${data.status || data.report?.status || "Received"}`;
          return;
        }
      } catch { /* fall back to locally stored reports */ }

      const local = read(LOCAL_REPORTS_KEY).find(item =>
        item.id === id || item.serverReportId === id
      );

      result.textContent = local
        ? `Local status: ${local.syncStatus}. ${
            local.syncStatus === "pending-sync"
              ? "This report has not yet been confirmed by the server."
              : "Category: " + (local.category || "Not set")
          }`
        : "Report not found online or on this device. Check the ID and connection.";
    });

    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);

    // Retry pending reports when this page loads.
    if (navigator.onLine) syncQueue();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();
