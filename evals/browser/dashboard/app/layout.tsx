import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  description: "Live local browser benchmark comparisons",
  title: "Browser A/B",
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
