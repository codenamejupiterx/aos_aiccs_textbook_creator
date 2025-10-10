"use client";
import { useRef, useState, useEffect } from "react";

export default function VideoPlayer({
  src,
  poster,
  className = "",
}: { src: string; poster?: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  };

  return (
    <div className={`relative aspect-[16/9] w-full overflow-hidden rounded-md border-2 border-green-200 bg-black ${className}`}>
      <video
        ref={ref}
        className="absolute inset-0 h-full w-full"
        controls
        playsInline
        preload="metadata"
        poster={poster}
      >
        <source src={src} type="video/mp4" />
        Your browser does not support the video tag.
      </video>

      {!playing && (
        <button
          onClick={toggle}
          aria-label="Play video"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-white/90 text-black grid place-items-center shadow-lg hover:bg-white"
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
  );
}
