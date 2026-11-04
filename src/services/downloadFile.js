// Save text or a Blob as a file from the browser.
// The link is attached to the page while it is clicked and the object URL is kept for a minute. Clicking a detached link and revoking the URL straight away
// (what the report and CSV buttons used to do) can cancel the download of a large file in some browsers: a plate report is about 3 MB.
export function downloadFile(content, filename, mimeType = "application/octet-stream") {
  const blob = typeof Blob !== "undefined" && content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
