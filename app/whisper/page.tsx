"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { RichText } from "@/components/RichText";
import type { MorningBrief, Nudge } from "@/lib/types";

type Phase = "idle" | "recording" | "transcribing" | "thinking" | "answer" | "working";

/**
 * The whisper panel — a glassmorphic floating surface that appears on a global
 * hotkey. Full access to everything Doppel can do: ask questions from memory,
 * run agent tasks (background or foreground), stop/approve running tasks.
 */
export default function WhisperPage() {
  const connect = useDoppel((s) => s.connect);
  const openaiReady = useDoppel((s) => s.ai.openaiConfigured);
  const aiConfigured = useDoppel((s) => s.ai.configured);
  const agents = useDoppel((s) => s.agents);
  const nudges = useDoppel((s) => s.nudges);

  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<{ role: string; content: string }[]>([]);
  const [conversational, setConversational] = useState(false);
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef("");
  const convoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const liveAgents = agents.filter((t) => ["running", "parked", "stopping"].includes(t.status));
  const doneAgents = agents.filter((t) => t.summary && !["running", "parked", "stopping"].includes(t.status));
  const visibleAgents = [...liveAgents, ...doneAgents];
  const agentBusy = liveAgents.length > 0;

  useEffect(() => {
    connect();
    document.documentElement.classList.add("whisper");
    return () => document.documentElement.classList.remove("whisper");
  }, [connect]);

  /* Stream listener — tokens arrive one at a time from brain:ask-fast.
     Accumulate into streamRef and push to answer state so the user sees
     words appear as they're generated (~300ms to first token vs ~3s). */
  useEffect(() => {
    const cleanup = window.doppel?.onAnswerStream?.((delta: string) => {
      streamRef.current += delta;
      setAnswer(streamRef.current);
      setPhase("answer");
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    /* Auto-start recording when the panel opens, if voice is ready. */
    if (openaiReady && aiConfigured) {
      startRecording();
    } else {
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Morning brief — show if it's before noon and a cached brief exists. */
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12 && aiConfigured) {
      window.doppel?.morningBriefCached().then((r) => {
        if (r?.ok && r.brief) setBrief(r.brief);
      });
    }
  }, [aiConfigured]);

  /* Conversational mode — auto-start recording on idle or after answer.
     In "answer" phase, recording starts silently so the response stays
     visible. The phase flips to "recording" only when speech is detected. */
  useEffect(() => {
    if (!conversational || !openaiReady) return;
    if (convoTimerRef.current) { clearTimeout(convoTimerRef.current); convoTimerRef.current = null; }

    if ((phase === "idle" || phase === "answer") && !agentBusy && !recorderRef.current) {
      convoTimerRef.current = setTimeout(() => {
        convoTimerRef.current = null;
        startRecording(phase === "answer");
      }, phase === "answer" ? 1500 : 800);
    }

    return () => {
      if (convoTimerRef.current) { clearTimeout(convoTimerRef.current); convoTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversational, phase, agentBusy]);

  /* Auto-grow textarea when input changes (e.g. from transcription). */
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  /* When a foreground task finishes during "working" phase, show its result. */
  const fgTask = agents.find((t) => t.mode === "foreground" && t.summary);
  useEffect(() => {
    if (phase === "working" && fgTask?.summary) {
      setAnswer(
        fgTask.summary.outcome === "done"
          ? `Done. ${fgTask.summary.text}`
          : `Stopped. ${fgTask.summary.text}`,
      );
      setPhase("answer");
      scheduleDismiss();
    }
  }, [fgTask?.summary, phase]);

  /* When a background task finishes while we're idle, surface its result
     as an answer so the user doesn't miss it. */
  const lastDoneBg = doneAgents.find((t) => t.mode === "background");
  const lastDoneIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "idle" && lastDoneBg?.summary && lastDoneBg.id !== lastDoneIdRef.current) {
      lastDoneIdRef.current = lastDoneBg.id;
      setAnswer(
        lastDoneBg.summary.outcome === "done"
          ? `Done: ${lastDoneBg.summary.text}`
          : `Stopped: ${lastDoneBg.summary.text}`,
      );
      setPhase("answer");
    }
  }, [lastDoneBg?.id, lastDoneBg?.summary, phase]);

  /* ---------------------------------------------------------------- record */

  const speechFramesRef = useRef(0);

  const startRecording = async (silent = false) => {
    if (!openaiReady) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      speechFramesRef.current = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        stopSilenceDetection();
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });

        const minSpeechFrames = 12;
        if (blob.size < 100 || speechFramesRef.current < minSpeechFrames) {
          /* Not enough speech — restart silently in convo mode,
             otherwise go idle. */
          if (conversational) {
            setTimeout(() => startRecording(true), 400);
          } else {
            setPhase("idle");
            inputRef.current?.focus();
          }
          return;
        }

        await handleVoice(blob);
      };

      recorderRef.current = recorder;
      recorder.start();
      /* In silent mode (convo re-listen), keep the current phase (e.g. "answer")
         visible — only flip to "recording" once speech is detected. */
      if (!silent) setPhase("recording");

      /* Silence detection via Web Audio API volume monitoring. */
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let speechDetected = false;

      const check = () => {
        if (!recorderRef.current || recorderRef.current.state !== "recording") return;
        analyser.getByteFrequencyData(data);
        const volume = data.reduce((a, b) => a + b, 0) / data.length;

        if (volume > 50) {
          if (!speechDetected) {
            speechDetected = true;
            /* Show "recording" as soon as voice is detected, even in
               silent mode — the user needs to see we heard them. */
            setPhase("recording");
          }
          speechFramesRef.current += 1;
          if (silenceRef.current) {
            clearTimeout(silenceRef.current);
            silenceRef.current = null;
          }
        } else if (speechDetected && !silenceRef.current) {
          silenceRef.current = setTimeout(() => {
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.stop();
              recorderRef.current = null;
              setPhase("transcribing");
            }
          }, 2500);
        }
        rafRef.current = requestAnimationFrame(check);
      };
      rafRef.current = requestAnimationFrame(check);
    } catch {
      setPhase("idle");
    }
  };

  const stopSilenceDetection = () => {
    if (silenceRef.current) { clearTimeout(silenceRef.current); silenceRef.current = null; }
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analyserRef.current = null;
  };

  const stopRecording = () => {
    stopSilenceDetection();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      recorderRef.current = null;
      setPhase("transcribing");
    }
  };

  /* --------------------------------------------------------- voice handler */

  const handleVoice = async (blob: Blob) => {
    setPhase("transcribing");
    const buffer = await blob.arrayBuffer();

    /* Step 1: transcribe only — fast, isolated API call. */
    const txResult = await doppel.transcribeAudio(buffer);

    if (!txResult?.ok || !txResult.text) {
      setPhase("idle");
      if (!conversational) {
        setAnswer(txResult?.detail ?? voice.whisper.noSpeech);
        setPhase("answer");
        scheduleDismiss();
      }
      return;
    }

    const transcript = txResult.text;

    /* Guard against Whisper hallucinations — when given near-silence or
       ambient noise, Whisper often outputs Korean/Chinese text, emojis,
       "thank you for watching", music notation, etc. */
    if (isWhisperHallucination(transcript)) {
      setPhase("idle");
      return;
    }

    setInput(transcript);

    /* Step 2: classify and route.
       Screen questions win — grab a fresh screenshot then ask the brain.
       Instructions (that aren't screen questions) go to the agent.
       Everything else goes to the brain as conversation. */
    if (isInstruction(transcript) && !isScreenQuestion(transcript)) {
      setPhase("idle");
      const priorUser = history.filter((h) => h.role === "user").pop();
      const isConfirmation = transcript.trim().length < 30
        && /\b(do it|do that|do what i|just do|go ahead|go for it|make it happen|let's go|run it|start it|proceed)\b/i.test(transcript);
      const instruction = priorUser && isConfirmation
        ? priorUser.content
        : transcript;
      setHistory([]);
      await runTask(instruction);
    } else {
      setPhase("thinking");
      if (isScreenQuestion(transcript)) await doppel.lookNow();
      streamRef.current = "";
      const result = await window.doppel?.askBrainFast(transcript, history);
      const reply = result?.ok && result.text
        ? result.text
        : (result?.detail ?? "I don't have enough context to answer that yet.");
      if (!streamRef.current) {
        setAnswer(reply);
        setPhase("answer");
      }
      setHistory((prev) => [
        ...prev,
        { role: "user", content: transcript },
        { role: "assistant", content: reply },
      ]);
      scheduleDismiss();
      if (conversational) setTimeout(() => startRecording(true), 1500);
    }
  };

  /* --------------------------------------------------------- text handler */

  const submitText = async (text: string) => {
    const q = text.trim();
    if (!q) return;

    /* Stop any active recording so it doesn't interfere. */
    if (recorderRef.current?.state === "recording") {
      stopSilenceDetection();
      recorderRef.current.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      recorderRef.current = null;
    }

    if (isInstruction(q) && !isScreenQuestion(q)) {
      setPhase("idle");
      const priorUser = history.filter((h) => h.role === "user").pop();
      const isConfirmation = q.length < 30
        && /\b(do it|do that|do what i|just do|go ahead|go for it|make it happen|let's go|run it|start it|proceed)\b/i.test(q);
      const instruction = priorUser && isConfirmation
        ? priorUser.content
        : q;
      setHistory([]);
      await runTask(instruction);
    } else {
      setPhase("thinking");
      if (isScreenQuestion(q)) await doppel.lookNow();
      streamRef.current = "";
      const result = await window.doppel?.askBrainFast(q, history);
      const reply = result?.ok && result.text
        ? result.text
        : (result?.detail ?? "I don't have enough context to answer that yet.");
      if (!streamRef.current) {
        setAnswer(reply);
        setPhase("answer");
      }
      setHistory((prev) => [
        ...prev,
        { role: "user", content: q },
        { role: "assistant", content: reply },
      ]);
      scheduleDismiss();
      if (conversational) setTimeout(() => startRecording(true), 1500);
    }
  };

  /* --------------------------------------------------------- agent runner */

  const runTask = async (instruction: string, mode: "background" | "foreground" = "background") => {
    if (mode === "foreground") {
      setPhase("working");
      setAnswer("");
    }
    const result = await doppel.runAgent({ instruction, mode });

    if (!result?.ok) {
      setAnswer(result?.detail ?? "I couldn't start.");
      setPhase("answer");
      scheduleDismiss();
      return;
    }

    /* Background tasks: stay conversational — the task strip shows progress.
       Foreground tasks: switch to "working" phase until done. */
    if (mode === "background") {
      setInput("");
      setPhase("idle");
      inputRef.current?.focus();
    }
  };

  /* ------------------------------------------------------- instruction test */

  /** Detect Whisper hallucinations — garbage output from silence/noise. */
  function isWhisperHallucination(text: string): boolean {
    const t = text.trim();
    if (t.length < 2) return true;
    /* Entirely non-Latin script (Whisper hallucinates CJK from silence) */
    if (/^[^\x20-\x7E]+$/.test(t)) return true;
    /* Just emojis / symbols */
    if (/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t)) return true;
    /* Common Whisper silence hallucinations */
    if (/^(thanks? (for watching|for listening)|please subscribe|music|applause|\[music\]|\(music\)|you$)/i.test(t)) return true;
    /* Whisper repeating the same short phrase — classic hallucination */
    if (t.length > 10) {
      const words = t.split(/\s+/);
      const unique = new Set(words.map((w) => w.toLowerCase()));
      if (unique.size === 1 && words.length > 2) return true;
    }
    return false;
  }

  function isScreenQuestion(text: string): boolean {
    return [
      /* Explicit "screen" mentions */
      /\bwhat.*(on|at).*(my|the)?\s*screen\b/i,
      /\blook at.*(my|the)?\s*screen\b/i,
      /\bread.*(my|the)?\s*screen\b/i,
      /\bscreen\s*right\s*now\b/i,
      /\bwhat.*screen\b/i,
      /\bsee.*my\s*screen\b/i,
      /\b(describe|explain|check)\s+.*(screen|window|page)\b/i,
      /* "what am I doing / looking at / working on" */
      /\bwhat.*(am i|i'm).*(look|see|do|work)/i,
      /* "what do you see right now" */
      /\bwhat.*(see|seeing|show)\b.*right now/i,
      /\btell me what.*(see|screen|open)\b/i,
      /\bcurrently\s+(on|open|showing|visible)\b/i,
      /* Deictic — pointing at screen without saying "screen" */
      /\blook at (it|this|that)\b/i,
      /\blook (again|once more|one more time)\b/i,
      /\b(take|have) a look\b/i,
      /\bcheck (this|that|it) out\b/i,
      /\bcheck (again|this|that|it)\b/i,
      /\bread (this|that|it)\b/i,
      /\bwhat('s| is| does) (this|that|it)\s*(say|show|mean)?\s*\??\s*$/i,
      /\bwhat('s| is) (this|that)\b/i,
      /\b(can|do) you see (this|that|it)\b/i,
      /\bwhat does (this|that|it) say\b/i,
      /\bwhat('s| is) (going on|happening)( here)?\b/i,
      /\bwhat('s| is) (showing|visible|displayed|in front of me)\b/i,
    ].some((re) => re.test(text));
  }

  function isInstruction(text: string): boolean {
    const t = text.trim();

    /* Questions starting with question words are questions, not instructions.
       Exception: "Can you X?" / "Could you X?" are polite commands. */
    if (t.endsWith("?")) {
      if (/^(what|where|when|why|how|who|which|is|are|does|do|did|was|were|has|have)\b/i.test(t)
        && !(/\b(can you|could you|would you|will you)\b/i.test(t))) {
        return false;
      }
    }

    /* Short follow-up confirmations — only when < 40 chars AND history exists.
       Must contain an explicit action word, not just "ok" / "yes" alone —
       "yes do it" is a command, "yes I understand" is not. */
    if (history.length > 0 && t.length < 40
      && /\b(do it|do that|do what i|just do|go ahead|go for it|make it happen|let's go|run it|start it|proceed)\b/i.test(t)) {
      return true;
    }

    const ACTION_VERBS = `(open|create|make|build|run|start|stop|move|copy|delete|install|download|send|write|edit|fix|update|close|launch|save|upload|convert|merge|add|remove|change|rename|find|get|search|show|take|put|turn|switch|toggle|enable|disable|clean|clear|organize|sort|schedule|order|post|share|deploy|test|format|print|zip|translate|summarize|draft|generate|fetch|pull|push|check|help|set|browse|surf|research|investigate|analyze|compare|review|go|navigate|click|select|type|enter|press|scroll|refresh|restart|cancel|undo|redo|play|pause|mute|unmute|minimize|maximize|resize|connect|disconnect|export|import|submit|commit|email|message|remind|bookmark|pin|unpin|archive|arrange|crop|backup|restore|log|sign)`;

    /* Polite commands — "can you" / "could you" must be followed by an action verb. */
    if (new RegExp(`\\b(can you|could you|would you|will you)\\s+${ACTION_VERBS}\\b`, "i").test(t)) return true;

    /* "I need you to..." / "I want you to..." followed by a verb. */
    if (new RegExp(`\\b(i need you to|i want you to|i'd like you to)\\s+${ACTION_VERBS}\\b`, "i").test(t)) return true;

    /* "please [verb]" — strong signal. */
    if (new RegExp(`\\bplease\\s+${ACTION_VERBS}\\b`, "i").test(t)) return true;

    /* Imperative at the start: "Search for...", "Find me...", "Open the...",
       "Go to...", "Click on...", "Scroll down..." */
    if (new RegExp(`^${ACTION_VERBS}\\s+(me|for|up|down|at|to|on|in|into|out|over|through|about|with|from|the|my|a|an|this|that|it|all)\\b`, "i").test(t)) return true;

    /* Bare imperative — single verb or verb + "it"/"this"/"that" at the end.
       "Stop." / "Cancel." / "Continue." / "Undo that." */
    if (new RegExp(`^${ACTION_VERBS}(\\s+(it|this|that|everything|all))?[.!]?$`, "i").test(t)) return true;

    return false;
  }

  /* -------------------------------------------------------------- nudges */

  const actNudge = async (n: Nudge) => {
    const result = await doppel.actOnNudge(n.id);
    if (!result?.ok) return;
    if (n.kind === "offer") {
      /* offer nudges trigger the agent — switch to working phase */
      setPhase("working");
    } else if (n.detail) {
      setAnswer(n.detail);
      setPhase("answer");
    }
  };

  /* -------------------------------------------------------------- dismiss */

  const scheduleDismiss = () => {
    /* No-op — the panel never hides itself. The user dismisses it with
       Escape, "Got it", or the hotkey toggle. */
  };

  const dismiss = () => {
    setConversational(false);
    setHistory([]);
    window.doppel?.whisperHide();
  };

  const reset = () => {
    stopSilenceDetection();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current = "";
    setInput("");
    setAnswer("");
    setPhase("idle");
    if (conversational) {
      setTimeout(() => startRecording(), 300);
    } else {
      inputRef.current?.focus();
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !busy) {
      e.preventDefault();
      submitText(input);
    }
    if (e.key === "Escape") dismiss();
  };

  const busy =
    phase === "transcribing" || phase === "thinking" || phase === "recording" || phase === "working";

  /* Shared easing — Apple-style spring feel. */
  const ease = [0.22, 0.68, 0, 1.0] as const;
  const fast = { duration: 0.22, ease };
  const medium = { duration: 0.32, ease };
  const slow = { duration: 0.44, ease };

  return (
    <div
      className="flex h-dvh w-full items-start justify-center select-none"
      style={{ background: "transparent", WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <motion.div
        layout
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ ...slow, layout: medium }}
        className="mt-1 flex w-full flex-col gap-3"
        style={{
          background: "rgba(240, 243, 248, 0.92)",
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          borderRadius: "var(--radius-card)",
          boxShadow:
            "0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(255, 255, 255, 0.18) inset",
          padding: "16px 20px",
          maxHeight: "calc(100dvh - 24px)",
          overflowY: "auto",
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties}
      >
        {/* Input row */}
        <div className="flex items-center gap-3">
          {openaiReady && (
            <>
              <motion.button
                onClick={() => {
                  if (phase === "recording") {
                    stopRecording();
                  } else {
                    startRecording();
                  }
                }}
                disabled={phase === "thinking" || phase === "transcribing" || phase === "working"}
                className="grid shrink-0 cursor-pointer place-items-center rounded-full"
                animate={{
                  background: phase === "recording" ? "var(--primary)" : "var(--bg-base)",
                  boxShadow: phase === "recording"
                    ? "0 0 16px var(--primary-glow)"
                    : "var(--elev-pressed-sm)",
                }}
                transition={fast}
                style={{ width: 38, height: 38 }}
                aria-label={phase === "recording" ? "Stop recording" : "Start recording"}
              >
                <MicIcon
                  active={phase === "recording"}
                  style={{
                    width: 18,
                    height: 18,
                    color: phase === "recording" ? "white" : "var(--slate)",
                  }}
                />
              </motion.button>

              <motion.button
                onClick={() => {
                  const next = !conversational;
                  setConversational(next);
                  if (next && phase === "idle") startRecording();
                }}
                className="grid shrink-0 cursor-pointer place-items-center rounded-full"
                animate={{
                  background: conversational ? "var(--primary)" : "var(--bg-base)",
                  boxShadow: conversational
                    ? "0 0 12px var(--primary-glow)"
                    : "var(--elev-pressed-sm)",
                }}
                transition={fast}
                style={{ width: 38, height: 38 }}
                aria-label={conversational ? "Exit conversational mode" : "Conversational mode"}
                title={conversational ? "Conversational mode on" : "Conversational mode"}
              >
                <ConvoIcon
                  active={conversational}
                  style={{
                    width: 18,
                    height: 18,
                    color: conversational ? "white" : "var(--slate)",
                  }}
                />
              </motion.button>
            </>
          )}

          <motion.textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={handleKey}
            rows={1}
            placeholder={
              !aiConfigured
                ? "Add an API key in Mind first"
                : "Ask me something or tell me what to do"
            }
            disabled={busy}
            animate={{ opacity: busy ? 0.5 : 1 }}
            transition={fast}
            className="min-w-0 flex-1"
            style={{
              padding: "10px 14px",
              borderRadius: "var(--radius-control)",
              background: "rgba(255, 255, 255, 0.5)",
              fontSize: "var(--text-sm)",
              color: "var(--ink)",
              border: "none",
              outline: "none",
              resize: "none",
              overflow: "hidden",
              lineHeight: 1.4,
            }}
          />

          {/* Emergency stop */}
          <AnimatePresence>
            {(busy || agentBusy) && (
              <motion.button
                initial={{ opacity: 0, scale: 0.5, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 38 }}
                exit={{ opacity: 0, scale: 0.5, width: 0 }}
                transition={medium}
                onClick={() => {
                  setConversational(false);
                  if (agentBusy) doppel.abortAgent();
                  if (recorderRef.current?.state === "recording") recorderRef.current.stop();
                  recorderRef.current = null;
                  setInput("");
                  setAnswer("");
                  setPhase("idle");
                  inputRef.current?.focus();
                }}
                className="grid shrink-0 cursor-pointer place-items-center rounded-full"
                style={{ width: 38, height: 38, background: "#ef4444" }}
                aria-label="Stop everything"
              >
                <StopIcon style={{ width: 16, height: 16, color: "white" }} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Nudge card */}
        <AnimatePresence>
          {phase === "idle" && nudges.length > 0 && (
            <motion.div
              key="nudge"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={medium}
              className="flex items-center gap-3 overflow-hidden"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-control)",
                background: "rgba(255, 255, 255, 0.5)",
                borderLeft: "3px solid var(--primary)",
              }}
            >
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "var(--text-sm)", color: "var(--ink)" }}>
                  {nudges[0].text}
                </p>
                {nudges[0].detail && (
                  <p style={{ fontSize: "var(--text-xs)", color: "var(--slate)", marginTop: 2 }}>
                    {nudges[0].detail}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {nudges[0].action && (
                  <button
                    onClick={() => actNudge(nudges[0])}
                    className="cursor-pointer"
                    style={{ fontSize: "var(--text-sm)", color: "var(--primary)", whiteSpace: "nowrap" }}
                  >
                    {nudges[0].action}
                  </button>
                )}
                <button
                  onClick={() => doppel.dismissNudge(nudges[0].id)}
                  className="cursor-pointer"
                  style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                >
                  {voice.nudge.dismiss}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Morning brief card */}
        <AnimatePresence>
          {phase === "idle" && brief && nudges.length === 0 && (
            <motion.div
              key="brief"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={medium}
              className="overflow-hidden"
              style={{
                padding: "12px 14px",
                borderRadius: "var(--radius-control)",
                background: "rgba(255, 255, 255, 0.5)",
                borderLeft: "3px solid var(--primary)",
              }}
            >
              <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
                {brief.greeting}
              </p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--slate)", marginBottom: 6 }}>
                {brief.yesterday}
              </p>
              {brief.openThreads.length > 0 && (
                <div style={{ marginBottom: 4 }}>
                  <p className="micro-label" style={{ marginBottom: 2 }}>Open threads</p>
                  {brief.openThreads.slice(0, 3).map((t, i) => (
                    <p key={i} style={{ fontSize: "var(--text-xs)", color: "var(--slate)" }}>· {t}</p>
                  ))}
                </div>
              )}
              <p style={{ fontSize: "var(--text-xs)", color: "var(--primary)", fontStyle: "italic" }}>
                {brief.suggestion}
              </p>
              <button
                onClick={() => setBrief(null)}
                className="cursor-pointer mt-1"
                style={{ fontSize: "var(--text-xs)", color: "var(--slate)" }}
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status / answer */}
        <AnimatePresence mode="wait">
          {phase === "recording" && (
            <StatusLine key="recording" transition={fast}>
              {voice.whisper.listening}
            </StatusLine>
          )}

          {phase === "transcribing" && (
            <StatusLine key="transcribing" pulse transition={fast}>
              {voice.whisper.transcribing}...
            </StatusLine>
          )}

          {phase === "thinking" && (
            <StatusLine key="thinking" pulse transition={fast}>
              {voice.whisper.thinking}...
            </StatusLine>
          )}

          {/* Foreground working */}
          {phase === "working" && (() => {
            const fg = agents.find((t) => t.mode === "foreground" && !t.summary);
            return fg ? (
              <motion.div
                key="working"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={medium}
              >
                <div className="flex items-center gap-2">
                  <Dot />
                  <span className="micro-label">
                    screen &middot; {voice.agent.running(fg.step)}
                  </span>
                </div>
                <AnimatePresence mode="wait">
                  {fg.narration.length > 0 && (
                    <motion.p
                      key={fg.narration[fg.narration.length - 1].at}
                      initial={{ opacity: 0, x: 4 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0 }}
                      transition={fast}
                      className="agent-voice mt-2"
                      style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                    >
                      {fg.narration[fg.narration.length - 1].text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            ) : null;
          })()}

          {phase === "answer" && (
            <motion.div
              key="answer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={medium}
            >
              <RichText>{answer}</RichText>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, ...fast }}
                className="mt-2 flex gap-3"
              >
                <button
                  onClick={reset}
                  className="cursor-pointer"
                  style={{ fontSize: "var(--text-sm)", color: "var(--primary)" }}
                >
                  Ask again
                </button>
                <button
                  onClick={dismiss}
                  className="cursor-pointer"
                  style={{ fontSize: "var(--text-sm)", color: "var(--slate)" }}
                >
                  {voice.whisper.dismiss}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Task strip — active + recently completed tasks */}
        <AnimatePresence>
          {visibleAgents.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 6, height: 0 }}
              animate={{
                opacity: t.summary ? 0.7 : 1,
                y: 0,
                height: "auto",
              }}
              exit={{ opacity: 0, height: 0, y: -4 }}
              transition={medium}
              className="overflow-hidden"
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-control)",
                background: t.summary
                  ? "rgba(255, 255, 255, 0.2)"
                  : t.status === "parked"
                    ? "rgba(var(--primary-rgb, 99,102,241), 0.08)"
                    : "rgba(255, 255, 255, 0.35)",
                borderLeft: t.status === "parked"
                  ? "3px solid var(--primary)"
                  : t.summary
                    ? "3px solid rgba(var(--primary-rgb, 99,102,241), 0.3)"
                    : "3px solid transparent",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {!t.summary && t.status === "running" && <Dot />}
                    <p style={{ fontSize: "var(--text-xs, 11px)", color: "var(--ink)" }}>
                      {t.summary
                        ? (t.summary.outcome === "done" ? "Done" : "Stopped")
                        : t.title.length > 40 ? t.title.slice(0, 40) + "\u2026" : t.title}
                    </p>
                  </div>
                  <AnimatePresence mode="wait">
                    {!t.summary && (
                      <motion.p
                        key={`progress-${t.step}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={fast}
                        className="micro-label"
                        style={{ marginTop: 1 }}
                      >
                        {t.mode} &middot; step {t.step}
                        {t.narration.length > 0 && ` \u2014 ${t.narration[t.narration.length - 1].text.slice(0, 50)}`}
                      </motion.p>
                    )}
                    {t.summary && (
                      <motion.p
                        key="summary"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={fast}
                        className="micro-label"
                        style={{ marginTop: 1 }}
                      >
                        {t.summary.text.length > 60 ? t.summary.text.slice(0, 60) + "\u2026" : t.summary.text}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Parked — needs approval */}
                <AnimatePresence>
                  {t.status === "parked" && t.parked && (
                    <motion.div
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 8 }}
                      transition={fast}
                      className="flex shrink-0 gap-2"
                    >
                      <button
                        onClick={() => doppel.answerAgent(t.id, "approve")}
                        className="cursor-pointer"
                        style={{ fontSize: "var(--text-xs, 11px)", color: "var(--primary)" }}
                      >
                        {voice.agent.approve}
                      </button>
                      <button
                        onClick={() => doppel.answerAgent(t.id, "stop")}
                        className="cursor-pointer"
                        style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
                      >
                        Stop
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Running — abort button */}
                <AnimatePresence>
                  {t.status === "running" && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.5 }}
                      transition={fast}
                      onClick={() => doppel.abortAgent(t.id)}
                      className="cursor-pointer shrink-0"
                      style={{ fontSize: "var(--text-xs, 11px)", color: "var(--slate)" }}
                    >
                      &times;
                    </motion.button>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function StatusLine({
  children,
  pulse,
  transition,
}: {
  children: React.ReactNode;
  pulse?: boolean;
  transition?: Record<string, unknown>;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={transition}
      className="flex items-center gap-2"
    >
      {pulse && <Dot />}
      <span className="micro-label">{children}</span>
    </motion.div>
  );
}

/** Animated activity dot — smooth opacity pulse, no janky scale. */
function Dot() {
  return (
    <motion.span
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--primary)",
        flexShrink: 0,
      }}
    />
  );
}

function MicIcon({ active, style }: { active: boolean; style: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      {active && (
        <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

function ConvoIcon({ active, style }: { active: boolean; style: React.CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {/* Two overlapping speech bubbles — conversation */}
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      {active && (
        <>
          {/* Animated dots inside the bubble — "talking" */}
          <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none">
            <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="0s" repeatCount="indefinite" />
          </circle>
          <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none">
            <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="0.2s" repeatCount="indefinite" />
          </circle>
          <circle cx="15" cy="10" r="1" fill="currentColor" stroke="none">
            <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
          </circle>
        </>
      )}
    </svg>
  );
}

function StopIcon({ style }: { style: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={style}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}
