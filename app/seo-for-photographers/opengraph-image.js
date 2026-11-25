import { ImageResponse } from "next/og";

export const alt = "SimplSEO — SEO for wedding and portrait photographers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: "68px 78px", background: "#202925", color: "#f1f6f3" }}>
      <div style={{ display: "flex", fontSize: 26, color: "#8cd5aa", marginBottom: 58 }}>SimplSEO</div>
      <div style={{ display: "flex", fontSize: 34, marginBottom: 14 }}>SEO software for</div>
      <div style={{ display: "flex", fontSize: 68, lineHeight: 1.12, letterSpacing: -3 }}>Wedding &amp; portrait</div>
      <div style={{ display: "flex", fontSize: 68, lineHeight: 1.12, letterSpacing: -3, color: "#8cd5aa" }}>photographers.</div>
      <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", fontSize: 22, color: "#b2beb6" }}><span>Your website. A clearer next step.</span><span>simpl-seo.com</span></div>
    </div>,
    size,
  );
}
