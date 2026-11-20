# Экспериментальное ядро расчёта оси

[Запуск T06 для всей оси](#расчёт-всей-оси).

## Расчёт одной позиции

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

## Расчёт всей оси

После сборки доступен ES-модуль `dist/axis.js`. Для переноса сборки нужны обе точки входа и их общий файл из `dist/`. Публичный контракт [calculateAxis и isCurrentAxisResult](core/axis.ts) принимает одну линейную ось. В каждой позиции — координата в мм и две серии по пять подписанных наблюдений с исходной десятичной строкой и единицей. Порядок в снимке и постоянный `positionId` определяют адрес источника. Сортировку таблицы интерфейс выполняет на отдельном представлении.

Пример из корня репозитория после `npm run build` (Node.js 24). [Адаптер](../tests/core/fixture-input.ts) нужен только для чтения тестового формата. Обычный клиент собирает `AxisRequest` из редактируемой модели испытания.

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { calculateAxis, demoProfile, isCurrentAxisResult } from './dist/axis.js';
import { fixtureRequest } from './tests/core/fixture-input.ts';

const t06 = JSON.parse(readFileSync('tests/fixtures/v1/cases/valid/T06-single-outlier.json', 'utf8'));
const draft = fixtureRequest(t06, demoProfile);
const first = await calculateAxis(draft);
if (first.state !== 'research-computed') throw Error(JSON.stringify(first.errors));
console.log(first.axis);

const p03 = draft.inputs.positions.find(p => p.positionId === 'p03');
p03.observations.up.find(o => o.repeat === 5).raw = '0';
draft.inputRevision += 1;
draft.runId = 'T06-edit/2';
console.log('Первая попытка актуальна:', await isCurrentAxisResult(first, draft));
const second = await calculateAxis(draft);
if (second.state !== 'research-computed') throw Error(JSON.stringify(second.errors));
console.log(second.axis);
JS
```

Первая попытка даёт B = 4 мкм и B̄ = 0,8 мкм. После правки проверка актуальности возвращает `false`, а повторный расчёт даёт 12 значений +0. [Все исходные итоги T06 и время расчёта](../docs/iterations/07-demo-calculator.md#07-д2--расчёт-всей-оси).

| Поле или действие | Контракт для интерфейса |
| --- | --- |
| `key` и `inputSnapshot` | Ядро копирует вход до первого ожидания и вычисляет SHA-256 канонического JSON объекта `inputs` через Web Crypto. Ключ содержит испытание, редакцию, попытку, хеш, профиль и версии, метод s. Для браузера требуется контекст с доступным Web Crypto. |
| `positions`, `axis`, `extrema` | Доступны при `research-computed`. Дисперсии выражены в мкм², все 12 итогов — в мкм. В 18 семействах экстремумов каждый источник содержит `kind`, `positionId`, `direction` и `positionOrder` (с нуля). Направления имеют порядок `up`, `down`; для позиционной величины используется `both`. |
| Статусы | Числовой ввод, применимость и оформление имеют отдельные состояния. Выдача маркируется `research-demo`, `productionEligible: false` и `budget-not-approved`. Происхождение синтетического примера хранится в `origin`. |
| Изменение исходного наблюдения | Пометить показанные итоги устаревшими сразу при вводе. Увеличить `inputRevision`; новой попытке дать новый `runId`. Перед показом ответа сверить его с текущей редакцией через `isCurrentAxisResult`. |
| Ошибка | `notStarted` означает ошибку ввода. В состоянии `failed` проверять код и стадию, например `AXIS_EMPTY` или `PRECISION_LOSS`. Оба варианта сохраняют снимок, ключ и диагностику. Числовые секции доступны только при успешной исследовательской попытке. |

Для воспроизведения измерений выполните `node tests/core/bench-axis.mjs` после сборки. Команда использует синтетические наборы P05 и сверяет результаты с независимым Python-контролем.

## Веб-прототип 07-Д3

Из корня рабочей ветки с Node.js 24 выполните `npm ci` и `npm run dev`. Откройте локальный адрес, который выведет Vite. Для статической версии выполните `npm run build`, затем `npm run preview`. Для размещения в подкаталоге нужно переносить всё содержимое `dist/`.

Команда `npm run build:demo` отдельно создаёт `dist/VSZ-calculator-07D3.html` с тем же интерфейсом и ядром в одном файле. Для SHA-256 и идентификаторов требуется защищённый контекст браузера. Локальный сервер на localhost подходит для демонстрации. Измерения находятся в памяти вкладки.

1. Нажмите **«Загрузить пример T06»**, затем **«Рассчитать»**. В результате B = 4 мкм, B̄ = 0,8 мкм.
2. Нажмите **«Изменить измерения»**. В позиции **p03**, направление **↑ up**, **повтор 5**, замените **20** на **0**.
3. Нажмите **«Пересчитать»**. Все 12 показателей станут равны нулю, график обновится. **«Отчёт»** открывает предпросмотр этой редакции.
4. Чтобы повторить показ, выберите **«Начало» → «Загрузить пример T06»** и подтвердите замену рабочей копии.

[Результаты и скриншоты проверки](../docs/iterations/07-demo-calculator.md#07-д3--живой-веб-прототип).
