# Расчёт одной позиции · 07-Д1

Точка входа — [calculatePosition](core/position.ts). На входе одна позиция в мм, по пять наблюдений `up` и `down`, единица и номер повторения каждого наблюдения. [Контракт TypeScript](core/contracts.ts) связывает снимок с ключом попытки. `demoProfile` задаёт единственный разрешённый режим `research-demo`, метод `sample-n-minus-1`, версию профиля «1» и предложенную политику `vsz-num-0.2`. Действительный статус метода — `proposed`.

## Проверка и запуск

Нужны Node.js 24 (проверено с 24.22.3) и для тестов Python 3.12 с [mpmath 1.3.0](../tests/fixtures/v1/requirements.txt). Из корня репозитория:

```sh
npm ci
python -m pip install -r tests/fixtures/v1/requirements.txt
npm run typecheck
npm test
npm run build
```

Результат сборки — ES-модуль `dist/position.js` с экспортами `calculatePosition`, `demoProfile` и `algorithmVersion`. Само вычисление использует стандартные BigInt, DataView и structuredClone. Python нужен при проверке независимых эталонов.

Пример запуска после сборки берёт публичную синтетическую позицию p03 из T06. Для изолированного примера хешируется снимок только этой позиции. При подключении к модели испытания вызывающая сторона передаёт SHA-256 канонического объекта `inputs` всей редакции по [контракту данных](../docs/architecture/data-model.md).

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { calculatePosition, demoProfile } from './dist/position.js';

const test = JSON.parse(readFileSync('tests/fixtures/v1/cases/valid/T06-single-outlier.json', 'utf8'));
const p = test.positions.find(p => p.position_id === 'p03');
const side = d => p[d].map(o => ({repeat: o.repeat, raw: o.value, sourceUnit: test.units.deviation}));
const position = {positionId: p.position_id, targetMm: p.target_mm, observations: {up: side('up'), down: side('down')}};
const inputDigest = createHash('sha256').update(JSON.stringify(position)).digest('hex');
const run = calculatePosition({position, profile: demoProfile, runId: 't06-p03', trialId: 'synthetic',
  inputRevision: 1, inputDigest});
if (run.state !== 'research-computed') throw Error(JSON.stringify(run.errors));
console.log(run.position.up.mean, run.position.up.variance, run.position.reversal, run.position.activeCandidates);
JS
```

Ожидаются μ↑ = 4 мкм, v↑ = 80 мкм², Bᵢ = +4 мкм и единственная ветвь `up`.

## Чтение результата

- `position` содержит 20 независимо округлённых характеристик и все определяющие кандидаты `cross, up, down` в этом порядке. Координата возвращается в мм. Истинный ноль имеет биты +0.
- `representedInputs` хранит исходную запись, единицу, точную исходную дробь, нормализованную десятичную строку и дробь d, биты и точное b, знаковую ошибку b−d. Целевой координате соответствует мм, отклонениям — мкм. Адрес наблюдения состоит из ID позиции, направления и номера повтора.
- `protectedPosition` хранит точные выражения для последующей агрегации. `position` предназначена для чтения результата. Формат переносимого файла испытания описан отдельно. Внутренние BigInt и дроби используются в памяти.
- При успехе сохраняются `budgetStatus: "budget-not-approved"` и `productionEligible: false`. При отказе доступны ключ, снимок и адресная диагностика. Ошибки структуры дают `notStarted`, вычислительные отказы — `failed/PRECISION_LOSS`. У них отсутствуют числовые секции результата.

[Отчёт итерации и границы проверки](../docs/iterations/07-demo-calculator.md).
