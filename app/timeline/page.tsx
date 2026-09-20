"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { ago } from "@/lib/time";
import type { BrainEpisode } from "@/lib/types";
import { Button } from "@/components/ui";

/**
 * The timeline — a searchable, scrollable record of everything Doppel has seen.
 *
 * This is Doppel's answer to "what was I doing on Tuesday?" but better than
 * a screenshot scroller because it's searchable by meaning, not just date.
 * Episodes are grouped by day, with a date picker on the side and a search
 * bar that filters by text match.
 */

export default function TimelinePage() {
  const now = useDoppel((s) => s.now);
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<BrainEpisode[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  /* Load available dates on mount. */
  useEffect(() => {
    doppel.brainAvailableDates().then((d) => {
      setDates(d);
      if (d.length > 0 && !selectedDate) setSelectedDate(d[0]);
    });
  }, []);

  /* Load episodes when date changes. */
  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    doppel.brainEpisodesForDate(selectedDate).then((eps) => {
      setEpisodes(eps);
      setLoading(false);
    });
  }, [selectedDate]);

  /* Simple text search: filter episodes by matching against activity, intent,
     detail, location, fragments. */
  const filtered = search.trim()
    ? episodes.filter((e) => {
        const q = search.toLowerCase();
        return (
          e.activity?.toLowerCase().includes(q) ||
          e.intent?.toLowerCase().includes(q) ||
          e.detail?.toLowerCase().includes(q) ||
          e.location?.toLowerCase().includes(q) ||
          e.fragments?.some(
            (f) =>
              f.value?.toLowerCase().includes(q) ||
              f.what?.toLowerCase().includes(q),
          )
        );
      })
    : episodes;

  return (
    <div className="flex gap-8" style={{ maxWidth: 960 }}>
      {/* ------------------------------------------------------- date picker */}
      <aside
        className="shrink-0 hide-scrollbar"
        style={{
          width: 160,
          maxHeight: "calc(100vh - 180px)",
          overflowY: "auto",
          position: "sticky",
          top: 80,
        }}
      >
        <p className="micro-label mb-4">{voice.timeline.title}</p>
        <div className="flex flex-col gap-1">
          {dates.map((date) => (
            <button
              key={date}
              onClick={() => setSelectedDate(date)}
              className="cursor-pointer text-left"
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-control)",
                background: date === selectedDate ? "var(--primary)" : "transparent",
                color: date === selectedDate ? "white" : "var(--ink)",
                fontWeight: date === selectedDate ? 600 : 400,
                fontSize: "var(--text-sm)",
                border: "none",
                transition: "all 0.15s ease",
              }}
            >
              {voice.timeline.dateLabel(date)}
            </button>
          ))}
          {dates.length === 0 && (
            <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)", padding: "8px 12px" }}>
              {voice.timeline.empty}
            </p>
          )}
        </div>
      </aside>

      {/* ------------------------------------------------------ main content */}
      <div className="min-w-0 flex-1">
        <header className="mb-8">
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 700 }}>
            {selectedDate ? voice.timeline.dateLabel(selectedDate) : voice.timeline.title}
          </h1>
          <p className="agent-voice mt-2" style={{ color: "var(--slate)" }}>
            {voice.timeline.intro}
          </p>
        </header>

        {/* --------------------------------------------------------- search */}
        <div className="mb-8">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={voice.timeline.searchPlaceholder}
            className="w-full"
            style={{
              padding: "14px 20px",
              borderRadius: "var(--radius-control)",
              background: "var(--bg-base)",
              boxShadow: "var(--elev-pressed-sm)",
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
            }}
          />
        </div>

        {/* -------------------------------------------------------- results */}
        {loading ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="agent-voice" style={{ color: "var(--slate)" }}>
            {search ? voice.timeline.noResults : voice.timeline.empty}
          </p>
        ) : (
          <>
            <p className="micro-label mb-4">
              {voice.timeline.count(filtered.length)}
              {search && ` matching "${search}"`}
            </p>
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {filtered.map((ep) => (
                  <EpisodeCard key={ep.id} episode={ep} now={now} search={search} />
                ))}
              </AnimatePresence>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EpisodeCard({
  episode: ep,
  now,
  search,
}: {
  episode: BrainEpisode;
  now: number;
  search: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const time = new Date(ep.at).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={ep.sensitive ? "pressed" : "raised"}
      style={{
        padding: "18px 22px",
        cursor: "pointer",
        borderLeft: ep.salience >= 0.7
          ? "3px solid var(--primary)"
          : "3px solid transparent",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-4">
        {ep.app && (
          <div
            className="shrink-0 mt-0.5 flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: "var(--radius-control)",
              background: "var(--primary-soft)",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--primary)",
            }}
          >
            {ep.app.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>
              {ep.sensitive
                ? voice.timeline.sensitive
                : highlight(ep.activity || ep.intent || "(no activity)", search)}
            </p>
            <span className="micro-label shrink-0">{time}</span>
          </div>

          {!ep.sensitive && ep.intent && ep.intent !== ep.activity && (
            <p
              className="mt-1"
              style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
            >
              {highlight(ep.intent, search)}
            </p>
          )}

          {!ep.sensitive && ep.location && (
            <p className="micro-label mt-1">{ep.location}</p>
          )}

          {expanded && !ep.sensitive && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-3"
            >
              {ep.detail && (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  {highlight(ep.detail, search)}
                </p>
              )}

              {ep.changed && (
                <p className="mt-2" style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}>
                  Changed: {ep.changed}
                </p>
              )}

              {ep.fragments && ep.fragments.length > 0 && (
                <div className="mt-3 pressed" style={{ padding: "12px 16px" }}>
                  <p className="micro-label mb-2">What was on screen</p>
                  {ep.fragments.slice(0, 20).map((f, i) => (
                    <p key={i} style={{ fontSize: "var(--text-xs, 11px)", color: "var(--ink)" }}>
                      <span style={{ color: "var(--slate)" }}>{f.what}: </span>
                      {highlight(f.value, search)}
                    </p>
                  ))}
                </div>
              )}

            </motion.div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Highlight matching search text in a string. */
function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const q = query.toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: "var(--primary-soft)", borderRadius: 2, padding: "0 2px" }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}
