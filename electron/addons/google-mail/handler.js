/**
 * Gmail add-on — Gmail API v1.
 */

var GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gapi(path, token, options) {
  options = options || {};
  var res = await fetch(GMAIL + path, {
    method: options.method || "GET",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error("Session expired. Reconnect in the Add-ons page.");
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("Gmail " + res.status + ": " + body.slice(0, 200));
  }
  if (res.status === 204) return null;
  return res.json();
}

function decodeBase64Url(str) {
  if (!str) return "";
  var padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function headerVal(headers, name) {
  var h = (headers || []).find(function (h) { return h.name.toLowerCase() === name.toLowerCase(); });
  return h ? h.value : "";
}

async function gmail_inbox(input, config) {
  var count = Math.min(Math.max(input.count || 10, 1), 20);
  var q = input.unread_only ? "is:unread" : "";

  var list = await gapi(
    "/messages?maxResults=" + count + (q ? "&q=" + encodeURIComponent(q) : ""),
    config._token,
  );

  var ids = (list.messages || []).map(function (m) { return m.id; });
  if (ids.length === 0) {
    return { text: input.unread_only ? "No unread messages." : "Inbox is empty." };
  }

  var lines = [];
  for (var i = 0; i < ids.length; i++) {
    var msg = await gapi("/messages/" + ids[i] + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date", config._token);
    var from = headerVal(msg.payload.headers, "From");
    var subject = headerVal(msg.payload.headers, "Subject");
    var date = headerVal(msg.payload.headers, "Date");
    var unread = (msg.labelIds || []).indexOf("UNREAD") !== -1;
    var snippet = (msg.snippet || "").slice(0, 150);
    var flag = unread ? "[NEW] " : "";

    var dateStr = "";
    try { dateStr = new Date(date).toISOString().slice(0, 16).replace("T", " "); } catch (e) { dateStr = date; }

    lines.push(dateStr + "  " + flag + from + ": " + subject);
    if (snippet) lines.push("   " + snippet + "...");
    lines.push("");
  }

  var label = input.unread_only ? "Unread messages" : "Recent inbox";
  return { text: label + ":\n\n" + lines.join("\n").trim() };
}

async function gmail_search(input, config) {
  var query = input.query;
  if (!query) return { error: true, text: "No search query given." };

  var count = Math.min(Math.max(input.count || 10, 1), 20);

  var list = await gapi(
    "/messages?maxResults=" + count + "&q=" + encodeURIComponent(query),
    config._token,
  );

  var ids = (list.messages || []).map(function (m) { return m.id; });
  if (ids.length === 0) return { text: "No matching emails found." };

  var lines = [];
  for (var i = 0; i < ids.length; i++) {
    var msg = await gapi("/messages/" + ids[i] + "?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date", config._token);
    var from = headerVal(msg.payload.headers, "From");
    var subject = headerVal(msg.payload.headers, "Subject");
    var date = headerVal(msg.payload.headers, "Date");
    var snippet = (msg.snippet || "").slice(0, 150);

    var dateStr = "";
    try { dateStr = new Date(date).toISOString().slice(0, 16).replace("T", " "); } catch (e) { dateStr = date; }

    lines.push(dateStr + "  " + from + ": " + subject);
    if (snippet) lines.push("   " + snippet + "...");
    lines.push("");
  }

  return { text: "Gmail search for \"" + query + "\":\n\n" + lines.join("\n").trim() };
}

async function gmail_send(input, config) {
  var to = input.to;
  var subject = input.subject;
  var body = input.body;
  if (!to) return { error: true, text: "No recipient given." };
  if (!subject) return { error: true, text: "No subject given." };
  if (!body) return { error: true, text: "No body given." };

  var cc = input.cc || "";
  var raw = "To: " + to + "\r\n";
  if (cc) raw += "Cc: " + cc + "\r\n";
  raw += "Subject: " + subject + "\r\n";
  raw += "Content-Type: text/plain; charset=utf-8\r\n\r\n";
  raw += body;

  var encoded = Buffer.from(raw).toString("base64url");

  await gapi("/messages/send", config._token, {
    method: "POST",
    body: { raw: encoded },
  });

  return { text: "Email sent to " + to + ": \"" + subject + "\"" };
}

module.exports = { gmail_inbox: gmail_inbox, gmail_search: gmail_search, gmail_send: gmail_send };
