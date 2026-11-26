import { type ActiveTrial, type PlanRow, type Proposal, previewChanges } from "../planning";
import { addressLink, focusPlanField } from "./PlanSettings";
import { protectionMessage, teachingAxisMismatch } from "./planModel";

export function PlanFindings({ plan }: { plan: Proposal }) {
  const ids = plan.positions.map(p => p.positionId);
  const issues = [...plan.findings, ...plan.rules.filter(r => r.state === "violated" && r.code !== "GRID")];
  if (!issues.length) return null;
  return <ul className="plan-issues">{issues.map((f,i) => {
    const links = new Map(f.addresses.map(a => addressLink(a, ids)).filter(Boolean).map(([id,name]) => [id,name]));
    return <li key={i}>{f.message} {[...links].map(([id,name]) =>
      <button key={id} className="plan-link" onClick={() => focusPlanField(id)}>{name}</button>)}</li>;
  })}</ul>;
}
export function PlanPreview({ plan, rows, active, teaching, edits, stale, pending, edit, undo, check, apply, cancel }: {
  plan: Proposal; teaching: boolean; rows: PlanRow[]; active: ActiveTrial; edits: boolean; stale: boolean; pending: boolean;
  edit: (i: number, raw: string) => void; undo: (i: number) => void; check: () => void; apply: () => void; cancel: () => void;
}) {
  const differences = previewChanges(active,plan);
  const endangered = differences.positions.filter(d => d.requiresPreservation);
  const hasRows = rows.length > 0;
  const checked = !edits && !stale;
  const spacing = plan.rules.find(rule => rule.code === "SPACING");
  const incompatibleAxis = teachingAxisMismatch(active.inputs.axis, plan, teaching);
  const kinds = { added:"Добавится", removed:"Удалится", moved:"Цель изменится", reformatted:"Изменится запись", reordered:"Изменится порядок", kept:"Сохранится", "frame-changed":"Смена системы отсчёта" };
  const remarks = new Map<number,string[]>();
  for (const finding of plan.findings) for (const address of finding.addresses) {
    const m = /^positions\[(\d+)\]/.exec(address);
    if (m) { const i = Number(m[1]); remarks.set(i,[...(remarks.get(i) ?? []),finding.message]); }
  }
  return <section className="plan-preview" aria-labelledby="plan-preview-title">
    <h3 id="plan-preview-title" tabIndex={-1}>{hasRows ? "Предпросмотр координат" : "Проверка параметров"}</h3>
    {stale ? <p className="stale" role="status">Предпросмотр устарел: изменились входные данные. Предложите координаты заново.</p>
      : edits ? <p className="stale" role="status">Есть непроверенные правки. Проверьте координаты и интервалы перед применением.</p>
      : <>{plan.state === "needs-input" && <p>Для подготовки плана нужны дополнительные сведения.</p>}
        {plan.state === "refused" && <p className="stale">Предложение недоступно для применения. Проверьте ограничения ниже.</p>}
        {plan.profile.state === "outside" && <p>Алгоритм поддерживает одну линейную ось с ходом до 2000 мм включительно. Для длинной оси требуется другая процедура.</p>}
        <PlanFindings plan={plan}/></>}
    {hasRows && <>
      <p className="plan-summary"><b>{plan.count} поз.</b> · Участок {plan.sectionLengthMm ?? "—"} мм · Размах целей {checked ? plan.targetSpanMm ?? "—" : "—"} мм · База рекомендации {plan.recommendation.fullTravelMm} мм</p>
      <div className="plan-table-wrap" role="region" aria-label="Предложенные координаты" tabIndex={0}>
        <table className="plan-table"><thead><tr><th>ID</th><th>Координата, мм</th>{plan.request.grid && <th>По сетке, мм</th>}<th>Интервал, мм</th><th>Источник и замечания</th></tr></thead>
        <tbody>{rows.map((row,i) => <tr key={i}>
          <th scope="row">{row.positionId}</th><td data-label="Координата, мм"><input id={"plan-row-" + i}
            aria-label={"Предложение " + row.positionId + ", мм"} value={row.rawMm} inputMode="decimal"
            aria-invalid={checked && remarks.has(i)} aria-describedby={checked && remarks.has(i) ? "plan-error-" + i : undefined}
            onKeyDown={e => { if (e.key === "Escape" && row.origin === "edited-proposal") { e.preventDefault(); undo(i); } }} onChange={e => edit(i,e.target.value)} /></td>
          {plan.request.grid && <td data-label="По сетке, мм">{checked ? plan.positions[i]?.executableMm ?? "—" : "—"}</td>}
          <td data-label="Интервал, мм">{checked && i ? plan.intervalsMm[i-1] ?? "—" : "—"}</td>
          <td data-label="Источник">{row.origin === "edited-proposal" ? "Правка инженера" : row.origin === "manual" ? "Из матрицы" : "Предложена"}
            {row.origin === "edited-proposal" && <button className="plan-link" onClick={() => undo(i)}>Отменить правку</button>}
            {checked && remarks.has(i) && <small id={"plan-error-" + i} className="plan-warning">⚠ {remarks.get(i)!.join(" ")}</small>}</td></tr>)}</tbody></table>
      </div>
      <details className="plan-fold"><summary>Координаты и неодинаковые интервалы</summary><p>Интервал — разность двух соседних целей после приведения к заданной сетке. При свободном выборе различный шаг помогает учесть периодические ошибки (ГОСТ 27843–2006, п. 5.2). Пригодность распределения оценивает инженер.</p>
        <p>Алгоритм {plan.request.algorithmVersion}. {plan.request.grid ? "Исполнительные строки показаны в колонке «По сетке»." : "Сетка станка не указана, проверены предварительные координаты."}</p></details>
      {checked && <>
        <p className="plan-spacing"><b>Интервалы.</b> {spacing?.message}</p>
        <div className="plan-reversal"><b>Реверс</b>
          {(["left","right"] as const).map(s => <span key={s}>{s === "left" ? "Слева" : "Справа"} — {{
            unconfirmed: "требуется подтверждение инженера", "geometry-checked":"геометрия проверена по указанным параметрам", contradiction:"обнаружено противоречие",
          }[plan.reversal[s].state]}.</span>)}
          {(plan.reversal.left.state === "unconfirmed" || plan.reversal.right.state === "unconfirmed") &&
            <span>Достижимость крайних позиций с двух направлений не подтверждена. Проверьте параметры станка перед испытанием.</span>}</div>
        <details className="plan-fold" open={endangered.length > 0 || undefined}><summary>Изменения в матрице · {differences.positions.filter(d => d.kind !== "kept").length} строк</summary>
          {differences.fullTravel && <p>Полный ход: {differences.fullTravel.oldMm || "не указан"} → {differences.fullTravel.newMm} мм.</p>}
          <ul className="plan-diff">{differences.positions.map(d => <li key={d.positionId}><b>{d.positionId}</b> · {kinds[d.kind]} · {d.oldMm || "—"} → {d.newMm || "—"} мм · наблюдений {d.observations.length}/10</li>)}</ul>
          <p className="hint">Исходная редакция {plan.request.base.inputRevision} · SHA-256 <code>{plan.request.base.inputDigest}</code></p>
        </details>
        {endangered.length > 0 && <p className="error" role="alert">{protectionMessage} Затронуто наблюдений: {endangered.reduce((n,c) => n+c.observations.length,0)}.</p>}
        {incompatibleAxis && <p className="stale">Учебный план предназначен для оси X с ходом 1000 мм. Для этой записи используйте собственные параметры.</p>}
      </>}
    </>}
    <div className="actions">
      {hasRows && <button onClick={check} disabled={pending || stale}>Проверить правки</button>}
      {hasRows && <button className="primary" disabled={pending || !checked || plan.state !== "draft" || !!endangered.length || incompatibleAxis} onClick={apply}>Применить план</button>}
      <button onClick={cancel}>Отмена</button>
    </div>
  </section>;
}
