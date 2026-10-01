import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/besley/wght.css";
import "@fontsource-variable/besley/wght-italic.css";
import "@fontsource-variable/libre-franklin/wght.css";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
