import { OpenGraphMark } from "./_components/og-mark";
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
      <OpenGraphMark color="#deddd7" foreground="#292927" size={24} />
    </div>,
    size
  );
}
