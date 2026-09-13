/**
 * Outlook Mail add-on — Microsoft Graph API.
 */

var GRAPH = "https://graph.microsoft.com/v1.0";

async function graph(path, token, options) {
  options = options || {};
  var res = await fetch(GRAPH + path, {
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
    throw new Error("Graph " + res.status + ": " + body.slice(0, 200));
  }
  if (res.status === 204) return null;
  return res.json();
}

function fmtDate(iso) { return iso ? iso.slice(0, 16).replace("T", " ") : ""; }

async function outlook_inbox(input, config) {
  var count = Math.min(Math.max(input.count || 10, 1), 30);
  var filter = input.unread_only ? "&$filter=isRead eq false" : "";

  var data = await graph(
    "/me/messages?$select=from,subject,receivedDateTime,isRead,bodyPreview" +
    "&$orderby=receivedDateTime desc&$top=" + count + filter,
    config._token,
  );

  var messages = data.value || [];
  if (messages.length === 0) {
    return { text: input.unread_only ? "No unread messages." : "Inbox is empty." };
  }

  var lines = messages.map(function (m) {
    var flag = m.isRead ? "" : "[NEW] ";
    var from = m.from && m.from.emailAddress ? m.from.emailAddress.name || m.from.emailAddress.address : "Unknown";
    var preview = (m.bodyPreview || "").replace(/[\r\n]+/g, " ").slice(0, 150);
    var out = fmtDate(m.receivedDateTime) + "  " + flag + from + ": " + m.subject;
    if (preview) out += "\n   " + preview + "...";
    return out;
  });

  var label = input.unread_only ? "Unread messages" : "Recent inbox";
  return { text: label + ":\n\n" + lines.join("\n\n") };
}

async function outlook_search(input, config) {
  var query = input.query;
  if (!query) return { error: true, text: "No search query given." };

  var count = Math.min(Math.max(input.count || 10, 1), 30);

  var data = await graph(
    "/me/messages?$search=%22" + encodeURIComponent(query) + "%22" +
    "&$select=from,subject,receivedDateTime,bodyPreview&$top=" + count,
    config._token,
  );

  var messages = data.value || [];
  if (messages.length === 0) return { text: "No matching emails found." };

  var lines = messages.map(function (m) {
    var from = m.from && m.from.emailAddress ? m.from.emailAddress.name || m.from.emailAddress.address : "Unknown";
    var preview = (m.bodyPreview || "").replace(/[\r\n]+/g, " ").slice(0, 150);
    var out = fmtDate(m.receivedDateTime) + "  " + from + ": " + m.subject;
    if (preview) out += "\n   " + preview + "...";
    return out;
  });

  return { text: "Email search for \"" + query + "\":\n\n" + lines.join("\n\n") };
}

async function outlook_send(input, config) {
  var to = input.to;
  var subject = input.subject;
  var body = input.body;
  if (!to) return { error: true, text: "No recipient given." };
  if (!subject) return { error: true, text: "No subject given." };
  if (!body) return { error: true, text: "No body given." };

  var toRecipients = to.split(",").map(function (addr) {
    return { emailAddress: { address: addr.trim() } };
  });
  var ccRecipients = [];
  if (input.cc) {
    ccRecipients = input.cc.split(",").map(function (addr) {
      return { emailAddress: { address: addr.trim() } };
    });
  }

  await graph("/me/sendMail", config._token, {
    method: "POST",
    body: {
      message: {
        subject: subject,
        body: { contentType: "Text", content: body },
        toRecipients: toRecipients,
        ccRecipients: ccRecipients,
      },
    },
  });

  return { text: "Email sent to " + to + ": \"" + subject + "\"" };
}

module.exports = {
  outlook_inbox: outlook_inbox,
  outlook_search: outlook_search,
  outlook_send: outlook_send,
};
