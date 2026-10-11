
/* CIVICFIX PHASE 2 ADMIN REVIEW */
(function () {
  "use strict";

  const API_BASE = "http://localhost:3000/api";

  const panel = document.createElement("section");
  panel.id = "phase2ReviewPanel";
  panel.style.cssText =
    "margin:24px auto;padding:20px;max-width:1100px;" +
    "border:1px solid #d9ded2;border-radius:12px;color:#222;" +
    "background:#fff;font-family:Arial,sans-serif;overflow-x:auto";

  panel.innerHTML = `
    <h2>Phase 2 — Report quality review</h2>
    <p>Review submitted reports for incomplete details and information
    that may require verification.</p>
    <button id="phase2Refresh" type="button">Refresh reports</button>
    <p id="phase2AdminStatus" role="status">Loading reports...</p>
    <div id="phase2AdminResults"></div>
  `;

  panel.hidden = true;
  const adminApp = document.querySelector("#adminApp");
  (adminApp || document.body).appendChild(panel);

  const status = panel.querySelector("#phase2AdminStatus");
  const results = panel.querySelector("#phase2AdminResults");

  function cell(value) {
    const td = document.createElement("td");
    td.textContent =
      value == null || value === "" ? "Not provided" : String(value);
    td.style.cssText =
      "padding:10px;border-bottom:1px solid #ddd;overflow-wrap:anywhere;";
    return td;
  }

  async function loadReports() {
    status.textContent = "Loading reports...";
    results.replaceChildren();

    try {
      const response = await fetch(API_BASE + "/reports", {
        credentials: "include"
      });

      if (response.status === 401) {
        status.textContent = "Your admin session expired. Sign in again.";
        window.civicfixRequireAdminLogin?.(
          "Your admin session expired. Sign in again."
        );
        return;
      }

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.success === false) {
        throw new Error(data.message || "Could not retrieve reports.");
      }

      const reports = Array.isArray(data)
        ? data
        : Array.isArray(data.reports)
          ? data.reports
          : null;

      if (!reports) {
        throw new Error("Unexpected server response.");
      }

      const heading = document.createElement("p");
      heading.textContent =
        `${reports.length} report(s) received from the server`;
      results.appendChild(heading);

      if (reports.length === 0) {
        status.textContent = "No server reports found.";
        return;
      }

      const table = document.createElement("table");
      table.style.cssText =
        "width:100%;border-collapse:collapse;text-align:left;" +
        "font-size:13px;min-width:700px;";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      [
        "Report ID",
        "Category",
        "Location",
        "Photo status",
        "Location confidence",
        "Review"
      ].forEach(label => {
        const th = document.createElement("th");
        th.textContent = label;
        th.style.cssText =
          "padding:10px;background:#f0f2ec;border-bottom:1px solid #ccc;";
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      reports.forEach(report => {
        // Match the actual CivicFix backend field names.
        const reportId =
          report.trackingId || report.clientReportId ||
          report.id || report._id;

        const category = report.issueType || report.category;
        const location = report.location;
        const description = report.description;
        const severity = report.severity;

        // The current backend does not save photo or location-verification
        // metadata, so don't pretend those details were received.
        const photoStatus =
          report.photoUploadStatus ||
          (report.hasPhoto === true
            ? "Photo reported; upload not confirmed"
            : report.hasPhoto === false
              ? "No photo"
              : "Not recorded by server");

        const locationConfidence =
          report.locationAccuracy ||
          report.locationSource ||
          "Not recorded by server";

        const missingCoreDetails =
          !category ||
          !location ||
          !description ||
          !severity;

        const uncertainLocation = [
          "unknown",
          "approximate",
          "user-provided"
        ].includes(
          String(report.locationAccuracy || "").toLowerCase()
        );

        const photoNeedsReview =
          report.photoQuality === "blurry" ||
          report.hasPhoto === false;

        const metadataUnavailable =
          !report.photoUploadStatus &&
          typeof report.hasPhoto !== "boolean";

        const locationMetadataUnavailable =
          !report.locationAccuracy && !report.locationSource;

        let review;

        if (missingCoreDetails) {
          review = "Incomplete — follow up";
        } else if (
          uncertainLocation ||
          photoNeedsReview ||
          metadataUnavailable ||
          locationMetadataUnavailable
        ) {
          review = "Needs verification";
        } else {
          review = "Details supplied";
        }

        const row = document.createElement("tr");

        [
          reportId,
          category,
          location,
          photoStatus,
          locationConfidence,
          review
        ].forEach(value => row.appendChild(cell(value)));

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      results.appendChild(table);

      status.textContent =
        "Report review loaded. Missing photo/location metadata is identified for verification.";
    } catch (error) {
      console.error("CivicFix admin review error:", error);
      status.textContent =
        "Could not load reports. Make sure the CivicFix backend is running at localhost:3000.";
    }
  }

  panel.querySelector("#phase2Refresh")
    .addEventListener("click", loadReports);

  window.addEventListener("civicfix:admin-authenticated", () => {
    panel.hidden = false;
    loadReports();
  });

  window.addEventListener("civicfix:admin-logged-out", () => {
    panel.hidden = true;
    results.replaceChildren();
    status.textContent = "Sign in to review reports.";
  });
})();
