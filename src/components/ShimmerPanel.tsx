/* eslint-disable */
export default function ShimmerPanel({
  variant = "light", // "light" | "dark"
  className = "",
}: { variant?: "light" | "dark"; className?: string }) {
  const base = "relative w-full h-64 overflow-hidden";
  const lightBg = "bg-gradient-to-br from-gray-100 via-white to-gray-300";
  const darkBg  = "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900";
  return (
    <div className={`${base} ${variant === "dark" ? darkBg : lightBg} ${className}`}>
      {/* shimmer sweep */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/60 to-transparent opacity-60 animate-pulse" />

      {/* floating bubbles */}
      <div className="absolute top-4 left-4 w-8 h-8 bg-white rounded-full opacity-80 animate-bounce" />
      <div className="absolute top-12 right-8 w-4 h-4 bg-gray-200 rounded-full opacity-90 animate-ping" />
      <div className="absolute bottom-8 left-12 w-6 h-6 bg-white rounded-full opacity-75 animate-pulse" />
      <div className="absolute bottom-16 right-4 w-3 h-3 bg-gray-100 rounded-full opacity-85 animate-bounce" />

      {/* center spinner */}
      <div className="absolute top-1/2 left-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin" />
    </div>
  );
}
