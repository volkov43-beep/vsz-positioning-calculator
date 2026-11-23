import { useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import type { AxisInputs } from "../core/axis";
import type { Address, Direction } from "../core/diagnostics";
import type { PositionInput } from "../core/contracts";
import { diagnosticAddress, directionText, directions, fieldId, travelEntry } from "./model";

import { inspectInputs, type Diagnostic, type Field } from "./inputValidation";

type CellProps = Omit<ComponentProps<"input">, "value" | "onChange" | "onFocus"> & {
  status: Field;
  reveal: boolean;
  setEditing: (id?: string) => void;
  value: string;
  onValueChange: (raw: string) => void;
};

function MeasurementCell({ status, reveal, setEditing, value, onValueChange, onKeyDown, ...props }: CellProps) {
  const before = useRef(value);
  const { id, state, message } = status;
  const rejected = state === "numeric-rejected";
  const invalid = state === "invalid-format" || (state === "empty" && reveal);
  const note = invalid || rejected || state === "editing";
  const describedBy = [note && id + "-note", props["aria-describedby"]].filter(Boolean).join(" ");
  return (
    <span className="measurement-cell" data-state={state}>
      <input
        {...props}
        id={id}
        type="text"
        aria-required="true"
        aria-invalid={invalid || rejected}
        data-diagnostic={rejected || undefined}
        aria-describedby={describedBy || undefined}
        value={value}
        onFocus={() => { before.current = value; }}
        onBlur={() => setEditing(undefined)}
        onChange={(event) => {
          setEditing(id);
          onValueChange(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(undefined);
            if (before.current !== value) onValueChange(before.current);
          } else {
            if (event.key === "Enter") {
              setEditing(undefined);
              before.current = value;
            }
            onKeyDown?.(event);
          }
        }}
      />
      {note && <small id={id + "-note"} className="cell-note">
        {state !== "editing" && <span aria-hidden="true">⚠ </span>}
        {state === "invalid-format" && <span className="short-format">Формат числа</span>}
        <span className="full-reason">{message}</span>
      </small>}
    </span>
  );
}

const coordinateLabel = { empty: "нет", editing: "ввод", "valid-numeric": "есть", "invalid-format": "ошибка", "numeric-rejected": "отказ" };

interface Props {
  inputs: AxisInputs;
  mobile: boolean;
  selected: string;
  select: (id: string) => void;
  change: (inputs: AxisInputs) => void;
  add: () => void;
  remove: () => void;
  issue?: Diagnostic | null;
  focusInput: (address: Address) => void;
  blocked: () => void;
  check: () => void;
  run: () => void;
  stale: boolean;
  busy: boolean;
}
export function Editor({
  inputs,
  mobile,
  selected,
  select,
  change,
  add,
  remove,
  issue,
  focusInput,
  blocked,
  check,
  run,
  stale,
  busy,
}: Props) {
  const rows = inputs.positions;
  const [editing, setEditing] = useState<string>();
  const [decimalKeys, setDecimalKeys] = useState(true);
  const [reviewed, setReviewed] = useState(false);
  const lastProblem = useRef("");
  const review = useMemo(() => inspectInputs(inputs, editing, issue), [inputs, editing, issue]);
  const { fields, problems, counts } = review;
  const error = issue?.field;

  function visit(field: Field) {
    lastProblem.current = field.id;
    setReviewed(true);
    focusInput(field.address);
  }
  function nextProblem() {
    const index = problems.findIndex((item) => item.id === lastProblem.current);
    visit(problems[(index + 1) % problems.length]);
  }
  function submit(action: () => void) {
    setEditing(undefined);
    setReviewed(true);
    // Commit a trailing separator or an unfinished exponent before checking readiness.
    const settled = editing ? inspectInputs(inputs, undefined, issue) : review;
    if (settled.problems.some((f) => f.state === "empty" || f.state === "invalid-format")) {
      blocked();
      visit(settled.problems[0]);
    } else {
      action();
    }
  }
  const travel = useMemo(() => travelEntry(inputs.axis.fullTravelMm), [inputs.axis.fullTravelMm]);
  const p = rows.find((row) => row.positionId === selected) ?? rows[0];
  function edit(id: string, transform: (old: PositionInput) => PositionInput) {
    change({ ...inputs, positions: rows.map((row) => (row.positionId === id ? transform(row) : row)) });
  }
  function coordinate(row: PositionInput) {
    const id = fieldId(row.positionId, "targetMm");
    return (
      <MeasurementCell
        inputMode={mobile && decimalKeys ? "decimal" : "text"}
        status={fields.get(id)!}
        reveal={reviewed}
        setEditing={setEditing}
        aria-label={row.positionId + " координата, мм"}
        value={row.targetMm}
        placeholder="мм"
        onValueChange={(targetMm) => edit(row.positionId, (old) => ({ ...old, targetMm }))}
      />
    );
  }
  function move(e: KeyboardEvent<HTMLInputElement>, row: PositionInput, d: Direction, repeat: number) {
    const i = rows.findIndex((r) => r.positionId === row.positionId);
    let dest = i,
      col = (d === "up" ? 0 : 5) + repeat - 1;
    if (e.key === "Enter") col += e.shiftKey ? -1 : 1;
    else if (e.altKey && e.key === "ArrowDown") dest++;
    else if (e.altKey && e.key === "ArrowUp") dest--;
    else return;
    if (col === 10) {
      dest++;
      col = 0;
    }
    if (col < 0) {
      dest--;
      col = 9;
    }
    if (!rows[dest]) return;
    e.preventDefault();
    select(rows[dest].positionId);
    const id = fieldId(rows[dest].positionId, "raw", col < 5 ? "up" : "down", (col % 5) + 1);
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }
  function cell(row: PositionInput, d: Direction, repeat: number) {
    const obs = row.observations[d].find((o) => o.repeat === repeat)!;
    const reviewSeries = error?.positionId === row.positionId && error.direction === d && error.repeat === undefined;
    const id = fieldId(row.positionId, "raw", d, repeat);
    return (
      <MeasurementCell
        aria-label={row.positionId + " " + d + " повтор " + repeat + ", мкм"}
        inputMode={mobile && decimalKeys ? "decimal" : "text"}
        status={fields.get(id)!}
        reveal={reviewed}
        setEditing={setEditing}
        data-review-series={reviewSeries || undefined}
        aria-describedby={reviewSeries ? "series-note" : undefined}
        autoComplete="off"
        spellCheck={false}
        value={obs.raw ?? ""}
        placeholder="—"
        onKeyDown={(e) => move(e, row, d, repeat)}
        onValueChange={(raw) =>
          edit(row.positionId, (old) => ({
            ...old,
            observations: {
              ...old.observations,
              [d]: old.observations[d].map((o) => (o.repeat === repeat ? { ...o, raw } : o)),
            },
          }))
        }
      />
    );
  }
  return (
    <>
      <section className="panel params">
        <div className="section-title">
          <h2>Параметры оси</h2>
          <span>Линейная ось</span>
        </div>
        <div className="form-row">
          <label>
            <span>Ось <b className="required-mark" aria-hidden="true">*</b></span>
            <input
              id="axis"
              aria-label="Ось"
              aria-required="true"
              aria-invalid={reviewed && fields.has("axis")}
              aria-describedby={reviewed && fields.has("axis") ? "axis-note" : undefined}
              value={inputs.axis.name}
              onChange={(e) => change({ ...inputs, axis: { ...inputs.axis, name: e.target.value } })}
            />
            {reviewed && fields.has("axis") && <small id="axis-note">⚠ Укажите обозначение оси.</small>}
          </label>
          <div className="travel-field">
            <label>
              Полный ход, мм
              <input
                id="fullTravelMm"
                aria-invalid={travel.label === "не подтверждён"}
                aria-describedby={travel.hint ? "travel-purpose travel-hint" : "travel-purpose"}
                value={inputs.axis.fullTravelMm ?? ""}
                onChange={(e) => change({ ...inputs, axis: { ...inputs.axis, fullTravelMm: e.target.value } })}
              />
            </label>
            <small id="travel-purpose">Для проверки применимости методики</small>
          </div>
        </div>
        {travel.hint && (
          <p className="hint" id="travel-hint">
            {travel.label === "не подтверждён" && <><span aria-hidden="true">⚠ </span>{travel.hint} </>}
            Предварительный расчёт доступен при полном наборе наблюдений.
          </p>
        )}
      </section>
      <section className="panel">
        <div className="section-title">
          <h2 id="positions" tabIndex={-1}>Измеренные отклонения</h2>
        </div>
        <div className="entry-counts">
          <strong>Корректно: {counts.valid} из {10 * rows.length} · Ошибки: {counts.format} · Пустые: {counts.empty}</strong>
          {counts.editing > 0 && <span>В процессе ввода: {counts.editing}</span>}
          {counts.rejected > 0 && <span>Численный отказ: {counts.rejected}</span>}
          <span>Координаты: {review.coordinates} из {rows.length} корректных</span>
        </div>
        <p className="entry-guide">Укажите координату каждой позиции в мм и по пять измеренных отклонений для каждого направления в мкм.
          Допускаются положительные и отрицательные значения, запятая или точка. Ноль является измерением, пустая ячейка — пропуском.</p>
        <p className="hint">Допустима научная запись, например <code>1e-12</code> (10<sup>−12</sup>).</p>
        <ul className="field-key" aria-label="Обозначения полей">
          <li><b className="key-required" aria-hidden="true">*</b> Обязательно для расчёта</li>
          <li><b className="key-service" aria-hidden="true">ID</b> Служебные данные</li>
          <li><b className="key-error" aria-hidden="true">!</b> Ошибка ввода</li>
        </ul>
        <div className="tools">
          <label>
            Позиция
            <select value={p?.positionId ?? ""} onChange={(e) => select(e.target.value)}>
              {rows.map((r) => {
                const stats = review.positions.get(r.positionId)!;
                return <option key={r.positionId} value={r.positionId}>
                  {r.positionId} · {stats.valid}/10 · координата: {coordinateLabel[stats.coordinate]}
                  {stats.errors > 0 && " · ошибок: " + stats.errors}
                  {error?.positionId === r.positionId && !error.repeat && error.direction && " · проверить серию"}
                </option>;
              })}
            </select>
          </label>
          {mobile && <label>Клавиатура
            <select value={decimalKeys ? "decimal" : "text"} onChange={(e) => setDecimalKeys(e.target.value === "decimal")}>
              <option value="decimal">Цифровая</option>
              <option value="text">Полная (± и экспонента)</option>
            </select>
          </label>}
          <button onClick={add}>Добавить позицию</button>
          <button disabled={!p} onClick={remove}>
            Удалить {p?.positionId ?? "позицию"}
          </button>
        </div>
        {problems.length > 0 && <div className="validation-tools">
          <button onClick={nextProblem}>К следующему незаполненному или ошибочному полю</button>
          {reviewed && <details>
            <summary>Замечания ({problems.length})</summary>
            <ul>{problems.map((item) => <li key={item.id}>
              <button onClick={() => visit(item)}>{diagnosticAddress(item.address)} — {item.message}</button>
            </li>)}</ul>
          </details>}
        </div>}
        {error?.direction && error.repeat === undefined && (
          <p id="series-note" className="field-note"><span aria-hidden="true">⚠ </span>Проверьте пять исходных наблюдений серии {diagnosticAddress(error)}.</p>
        )}
        {mobile ? (
          p && (
            <div className="mobile-pos" key={p.positionId}>
              {error?.positionId === p.positionId && (
                <p className="error">
                  <span aria-hidden="true">⚠ </span>{diagnosticAddress(error)}{" "}
                  · {issue?.message}
                </p>
              )}
              <label>
                <span><span className="position-id">{p.positionId}</span> Координата, мм <b className="required-mark" aria-hidden="true">*</b></span>
                {coordinate(p)}
              </label>
              {directions.map((d) => (
                <fieldset key={d}>
                  <legend>{directionText[d]} · отклонения, мкм <b className="required-mark" aria-hidden="true">*</b></legend>
                  {p.observations[d].map((o) => (
                    <label key={o.repeat}>
                      Повтор {o.repeat}
                      {cell(p, d, o.repeat)}
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )
        ) : (
          <div className="table-wrap">
            <table className="matrix">
              <caption className="sr">Измерения оси, отклонения в мкм</caption>
              <thead>
                <tr>
                  <th rowSpan={2}>ID</th>
                  <th rowSpan={2}>Координата, мм <b className="required-mark" aria-hidden="true">*</b></th>
                  {directions.map((d) => (
                    <th key={d} scope="colgroup" colSpan={5}>
                      {directionText[d]} · мкм <b className="required-mark" aria-hidden="true">*</b>
                    </th>
                  ))}
                </tr>
                <tr>
                  {directions.flatMap((d) =>
                    [1, 2, 3, 4, 5].map((n) => (
                      <th key={d + n} scope="col">
                        {n}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.positionId} data-selected={row.positionId === selected}
                    onFocusCapture={() => select(row.positionId)}>
                    <th scope="row">
                      <span className="position-id">{row.positionId}</span>
                      <small className="row-count" aria-label="Корректные измерения">{review.positions.get(row.positionId)!.valid}/10</small>
                    </th>
                    <td>{coordinate(row)}</td>
                    {directions.flatMap((d) =>
                      row.observations[d].map((o) => <td key={d + o.repeat}>{cell(row, d, o.repeat)}</td>),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">
          Tab и Enter переходят между полями. Escape отменяет правку ячейки. Alt + ↑ / ↓ меняет позицию в том же столбце.
        </p>
        <div className="actions">
          <button onClick={() => submit(check)}>Проверить</button>
          <button className="primary" onClick={() => submit(run)} disabled={busy}>
            {busy ? "Выполняется расчёт…" : stale ? "Пересчитать" : "Рассчитать"}
          </button>
        </div>
      </section>
    </>
  );
}
