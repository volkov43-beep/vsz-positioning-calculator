import type { KeyboardEvent } from "react";
import type { AxisInputs } from "../core/axis";
import type { Address, Direction } from "../core/diagnostics";
import type { PositionInput } from "../core/contracts";
import { directionText, directions, fieldId } from "./model";

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
  check,
  run,
  stale,
  busy,
}: Props) {
  const rows = inputs.positions;
  const p = rows.find((row) => row.positionId === selected) ?? rows[0];
  function edit(id: string, transform: (old: PositionInput) => PositionInput) {
    change({ ...inputs, positions: rows.map((row) => (row.positionId === id ? transform(row) : row)) });
  }
  function coordinate(row: PositionInput) {
    return (
      <input
        id={fieldId(row.positionId, "targetMm")}
        aria-label={row.positionId + " координата, мм"}
        value={row.targetMm}
        aria-invalid={error?.positionId === row.positionId && error.field === "targetMm"}
        placeholder="мм"
        onChange={(e) => edit(row.positionId, (old) => ({ ...old, targetMm: e.target.value }))}
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
    const invalid = error?.positionId === row.positionId && error.direction === d && error.repeat === repeat;
    return (
      <input
        aria-label={row.positionId + " " + d + " повтор " + repeat + ", мкм"}
        id={fieldId(row.positionId, "raw", d, repeat)}
        aria-invalid={invalid}
        aria-describedby={invalid ? "issue" : undefined}
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={obs.raw ?? ""}
        placeholder="—"
        onKeyDown={(e) => move(e, row, d, repeat)}
        onChange={(e) =>
          edit(row.positionId, (old) => ({
            ...old,
            observations: {
              ...old.observations,
              [d]: old.observations[d].map((o) => (o.repeat === repeat ? { ...o, raw: e.target.value } : o)),
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
            Ось
            <input
              id="axis"
              value={inputs.axis.name}
              onChange={(e) => change({ ...inputs, axis: { ...inputs.axis, name: e.target.value } })}
            />
          </label>
          <label>
            Полный ход, мм
            <input
              id="fullTravelMm"
              value={inputs.axis.fullTravelMm ?? ""}
              onChange={(e) => change({ ...inputs, axis: { ...inputs.axis, fullTravelMm: e.target.value } })}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <div className="section-title">
          <h2>Измеренные отклонения</h2>
          <span>
            {rows.reduce(
              (n, r) =>
                n + directions.reduce((a, d) => a + r.observations[d].filter((o) => o.raw?.trim()).length, 0),
              0,
            )}{" "}
            из {10 * rows.length} введено
          </span>
        </div>
        <p className="muted">Координата в мм, отклонения со знаком в мкм. Пустая ячейка означает пропуск.</p>
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
            Удалить выбранную
          </button>
        </div>
        {mobile ? (
          p && (
            <div className="mobile-pos">
              {error?.positionId === p.positionId && (
                <p className="error">
                  {[p.positionId, error.direction, error.repeat && "повтор " + error.repeat]
                    .filter(Boolean)
                    .join(" / ")}{" "}
                  · {errorMessage}
                </p>
              )}
              <label>
                Координата {p.positionId}, мм{coordinate(p)}
              </label>
              {directions.map((d) => (
                <fieldset key={d}>
                  <legend>{directionText[d]} · отклонения, мкм</legend>
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
                  <th rowSpan={2}>Позиция, мм</th>
                  {directions.map((d) => (
                    <th key={d} scope="colgroup" colSpan={5}>
                      {directionText[d]} · мкм
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
                  <tr key={row.positionId}>
                    <th scope="row">{row.positionId}</th>
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
          Tab и Enter переходят между полями. Alt + ↑ / ↓ меняет позицию в том же столбце.
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
