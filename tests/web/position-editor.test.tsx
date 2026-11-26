// @vitest-environment jsdom
import { act } from "react";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";

beforeAll(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("scrollTo", () => {});
  // jsdom has no native modal implementation; real focus and modal behaviour are checked in Chrome.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import("../../src/web/main"); });
});

function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(b => b.textContent === label);
  if (!button) throw Error("Missing button " + label);
  act(() => { button.focus(); button.click(); });
}
function field(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw Error("Missing input " + id);
  return element;
}
function write(input: HTMLInputElement, raw: string) {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, raw);
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
}
function key(input: HTMLInputElement, value: string) {
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })); });
}
function revision() { return document.querySelector(".revision")!.textContent; }

beforeEach(() => {
  click("Начало"); click("Новый расчёт");
  if (document.querySelector("dialog[open]")) click("Подтвердить");
});

it("accepts direct target edits and confirms deletion of an empty position by ID", () => {
  click("Добавить позицию");
  const target = field("p06-targetMm");
  write(target, "250"); write(target, "300");
  act(() => target.blur());
  expect(target.value).toBe("300");
  click("Удалить p06");
  expect(document.querySelector("dialog[open]")?.textContent).toContain("Удалить позицию p06?");
  click("Отмена"); expect(target.isConnected).toBe(true);
  click("Удалить p06"); click("Подтвердить");
  expect(target.isConnected).toBe(false);
  expect(field("p03-targetMm").isConnected).toBe(true);
});

it.each(["-0,00100", "abc", "1e-", "0"])("rejects a move and removal through the live editor with source %j", raw => {
  const target = field("p03-targetMm"), observed = field("p03-raw-down-4");
  write(target,"250"); write(observed,raw);
  const saved = revision();
  write(target,"3e"); expect(target.value).toBe("3e"); expect(revision()).toBe(saved);
  write(target,"300"); key(target,"Enter");
  expect(target.value).toBe("250"); expect(observed.value).toBe(raw); expect(revision()).toBe(saved);
  expect(document.getElementById("position-block-message")?.textContent).toContain("Исходная координата сохранена");
  click("Удалить p03");
  expect(document.querySelector("dialog[open]")).toBeNull();
  expect(document.getElementById("position-block-message")?.textContent).toContain("Удаление заблокировано");
  expect(target.isConnected).toBe(true); expect(revision()).toBe(saved);
  click("К планировщику позиций"); expect(document.activeElement?.id).toBe("plan-propose");
});

it("commits equivalent spelling once on blur and discards an unfinished target on Escape", () => {
  const target = field("p03-targetMm"), observed = field("p03-raw-up-5");
  write(target,"40.0"); write(observed,"-0,00100");
  expect(revision()).toBe("Редакция 3");
  write(target,"4e"); key(target,"Escape");
  expect(target.value).toBe("40.0"); expect(revision()).toBe("Редакция 3");
  write(target,"40.00"); act(() => target.blur());
  expect(revision()).toBe("Редакция 4"); expect(target.value).toBe("40.00");
  expect(observed.value).toBe("-0,00100");
  act(() => { target.focus(); target.blur(); });
  expect(revision()).toBe("Редакция 4");
});

it("keeps all ten original records on a failed direct move of a T06 position", () => {
  click("Начало"); click("Загрузить пример T06");
  const records = [...document.querySelectorAll<HTMLInputElement>('[id^="p03-raw-"]')];
  const before = records.map(input => input.value);
  const target = field("p03-targetMm");
  write(target,"300"); act(() => target.blur());
  expect(target.value).toBe("500"); expect(revision()).toBe("Редакция 1");
  expect(before).toHaveLength(10); expect(records.map(input => input.value)).toEqual(before);
});

it("rechecks the named row at confirmation if its source data has changed", () => {
  const target = field("p03-targetMm"), entered = field("p03-raw-up-1");
  write(target, "250"); click("Удалить p03");
  expect(document.querySelector("dialog[open]")).toBeTruthy();
  // Exercise a stale confirmation independently of the browser's modal focus lock.
  write(entered, "0");
  const before = revision();
  click("Подтвердить");
  expect(target.isConnected).toBe(true);
  expect(entered.value).toBe("0");
  expect(revision()).toBe(before);
  expect(document.getElementById("position-block-message")?.textContent).toContain("Удаление заблокировано");
});

it("keeps ordinary format validation and address navigation on unmeasured coordinates", () => {
  const target = field("p02-targetMm");
  write(target, "abc"); click("Проверить");
  expect(target.getAttribute("aria-invalid")).toBe("true");
  write(target, "-2,500e2"); act(() => target.blur());
  expect(target.value).toBe("-2,500e2");
  expect(target.getAttribute("aria-invalid")).toBe("false");
});
