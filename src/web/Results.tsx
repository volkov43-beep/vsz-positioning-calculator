import type { AxisRequest } from "../core/axis";
import type { PositionInput } from "../core/contracts";
import {
  directions,
  directionText,
  displayNumber as fmt,
  metrics,
  travelEntry,
  type LocalPosition,
  type Success,
  warning,
} from "./model";

const lines = [
  ["up", "mean", "Среднее ↑", "#00656a", ""],
  ["down", "mean", "Среднее ↓", "#b14f17", "8 4"],
  ["up", "upper", "Верхняя ↑", "#00656a", "4 3"],
  ["up", "lower", "Нижняя ↑", "#00656a", "1 3"],
  ["down", "upper", "Верхняя ↓", "#b14f17", "11 3 2 3"],
  ["down", "lower", "Нижняя ↓", "#b14f17", "6 3 1 3"],
] as const;

function unitFraction(value: number, low: number, high: number) {
  if (low === high) return 0.5;
  // Scaling the drawing must also work when high-low would overflow binary64.
  if (Number.isFinite(high - low)) return (value - low) / (high - low);
  return (value / 2 - low / 2) / (high / 2 - low / 2);
}

export function Plot({
  positions,
  selected,
  select,
}: {
  positions: LocalPosition[];
  selected: string;
  select: (id: string) => void;
}) {
  const rows = [...positions].sort((a, b) => a.targetMm - b.targetMm);
  let min = 0,
    max = 0;
  for (const p of rows)
    for (const [d, k] of lines) {
      min = Math.min(min, p[d][k]);
      max = Math.max(max, p[d][k]);
    }
  if (min === max) {
    min = -1;
    max = 1;
  }
  const coincident = rows.every((p) => lines.every(([d, k]) => p[d][k] === p.up.mean));
  const zeroLine = coincident && rows.every((p) => p.up.mean === 0);
  const x = (p: LocalPosition) =>
    82 + unitFraction(p.targetMm, rows[0].targetMm, rows[rows.length - 1].targetMm) * 550;
  const y = (v: number) => 162 - unitFraction(v, min, max) * 136;
  const ticks = [...new Set([min, 0, max])];
  const selectedRow = rows.find((p) => p.positionId === selected) ?? rows[0];
  const labels = [
    rows[0],
    ...(rows.length > 2 ? [rows[Math.floor(rows.length / 2)]] : []),
    ...(rows.length > 1 ? [rows[rows.length - 1]] : []),
  ];
  return (
    <section className="panel">
      <div className="section-title">
        <h2>График отклонений</h2>
        <span>мкм</span>
      </div>
      <div className="plot-window" tabIndex={0} aria-label="График, область прокрутки">
        <svg
          className="plot"
          viewBox="0 0 700 203"
          role="img"
          aria-label="Средние и границы обоих направлений по координате оси. Числа доступны в подробностях позиции."
        >
          <text x="10" y="15">
            мкм
          </text>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={82} x2={632} y1={y(v)} y2={y(v)} className="gridline" />
              <text x="73" y={y(v) + 4} textAnchor="end">
                {tick(v)}
              </text>
            </g>
          ))}
          <line x1={x(selectedRow)} x2={x(selectedRow)} y1="22" y2="165" className="guide" />
          {lines.map(([d, k, title, color, dash], i) => (
            <g key={title}>
              <polyline
                data-curve={d + "-" + k}
                fill="none"
                stroke={color}
                strokeWidth={i < 2 ? 2.6 : 1.6}
                strokeDasharray={dash}
                points={rows.map((p) => x(p) + "," + y(p[d][k])).join(" ")}
              />
              {k === "mean" &&
                rows.map((p) =>
                  d === "up" ? (
                    <circle
                      key={p.positionId}
                      cx={x(p)}
                      cy={y(p[d][k])}
                      r={3.5}
                      stroke={color}
                      fill="white"
                    />
                  ) : (
                    <rect
                      key={p.positionId}
                      x={x(p) - 2.5}
                      y={y(p[d][k]) - 2.5}
                      width="5"
                      height="5"
                      fill={color}
                    />
                  ),
                )}
            </g>
          ))}
          {labels.map((p) => (
            <text key={p.positionId} x={x(p)} y="186" textAnchor="middle">
              {tick(p.targetMm)}
            </text>
          ))}
          <text x="668" y="186">
            мм
          </text>
        </svg>
      </div>
      {coincident && <p className="plot-note">{zeroLine
        ? "Все шесть рядов совпадают на 0 мкм."
        : "Все шесть рядов совпадают в каждой позиции."}</p>}
      <ul className="legend">
        {lines.map(([d, k, name, color, dash]) => (
          <li key={name}>
            <svg width="32" height="12" aria-hidden="true">
              <line x1="0" x2="32" y1="6" y2="6" stroke={color} strokeWidth="2" strokeDasharray={dash} />
              {k === "mean" &&
                (d === "up" ? (
                  <circle cx="16" cy="6" r="3" fill={color} />
                ) : (
                  <rect x="13" y="3" width="6" height="6" fill={color} />
                ))}
            </svg>
            {name}
          </li>
        ))}
      </ul>
      <label>
        Позиция на графике
        <select value={selectedRow.positionId} onChange={(e) => select(e.target.value)}>
          {rows.map((p) => (
            <option key={p.positionId} value={p.positionId}>
              {p.positionId} · {fmt(p.targetMm)} мм
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
function tick(v: number) {
  return v !== 0 && (Math.abs(v) < 0.001 || Math.abs(v) > 1e5)
    ? v.toExponential(2).replace(".", ",")
    : fmt(Number(v.toPrecision(5)));
}
export function Totals({ result }: { result: Success }) {
  return (
    <section className="panel">
      <div className="section-title">
        <h2>Показатели оси</h2>
        <span>12 характеристик · мкм</span>
      </div>
      {(["B", "A", "E", "R", "M"] as const).map((family) => (
        <div className="metric-grid" data-family={family} key={family}
          role="group" aria-label={"Характеристики " + family}>
          {metrics.filter(([key]) => key.startsWith(family)).map(([key, symbol, name, help]) => (
            <div className="metric" key={key}>
              <div className="metric-head"><b>{symbol}</b><span>{name}</span></div>
              <div className="value">
                <output data-metric={key}>{fmt(result.axis[key])}</output> <small>мкм</small>
              </div>
              <p>{help}</p>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
export function PositionDetails({ p, source }: { p: LocalPosition; source: PositionInput }) {
  const measures = [
    ["mean", "Среднее μ", "мкм"],
    ["sd", "Стандартное отклонение s", "мкм"],
    ["variance", "Дисперсия v", "мкм²"],
    ["lower", "Нижняя граница", "мкм"],
    ["upper", "Верхняя граница", "мкм"],
    ["repeatability", "Повторяемость Rᵢ", "мкм"],
  ] as const;
  return (
    <div className="position-detail">
      <h3>
        {p.positionId} · {fmt(p.targetMm)} мм
      </h3>
      <table className="details">
        <caption className="sr">Направленные характеристики {p.positionId}</caption>
        <thead>
          <tr>
            <th>Характеристика</th>
            {directions.map((d) => (
              <th key={d}>{directionText[d]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {measures.map(([key, name, unit]) => (
            <tr key={key}>
              <th scope="row">
                {name}, {unit}
              </th>
              {directions.map((d) => (
                <td key={d} data-detail={p.positionId + "-" + d + "-" + key}>
                  {fmt(p[d][key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="facts">
        {(
          [
            ["Двустороннее среднее ν", p.meanBoth],
            ["Зона нечувствительности Bᵢ", p.reversal],
            ["Перекрёстный кандидат Cᵢ", p.crossCandidate],
            ["Двусторонняя повторяемость Rᵢ", p.repeatabilityBoth],
          ] as const
        ).map(([label, val]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{fmt(val)} мкм</dd>
          </div>
        ))}
        <div>
          <dt>Определяющие ветви Rᵢ</dt>
          <dd>
            {p.activeCandidates.map((k) => (k === "cross" ? "Cᵢ" : k === "up" ? "Rᵢ↑" : "Rᵢ↓")).join(", ")}
          </dd>
        </div>
      </dl>
      <h4>Исходные наблюдения, мкм</h4>
      <dl className="facts">
        {directions.map((d) => (
          <div key={d}>
            <dt>{directionText[d]} · повторы 1–5</dt>
            <dd>{source.observations[d].map((o) => o.raw).join(" · ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
export function Method({ result }: { result: Success }) {
  return (
    <section className="panel">
      <h2>Метод и ограничения</h2>
      <dl className="facts">
        <div>
          <dt>Метод оценки s</dt>
          <dd>{result.key.sdMethod} · предложен</dd>
        </div>
        <div>
          <dt>Расчётный профиль</dt>
          <dd>
            {result.key.profileId}, версия {result.key.profileVersion}
          </dd>
        </div>
        <div>
          <dt>Численная политика</dt>
          <dd>{result.key.numericalPolicyVersion} · бюджет d→b не утверждён</dd>
        </div>
        <div>
          <dt>Алгоритм</dt>
          <dd>{result.key.algorithmVersion}</dd>
        </div>
        <div>
          <dt>Применимость процедуры</dt>
          <dd>
            {result.applicability.state === "outOfScope" ? "Вне границ профиля" : "Не подтверждена"}
            {result.applicability.issues.includes("TRAVEL_UNCONFIRMED") ? " · полный ход не подтверждён" : ""}
            {result.applicability.issues.includes("PLAN_TOO_SHORT") ? " · менее пяти позиций" : ""}
            {result.applicability.issues.includes("OUTSIDE_TRAVEL_PROFILE")
              ? " · полный ход вне профиля"
              : ""}
          </dd>
        </div>
        <div>
          <dt>Реквизиты отчёта</dt>
          <dd>Неполные · дата измерения, исполнитель, прибор и условия</dd>
        </div>
      </dl>
    </section>
  );
}
export function Report({ result, req, generated }: { result: Success; req: AxisRequest; generated: Date }) {
  return (
    <>
      <section className="panel">
        <h2>Предварительный расчётный отчёт</h2>
        <dl className="facts">
          <div>
            <dt>Испытание</dt>
            <dd>
              {req.origin.kind === "synthetic" ? "T06 · Синтетические данные" : "Ручной ввод"} · {req.trialId}
            </dd>
          </div>
          <div>
            <dt>Ось / полный ход</dt>
            <dd>
              {req.inputs.axis.name} / {travelEntry(req.inputs.axis.fullTravelMm).label}
            </dd>
          </div>
          <div>
            <dt>Дата формирования</dt>
            <dd>{generated.toLocaleString("ru-RU")}</dd>
          </div>
          <div>
            <dt>Редакция / SHA-256</dt>
            <dd>
              {result.key.inputRevision} / {result.key.inputDigest}
            </dd>
          </div>
        </dl>
        <p>{warning}</p>
      </section>
      <Totals result={result} />
      <section className="panel">
        <h2>Измерения и характеристики позиций</h2>
        {result.positions.map((p, i) => (
          <PositionDetails key={p.positionId} p={p} source={result.inputSnapshot.positions[i]} />
        ))}
      </section>
      <Method result={result} />
    </>
  );
}
