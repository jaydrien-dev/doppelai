/**
 * Claude describes keys the X11 way — "ctrl+s", "Return", "alt+Tab".
 * Windows SendKeys wants "^s", "{ENTER}", "%{TAB}". This is the translation.
 */

const MODIFIERS = {
  ctrl: "^",
  control: "^",
  alt: "%",
  shift: "+",
  // Windows has no SendKeys modifier for the meta/super key; it is dropped
  // deliberately rather than silently mistranslated into something else.
  super: "",
  meta: "",
  cmd: "",
  win: "",
};

const NAMED = {
  return: "{ENTER}",
  enter: "{ENTER}",
  kp_enter: "{ENTER}",
  tab: "{TAB}",
  escape: "{ESC}",
  esc: "{ESC}",
  backspace: "{BACKSPACE}",
  bs: "{BACKSPACE}",
  delete: "{DELETE}",
  del: "{DELETE}",
  insert: "{INSERT}",
  home: "{HOME}",
  end: "{END}",
  prior: "{PGUP}",
  page_up: "{PGUP}",
  pageup: "{PGUP}",
  next: "{PGDN}",
  page_down: "{PGDN}",
  pagedown: "{PGDN}",
  up: "{UP}",
  down: "{DOWN}",
  left: "{LEFT}",
  right: "{RIGHT}",
  space: " ",
  capslock: "{CAPSLOCK}",
  printscreen: "{PRTSC}",
  print: "{PRTSC}",
  break: "{BREAK}",
  help: "{HELP}",
  numlock: "{NUMLOCK}",
  scrolllock: "{SCROLLLOCK}",
};

for (let i = 1; i <= 16; i++) NAMED[`f${i}`] = `{F${i}}`;

/** SendKeys treats these as syntax; a literal one has to be wrapped. */
const LITERAL = new Set(["+", "^", "%", "~", "(", ")", "{", "}", "[", "]"]);

/**
 * "ctrl+shift+s" -> "^+s"; "Return" -> "{ENTER}"; "alt+F4" -> "%{F4}".
 * Returns null for anything it can't faithfully express, so the caller can
 * report an honest failure instead of pressing the wrong thing.
 */
function toSendKeys(combo) {
  const raw = String(combo ?? "").trim();
  if (!raw) return null;

  const parts = raw.split(/[+\s]+/).filter(Boolean);
  const mods = [];
  let key = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower in MODIFIERS) {
      const symbol = MODIFIERS[lower];
      if (symbol === "") return null; // a modifier we cannot send
      if (!mods.includes(symbol)) mods.push(symbol);
      continue;
    }
    if (key !== null) return null; // two non-modifier keys: not a combo we know
    key = lower;
  }

  if (key === null) return null;

  let target;
  if (key in NAMED) target = NAMED[key];
  else if (key.length === 1) target = LITERAL.has(key) ? `{${key}}` : key;
  else return null;

  return `${mods.join("")}${target}`;
}

/** A sequence like "ctrl+a ctrl+c" -> ["^a", "^c"]. */
function toSequence(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(toSendKeys);
}

module.exports = { toSendKeys, toSequence };
