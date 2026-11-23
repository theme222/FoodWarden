import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import "./style.css";
import "./dashboard-theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("Dashboard root is missing");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
