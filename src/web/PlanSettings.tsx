import type { Approach } from "../planning";
import type { PlanForm } from "./planModel";

type TextKey = { [K in keyof PlanForm]: PlanForm[K] extends string ? K : never }[keyof PlanForm];
export const fieldNames: Record<string, [string, string]> = {
  "passport.name": ["axis", "Обозначение оси"], "passport.fullTravelMm": ["fullTravelMm", "Полный ход оси"],
  "passport.travelSource": ["plan-source", "Источник полного хода"], "passport.travelConfirmed": ["plan-confirm", "Подтверждение хода"],
  "passport.frame.system": ["plan-system", "Система координат"], "passport.frame.positiveDirection": ["plan-positive", "Положительное направление"],
  "section.startMm": ["plan-start", "Начало участка"], "section.endMm": ["plan-end", "Конец участка"], section: ["plan-start", "Измерительный участок"],
  "section.source": ["plan-start", "Границы участка"], "section.choice": ["plan-choice", "Выбор позиций"], "section.constraints": ["plan-constraint", "Ограничения"],
  "ends.left": ["plan-left", "Левая крайняя цель"], "ends.right": ["plan-right", "Правая крайняя цель"], ends: ["plan-left", "Крайние цели"],
  "passport.limits.minMm": ["plan-min", "Нижний предел"], "passport.limits.maxMm": ["plan-max", "Верхний предел"], "passport.limits": ["plan-min", "Пределы движения"],
  "grid.originMm": ["plan-gridOrigin", "Начало сетки"], "grid.stepMm": ["plan-gridStep", "Шаг сетки"], grid: ["plan-gridStep","Сетка станка"],
  desiredCount: ["plan-count","Выбранное количество"], decimalPlaces: ["plan-places", "Десятичные знаки"],
};
export function addressLink(address: string, ids: string[]) {
  const row = /^positions\[(\d+)\]/.exec(address);
  if (row) return ["plan-row-" + row[1], ids[Number(row[1])] ?? "Координата"];
  const rev = /^section\.approach\.(left|right)(?:\.(\w+))?/.exec(address);
  if (rev) return ["plan-" + rev[1] + "-" + (rev[2] ?? "bothSides"), "Реверс " + (rev[1] === "left" ? "слева" : "справа")];
  return fieldNames[address] ?? fieldNames[address.replace(/\.(basis|rawMm)$/, "")];
}
export function focusPlanField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  for (let parent = el.parentElement; parent; parent = parent.parentElement)
    if (parent instanceof HTMLDetailsElement) parent.open = true;
  el.focus();
}
export function PlanSettings({ form, change, minimum }: { form: PlanForm; change: (form: PlanForm) => void; minimum: number | null }) {
  function field(key: TextKey, label: string, numeric = true, placeholder?: string) {
    return <label>{label}<input id={"plan-" + key} value={form[key]} placeholder={placeholder}
      inputMode={numeric ? "decimal" : "text"} autoComplete="off" onChange={e => change({ ...form, [key]: e.target.value,
        ...(key === "source" ? { confirmed: false } : {}) })} /></label>;
  }
  function approach(side: "left" | "right") {
    const key = side === "left" ? "leftApproach" : "rightApproach";
    const a = form[key];
    const update = (patch: Partial<Approach>) => change({ ...form, [key]: { ...a, ...patch } });
    return <fieldset><legend>{side === "left" ? "Левая цель" : "Правая цель"}</legend>
      <label>Подход с двух сторон<select id={"plan-" + side + "-bothSides"} value={a.bothSides}
        onChange={e => update({ bothSides: e.target.value as Approach["bothSides"] })}>
        <option value="unknown">Не подтверждён</option><option value="possible">Возможен</option><option value="impossible">Невозможен</option>
      </select></label>
      {([["availableMm","Доступное движение, мм"],["requiredMm","Требуемый запас, мм"],["basis","Основание запаса"]] as const).map(([k,label]) =>
        <label key={k}>{label}<input id={"plan-" + side + "-" + k} value={a[k] ?? ""} inputMode={k === "basis" ? "text" : "decimal"}
          onChange={e => update({ [k]: e.target.value || null })} /></label>)}
    </fieldset>;
  }
  return <>
    <div className="plan-fields plan-basics">
      {field("count","Количество позиций",true,minimum ? String(minimum) + " · по рекомендации" : "По рекомендации")}
      {field("start","Начало участка, мм")}{field("end","Конец участка, мм")}
    </div>
    <details className="plan-fold"><summary>Паспорт, система координат и крайние цели</summary>
      <p>Возьмите полный ход из документации станка. Измерительный участок задайте в принятой системе координат.</p>
      <div className="plan-fields">
        {field("source","Источник полного хода",false)}
        <label className="plan-check"><input id="plan-confirm" type="checkbox" checked={form.confirmed} disabled={!form.source.trim()}
          onChange={e => change({ ...form, confirmed: e.target.checked })} />Ход сверен с указанным источником</label>
        {field("system","Система координат",false)}{field("positive","Положительное направление",false)}
        {field("left","Левая крайняя цель, мм")}{field("right","Правая крайняя цель, мм")}
        <label>Выбор позиций<select id="plan-choice" value={form.choice} onChange={e => change({ ...form, choice: e.target.value as PlanForm["choice"] })}>
          <option value="unknown">Не установлен</option><option value="free">Свободный</option><option value="fixed">Фиксированный</option>
        </select></label>
        {field("constraint","Ограничения размещения",false)}
      </div>
      <p className="hint">Крайние цели — первая и последняя точки внутри участка. Укажите обе явно. Для фиксированных целей можно проверить координаты из матрицы.</p>
    </details>
    <details className="plan-fold"><summary>Сетка станка и условия реверса</summary>
      <p>Укажите известные параметры. Для сетки нужны начало и положительный шаг. Половина шага округляется дальше от начала сетки.</p>
      <div className="plan-fields">
        {field("min","Нижний механический предел, мм")}{field("max","Верхний механический предел, мм")}
        {field("gridOrigin","Начало сетки, мм")}{field("gridStep","Шаг сетки, мм")}{field("places","Знаков для внутренних целей (0–12)")}
      </div>
      <p>Запас зависит от движения конкретного станка. Достаточное расстояние само по себе не подтверждает достижение рабочей скорости.</p>
      <div className="plan-fields">{approach("left")}{approach("right")}</div>
    </details>
  </>;
}
export function MethodHelp() {
  return <details className="plan-fold"><summary>Условия проведения испытаний</summary>
    <dl className="plan-help">
      <dt>Среда и подготовка</dt><dd>Учитывайте тепловые требования изготовителя, выдержку оборудования и внешние источники тепла (ГОСТ 27843–2006, п. 4.1). Проверьте состояние ненагруженного станка и его установку (п. 4.2). Режим прогрева выбирают по указаниям изготовителя (п. 4.3).</dd>
      <dt>Установка и движение</dt><dd>Определите линию измерения относительного перемещения между узлами инструмента и детали, укажите прибор (пп. 5.3.1, 7б, 8.1). Используйте эксплуатационную скорость позиционирования и остановку, достаточную для измерения (п. 5.1).</dd>
      <dt>Число и расположение позиций</dt><dd>Для короткой линейной оси — минимум пять позиций на метр и пять всего (п. 5.3.2). При свободном выборе неодинаковые интервалы помогают охватить разные положения относительно периодических ошибок передачи или шкалы (п. 5.2). В приложении выбор полного хода и округление вверх — проектная формализация.</dd>
      <dt>Цикл и реверс</dt><dd>Каждую цель достигают пять раз с каждой стороны. Стрелки обозначают направление подхода (пп. 3.5–3.7, 5.3.2, рис. 1). Согласуйте крайние позиции, проверьте возможность двустороннего подхода и набора рабочей скорости после реверса (пп. 3.2, 5.3.2, 7е).</dd>
    </dl></details>;
}
