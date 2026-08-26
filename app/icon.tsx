import { MeritOpenGraphMark } from "@merit-systems/brand/opengraph";
import { ImageResponse } from "next/og";

export const size = {
  height: 32,
  width: 32,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: "#f5f3ed",
        borderRadius: "6px",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <MeritOpenGraphMark color="#deddd7" foreground="#292927" size={24} />
    </div>,
    size
  );
}
