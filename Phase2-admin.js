
/* CIVICFIX PHASE 2 ADMIN REVIEW */
(async function () {
  "use strict";

  const panel = document.createElement("section");
  panel.id = "phase2ReviewPanel";
  panel.style.cssText =
    "margin:24px auto;padding:20px;max-width:1100px;" +
    "border:1px solid #d9ded2;border-radius:12px;color:#222;" +
    "background:#fff;font-family:Arial,sans-serif";

  panel.innerHTML = `
    <h2>Phase 2 — Report quality review</h2>
    <p>Reports that may need verification because of incomplete details,
    uncertain location, or unavailable photos.</p>
    <button id="phase2Refresh" type="button">Refresh reports</button>
    <p id="phase2AdminStatus" role="status">Loading reports...</p>
    <div id="phase2AdminResults"></div>
  `;

  document.body.appendChild(panel);

  const status = panel.querySelector("#phase2AdminStatus");
  const results = panel.querySelector("#phase2AdminResults");

  function cell(value) {
    const td = document.createElement("td");
    td.textContent = value == null || value === "" ? "Not provided" : String(value);
    td.style.cssText = "padding:10px;border-bottom:1px solid #ddd;";
    return td;
  }

  async function loadReports() {
    status.textContent = "Loading reports...";
    results.replaceChildren();

    try {
      const response = await fetch("/api/reports");

      if (!response.ok) {
        throw new Error("Server returned HTTP " + response.status);
      }

      const data = await response.json();
      const reports = Array.isArray(data)
        ? data
        : Array.isArray(data.reports) ? data.reports : [];

      const heading = document.createElement("p");
      heading.textContent = `${reports.length} report(s) received from the server`;
      results.appendChild(heading);

      if (!reports.length) {
        status.textContent = "No server reports found.";
        return;
      }

      const table = document.createElement("table");
      table.style.cssText =
        "width:100%;border-collapse:collapse;text-align:left;" +
        "font-size:13px;overflow-wrap:anywhere";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      [
        "Report ID", "Category", "Location",
        "Photo status", "Location confidence", "Review"
      ].forEach(label => {
        const th = document.createElement("th");
        th.textContent = label;
        th.style.cssText =
          "padding:10px;background:#f0f2ec;border-bottom:1px solid #ccc";
        headerRow.appendChild(th);
      });

      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      reports.forEach(report => {
        const row = document.createElement("tr");

        const photoStatus = report.photoUploadStatus ||
          (report.hasPhoto ? "Photo status unknown" : "Missing photo");

        const locationConfidence = report.locationAccuracy ||
          report.locationSource || "Not verified";

        const missingCoreDetails =
          !report.category || !report.location ||
          !report.description || !report.severity;

        const needsReview =
          missingCoreDetails ||
          !report.hasPhoto ||
          ["unknown", "approximate", "user-provided"].includes(
            report.locationAccuracy
          ) ||
          report.photoQuality === "blurry";

        const review = missingCoreDetails
          ? "Incomplete — follow up"
          : needsReview
            ? "Needs verification"
            : "Details supplied";

        [
          report.clientReportId || report.id || report._id,
          report.category,
          report.location,
          photoStatus,
          locationConfidence,
          review
        ].forEach(value => row.appendChild(cell(value)));

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      results.appendChild(table);
      status.textContent = "Report review loaded.";
    } catch (error) {
      status.textContent =
        "Could not load server reports. Check the server connection and /api/reports endpoint.";
    }
  }

  panel.querySelector("#phase2Refresh").addEventListener("click", loadReports);
  await loadReports();
})();
