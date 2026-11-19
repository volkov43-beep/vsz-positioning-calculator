# Состояние проекта

Дата последнего обновления — 19 ноября 2026 года.

| Итерация | Фактическое состояние |
| --- | --- |
| 00 и 01Б | Основа проекта и [нормативная спецификация 0.1](methodology/scope.md) вошли в основную ветку через [PR № 1](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/1) и [PR № 2](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/2) |
| 02А и 02Б | [Математическая спецификация](methodology/math-spec.md) и [обезличенный аудит Excel](validation/excel-audit-summary.md) версии 0.1 опубликованы. [PR № 3](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/3) объединён. Исходный HEAD для 03Б — [`b94c33585d0f49b955a72f3b1fc30edb6b8490d8`](https://github.com/volkov43-beep/vsz-positioning-calculator/commit/b94c33585d0f49b955a72f3b1fc30edb6b8490d8) |
| 03А | Аналитически завершена. PRO передал публичный пакет синтетических эталонов, [план проверок](validation/reference-test-plan.md) и [заключение по численной точности](validation/numerical-policy-review.md) |
| 03Б | Завершена. Пакет вошёл в основную ветку через [PR № 4](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/4). Доступны [манифест 53 наборов](../tests/fixtures/v1/manifest.json), [инструкция по воспроизведению](../tests/fixtures/v1/README.md) и [отчёт Work](iterations/03-reference-fixtures.md) |
| 04-1–04-4 | Завершены. [PR № 5](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/5) объединён в `main` коммитом [`2068fd4`](https://github.com/volkov43-beep/vsz-positioning-calculator/commit/2068fd449fd5da154c4b5c1fac8d5ac040ee19f1). [Требования](product/requirements.md), [сценарии](product/user-flows.md), [схемы экранов](product/ui-wireframes.md) и [матрица 23 требований MVP](iterations/04-product-ux.md#матрица-соответствия-mvp) вошли в основную ветку. |
| 05-1 | [Техническая архитектура](architecture/architecture.md) и [ADR-0001](decisions/ADR-0001-application-architecture.md) подготовлены к проверке в [Draft PR № 6](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/6). Рекомендованы React, независимое ядро TypeScript, Vite, файл испытания и IndexedDB. ADR имеет статус Proposed. [Отчёт общей итерации 05](iterations/05-architecture.md). |
| 05-2 | [Модель данных](architecture/data-model.md) и [контракты компонентов](architecture/contracts.md) представлены в том же [Draft PR № 6](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/6). Описаны сохранение исходных строк, четыре независимых состояния, проверка целостности файла и связь результата с редакцией входов. |

## Открытые инженерные вопросы

- **Q5 и Q11.** Специалисту ВСЗ предстоит подтвердить связь знака прибора с координатой оси, происхождение наблюдений, применённые коррекции и форматы будущих выгрузок.
- **Q9 / D13.** Все положительные эталоны используют выборочное стандартное отклонение с делителем 4 при пяти наблюдениях. Метод `sample-n-minus-1` ожидает решения метролога.
- **Численная политика.** На наборе `P02-mixed-scale` общее центрирование по §9.2 математической спецификации теряет локальный разброс. Допуски §9.4 могут скрыть эту потерю. Перед программированием основного ядра требуется исправить §9.2 и §9.4 математической спецификации. Локальный порядок вычислений, пределы погрешности, критерий для дисперсий, шаг отображения и округление точных половин требуют отдельного согласования. Подробности — в [численном заключении](validation/numerical-policy-review.md).
- Выбор позиций, пригодность измерительной установки, приёмочные допуски и форма протокола сохраняют статус из [нормативной спецификации](methodology/scope.md). Причина четырёх расхождений печатной сводки А.1 остаётся открытой. Выбор лицензии остаётся открытым. Предложение по стеку ожидает решения владельца проекта.

## Следующая итерация

**05-3 — заключительная часть архитектурного этапа по отдельному заданию.** Для неё подготовлены проект формата 1.0, границы компонентов и проверяемые сценарии сохранения, импорта и пересчёта. Работа продолжается в ветке `docs/iteration-05-architecture` и Draft PR № 6.
