import { useState } from "react";
import SplashScreen from "./components/SplashScreen";

export default function App() {
  const [splashDone, setSplashDone] = useState(false);

  if (!splashDone) {
    return <SplashScreen onComplete={() => setSplashDone(true)} />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(245,196,0,0.7)",
        fontFamily: "'Inter', sans-serif",
        fontSize: "14px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      Welcome
    </div>
  );
}
