import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import QuickStart from "./QuickStart.jsx";
import "./styles.css";

function BenchEmbed() {
  const [initialDesign, setInitialDesign] = useState(null);
  const parentOrigin = window.location.origin;
  useEffect(() => {
    const receive = event => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type === "assured:qc:design" && (event.data.design === null || typeof event.data.design?.text === "string")) setInitialDesign(event.data.design);
    };
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "assured:qc:ready" }, parentOrigin);
    return () => window.removeEventListener("message", receive);
  }, [parentOrigin]);
  const onResults = useCallback(payload => {
    window.parent.postMessage({ type: "assured:qc:results", ...payload }, parentOrigin);
  }, [parentOrigin]);
  return (
    <div className="page embedded">
      <QuickStart initialDesign={initialDesign} onResults={onResults} />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<BenchEmbed />);
