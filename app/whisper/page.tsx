"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { doppel, useDoppel } from "@/lib/store";
import { voice } from "@/lib/voice";
import { RichText } from "@/components/RichText";
import type { Bot, InboxTask, MorningBrief, Nudge, Workflow } from "@/lib/types";

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
  const [prevChats, setPrevChats] = useState<{ q: string; a: string; at: number }[]>([]);
  const [allBots, setAllBots] = useState<Bot[]>([]);
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

  /* Load previous chat history on mount */
  useEffect(() => {
    window.doppel?.whisperChatHistory?.().then((chats) => {
      if (chats?.length) {
        setPrevChats(chats);
        /* Seed conversation history so brain has context */
        const seed: { role: string; content: string }[] = [];
        for (const c of chats) {
          seed.push({ role: "user", content: c.q });
          seed.push({ role: "assistant", content: c.a });
        }
        setHistory(seed);
      }
    });
  }, []);

  /* Listen for bot updates — just track running state so we can block duplicate tasks */
  useEffect(() => {
    const api = window.doppel;
    if (!api) return;
    api.computerList?.().then((list: Bot[]) => setAllBots(list));
    const unsub = api.onBotUpdate?.((bot: Bot) => {
      setAllBots((prev) => {
        const idx = prev.findIndex((b) => b.id === bot.id);
        if (idx >= 0) { const next = [...prev]; next[idx] = bot; return next; }
        return [...prev, bot];
      });
    });
    return () => unsub?.();
  }, []);

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
    /* Jev second opinion — catches hallucinations the heuristics miss */
    const jevHallucination = await window.doppel?.isHallucination?.(transcript);
    if (jevHallucination) {
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
      /* "make sense of X on my screen" / "explain the equation" / "help me understand" */
      /\b(make sense|explain|interpret|understand|analyze|analyse)\b.*(on|my|the)\s*(screen|display|monitor|window)\b/i,
      /\b(on|my|the)\s*screen\b.*\b(titled|called|labeled|named)\b/i,
      /\b(equation|formula|diagram|chart|graph|code|error|message)\b.*(on|my|the)\s*screen\b/i,
      /\b(on|my|the)\s*screen\b.*(equation|formula|diagram|chart|graph|code|error|message)\b/i,
      /\bhelp me (understand|make sense|figure out)\b/i,
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

  /* Walkthrough detection is handled by the whisper:ask handler (Jev-powered)
     in the main process. This local check is only needed for the text input
     path where we route before sending to the backend. */
  async function isWalkthroughRequest(text: string): Promise<boolean> {
    /* Quick local regex for obvious cases */
    if (/\b(walk\s+(me\s+)?through|guide\s+me|show\s+me\s+how|tutorial|walkthrough|step[\s-]*by[\s-]*step)\b/i.test(text)) return true;
    /* Jev second opinion for subtler phrasings */
    const result = await window.doppel?.routeVoice?.(text);
    return false; /* walkthrough routing handled by whisper:ask, not voice router */
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

  /* ---- Task detection — uses the LLM to understand natural speech.
     No regex fragility — Gemini classifies intent and extracts the goal. */

  /** Shared routing logic for both voice and text input. */
  async function routeMessage(text: string) {
    const t = text.trim();
    if (!t) return;

    /* ---- Walkthrough — ABSOLUTE FIRST check, before everything else.
       If this matches, nothing else runs.  No ambiguity, no fallthrough. */
    if (await isWalkthroughRequest(t)) {
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

    /* ---- Agent commands — full access to inbox, workflows, and tasks ---- */
    const AGENT_NAMES: Record<string, string> = {
      claude: "claude-desktop", "claude desktop": "claude-desktop",
      cloud: "claude-desktop", "cloud desktop": "claude-desktop",
      "claude code": "cursor", "cloud code": "cursor",
      cursor: "cursor", chatgpt: "chatgpt", gpt: "chatgpt",
      windsurf: "windsurf", grok: "grok", cline: "cline",
      continue: "continue", "amazon q": "amazon-q",
      copilot: "copilot", zed: "zed",
    };
    const AGENT_DISPLAY: Record<string, string> = {
      "claude-desktop": "Claude Desktop", cursor: "Cursor", chatgpt: "ChatGPT",
      windsurf: "Windsurf", grok: "Grok", cline: "Cline",
      continue: "Continue", "amazon-q": "Amazon Q", copilot: "Copilot", zed: "Zed",
    };
    /* Strip leading "doppel/dapo/hey doppel" and speech filler before matching */
    let tl = t.toLowerCase()
      .replace(/^(?:hey\s+)?(?:doppel|dapo|dopple|dapple)[,.\s]*/i, "")
      .replace(/\b(?:uh+|um+|like|so|actually|basically|sorry)\b[,\s]*/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    /* Handle self-corrections: "cloud code, cloud desktop" → use last agent mentioned */
    const correctionMatch = tl.match(/(?:cloud\s*code|claude\s*code)[,\s]+(?:cloud\s*desktop|claude\s*desktop)/);
    if (correctionMatch) tl = tl.replace(correctionMatch[0], "claude desktop");

    /* Resolve an agent name from text, handling multi-word names. */
    function resolveAgent(name: string): { id: string; display: string } | null {
      const n = name.toLowerCase().trim();
      /* Try multi-word first ("claude desktop", "amazon q") then single word */
      if (AGENT_NAMES[n]) return { id: AGENT_NAMES[n], display: AGENT_DISPLAY[AGENT_NAMES[n]] || n };
      /* Try first word */
      const first = n.split(/\s+/)[0];
      if (AGENT_NAMES[first]) return { id: AGENT_NAMES[first], display: AGENT_DISPLAY[AGENT_NAMES[first]] || first };
      return null;
    }

    /* Detect agent task intent broadly — covers many natural phrasings:
       "tell claude to X", "ask cursor to X", "send X to claude",
       "give claude a task: X", "have cursor do X", "get claude to X",
       "send a task to claude desktop: X", "I want claude to X",
       "can you send a task to my claude desktop" */
    const AG = `(claude\\s*desktop|cloud\\s*desktop|claude\\s*code|cloud\\s*code|claude|cloud|cursor|chatgpt|gpt|windsurf|grok|cline|continue|amazon\\s*q|copilot|zed)`;
    const agentTaskResult = (() => {
      /* Strip "can you" / "could you" / "would you" prefix */
      const cl = tl.replace(/^(?:can|could|would)\s+you\s+(?:please\s+)?/, "");
      /* Pattern 1: "tell/ask/have/get [agent] to X" */
      const p1 = cl.match(new RegExp(`(?:tell|ask|have|get|make)\\s+(?:my\\s+)?${AG}\\s+(?:to\\s+)?(.+)`));
      if (p1) return { agent: p1[1], instruction: p1[2] };
      /* Pattern 2: "send [X] to [agent]" or "send a task to [agent]: X" */
      const p2 = cl.match(new RegExp(`send\\s+(?:a\\s+)?(?:task\\s+)?to\\s+(?:my\\s+)?${AG}[:\\s]*(.+)`));
      if (p2) return { agent: p2[1], instruction: p2[2] };
      /* Pattern 2b: "send [agent] a task" / "send [agent] X" */
      const p2b = cl.match(new RegExp(`send\\s+(?:my\\s+)?${AG}\\s+(?:a\\s+)?(?:task[:\\s]+)?(.+)`));
      if (p2b) return { agent: p2b[1], instruction: p2b[2] };
      /* Pattern 3: "give [agent] a task: X" */
      const p3 = cl.match(new RegExp(`give\\s+(?:my\\s+)?${AG}\\s+(?:a\\s+)?(?:task|job|assignment)[:\\s]*(.+)`));
      if (p3) return { agent: p3[1], instruction: p3[2] };
      /* Pattern 4: "I want [agent] to X" / "I need [agent] to X" */
      const p4 = cl.match(new RegExp(`i\\s+(?:want|need)\\s+(?:you\\s+to\\s+)?(?:send\\s+(?:a\\s+)?(?:task\\s+)?to\\s+|tell\\s+|have\\s+|get\\s+)?(?:my\\s+)?${AG}\\s+(?:to\\s+)?(.+)`));
      if (p4) return { agent: p4[1], instruction: p4[2] };
      /* Pattern 5: "[agent], do X" / "[agent]: X" (agent name at start) */
      const p5 = cl.match(new RegExp(`^${AG}[,:\\s]+(.{10,})`));
      if (p5) return { agent: p5[1], instruction: p5[2] };
      /* Pattern 6: "and tell it to X" / "and tell them to X" — catches compound sentences
         where the agent was already mentioned and resolved via correction */
      const p6 = cl.match(/(?:and\s+)?(?:tell|ask|have|get)\s+(?:it|them|that)\s+(?:to\s+)?(.+)/);
      if (p6 && correctionMatch) return { agent: "claude desktop", instruction: p6[1] };
      return null;
    })();

    /* generic: "task: X", "send to agent: X", "queue: X" */
    const genericMatch = !agentTaskResult && t.match(/^(?:send\s+to\s+agent|task|tell\s+(?:the\s+)?agent\s+to|queue|assign)[:\s]+(.+)/i);

    if (agentTaskResult || genericMatch) {
      const resolved = agentTaskResult ? resolveAgent(agentTaskResult.agent) : null;
      const target = resolved?.id ?? "any";
      const label = resolved?.display ?? "your agent";
      const instruction = (agentTaskResult ? agentTaskResult.instruction : (genericMatch as RegExpMatchArray)[1]).trim();
      /* Strip trailing filler like "okay?" "please" "thanks" */
      const clean = instruction.replace(/[,.]?\s*(?:okay|ok|please|thanks|thank you|alright)\s*[?.!]*$/i, "").trim();
      await doppel.inboxCreate(clean, true, target);
      setAnswer(`Queued for ${label}:\n\n"${clean}"\n\nIt'll be picked up next time the agent checks in.`);
      setPhase("answer");
      scheduleDismiss();
      return;
    }

    /* ---- Jev-powered voice command routing --------------------------------
       Fast typed decision replaces fragile regex chains. Falls back to
       "other" if Jev is unavailable, which continues to the brain. */
    const voiceRoute = await window.doppel?.routeVoice?.(t) ?? "other";

    /* ---- Show tasks / inbox ----------------------------------------------- */
    if (voiceRoute === "show_tasks") {
      setPhase("thinking");
      const [tasks, workflows] = await Promise.all([doppel.inboxList(), doppel.workflowList()]);
      const active = tasks.filter((t: InboxTask) => t.status !== "done" && t.status !== "rejected");
      const done = tasks.filter((t: InboxTask) => t.status === "done");
      const running = workflows.filter((w: Workflow) => w.status === "running");

      let reply = "";
      if (active.length === 0 && running.length === 0 && done.length === 0) {
        reply = "Nothing in the queue. All agents are idle.";
      } else {
        if (running.length > 0) {
          reply += `**Workflows running:** ${running.length}\n`;
          running.forEach((w: Workflow) => {
            reply += `- "${w.title}" — step ${w.currentStep + 1}/${w.steps.length} (${w.steps[w.currentStep]?.status ?? "?"})\n`;
          });
          reply += "\n";
        }
        if (active.length > 0) {
          reply += `**Active tasks:** ${active.length}\n`;
          active.forEach((t: InboxTask) => {
            const who = t.agent || AGENT_DISPLAY[t.target] || t.target;
            reply += `- [${t.status}] ${who}: "${t.instruction.slice(0, 80)}"\n`;
          });
          reply += "\n";
        }
        if (done.length > 0) {
          reply += `**Completed:** ${done.length} task${done.length > 1 ? "s" : ""}\n`;
          done.slice(0, 3).forEach((t: InboxTask) => {
            const who = t.agent || AGENT_DISPLAY[t.target] || t.target;
            reply += `- ${who}: "${t.instruction.slice(0, 60)}" — ${t.result ? t.result.slice(0, 100) : "done"}\n`;
          });
          if (done.length > 3) reply += `- …and ${done.length - 3} more\n`;
        }
      }
      setAnswer(reply.trim());
      setPhase("answer");
      return;
    }

    /* ---- Approve task ------------------------------------------------------ */
    if (voiceRoute === "approve_tasks") {
      setPhase("thinking");
      const tasks = await doppel.inboxList();
      const pending = tasks.filter((t: InboxTask) => t.status === "pending");
      if (pending.length === 0) {
        setAnswer("No pending tasks to approve.");
      } else {
        await Promise.all(pending.map((t: InboxTask) => doppel.inboxApprove(t.id)));
        setAnswer(`Approved ${pending.length} task${pending.length > 1 ? "s" : ""}. Agents can pick them up now.`);
      }
      setPhase("answer");
      return;
    }

    /* ---- Reject / cancel task ---------------------------------------------- */
    if (voiceRoute === "reject_tasks") {
      setPhase("thinking");
      const tasks = await doppel.inboxList();
      const cancellable = tasks.filter((t: InboxTask) => ["pending", "approved", "claimed"].includes(t.status));
      if (cancellable.length === 0) {
        setAnswer("No active tasks to cancel.");
      } else {
        await Promise.all(cancellable.map((t: InboxTask) => doppel.inboxReject(t.id)));
        setAnswer(`Cancelled ${cancellable.length} task${cancellable.length > 1 ? "s" : ""}.`);
      }
      setPhase("answer");
      return;
    }

    /* ---- Retry failed tasks ------------------------------------------------ */
    if (voiceRoute === "retry_tasks") {
      setPhase("thinking");
      const tasks = await doppel.inboxList();
      const failed = tasks.filter((t: InboxTask) => t.status === "rejected" || t.status === "failed");
      if (failed.length === 0) {
        setAnswer("No failed tasks to retry.");
      } else {
        await Promise.all(failed.map((t: InboxTask) => doppel.inboxRetry(t.id)));
        setAnswer(`Retrying ${failed.length} task${failed.length > 1 ? "s" : ""}.`);
      }
      setPhase("answer");
      return;
    }

    /* ---- Clear completed tasks --------------------------------------------- */
    if (voiceRoute === "clear_tasks") {
      await doppel.inboxClear();
      setAnswer("Cleared completed tasks from the inbox.");
      setPhase("answer");
      return;
    }

    /* ---- Show workflows ---------------------------------------------------- */
    if (voiceRoute === "show_workflows") {
      setPhase("thinking");
      const workflows = await doppel.workflowList();
      if (workflows.length === 0) {
        setAnswer("No workflows. You can create one — tell me the steps and which agents should run them.");
      } else {
        let reply = `**${workflows.length} workflow${workflows.length > 1 ? "s" : ""}:**\n\n`;
        workflows.forEach((w: Workflow) => {
          const statusIcon = w.status === "running" ? "▶" : w.status === "done" ? "✓" : w.status === "failed" ? "✗" : "⏸";
          reply += `${statusIcon} **${w.title}** — ${w.status}\n`;
          w.steps.forEach((s, i) => {
            const current = i === w.currentStep && w.status === "running" ? " ← current" : "";
            const stepAgent = AGENT_DISPLAY[s.target] || s.target;
            reply += `   ${i + 1}. [${s.status}] ${stepAgent}: ${s.instruction.slice(0, 70)}${current}\n`;
          });
          reply += "\n";
        });
        setAnswer(reply.trim());
      }
      setPhase("answer");
      return;
    }

    /* ---- Abort workflow ---------------------------------------------------- */
    if (voiceRoute === "abort_workflow") {
      setPhase("thinking");
      const workflows = await doppel.workflowList();
      const running = workflows.filter((w: Workflow) => w.status === "running");
      if (running.length === 0) {
        setAnswer("No running workflows to abort.");
      } else {
        await Promise.all(running.map((w: Workflow) => doppel.workflowAbort(w.id)));
        setAnswer(`Aborted ${running.length} workflow${running.length > 1 ? "s" : ""}.`);
      }
      setPhase("answer");
      return;
    }

    /* ---- Create workflow (natural language) -------------------------------- */
    if (voiceRoute === "create_workflow") {
      setPhase("thinking");
      setThinking("Planning workflow...");

      /* Use the LLM to parse natural language into structured workflow steps. */
      const parseResult = await window.doppel?.askBrainFast(
        `The user wants to create a multi-agent workflow. Parse their request into a workflow title and ordered steps. Each step needs an instruction (what to do) and a target agent (one of: claude-desktop, cursor, chatgpt, windsurf, grok, cline, continue, amazon-q, copilot, zed, or "any" if unspecified).

User's request: "${t}"

Reply with ONLY valid JSON in this exact format, nothing else:
{"title": "short title", "steps": [{"instruction": "what to do", "target": "agent-id"}], "onFailure": "abort"}`,
        [],
      );

      if (parseResult?.ok && parseResult.text) {
        try {
          /* Strip markdown code fences if present */
          const cleaned = parseResult.text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.steps?.length > 0) {
            const wf = await doppel.workflowCreate(
              parsed.title || "Untitled workflow",
              parsed.steps,
              parsed.onFailure || "abort",
            );
            let reply = `**Workflow created:** ${parsed.title}\n\n`;
            parsed.steps.forEach((s: { instruction: string; target: string }, i: number) => {
              const agent = AGENT_DISPLAY[s.target] || s.target;
              reply += `${i + 1}. **${agent}:** ${s.instruction}\n`;
            });
            reply += `\nOn failure: ${parsed.onFailure || "abort"}. Step 1 is now queued.`;
            setAnswer(reply);
          } else {
            setAnswer("I couldn't parse that into workflow steps. Try something like:\n\n\"Create a workflow: step 1 cursor writes tests, step 2 claude reviews them\"");
          }
        } catch {
          setAnswer("I couldn't parse that into a workflow. Try being more explicit about the steps and which agents should run them.");
        }
      } else {
        setAnswer("Couldn't plan the workflow. Try again with clearer steps.");
      }
      setPhase("answer");
      return;
    }

    /* ---- Screen-context questions bypass classification entirely ----------
       "What's on my screen", "explain this equation", etc. are questions
       that need screen capture + brain, NOT bot tasks. */
    if (isScreenQuestion(t)) {
      setPhase("thinking");
      await doppel.lookNow();
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
      scheduleDismiss();
      return;
    }

    /* ---- Computer use — LLM classifies intent, no rigid regex ----------- */
    const classification = await window.doppel?.classifyIntent?.(t);
    if (classification?.intent === "task" && classification.goal) {
      /* Block if a bot is already running — only the Agents page can manage active bots */
      const currentBots: Bot[] = await doppel.computerList?.() ?? [];
      const hasActive = currentBots.some((b) => b.status === "running" || b.status === "clarifying");
      if (hasActive) {
        setAnswer("A bot is already running. You can manage it from the Agents page.");
        setPhase("answer");
        return;
      }
      setPhase("thinking");
      setThinking("Starting bot...");
      /* Include recent conversation so the bot has full context
         (e.g. a dictated schedule, file names mentioned, etc.) */
      let goalWithContext = classification.goal;
      if (history.length > 0) {
        const recentLines = history.slice(-10).map((m) =>
          `${m.role === "user" ? "User" : "Doppel"}: ${m.content}`
        ).join("\n");
        goalWithContext = `${classification.goal}\n\n--- Recent conversation for context ---\n${recentLines}`;
      }
      const result = await doppel.computerCreate(goalWithContext);
      if (result?.ok) {
        setAnswer(`On it. Running in the background:\n\n"${classification.goal}"\n\nYou can see progress in the overlay.`);
      } else {
        setAnswer(`Couldn't start the bot: ${result?.error ?? "unknown error"}`);
      }
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
    /* Persist this exchange so the next session has context */
    window.doppel?.whisperSaveChat?.(t, reply);
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

        {/* Previous conversations — shown when idle so the user sees continuity */}
        <AnimatePresence>
          {phase === "idle" && prevChats.length > 0 && (
            <motion.div
              key="prev-chats"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -6, height: 0 }}
              transition={medium}
              className="overflow-hidden"
              style={{
                borderRadius: "var(--radius-control)",
                background: "rgba(255, 255, 255, 0.35)",
                padding: "8px 12px",
              }}
            >
              <p className="micro-label" style={{ marginBottom: 6, color: "var(--slate)" }}>
                Recent
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {prevChats.slice(-3).map((chat, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    <p style={{ color: "var(--ink)", fontWeight: 500 }}>
                      {chat.q.length > 60 ? chat.q.slice(0, 57) + "..." : chat.q}
                    </p>
                    <p style={{ color: "var(--slate)", marginTop: 1 }}>
                      {chat.a.length > 80 ? chat.a.slice(0, 77) + "..." : chat.a}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Morning brief card */}
        <AnimatePresence>
          {phase === "idle" && brief && (
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
