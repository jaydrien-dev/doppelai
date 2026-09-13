/**
 * Outlook Calendar add-on — Microsoft Graph API.
 */

var GRAPH = "https://graph.microsoft.com/v1.0";

async function graph(path, token) {
  var res = await fetch(GRAPH + path, {
    headers: { Authorization: "Bearer " + token },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error("Session expired. Reconnect in the Add-ons page.");
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("Graph " + res.status + ": " + body.slice(0, 200));
  }
  return res.json();
}

function fmtTime(iso) { return iso ? iso.slice(11, 16) : ""; }
function fmtDate(iso) { return iso ? iso.slice(0, 16).replace("T", " ") : ""; }
function minsUntil(iso) { return Math.round((new Date(iso + "Z").getTime() - Date.now()) / 60000); }

async function outlook_cal_today(_input, config) {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

  var data = await graph(
    "/me/calendarview?startDateTime=" + start + "&endDateTime=" + end +
    "&$select=subject,start,end,location,organizer,isAllDay,showAs&$orderby=start/dateTime&$top=30",
    config._token,
  );

  var events = data.value || [];
  if (events.length === 0) return { text: "No events today." };

  var lines = events.map(function (e) {
    var time = e.isAllDay ? "All day" : fmtTime(e.start.dateTime) + "-" + fmtTime(e.end.dateTime);
    var loc = e.location && e.location.displayName ? " @ " + e.location.displayName : "";
    var org = e.organizer && e.organizer.emailAddress ? " (" + e.organizer.emailAddress.name + ")" : "";
    return time + "  " + e.subject + loc + org;
  });

  return { text: "Today's Outlook Calendar:\n\n" + lines.join("\n") };
}

async function outlook_cal_upcoming(input, config) {
  var hours = Math.min(Math.max(input.hours || 4, 1), 48);
  var now = new Date();
  var until = new Date(now.getTime() + hours * 3600000);

  var data = await graph(
    "/me/calendarview?startDateTime=" + now.toISOString() + "&endDateTime=" + until.toISOString() +
    "&$select=subject,start,end,location&$orderby=start/dateTime&$top=20",
    config._token,
  );

  var events = data.value || [];
  if (events.length === 0) return { text: "Nothing in the next " + hours + " hours." };

  var lines = events.map(function (e) {
    var mins = minsUntil(e.start.dateTime);
    var loc = e.location && e.location.displayName ? " @ " + e.location.displayName : "";
    return "In " + mins + " min: " + e.subject + " (" + fmtTime(e.start.dateTime) + "-" + fmtTime(e.end.dateTime) + ")" + loc;
  });

  return { text: "Upcoming (next " + hours + "h):\n\n" + lines.join("\n") };
}

async function outlook_cal_search(input, config) {
  var query = input.query;
  if (!query) return { error: true, text: "No search query given." };

  var days = Math.min(Math.max(input.days || 30, 1), 90);
  var now = new Date();
  var start = new Date(now.getTime() - days * 86400000).toISOString();
  var end = new Date(now.getTime() + days * 86400000).toISOString();

  var data = await graph(
    "/me/calendarview?startDateTime=" + start + "&endDateTime=" + end +
    "&$select=subject,start,end,location,bodyPreview&$orderby=start/dateTime&$top=100",
    config._token,
  );

  var q = query.toLowerCase();
  var events = (data.value || []).filter(function (e) {
    return (e.subject || "").toLowerCase().includes(q) ||
      (e.bodyPreview || "").toLowerCase().includes(q);
  }).slice(0, 20);

  if (events.length === 0) return { text: "No matching events found." };

  var lines = events.map(function (e) {
    var loc = e.location && e.location.displayName ? " @ " + e.location.displayName : "";
    return fmtDate(e.start.dateTime) + "  " + e.subject + loc;
  });

  return { text: "Calendar search for \"" + query + "\":\n\n" + lines.join("\n") };
}

module.exports = {
  outlook_cal_today: outlook_cal_today,
  outlook_cal_upcoming: outlook_cal_upcoming,
  outlook_cal_search: outlook_cal_search,
};
