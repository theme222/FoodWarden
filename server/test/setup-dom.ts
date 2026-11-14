import { Window } from "happy-dom";
const dom = new Window({ url: "http://localhost" });
const globals = globalThis as unknown as Record<string, unknown>;
const source = dom as unknown as Record<string, unknown>;
for (const name of [
  "window",
  "document",
  "navigator",
  "location",
  "HTMLElement",
  "Element",
  "Node",
  "HTMLButtonElement",
  "HTMLInputElement",
  "DocumentFragment",
  "MutationObserver",
  "ResizeObserver",
  "Event",
  "EventTarget",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = name === "window" ? dom : source[name];
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value:
      typeof value === "function" &&
      [
        "getComputedStyle",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ].includes(name)
        ? value.bind(dom)
        : value,
  });
}
globals.IS_REACT_ACT_ENVIRONMENT = true;
