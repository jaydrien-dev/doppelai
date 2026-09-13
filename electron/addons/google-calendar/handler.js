/**
 * Google Calendar add-on — Google Calendar API v3.
 */

var GCAL = "https://www.googleapis.com/calendar/v3";

async function gcal(path, token) {
  var sep = path.includes("?") ? "&" : "?";
  var res = await fetch(GCAL + path + sep + "access_token=" + token, {
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 401) throw new Error("Session expired. Reconnect in the Add-ons page.");
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("Google Calendar " + res.status + ": " + body.slice(0, 200));
  }
  return res.json();
}

function fmtTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  return d.toTimeString().slice(0, 5);
}

function fmtDate(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function minsUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

async function gcal_today(_input, config) {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + 86400000);

  var data = await gcal(
    "/calendars/primary/events?timeMin=" + start.toISOString() +
    "&timeMax=" + end.toISOString() +
    "&singleEvents=true&orderBy=startTime&maxResults=30",
    config._token,
  );

  var events = data.items || [];
  if (events.length === 0) return { text: "No events today." };

  var lines = events.map(function (e) {
    var allDay = !!(e.start.date && !e.start.dateTime);
    var time = allDay ? "All day" : fmtTime(e.start.dateTime) + "-" + fmtTime(e.end.dateTime);
    var loc = e.location ? " @ " + e.location : "";
    var org = e.organizer && e.organizer.displayName ? " (" + e.organizer.displayName + ")" : "";
    return time + "  " + (e.summary || "(no title)") + loc + org;
  });

  return { text: "Today's Google Calendar:\n\n" + lines.join("\n") };
}

async function gcal_upcoming(input, config) {
  var hours = Math.min(Math.max(input.hours || 4, 1), 48);
  var now = new Date();
  var until = new Date(now.getTime() + hours * 3600000);

  var data = await gcal(
    "/calendars/primary/events?timeMin=" + now.toISOString() +
    "&timeMax=" + until.toISOString() +
    "&singleEvents=true&orderBy=startTime&maxResults=20",
    config._token,
  );

  var events = data.items || [];
  if (events.length === 0) return { text: "Nothing in the next " + hours + " hours." };

  var lines = events.map(function (e) {
    var t = e.start.dateTime || e.start.date;
    var mins = minsUntil(t);
    var loc = e.location ? " @ " + e.location : "";
    var time = e.start.dateTime ? fmtTime(e.start.dateTime) + "-" + fmtTime(e.end.dateTime) : "all day";
    return "In " + mins + " min: " + (e.summary || "(no title)") + " (" + time + ")" + loc;
  });

  return { text: "Upcoming (next " + hours + "h):\n\n" + lines.join("\n") };
}

async function gcal_search(input, config) {
  var query = input.query;
  if (!query) return { error: true, text: "No search query given." };

  var days = Math.min(Math.max(input.days || 30, 1), 90);
  var now = new Date();
  var start = new Date(now.getTime() - days * 86400000);
  var end = new Date(now.getTime() + days * 86400000);

  var data = await gcal(
    "/calendars/primary/events?timeMin=" + start.toISOString() +
    "&timeMax=" + end.toISOString() +
    "&q=" + encodeURIComponent(query) +
    "&singleEvents=true&orderBy=startTime&maxResults=20",
    config._token,
  );

  var events = data.items || [];
  if (events.length === 0) return { text: "No matching events found." };

  var lines = events.map(function (e) {
    var t = e.start.dateTime || e.start.date;
    var loc = e.location ? " @ " + e.location : "";
    return fmtDate(t) + "  " + (e.summary || "(no title)") + loc;
  });

  return { text: "Calendar search for \"" + query + "\":\n\n" + lines.join("\n") };
}

module.exports = { gcal_today: gcal_today, gcal_upcoming: gcal_upcoming, gcal_search: gcal_search };
