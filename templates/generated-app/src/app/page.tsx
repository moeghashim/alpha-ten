import type { CSSProperties } from "react";

const pageStyles: CSSProperties = {
  alignItems: "center",
  display: "flex",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  justifyContent: "center",
  minHeight: "100vh",
  margin: 0
};

export default function Home() {
  return <main style={pageStyles}>This app hasn't been generated yet.</main>;
}
