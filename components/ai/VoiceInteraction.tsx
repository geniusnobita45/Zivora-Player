"use client";
import { useEffect, useRef, useState } from "react";
export interface VoiceInteractionProps {
  enabled: boolean;
  onTranscript: (value: string) => void;
  answer?: string | null;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
export function VoiceInteraction({ enabled, onTranscript, answer }: VoiceInteractionProps) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognition.current?.stop(), []);
  if (!enabled || typeof window === "undefined") return null;
  const toggle = () => {
    const Constructor =
      (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).SpeechRecognition ??
      (window as Window & { webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .webkitSpeechRecognition;
    if (!Constructor) return;
    if (listening) {
      recognition.current?.stop();
      setListening(false);
      return;
    }
    const value = new Constructor();
    value.lang = "en-US";
    value.continuous = false;
    value.interimResults = false;
    value.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript) onTranscript(transcript);
      setListening(false);
    };
    value.onerror = () => setListening(false);
    recognition.current = value;
    value.start();
    setListening(true);
  };
  const speak = () => {
    if (answer && "speechSynthesis" in window)
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
  };
  return (
    <div className="flex gap-2">
      <button type="button" onClick={toggle} className="zivora-ai-chip" aria-pressed={listening}>
        {listening ? "Stop listening" : "Voice question"}
      </button>
      <button type="button" onClick={speak} className="zivora-ai-chip" disabled={!answer}>
        Read answer
      </button>
    </div>
  );
}
