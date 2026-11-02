import { ImageResponse } from "next/og";

export const alt = "UploadReady — make every file fit the upload rules";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0f1f4b", padding: 72, color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#ffffff" />
            <path d="M8 12V8h4M20 8h4v4M24 20v4h-4M12 24H8v-4" fill="none" stroke="#0f1f4b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11.5 16.4l3.1 3.1 6-6.6" fill="none" stroke="#2346e8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontSize: 40, fontWeight: 700 }}>UploadReady</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, color: "#7fd3a6", fontSize: 26, marginBottom: 18 }}>
            <div style={{ width: 2, height: 26, background: "#7fd3a6" }} />
            <div style={{ flex: 1, height: 2, background: "#7fd3a6" }} />
            <span>Fits</span>
            <div style={{ flex: 1, height: 2, background: "#7fd3a6" }} />
            <div style={{ width: 2, height: 26, background: "#7fd3a6" }} />
          </div>
          <span style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>Make every file fit the upload rules.</span>
        </div>
        <span style={{ fontSize: 28, color: "#c9d3ee" }}>Photos and documents for job, university, housing and visa applications.</span>
      </div>
    ),
    size,
  );
}
