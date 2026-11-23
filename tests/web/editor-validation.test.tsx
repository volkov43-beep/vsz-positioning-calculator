// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor } from "../../src/web/Editor";
import { draft } from "../../src/web/model";

let root: Root;
let host: HTMLDivElement;
const run = vi.fn(), check = vi.fn(), blocked = vi.fn(), focusInput = vi.fn();
function Trial() {
  const [inputs, change] = useState(() => draft(true).inputs);
  const [selected, select] = useState("p03");
  return <Editor inputs={inputs} change={change} selected={selected} select={select}
    mobile add={vi.fn()} remove={vi.fn()} focusInput={focusInput} run={run} check={check}
    blocked={blocked} stale={false} busy={false} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Trial />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function write(input: HTMLInputElement, text: string, inputType = "insertText") {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: text }));
  });
}
function pressButton(name: string) {
  const btn = Array.from(host.querySelectorAll("button")).find(b => b.textContent === name)!;
  act(() => { btn.focus(); btn.click(); });
}
it("keeps pasted decimals verbatim through blur and restores every digit on Escape", () => {
  const input = host.querySelector<HTMLInputElement>("#p03-raw-up-5")!;
  const long = "-0,0012345678901234567890000000";
  write(input, long, "insertFromPaste");
  act(() => input.blur());
  expect(input.value).toBe(long);
  write(input, "1e-");
  expect(host.textContent).toContain("В процессе ввода: 1");
  expect(input.getAttribute("aria-invalid")).toBe("false");
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(input.value).toBe(long);
  expect(host.textContent).toContain("Корректно: 50 из 50");
});
it("collects all issues on check and guards calculation until corrections are complete", () => {
  const input = host.querySelector<HTMLInputElement>("#p03-raw-up-5")!;
  const coord = host.querySelector<HTMLInputElement>("#p03-targetMm")!;
  write(coord, "");
  write(input, "12abc", "insertFromPaste");
  pressButton("Проверить");
  expect(check).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Замечания (2)");
  expect(coord.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  pressButton("Рассчитать");
  expect(run).not.toHaveBeenCalled();
  expect(blocked).toHaveBeenCalledTimes(2);
  expect(focusInput).toHaveBeenCalledWith({ field: "raw", positionId: "p03", direction: "up", repeat: 5 });
  write(coord, "500");
  write(input, "0,");
  pressButton("Рассчитать");
  expect(run).toHaveBeenCalledOnce();
  expect(input.value).toBe("0,");
});
