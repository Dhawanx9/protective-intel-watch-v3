/** Parses an uploaded OPML document into {id, label, url, region, enabled} entries. */
export function parseOPML(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("That file isn't valid OPML/XML.");
  const outlines = [...doc.querySelectorAll("outline[xmlUrl], outline[xmlurl]")];
  return outlines.map((o, i) => {
    const url = o.getAttribute("xmlUrl") || o.getAttribute("xmlurl");
    const label = o.getAttribute("title") || o.getAttribute("text") || url;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `feed-${i}`;
    return { id, label, url, region: "Imported", enabled: true };
  });
}

/** Serializes the current feed list to an OPML document string for download. */
export function toOPML(feeds) {
  const items = feeds.map(f =>
    `    <outline text="${escapeXml(f.label)}" title="${escapeXml(f.label)}" type="rss" xmlUrl="${escapeXml(f.url)}" />`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Protective Intel Watch - Feeds</title></head>
  <body>
${items}
  </body>
</opml>`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[m]));
}

export function downloadTextFile(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
