import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "SimplSEO — SEO, in plain English.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Next.js renders and caches this image at build time, with no external fetches.
export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), "public/light.png"));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
          color: "#16332b",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            width: "100%",
            height: 12,
            background: "#00bf63",
          }}
        />
        {/* ImageResponse rasterizes this logo; next/image is for browser pages. */}
        <img
          src={`data:image/png;base64,${logo.toString("base64")}`}
          width={1080}
          height={235}
          alt=""
        />
        <div style={{ display: "flex", fontSize: 42, marginTop: 24 }}>
          SEO, in plain English.
        </div>
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 42,
            fontSize: 28,
            color: "#527268",
          }}
        >
          simpl-seo.com
        </div>
      </div>
    ),
    size,
  );
}
