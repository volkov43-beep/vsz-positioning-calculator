import { useMemo, useRef, type ComponentProps, type KeyboardEvent } from "react";
import type { AxisInputs } from "../core/axis";
import type { Address, Direction } from "../core/diagnostics";
import type { PositionInput } from "../core/contracts";
import { diagnosticAddress, directionText, directions, fieldId, travelEntry } from "./model";

type CellProps = Omit<ComponentProps<"input">, "value" | "onChange" | "onFocus"> & {
  value: string;
  onValueChange: (raw: string) => void;
};

function MeasurementCell({ value, onValueChange, onKeyDown, ...props }: CellProps) {
  const before = useRef(value);
  return (
    <input
      aria-required="true"
      {...props}
      value={value}
      onFocus={() => { before.current = value; }}
      onChange={(e) => onValueChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          if (before.current !== value) onValueChange(before.current);
        } else {
          if (e.key === "Enter") before.current = value;
          onKeyDown?.(e);
        }
      }}
    />
  );
}

interface Props {
  inputs: AxisInputs;
  mobile: boolean;
  selected: string;
  select: (id: string) => void;
  change: (inputs: AxisInputs) => void;
  add: () => void;
  remove: () => void;
  error?: Address;
  errorMessage?: string;
  calculationIssue: boolean;
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
  error,
  errorMessage,
  calculationIssue,
  check,
  run,
  stale,
  busy,
}: Props) {
  const rows = inputs.positions;
  const travel = useMemo(() => travelEntry(inputs.axis.fullTravelMm), [inputs.axis.fullTravelMm]);
  const p = rows.find((row) => row.positionId === selected) ?? rows[0];
  function edit(id: string, transform: (old: PositionInput) => PositionInput) {
    change({ ...inputs, positions: rows.map((row) => (row.positionId === id ? transform(row) : row)) });
  }
  function coordinate(row: PositionInput) {
    const flagged = error?.positionId === row.positionId && error.field === "targetMm";
    return (
      <MeasurementCell
        id={fieldId(row.positionId, "targetMm")}
        aria-label={row.positionId + " координата, мм"}
        value={row.targetMm}
        aria-invalid={flagged && !calculationIssue}
        data-diagnostic={(flagged && calculationIssue) || undefined}
        aria-describedby={flagged ? "issue-message" : undefined}
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
    const invalid = error?.positionId === row.positionId && error.direction === d && error.repeat === repeat;
    return (
      <MeasurementCell
        aria-label={row.positionId + " " + d + " повтор " + repeat + ", мкм"}
        id={fieldId(row.positionId, "raw", d, repeat)}
        aria-invalid={invalid && !calculationIssue}
        data-diagnostic={(invalid && calculationIssue) || undefined}
        data-review-series={reviewSeries || undefined}
        aria-describedby={reviewSeries ? "series-note" : invalid ? "issue-message" : undefined}
        type="text"
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
              aria-required="true"
              aria-invalid={error?.field === "axis"}
              aria-describedby={error?.field === "axis" ? "issue-message" : undefined}
              value={inputs.axis.name}
              onChange={(e) => change({ ...inputs, axis: { ...inputs.axis, name: e.target.value } })}
            />
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
          <span>
            {rows.reduce(
              (n, r) =>
                n + directions.reduce((a, d) => a + r.observations[d].filter((o) => o.raw?.trim()).length, 0),
              0,
            )}{" "}
            из {10 * rows.length} введено
          </span>
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
              {rows.map((r) => (
                <option key={r.positionId}>{r.positionId}</option>
              ))}
            </select>
          </label>
          <button onClick={add}>Добавить позицию</button>
          <button disabled={!p} onClick={remove}>
            Удалить {p?.positionId ?? "позицию"}
          </button>
        </div>
        {error?.direction && error.repeat === undefined && (
          <p id="series-note" className="field-note"><span aria-hidden="true">⚠ </span>Проверьте пять исходных наблюдений серии {diagnosticAddress(error)}.</p>
        )}
        {mobile ? (
          p && (
            <div className="mobile-pos" key={p.positionId}>
              {error?.positionId === p.positionId && (
                <p className="error">
                  <span aria-hidden="true">⚠ </span>{diagnosticAddress(error)}{" "}
                  · {errorMessage}
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
                    <th scope="row"><span className="position-id">{row.positionId}</span></th>
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
          <button onClick={check}>Проверить</button>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? "Выполняется расчёт…" : stale ? "Пересчитать" : "Рассчитать"}
          </button>
        </div>
      </section>
    </>
  );
}
