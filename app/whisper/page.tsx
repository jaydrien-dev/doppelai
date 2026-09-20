"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { RichText } from "@/components/RichText";
import type { InboxTask, MorningBrief, Nudge } from "@/lib/types";

type Phase = "idle" | "recording" | "transcribing" | "thinking" | "answer";

/**
 * The whisper panel — a glassmorphic floating surface that appears on a global
 * hotkey. Full access to everything Doppel can do: ask questions from memory,
 * run agent tasks (background or foreground), stop/approve running tasks.
 */
export default function WhisperPage() {
  const connect = useDoppel((s) => s.connect);
  const openaiReady = useDoppel((s) => s.ai.openaiConfigured);
  const aiConfigured = useDoppel((s) => s.ai.configured);
  const nudges = useDoppel((s) => s.nudges);
  const inbox = useDoppel((s) => s.inbox);
  const micSensitivity = useDoppel((s) => s.whisper.micSensitivity ?? 80);

  const [phase, setPhase] = useState<Phase>("idle");
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [thinking, setThinking] = useState("");
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
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
  const thinkingRef = useRef("");
  const convoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const convoRetriesRef = useRef(0);
  const wtRef = useRef<{ active: boolean; goal?: string; step?: number; total?: number; instruction?: string }>({ active: false });

  useEffect(() => {
    connect();
    document.documentElement.classList.add("whisper");
    return () => document.documentElement.classList.remove("whisper");
  }, [connect]);

  /* Stream listener — tokens arrive one at a time from brain:ask-fast.
     Accumulate into streamRef and push to answer state so the user sees
     words appear as they're generated (~300ms to first token vs ~3s).
     Guard: only transition to "answer" if we're still waiting for this
     response — don't override "recording" / "transcribing" if the user
     has already moved on to the next question. */
  useEffect(() => {
    const cleanup = window.doppel?.onAnswerStream?.((delta: string) => {
      streamRef.current += delta;
      setAnswer(streamRef.current);
      setPhase((prev) =>
        prev === "thinking" || prev === "answer" ? "answer" : prev,
      );
      setThinkingExpanded(false);
    });
    return () => cleanup?.();
  }, []);

  /* Thinking stream — shows Doppel's reasoning as it arrives, like Claude.
     Same guard: ignore stale tokens if the user has moved on. */
  useEffect(() => {
    const cleanup = window.doppel?.onThinkingStream?.((delta: string) => {
      setPhase((prev) => {
        if (prev !== "thinking" && prev !== "answer") return prev;
        thinkingRef.current += delta;
        setThinking(thinkingRef.current);
        return prev;
      });
    });
    return () => cleanup?.();
  }, []);

  /* Track walkthrough state so "next" / "back" / "stop" work mid-walkthrough. */
  useEffect(() => {
    const cleanup = window.doppel?.onGuideWalkthrough?.((data: unknown) => {
      const d = data as { active: boolean; goal?: string; step?: number; total?: number; instruction?: string };
      wtRef.current = d;
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
     visible. The phase flips to "recording" only when speech is detected.
     A longer delay after answers gives the user time to read. */
  useEffect(() => {
    if (!conversational || !openaiReady) return;
    if (convoTimerRef.current) { clearTimeout(convoTimerRef.current); convoTimerRef.current = null; }

    if ((phase === "idle" || phase === "answer") && !recorderRef.current) {
      convoTimerRef.current = setTimeout(() => {
        convoTimerRef.current = null;
        startRecording(phase === "answer");
      }, phase === "answer" ? 3000 : 800);
    }

    return () => {
      if (convoTimerRef.current) { clearTimeout(convoTimerRef.current); convoTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversational, phase]);

  /* Auto-grow textarea when input changes (e.g. from transcription). */
  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [input]);

  /* ---------------------------------------------------------------- record */

  const speechFramesRef = useRef(0);

  const startRecording = async (silent = false) => {
    if (!openaiReady) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      /* Route audio through a bandpass filter (200-3500 Hz) before recording.
         This physically removes low rumble (fans, HVAC, traffic) and high hiss
         from the audio that reaches Whisper — not just the VAD. */
      const filterCtx = new AudioContext();
      await filterCtx.resume();
      const filterSource = filterCtx.createMediaStreamSource(stream);

      const highpass = filterCtx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 200;
      highpass.Q.value = 0.7;

      const lowpass = filterCtx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 3500;
      lowpass.Q.value = 0.7;

      filterSource.connect(highpass).connect(lowpass);

      const filteredDest = filterCtx.createMediaStreamDestination();
      lowpass.connect(filteredDest);
      const filteredStream = filteredDest.stream;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : undefined;
      const recorder = new MediaRecorder(filteredStream, mime ? { mimeType: mime } : {});
      chunksRef.current = [];
      speechFramesRef.current = 0;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        filteredStream.getTracks().forEach((t) => t.stop());
        filterCtx.close().catch(() => {});
        stopSilenceDetection();
        clearTimeout(safetyTimer);
        const blob = new Blob(chunksRef.current, { type: mime ?? "audio/webm" });

        const minSpeechFrames = 12;
        if (blob.size < 100 || speechFramesRef.current < minSpeechFrames) {
          convoRetriesRef.current += 1;
          if (convoRetriesRef.current >= 3) setConversational(false);
          setPhase("idle");
          inputRef.current?.focus();
          return;
        }

        /* Successful recording — reset retry counter. */
        convoRetriesRef.current = 0;
        await handleVoice(blob);
      };

      recorderRef.current = recorder;
      recorder.start();
      /* In silent mode (convo re-listen), keep the current phase (e.g. "answer")
         visible — only flip to "recording" once speech is detected. */
      if (!silent) setPhase("recording");

      /* Silence detection via Web Audio API — speech-band only.
         Focus on 500–2500 Hz where speech formants are strongest. This avoids
         low rumble (fans, typing, HVAC at 50-400 Hz) and high-frequency hiss. */
      const audioCtx = new AudioContext();
      await audioCtx.resume();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024; /* More bins = finer frequency resolution */
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let speechDetected = false;
      let lastSpeechAt = 0;
      let peakVolume = 0;
      let consecutiveAbove = 0;

      /* Map the speech band to FFT bin indices (500-2500 Hz). */
      const binHz = audioCtx.sampleRate / analyser.fftSize;
      const speechLo = Math.max(1, Math.round(500 / binHz));
      const speechHi = Math.min(data.length - 1, Math.round(2500 / binHz));

      /* Adaptive threshold — measure ambient noise for 40 frames (~0.67s).
         Longer calibration → more stable noise floor estimate.
         Track the MINIMUM so speech during calibration doesn't inflate it. */
      let calibrationFrames = 0;
      let noiseFloor = 255;
      let speechThreshold = micSensitivity; /* fallback until calibrated */

      /* Safety net — if no speech detected in 8s, stop. */
      const safetyTimer = setTimeout(() => {
        if (recorderRef.current?.state === "recording" && !speechDetected) {
          recorderRef.current.stream?.getTracks().forEach((t) => t.stop());
          recorderRef.current = null;
          stopSilenceDetection();
          convoRetriesRef.current += 1;
          if (convoRetriesRef.current >= 3) setConversational(false);
          setPhase("idle");
          inputRef.current?.focus();
        }
      }, 8000);

      const check = () => {
        if (!recorderRef.current || recorderRef.current.state !== "recording") return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = speechLo; i <= speechHi; i++) sum += data[i];
        const volume = sum / (speechHi - speechLo + 1);

        /* Calibration — first 40 frames (~0.67s), learn the noise floor. */
        if (calibrationFrames < 40) {
          calibrationFrames++;
          if (volume < noiseFloor) noiseFloor = volume;
          if (calibrationFrames === 40) {
            /* In silent re-listen mode (after an answer), use a much stricter
               threshold — the mic is open in the background and must only
               trigger on deliberate speech, not fans, TV, or ambient chatter.
               Normal mode is still responsive but above ambient noise. */
            speechThreshold = silent
              ? Math.max(45, noiseFloor * 3.0 + 30)
              : Math.max(30, noiseFloor * 2.0 + 20);
          }
          rafRef.current = requestAnimationFrame(check);
          return;
        }

        /* After speech starts, raise the bar — require volume to be at
           least 40% of the peak.  This prevents background noise (which
           is much quieter than speech) from counting as "still talking". */
        const activeThreshold = speechDetected
          ? Math.max(speechThreshold, peakVolume * 0.4)
          : speechThreshold;

        if (volume > activeThreshold) {
          consecutiveAbove++;
          if (volume > peakVolume) peakVolume = volume;
          /* Require consecutive frames above threshold to confirm speech.
             Silent re-listen needs 8 frames (~130ms) — only real speech
             is that sustained. Normal mode needs 5 (~80ms). */
          if (consecutiveAbove >= (silent ? 8 : 5)) {
            if (!speechDetected) {
              speechDetected = true;
              clearTimeout(safetyTimer);
              setPhase("recording");
            }
            speechFramesRef.current += 1;
            lastSpeechAt = Date.now();
          }
        } else {
          consecutiveAbove = 0;
        }

        /* End condition — timestamp comparison, no timers to clear. */
        if (speechDetected && speechFramesRef.current >= 15 && lastSpeechAt) {
          const elapsed = Date.now() - lastSpeechAt;
          const grace = speechFramesRef.current < 60 ? 3500 : 2500;
          if (elapsed > grace) {
            recorderRef.current.stop();
            recorderRef.current = null;
            setPhase("transcribing");
            return;
          }
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

    /* Step 2: classify the whole message and route — handles mixed
       messages that contain both questions and commands. */
    await routeMessage(transcript);
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

    await routeMessage(q);
  };

  /* ------------------------------------------------------- classification */

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

  /* --------------------------------------------------------- walkthrough detection
     FIRST gate — before any other classification.  If someone wants a
     walkthrough / tutorial / to be pointed at a UI element, it ALWAYS
     goes to the guide system.  Never to the agent, never to the brain.

     Every conceivable way to ask is listed.  Spoken language is messy:
     Whisper might capitalise oddly, add/drop punctuation, merge words,
     or hallucinate filler.  All patterns are case-insensitive and
     tolerant of extra whitespace. */

  const WALKTHROUGH_PATTERNS: RegExp[] = [
    /* ---- "walk me through" family ---- */
    /\bwalk\s+(me\s+)?through\b/i,
    /\bwalk\s+through\s+(how|the|this|that|it|my|your|setting|process|steps)\b/i,

    /* ---- "guide me" family ---- */
    /\bguide\s+(me\s+)?(through|on|to|in|for|with)\b/i,

    /* ---- "take me through" ---- */
    /\btake\s+me\s+through\b/i,

    /* ---- "show me how" family ---- */
    /\bshow\s+me\s+how\s+(to|i|we|you|it|the|this|that)\b/i,
    /\bshow\s+me\s+how\b/i,

    /* ---- "teach me" family ---- */
    /\bteach\s+me\b/i,

    /* ---- "demonstrate" ---- */
    /\bdemonstrate\s+(how\s+to\s+|the\s+|this|that|it)?\b/i,

    /* ---- tutorial / walkthrough / tour / demo as nouns ---- */
    /\b(walkthrough|walk-through|tutorial|guided\s*tour)\s+(of|for|on|about|to)\b/i,
    /\b(give|show|start|begin|do|run|provide|create)\s+(me\s+)?(a\s+)?(walkthrough|walk-through|tutorial|guided\s*tour|demo|demonstration)\b/i,
    /\b(i\s+(want|need|would\s+like)\s+(a\s+)?(walkthrough|walk-through|tutorial|guided\s*tour|demo|demonstration))\b/i,

    /* ---- "step by step" (spoken often as "step-by-step") ---- */
    /\bstep[\s-]*by[\s-]*step\b/i,

    /* ---- pointing / "where is" — Clicky style ---- */
    /\bshow\s+me\s+where\b/i,
    /\bpoint\s+(me\s+)?(to|at|where|toward|towards)\b/i,
    /\bwhere\s+(do|should|can|would|could|shall)\s+i\s+(click|tap|press|find|go|look|navigate|select|start|begin)\b/i,
    /\bwhere\s+(is|are|was)\s+(the\s+)?(\w+\s+){0,5}(button|setting|option|menu|tab|link|icon|toggle|switch|field|input|checkbox|dropdown|slider|control|panel|section|page|area|tool|toolbar|sidebar|dialog|popup|modal|window|pane)\b/i,
    /\bwhich\s+(button|menu|tab|option|setting|icon|link|control)\s+(do|should|to|would|could)\b/i,
    /\b(what|where)\s+(do|should|would|could)\s+i\s+(click|press|tap|select|choose|pick|hit)\b/i,
    /\bhelp\s+me\s+find\s+(the\s+)?(\w+\s+){0,5}(button|setting|option|menu|control|toggle|icon|link|field|tab)\b/i,
    /\bfind\s+(the\s+)?(button|setting|option|menu|control|toggle)\s+(for|to)\b/i,

    /* ---- "help me learn / figure out how to" ---- */
    /\bhelp\s+me\s+(learn|figure\s+out|understand)\s+how\s+to\b/i,

    /* ---- "how do I" + UI action verb (screen-specific how-to) ---- */
    /\bhow\s+(do|can|should|would)\s+i\s+(click|navigate|find|get to|access|open|enable|disable|toggle|turn on|turn off|activate|deactivate|set up|configure|change|modify|adjust|switch)\b/i,

    /* ---- "show me the way" / "lead me" ---- */
    /\bshow\s+me\s+the\s+way\s+to\b/i,
    /\blead\s+me\s+(through|to)\b/i,

    /* ---- "can you show me" + location/process words ---- */
    /\b(show|point\s+out)\s+me\s+(the\s+)?(steps|process|procedure|way|path|workflow|flow)\b/i,

    /* ---- Whisper mishearings — common transcription errors ---- */
    /\bwok\s+me\s+through\b/i,     /* "walk" → "wok" */
    /\bguard\s+me\s+through\b/i,   /* "guide" → "guard" */
    /\bwalked?\s+me\s+through\b/i,  /* past tense still means the same */
  ];

  function isWalkthroughRequest(text: string): boolean {
    return WALKTHROUGH_PATTERNS.some((re) => re.test(text));
  }

  /** Strip the trigger phrase, keep the goal — what the user actually wants. */
  function extractWalkthroughGoal(text: string): string {
    let goal = text
      /* Remove wake words / politeness prefixes */
      .replace(/^(hey\s+(doppel|dopple|double)|ok\s+doppel|doppel|yo\s+doppel)\s*,?\s*/i, "")
      .replace(/^(can you|could you|would you|will you|please|i need you to|i want you to|i'd like you to)\s+/i, "")
      /* Remove the walkthrough trigger itself */
      .replace(/^(walk\s+me\s+through\s+(how\s+to\s+)?)/i, "")
      .replace(/^(guide\s+me\s+(through|on|to|in|for|with)\s+(how\s+to\s+)?)/i, "")
      .replace(/^(take\s+me\s+through\s+(how\s+to\s+)?)/i, "")
      .replace(/^(show\s+me\s+how\s+(to\s+|i\s+(can|should)\s+)?)/i, "")
      .replace(/^(show\s+me\s+where\s+(to\s+|i\s+(can|should)\s+)?)/i, "")
      .replace(/^(teach\s+me\s+(how\s+to\s+|to\s+)?)/i, "")
      .replace(/^(demonstrate\s+(how\s+to\s+)?)/i, "")
      .replace(/^(point\s+me\s+(to|at)\s+)/i, "")
      .replace(/^(help\s+me\s+(learn|figure\s+out|understand|find)\s+(how\s+to\s+)?)/i, "")
      .replace(/^(give\s+me\s+a\s+(walkthrough|tutorial|demo|demonstration)\s+(of|for|on|about)\s+)/i, "")
      .replace(/^(show\s+me\s+(a\s+)?(walkthrough|tutorial|demo)\s+(of|for|on|about)\s+)/i, "")
      .replace(/^(step[\s-]*by[\s-]*step\s+(how\s+to\s+)?)/i, "")
      .replace(/^(where\s+(do|should|can)\s+i\s+(click|find|go|navigate)\s+(to\s+)?)/i, "")
      .replace(/^(where\s+is\s+(the\s+)?)/i, "")
      .replace(/^(how\s+(do|can|should)\s+i\s+)/i, "")
      .replace(/[?.!]+$/, "")
      .trim();
    /* If extraction ate everything, fall back to the raw text. */
    return goal.length >= 3 ? goal : text.trim();
  }

  /** Shared routing logic for both voice and text input. */
  async function routeMessage(text: string) {
    const t = text.trim();
    if (!t) return;

    /* ---- Walkthrough — ABSOLUTE FIRST check, before everything else.
       If this matches, nothing else runs.  No ambiguity, no fallthrough. */
    if (isWalkthroughRequest(t)) {
      const goal = extractWalkthroughGoal(t);
      setPhase("thinking");
      streamRef.current = "";
      thinkingRef.current = "";
      setThinking("Setting up walkthrough...");
      setThinkingExpanded(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await doppel.guideStartWalkthrough(goal) as any;
        if (result?.ok) {
          setAnswer(
            `Got it. I'll walk you through it — ${result.steps ?? "a few"} steps.\n\n` +
            `**Step 1:** ${result.firstStep ?? goal}\n\n` +
            `Look at the pointer on your screen. Say "next" when you're ready for the next step.`,
          );
        } else {
          setAnswer(`I couldn't set up that walkthrough. ${result?.detail ?? "Try again?"}`);
        }
      } catch {
        setAnswer("Something went wrong starting the walkthrough.");
      }
      setPhase("answer");
      return;
    }

    /* ---- Walkthrough navigation — "next" / "back" / "stop" / "do it for me"
       while a walkthrough is already active. */
    if (wtRef.current?.active) {
      const tl = t.toLowerCase();
      if (/\b(next|continue|go on|move on|okay|ok|done|got it|i did it|finished|ready)\b/i.test(tl) && t.length < 40) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await doppel.guideNextStep() as any;
        if (r?.done) {
          setAnswer("Walkthrough complete!");
          setPhase("answer");
        } else if (r?.ok) {
          setAnswer(`**Step ${r.step}:** ${r.instruction}`);
          setPhase("answer");
        }
        return;
      }
      if (/\b(back|previous|go back|prev|undo|before)\b/i.test(tl) && t.length < 30) {
        const r = await doppel.guidePrevStep();
        if (r?.ok) {
          setAnswer(`Back to step ${r.step}.`);
          setPhase("answer");
        }
        return;
      }
      if (/\b(stop|end|cancel|quit|exit|close|enough|never\s*mind|nevermind|i'm done|done)\b/i.test(tl) && t.length < 30) {
        await doppel.guideEndWalkthrough();
        setAnswer("Walkthrough ended.");
        setPhase("answer");
        return;
      }
      if (/\b(do it|do it for me|just do it|do that for me|automate|automatic|you do it)\b/i.test(tl) && t.length < 40) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await doppel.guideDoStep() as any;
        if (r?.ok) {
          setAnswer(`Doing it — ${r.action ?? "performing"} the action.`);
          setPhase("answer");
          /* Auto-advance after doing */
          setTimeout(async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nr = await doppel.guideNextStep() as any;
            if (nr?.done) {
              setAnswer("Walkthrough complete!");
              setPhase("answer");
            } else if (nr?.ok) {
              setAnswer(`**Step ${nr.step}:** ${nr.instruction}`);
              setPhase("answer");
            }
          }, 1500);
        } else {
          setAnswer(`Couldn't do that step automatically.`);
          setPhase("answer");
        }
        return;
      }
      /* Not a nav command — fall through to normal routing (user might ask
         an unrelated question mid-walkthrough). */
    }

    /* ---- Inbox — "send to agent" / "task:" / "tell claude to" ------------ */
    const AGENT_NAMES: Record<string, string> = {
      claude: "claude-desktop", cursor: "cursor", chatgpt: "chatgpt",
      gpt: "chatgpt", windsurf: "windsurf", grok: "grok",
    };
    /* "tell claude to X", "ask cursor to X", "send to chatgpt: X" */
    const targetMatch = t.match(/^(?:tell|ask|send\s+to)\s+(claude|cursor|chatgpt|gpt|windsurf|grok)\s+(?:to\s+)?[:\s]*(.+)/i);
    /* generic: "task: X", "send to agent: X", "queue: X" */
    const genericMatch = !targetMatch && t.match(/^(?:send\s+to\s+agent|task|tell\s+(?:the\s+)?agent\s+to|queue|assign)[:\s]+(.+)/i);

    if (targetMatch || genericMatch) {
      const target = targetMatch ? (AGENT_NAMES[targetMatch[1].toLowerCase()] ?? "any") : "any";
      const instruction = (targetMatch ? targetMatch[2] : (genericMatch as RegExpMatchArray)[1]).trim();
      const label = targetMatch ? targetMatch[1] : "your agent";
      await doppel.inboxCreate(instruction, true, target);
      setAnswer(`Queued for ${label}:\n\n"${instruction}"\n\nIt'll be picked up next time the agent checks in.`);
      setPhase("answer");
      scheduleDismiss();
      return;
    }

    /* Everything goes to the brain — answer from memory, screen, or web. */
    setPhase("thinking");
    if (isScreenQuestion(t)) await doppel.lookNow();
    streamRef.current = "";
    thinkingRef.current = "";
    setThinking("");
    setThinkingExpanded(true);
    const result = await window.doppel?.askBrainFast(t, history);
    const reply = result?.ok && result.text
      ? result.text
      : (result?.detail ?? "I don't have enough context to answer that yet.");
    if (!streamRef.current) {
      setAnswer(reply);
      setPhase("answer");
    }
    setHistory((prev) => [
      ...prev,
      { role: "user", content: t },
      { role: "assistant", content: reply },
    ]);
    scheduleDismiss();

    if (conversational) setTimeout(() => startRecording(true), 1500);
  }

  /* -------------------------------------------------------------- nudges */

  const actNudge = async (n: Nudge) => {
    const result = await doppel.actOnNudge(n.id);
    if (!result?.ok) return;
    if (n.detail) {
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
    thinkingRef.current = "";
    setInput("");
    setAnswer("");
    setThinking("");
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
    phase === "transcribing" || phase === "thinking" || phase === "recording";

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
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={slow}
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
                disabled={phase === "thinking" || phase === "transcribing"}
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
            {busy && (
              <motion.button
                initial={{ opacity: 0, scale: 0.5, width: 0 }}
                animate={{ opacity: 1, scale: 1, width: 38 }}
                exit={{ opacity: 0, scale: 0.5, width: 0 }}
                transition={medium}
                onClick={() => {
                  setConversational(false);
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

        {/* Active inbox tasks */}
        <AnimatePresence>
          {phase === "idle" && inbox.filter((t) => t.status === "claimed" || t.status === "done").slice(0, 2).map((task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={medium}
              className="overflow-hidden"
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-control)",
                background: "rgba(255, 255, 255, 0.5)",
                borderLeft: `3px solid ${task.status === "done" ? "#3a3" : "#e89b00"}`,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: "var(--text-xs, 11px)", color: task.status === "done" ? "#3a3" : "#e89b00", fontWeight: 600 }}>
                    {task.status === "claimed" ? `${task.agent ?? "Agent"} working...` : "Done"}
                  </p>
                  <p style={{ fontSize: "var(--text-sm)", color: "var(--ink)", marginTop: 2 }}>
                    {task.instruction.length > 60 ? task.instruction.slice(0, 60) + "\u2026" : task.instruction}
                  </p>
                  {task.result && (
                    <p style={{ fontSize: "var(--text-xs)", color: "var(--slate)", marginTop: 4, whiteSpace: "pre-wrap" }}>
                      {task.result.length > 200 ? task.result.slice(0, 200) + "\u2026" : task.result}
                    </p>
                  )}
                </div>
                {task.status === "done" && (
                  <button
                    onClick={() => doppel.inboxClear()}
                    className="cursor-pointer shrink-0"
                    style={{ fontSize: "var(--text-xs)", color: "var(--slate)" }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          ))}
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
            <motion.div
              key="thinking"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={fast}
              style={{
                padding: "10px 14px",
                borderRadius: "var(--radius-control)",
                background: "rgba(99, 102, 241, 0.04)",
                borderLeft: "3px solid rgba(99, 102, 241, 0.3)",
              }}
            >
              <div className="flex items-center gap-2" style={{ marginBottom: thinking ? 6 : 0 }}>
                <Dot />
                <span className="micro-label" style={{ color: "var(--primary)", opacity: 0.7 }}>
                  thinking
                </span>
              </div>
              {thinking && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.7 }}
                  transition={fast}
                  style={{
                    fontSize: "var(--text-sm)",
                    color: "var(--slate)",
                    lineHeight: 1.5,
                    maxHeight: 160,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {thinking}
                </motion.p>
              )}
            </motion.div>
          )}

          {phase === "answer" && (
            <motion.div
              key="answer"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={medium}
            >
              {thinking && (
                <div
                  onClick={() => setThinkingExpanded(!thinkingExpanded)}
                  style={{
                    marginBottom: 10,
                    padding: "8px 12px",
                    borderRadius: "var(--radius-control)",
                    background: "rgba(99, 102, 241, 0.04)",
                    borderLeft: "3px solid rgba(99, 102, 241, 0.2)",
                    cursor: "pointer",
                  }}
                >
                  <span
                    className="micro-label"
                    style={{ color: "var(--primary)", opacity: 0.6 }}
                  >
                    {thinkingExpanded ? "\u25BC" : "\u25B6"} thinking
                  </span>
                  <AnimatePresence>
                    {thinkingExpanded && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 0.6, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={fast}
                        style={{
                          fontSize: "var(--text-sm)",
                          color: "var(--slate)",
                          marginTop: 6,
                          lineHeight: 1.5,
                          maxHeight: 140,
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {thinking}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              )}
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
