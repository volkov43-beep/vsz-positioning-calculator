import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  calculateAxis,
  checkAxisInputs,
  isCurrentAxisResult,
  type AxisInputs,
  type AxisRequest,
} from "../core/axis";
import type { Address, CoreIssue } from "../core/diagnostics";
import { Editor } from "./Editor";
import { Plot, PositionDetails, Report, Totals, Method } from "./Results";
import { diagnosticAddress, diagnosticTarget, draft, editorPosition, sampleData, warning, type Success } from "./model";
import "./style.css";

type Page = "Начало" | "Испытание" | "Результаты" | "Отчёт";
type Issue = ReturnType<CoreIssue["diagnostic"]>;
const pages: Page[] = ["Начало", "Испытание", "Результаты", "Отчёт"];

function Mark() {
  return (
    <svg className="mark" viewBox="0 0 52 40" aria-hidden="true">
      <path d="M2 32 14 8h8L10 32zm14 0L28 8h8L24 32zm14 0L42 8h8L38 32z" fill="currentColor" />
    </svg>
  );
}
function Home({ start }: { start: (synthetic: boolean) => void }) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">ГОСТ 27843–2006</p>
          <h1>Калькулятор точности позиционирования</h1>
          <p className="lead">
            Расчёт точности и повторяемости позиционирования одной линейной оси станка с ЧПУ.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => start(true)}>
              Загрузить пример T06
            </button>
            <button onClick={() => start(false)}>Новый расчёт</button>
          </div>
        </div>
        <div className="plan-graphic">
          <div className="diagram-title">
            <b>План позиций</b>
            <span>T06 / ось X</span>
          </div>
          <svg
            viewBox="0 0 440 175"
            role="img"
            aria-label="Пять заданных позиций от 0 до 1000 мм. По пять подходов в двух направлениях."
          >
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="#38515c" strokeWidth=".7" />
              </pattern>
            </defs>
            <rect width="440" height="175" fill="url(#grid)" />
            <g fill="none" stroke="#8ad2d0" strokeWidth="2">
              <path d="M36 52H305m-8-5 8 5-8 5" />
            </g>
            <text x="320" y="56" fill="#a6e1e0">
              ↑ up
            </text>
            <path d="M36 88H404" stroke="#fff" />
            {sampleData.positions.map((p, i) => (
              <g key={p.id}>
                <path d={`M${36 + 92 * i} 78v20`} stroke="white" />
                <circle cx={36 + 92 * i} cy="88" r="4" fill="#fcc080" />
                <text x={36 + 92 * i} y="115" fill="#fff" textAnchor="middle">
                  {p.targetMm}
                </text>
              </g>
            ))}
            <g fill="none" stroke="#ffc080" strokeWidth="2">
              <path d="M404 143H137m8-5-8 5 8 5" />
            </g>
            <text x="50" y="148" fill="#ffc080">
              ↓ down
            </text>
          </svg>
          <div className="diagram-footer">
            <span>Заданная координата</span>
            <b>мм</b>
          </div>
        </div>
      </section>
      <section className="profile-strip" aria-label="Границы расчёта">
        {[
          ["Объект", "1 линейная ось"],
          ["Полный ход", "до 2 000 мм"],
          ["Измерения", "5 повторов × 2"],
          ["Результат", "12 характеристик"],
        ].map(([term, value]) => (
          <div key={term}>
            <span>{term}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>
      <section className="home-note">
        <h2>Синтетический пример T06</h2>
        <p>
          В примере пять позиций и 50 измерений. Рассчитайте ось, затем измените в p03 пятый повтор ↑ с 20 на 0 и
          сравните B и B̄ после пересчёта.
        </p>
      </section>
    </>
  );
}
function App() {
  const [page, setPage] = useState<Page>("Начало");
  const [req, setReq] = useState<AxisRequest | null>(null),
    active = useRef<AxisRequest | null>(null);
  const [selected, select] = useState("p01"),
    nextId = useRef(6);
  const [current, setCurrent] = useState<Success | null>(null),
    [when, setWhen] = useState(new Date());
  const [stale, setStale] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [inputState, setInputState] = useState("Ожидает проверки"),
    [issue, setIssue] = useState<Issue | null>(null),
    [problem, setProblem] = useState("");
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 62em)").matches);
  const [confirm, setConfirm] = useState<"sample" | "new" | "remove" | null>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const mq = matchMedia("(max-width: 62em)");
    const handler = () => setMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [confirm]);
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  function go(to: Page) {
    setPage(to);
    window.scrollTo(0, 0);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }
  function install(r: AxisRequest) {
    active.current = r;
    setReq(r);
  }
  function load(synthetic: boolean) {
    try {
      const r = draft(synthetic);
      install(r);
      select(r.inputs.positions[0].positionId);
      nextId.current = 6;
      setDirty(false);
      setStale(false);
      setCurrent(null);
      setIssue(null);
      setBusy(false);
      setProblem("");
      setInputState("Ожидает проверки");
      go("Испытание");
    } catch {
      setProblem("Не удалось открыть испытание. Проверьте доступность Web Crypto в этом браузере.");
    }
  }
  function start(synthetic: boolean) {
    if (dirty) setConfirm(synthetic ? "sample" : "new");
    else load(synthetic);
  }
  function edit(inputs: AxisInputs) {
    const prev = active.current;
    if (!prev) return;
    install({ ...prev, inputs, inputRevision: prev.inputRevision + 1, runId: "draft" });
    setDirty(true);
    setBusy(false);
    setStale(stale || !!current || busy);
    setCurrent(null);
    setIssue(null);
    setProblem("");
    setInputState("Ожидает проверки");
  }
  function add() {
    if (!req) return;
    const id = "p" + String(nextId.current++).padStart(2, "0");
    edit({ ...req.inputs, positions: [...req.inputs.positions, editorPosition(id)] });
    select(id);
  }
  function remove() {
    if (!req) return;
    const rows = req.inputs.positions.filter((p) => p.positionId !== selected);
    edit({ ...req.inputs, positions: rows });
    select(rows[0]?.positionId ?? "");
  }
  function check() {
    if (!req) return;
    const v = checkAxisInputs(req.inputs);
    setProblem("");
    setIssue(v.valid ? null : v.issue.diagnostic("check-" + req.inputRevision));
    setInputState(
      v.valid ? "Проверены" : v.issue.stage === "parse" ? "Ошибка ввода" : "Проверка остановлена",
    );
  }
  async function run() {
    if (!active.current) return;
    const submitted = { ...active.current, runId: crypto.randomUUID() };
    install(submitted);
    setBusy(true);
    setIssue(null);
    setProblem("");
    setCurrent(null);
    try {
      const r = await calculateAxis(submitted);
      if (active.current !== submitted) return;
      if (r.state === "research-computed") {
        const fresh = await isCurrentAxisResult(r, submitted);
        if (active.current !== submitted) return;
        if (!fresh) {
          setStale(true);
          return;
        }
        setInputState("Проверены");
        setStale(false);
        setCurrent(r);
        setWhen(new Date());
        go("Результаты");
      } else {
        setIssue(r.errors[0]);
        setInputState(
          r.inputStatus === "valid"
            ? "Проверены"
            : r.state === "notStarted"
              ? "Ошибка ввода"
              : "Проверка остановлена",
        );
      }
    } catch {
      if (active.current === submitted)
        setProblem(
          "Расчёт прерван. Ввод сохранён в открытой вкладке. Повторите попытку в защищённом контексте браузера.",
        );
    } finally {
      if (active.current === submitted) setBusy(false);
    }
  }
  function focusInput(f: Address) {
    if (f.positionId) select(f.positionId);
    setPage("Испытание");
    requestAnimationFrame(() => {
      document.getElementById(diagnosticTarget(f))?.focus();
    });
  }
  const selectedInput = req?.inputs.positions.find((row) => row.positionId === selected);
  const chosen = current?.positions.find((p) => p.positionId === selected) ?? current?.positions[0];
  const src = current?.inputSnapshot.positions.find((p) => p.positionId === chosen?.positionId);
  return (
    <>
      <a className="skip" href="#main">
        К содержанию
      </a>
      <header>
        <div className="bar">
          <div className="brand">
            <Mark />
            <b>ВСЗ</b>
            <span>Вятский станкостроительный завод</span>
          </div>
          <span className="mode">Демонстрационный режим</span>
        </div>
      </header>
      <nav aria-label="Разделы калькулятора">
        <div>
          {pages.map((p) => (
            <button
              key={p}
              aria-current={page === p ? "page" : undefined}
              disabled={p !== "Начало" && !req}
              onClick={() => go(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </nav>
      <main id="main">
        <div className="notice">
          <strong aria-hidden="true">i</strong>
          <span>{warning}</span>
        </div>
        {page === "Начало" ? (
          <Home start={start} />
        ) : (
          req && (
            <>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">
                    {req.origin.kind === "synthetic" ? "T06 · Синтетические данные" : "Ручной ввод"}
                  </p>
                  <h1 ref={heading} tabIndex={-1}>
                    {page === "Испытание"
                      ? "Испытание оси"
                      : page === "Результаты"
                        ? "Результаты расчёта"
                        : "Расчётный отчёт"}
                  </h1>
                </div>
                <span className="revision">Редакция {req.inputRevision}</span>
              </div>
              {stale && !current && (
                <p className="stale" role="status">
                  Данные изменены — требуется пересчёт
                </p>
              )}
              {page === "Испытание" && (
                <>
                  <Editor
                    key={req.trialId}
                    inputs={req.inputs}
                    mobile={mobile}
                    selected={selected}
                    select={select}
                    change={edit}
                    add={add}
                    remove={() => setConfirm("remove")}
                    issue={issue}
                    focusInput={focusInput}
                    blocked={() => {
                      setInputState("Требуются исправления");
                      setProblem("");
                    }}
                    check={check}
                    run={run}
                    stale={stale}
                    busy={busy}
                  />
                  <section className="panel">
                    <h2>Проверка испытания</h2>
                    {issue && (
                      <div className="error" id="issue">
                        <strong id="issue-message" role="alert"><span aria-hidden="true">⚠ </span>{issue.message}</strong>
                        <p className="issue-address">{diagnosticAddress(issue.field)}</p>
                        <button onClick={() => focusInput(issue.field)}>
                          {issue.field.direction && !issue.field.repeat ? "К серии измерений" : "К полю ввода"}
                        </button>
                        <p>{issue.action}</p>
                        <details>
                          <summary>Технические сведения</summary>
                          <code>{issue.code}{issue.reason === issue.code ? "" : " · " + issue.reason}</code>
                          <p>{issue.field.field}</p>
                        </details>
                      </div>
                    )}
                    <dl className="facts" aria-live={issue ? "off" : "polite"}>
                      <div>
                        <dt>Исходные числа</dt>
                        <dd>{inputState}</dd>
                      </div>
                      <div>
                        <dt>Вычисление</dt>
                        <dd>
                          {busy
                            ? "Выполняется"
                            : current
                              ? "Выполнено"
                              : issue?.runId.startsWith("check-")
                                ? "Ожидает запуска"
                                : issue && issue.category === "arithmetic"
                                  ? "Отказ"
                                  : issue || inputState === "Требуются исправления"
                                    ? "Заблокировано"
                                    : "Ожидает запуска"}
                        </dd>
                      </div>
                      <div>
                        <dt>Применимость процедуры</dt>
                        <dd>
                          {current?.applicability.state === "outOfScope" ? "Вне профиля" : "Не подтверждена"}
                        </dd>
                      </div>
                      <div>
                        <dt>Оформление отчёта</dt>
                        <dd>Реквизиты неполные</dd>
                      </div>
                      <div>
                        <dt>Численная политика</dt>
                        <dd>vsz-num-0.2 · бюджет преобразования входов не утверждён</dd>
                      </div>
                    </dl>
                  </section>
                </>
              )}
              {page !== "Испытание" && !current && (
                <section className="panel">
                  <h2>Нет актуального результата</h2>
                  <p>Откройте измерения и запустите расчёт текущей редакции.</p>
                  <button onClick={() => go("Испытание")}>К измерениям</button>
                </section>
              )}
              {page === "Результаты" && current && chosen && src && (
                <>
                  <div className="actions result-actions">
                    <span>
                      Ось {req.inputs.axis.name} · {current.positionCount} позиций ·{" "}
                      {current.observationCount} наблюдений
                    </span>
                    {req.origin.kind === "synthetic" && req.inputs.positions.some((p) => p.positionId === "p03") ? (
                      <button onClick={() => focusInput({ positionId: "p03", direction: "up", repeat: 5, field: "raw" })}>
                        Изменить p03 ↑ №5
                      </button>
                    ) : (
                      <button onClick={() => go("Испытание")}>Изменить измерения</button>
                    )}
                  </div>
                  <Totals result={current} />
                  <Plot positions={current.positions} selected={selected} select={select} />
                  <section className="panel">
                    <h2>Подробности позиции</h2>
                    <PositionDetails p={chosen} source={src} />
                  </section>
                  <Method result={current} />
                </>
              )}
              {page === "Отчёт" && current && <Report req={req} result={current} generated={when} />}
            </>
          )
        )}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
      </main>
      <footer>
        <b>ВСЗ</b>
        <span>Измерения обрабатываются в этой вкладке</span>
      </footer>
      <dialog ref={dialog} aria-labelledby="dialog-title" aria-describedby="dialog-message" onCancel={() => setConfirm(null)}>
        <h2 id="dialog-title">{confirm === "remove" ? "Удалить позицию " + selected + "?" : "Заменить текущее испытание?"}</h2>
        <p id="dialog-message">
          {confirm === "remove"
            ? (selectedInput?.targetMm.trim() ? "Координата " + selectedInput.targetMm + " мм. " : "Координата не указана. ") +
              "Все десять полей измерений этой позиции будут удалены из рабочей копии."
            : "Введённые изменения будут потеряны."}
        </p>
        <div className="actions">
          <button autoFocus onClick={() => setConfirm(null)}>
            Отмена
          </button>
          <button
            className="primary"
            onClick={() => {
              const action = confirm;
              setConfirm(null);
              if (action === "remove") remove();
              else load(action === "sample");
            }}
          >
            Подтвердить
          </button>
        </div>
      </dialog>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
