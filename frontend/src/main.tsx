import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { RuntimeProvider } from "./runtime/RuntimeProvider";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RuntimeProvider>
      <App />
    </RuntimeProvider>
  </React.StrictMode>,
);
