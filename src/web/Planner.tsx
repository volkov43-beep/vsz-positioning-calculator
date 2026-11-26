import { useEffect, useRef, useState } from "react";
import type { AxisRequest } from "../core/axis";
import { editCoordinate, exampleRows, propose, recommendCount, sourceRow, validate, type ActiveTrial, type PlanRow, type Proposal } from "../planning";
import { activeTrial, emptyPlanForm, passport, planRequest, protectionMessage, teachingForm, type CommitPlan, type PlanForm, type PlanSession } from "./planModel";
import { MethodHelp, PlanSettings } from "./PlanSettings";
import { PlanPreview } from "./PlanPreview";

interface Props {
  req: AxisRequest;
  session: PlanSession;
  change: (form: PlanForm) => PlanSession;
  commit: CommitPlan;
}
export function Planner({ req, session, change, commit }: Props) {
  const [plan, setPlan] = useState<Proposal | null>(null);
  const [rows,setRows] = useState<PlanRow[]>([]);
  const [edited,setEdited] = useState(false);
  const [pending,setPending] = useState(false);
  const [message,setMessage] = useState("");
  const ticket = useRef(0);
  const original = useRef<PlanRow[]>([]);
  const beforeExample = useRef<PlanForm | null>(null);
  const form = session.form;
  const active = activeTrial(req, session);
  const pass = passport(req.inputs.axis,form);
  const recommendation = recommendCount(pass);
  const conditional = !pass.travelConfirmed && pass.fullTravelMm?.trim() && recommendation.profile.state === "undetermined"
    ? recommendCount({ ...pass, travelConfirmed: true, travelSource: "Условная оценка" }).minimum : null;
  const base = plan?.request.base;
  const stale = !!base && (base.trialId !== req.trialId || base.inputRevision !== req.inputRevision);
  const unchecked = edited || (!!base && base.conditionsVersion !== active.conditionsVersion);
  useEffect(() => () => { ticket.current++; }, []);
  function invalidate() { ticket.current++; setPending(false); setMessage(""); }
  function settings(next: PlanForm) { invalidate(); change(next); }
  async function inspect(mode: "generate" | "example" | "matrix" | "check") {
    const id = ++ticket.current;
    setMessage(""); setPending(true);
    let source = form, current: ActiveTrial = active;
    if (mode === "example") {
      if (!form.example) beforeExample.current = form;
      source = teachingForm();
      current = activeTrial(req, change(source));
    }
    try {
      const request = await planRequest(current, source);
      const result = mode === "generate" ? await propose(request) : await validate(request,
        mode === "check" ? rows : mode === "example" ? exampleRows : req.inputs.positions.map(p => ({
          positionId: p.positionId, rawMm: p.targetMm, origin: "manual" as const,
        })));
      if (id !== ticket.current) return;
      const nextRows = result.positions.map(sourceRow);
      if (mode !== "check") original.current = nextRows;
      setRows(nextRows); setPlan(result); setEdited(false);
      requestAnimationFrame(() => document.getElementById("plan-preview-title")?.focus());
    } catch {
      if (id === ticket.current) setMessage("Проверка плана прервана. Проверьте доступность Web Crypto и повторите попытку.");
    } finally { if (id === ticket.current) setPending(false); }
  }
  function edit(i: number, raw: string) {
    invalidate(); setRows(prev => prev.map((row,j) => {
      if (i !== j || row.rawMm === raw) return row;
      return row.origin === "manual" ? { ...row, origin: "edited-proposal", rawMm: raw, originalProposalMm: row.rawMm } : editCoordinate(row, raw);
    })); setEdited(true);
  }
  function undo(i: number) {
    invalidate(); setRows(prev => prev.map((row,j) => i === j ? original.current[i] : row)); setEdited(true);
  }
  function dismiss(text: string) {
    invalidate(); setPlan(null); setRows([]); setEdited(false); setMessage(text);
  }
  async function apply() {
    if (!plan || pending || stale || unchecked) return;
    const id = ++ticket.current;
    const wanted = () => id === ticket.current;
    setPending(true);
    try {
      const state = await commit(active,plan,wanted);
      if (!wanted()) return;
      if (state === "applied" || state === "conditions" || state === "already") {
        beforeExample.current = null;
        dismiss(state === "applied" ? "План применён. Можно вводить измеренные отклонения." : state === "conditions" ?
          "Условия плана обновлены. Числовые входы и редакция сохранены." : "Этот план уже применён.");
        requestAnimationFrame(() => document.getElementById("positions")?.focus());
      } else setMessage(state === "protected" ? protectionMessage : "Применение остановлено. Проверьте актуальные данные и предложение.");
    } catch { if (wanted()) setMessage("Применение прервано. Действующие измерения сохранены."); }
    finally { if (wanted()) setPending(false); }
  }
  const paramsEntered = recommendation.minimum && pass.name.trim() && form.start && form.end && form.left && form.right && form.system.trim() && form.positive.trim();
  return <section className="panel planner" aria-labelledby="planner-title">
    <div className="section-title"><h2 id="planner-title">План целевых позиций</h2><span>Ось {pass.name || "—"} · {pass.fullTravelMm || "—"} мм</span></div>
    <p className="plan-intro">Поможем определить количество и предварительное расположение позиций. Перед испытанием инженер должен проверить достижимость координат и условия подхода с двух направлений.</p>
    {form.example && <p className="stale">Синтетический пример предварительного плана. Достижимость и условия испытания реального станка не подтверждены.</p>}
    <div className="plan-recommend" aria-live="polite">
      <strong>{recommendation.minimum ? "Рекомендуется не менее " + recommendation.minimum + " позиций" :
        recommendation.profile.state === "outside" ? "Ход вне поддерживаемого профиля" : conditional ? "Если ход будет подтверждён — от " + conditional + " позиций" : "Ориентир — не менее 5 позиций"}</strong>
      <span>{recommendation.minimum ? "По полному ходу " + pass.fullTravelMm + " мм · проектное правило" : recommendation.profile.state === "outside" ?
        "Короткоходовой план доступен до 2000 мм включительно. Для длинной оси требуется другая процедура." : "Для точной рекомендации укажите полный ход, источник и подтвердите значение."}</span>
    </div>
    <PlanSettings form={form} change={settings} minimum={recommendation.minimum}/>
    <MethodHelp/>
    {recommendation.minimum && /^\d+$/.test(form.count) && Number(form.count) < recommendation.minimum &&
      <p className="stale">Выбрано меньше позиций, чем рекомендует проектное правило для этого хода.</p>}
    <p className="hint">{paramsEntered ? "Исходные параметры введены. Проверьте предложение." : "Для предложения нужны паспортные данные, участок и обе крайние цели."}</p>
    <div className="actions plan-actions">
      <button id="plan-propose" className="primary" disabled={pending} onClick={() => inspect("generate")}>Предложить координаты</button>
      <button disabled={pending} onClick={() => inspect("matrix")}>Проверить план из матрицы</button>
      <button className="plan-link" disabled={pending} onClick={() => inspect("example")}>Учебный план 40–960 мм</button>
      {form.example && <button className="plan-link" onClick={() => { settings(beforeExample.current ?? session.manualForm ?? emptyPlanForm());
        beforeExample.current = null; dismiss("Открыты параметры текущего испытания."); }}>К параметрам испытания</button>}
    </div>
    {message && <p className="plan-message" role="status">{message}</p>}
    {plan && <PlanPreview plan={plan} teaching={form.example} active={active} rows={rows} edits={unchecked} stale={stale} pending={pending}
      edit={edit} undo={undo} check={() => inspect("check")} apply={apply} cancel={() => {
        if (beforeExample.current) { change(beforeExample.current); beforeExample.current = null; }
        dismiss("Предложение отменено. Матрица измерений сохранена.");
        requestAnimationFrame(() => document.getElementById("plan-propose")?.focus());
      }}/>}
  </section>;
}
