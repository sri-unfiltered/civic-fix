
/* CIVICFIX PHASE 2
   Offline drafts, photo preparation and quality metadata.
   Report submission, tracking and queue syncing are handled by script.js.
*/
(() => {
  "use strict";

  const DRAFT_KEY = "civicfix_phase2_drafts";

  const $ = id => document.getElementById(id);

  const read = key => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const write = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
  };

  const makeId = () =>
    "CF-" + Date.now().toString(36).toUpperCase() +
    "-" + Math.random().toString(36).slice(2, 6).toUpperCase();

  let activeDraftId = null;
  let photoData = "";

  const getField = id => $(id)?.value?.trim() || "";

  function getLocationMetadata() {
    const location = getField("issueLocation");
    const confidence = $("locationConfidence")?.value || "";

    return {
      locationSource:
        confidence || (location ? "manual" : "unknown"),
      locationAccuracy:
        confidence === "gps" ? "gps" :
        confidence === "approximate" ? "approximate" :
        location ? "user-provided" : "unknown"
    };
  }

  function getPhotoQuality() {
    return $("photoQuality")?.value ||
      (photoData ? "unknown" : "unavailable");
  }

  function collectDraft() {
    const metadata = getLocationMetadata();

    return {
      id: activeDraftId || makeId(),
      category: getField("issueType"),
      location: getField("issueLocation"),
      description: getField("issueDescription"),
      severity: getField("issueSeverity"),
      locationSource: metadata.locationSource,
      locationAccuracy: metadata.locationAccuracy,
      photoQuality: getPhotoQuality(),
      hasPhoto: Boolean(photoData),
      photoData,
      status: "draft",
      syncStatus: "not-submitted",
      completeness: "incomplete",
      updatedAt: new Date().toISOString()
    };
  }

  function setMessage(id, message) {
    const element = $(id);
    if (element) element.textContent = message;
  }

  function showToast(message) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = message;
    toast.hidden = false;

    setTimeout(() => {
      toast.hidden = true;
    }, 2500);
  }

  function updateConnection() {
    const online = navigator.onLine;

    setMessage(
      "connectionStatusText",
      online
        ? "Online — reports can sync"
        : "Offline — drafts stay on this device"
    );

    const status = $("connectionStatus");
    if (status) status.dataset.online = String(online);
  }

  function saveDraft() {
    const draft = collectDraft();
    const drafts = read(DRAFT_KEY);
    const index = drafts.findIndex(item => item.id === draft.id);

    if (index >= 0) {
      drafts[index] = draft;
    } else {
      drafts.unshift(draft);
    }

    try {
      write(DRAFT_KEY, drafts);
      activeDraftId = draft.id;

      setMessage(
        "draftStatus",
        "Draft saved on this device. You can resume it later."
      );

      showToast("Draft saved successfully.");
    } catch {
      setMessage(
        "draftStatus",
        "Storage is full. Try removing an old draft or photo."
      );
    }
  }

  function renderPhotoPreview() {
    const preview = $("photoPreview");
    if (!preview) return;

    preview.replaceChildren();

    if (!photoData) {
      preview.hidden = true;
      return;
    }

    const image = document.createElement("img");
    image.src = photoData;
    image.alt = "Selected report photo preview";
    image.style.maxWidth = "100%";
    image.style.maxHeight = "180px";

    preview.appendChild(image);
    preview.hidden = false;
  }

  function restoreDraft(draft) {
    activeDraftId = draft.id || null;

    if ($("issueType")) {
      $("issueType").value = draft.category || draft.issueType || "";
    }

    if ($("issueLocation")) {
      $("issueLocation").value = draft.location || "";
    }

    if ($("issueDescription")) {
      $("issueDescription").value = draft.description || "";
    }

    if ($("issueSeverity")) {
      $("issueSeverity").value = draft.severity || "";
    }

    if ($("locationConfidence")) {
      const source = draft.locationSource || "unknown";
      const allowed = ["gps", "approximate", "manual", "unknown"];

      $("locationConfidence").value =
        allowed.includes(source) ? source : "unknown";
    }

    if ($("photoQuality")) {
      $("photoQuality").value = draft.photoQuality || "unknown";
    }

    photoData = draft.photoData || "";
    renderPhotoPreview();

    setMessage("draftStatus", "Draft resumed. Continue editing.");

    if ($("reportModal")) {
      $("reportModal").hidden = false;
    }
  }

  function showDrafts() {
    const drafts = read(DRAFT_KEY);

    if (!drafts.length) {
      alert("No saved drafts yet.");
      return;
    }

    const choices = drafts.map((draft, index) =>
      `${index + 1}. ${draft.category || "Uncategorized"} — ` +
      `${draft.location || "Location not added"}`
    ).join("\n");

    const answer = prompt(
      "Enter the number of the draft to resume:\n\n" + choices
    );

    if (answer === null || !answer.trim()) return;

    const index = Number(answer) - 1;

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= drafts.length
    ) {
      alert("Please enter a valid draft number.");
      return;
    }

    restoreDraft(drafts[index]);
  }

  // Compress the selected image before saving it with a draft.
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

      reader.onerror = () => {
        reject(new Error("Could not read the image."));
      };

      reader.onload = () => {
        const image = new Image();

        image.onerror = () => {
          reject(new Error("Could not open the image."));
        };

        image.onload = () => {
          const maxDimension = 1000;
          const scale = Math.min(
            1,
            maxDimension / Math.max(image.width, image.height)
          );

          const canvas = document.createElement("canvas");

          canvas.width = Math.max(
            1,
            Math.round(image.width * scale)
          );

          canvas.height = Math.max(
            1,
            Math.round(image.height * scale)
          );

          const context = canvas.getContext("2d");

          if (!context) {
            reject(new Error("Could not prepare the image."));
            return;
          }

          context.drawImage(
            image,
            0,
            0,
            canvas.width,
            canvas.height
          );

          resolve(canvas.toDataURL("image/jpeg", 0.72));
        };

        image.src = reader.result;
      };

      reader.readAsDataURL(file);
    });
  }

  function setup() {
    updateConnection();

    $("saveDraftBtn")?.addEventListener("click", saveDraft);
    $("viewDraftsBtn")?.addEventListener("click", showDrafts);

    // This file deliberately does not submit reports or sync the queue.
    // script.js is the single owner of those operations.

    $("issuePhoto")?.addEventListener("change", async event => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        photoData = await compressImage(file);
        renderPhotoPreview();

        if (
          $("photoQuality") &&
          $("photoQuality").value === "unknown"
        ) {
          $("photoQuality").value = "clear";
        }

        showToast("Photo prepared for this draft.");
      } catch (error) {
        photoData = "";
        renderPhotoPreview();

        setMessage(
          "reportFormMessage",
          error.message || "Could not prepare this photo."
        );
      }
    });

    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    setup();
  }
})();