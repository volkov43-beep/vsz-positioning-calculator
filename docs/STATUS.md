# Состояние проекта

Дата последнего обновления — 20 ноября 2026 года.

| Итерация | Фактическое состояние |
| --- | --- |
| 00 и 01Б | Основа проекта и [нормативная спецификация 0.1](methodology/scope.md) вошли в основную ветку через [PR № 1](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/1) и [PR № 2](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/2) |
| 02А и 02Б | [Математическая спецификация](methodology/math-spec.md) и [обезличенный аудит Excel](validation/excel-audit-summary.md) версии 0.1 опубликованы. [PR № 3](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/3) объединён. Исходный HEAD для 03Б — [`b94c33585d0f49b955a72f3b1fc30edb6b8490d8`](https://github.com/volkov43-beep/vsz-positioning-calculator/commit/b94c33585d0f49b955a72f3b1fc30edb6b8490d8) |
| 03А | Аналитически завершена. PRO передал публичный пакет синтетических эталонов, [план проверок](validation/reference-test-plan.md) и [заключение по численной точности](validation/numerical-policy-review.md) |
| 03Б | Завершена. Пакет вошёл в основную ветку через [PR № 4](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/4). Доступны [манифест 53 наборов](../tests/fixtures/v1/manifest.json), [инструкция по воспроизведению](../tests/fixtures/v1/README.md) и [отчёт Work](iterations/03-reference-fixtures.md) |
| 04-1–04-4 | Завершены. [PR № 5](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/5) объединён в `main` коммитом [`2068fd4`](https://github.com/volkov43-beep/vsz-positioning-calculator/commit/2068fd449fd5da154c4b5c1fac8d5ac040ee19f1). [Требования](product/requirements.md), [сценарии](product/user-flows.md), [схемы экранов](product/ui-wireframes.md) и [матрица 23 требований MVP](iterations/04-product-ux.md#матрица-соответствия-mvp) вошли в основную ветку. |
| 05-1–05-3 | Архитектура, модель, контракты и план вошли в main через [PR № 6](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/6), коммит `0eba9b485537c10fdeda4e1f3f6a8b058312c1a7`. [Отчёт 05](iterations/05-architecture.md). Запись ADR-0001 имеет статус Proposed. |
| PRE-06 | Work воспроизвёл результаты PRO и подготовил [§9.2 и §9.4](methodology/math-spec.md), [отчёт проверки](validation/pre06-numerical-policy-verification.md) и [ADR-0002](decisions/ADR-0002-numerical-policy.md). Материалы объединены через [PR №7](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/7), статус политики — Proposed. [Отчёт итерации](iterations/pre06-numerical-policy.md). |
| 06 | Результаты технической проверки вошли в main через [PR №8](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/8), SHA `973463c72445231c03d3f736bde376b173838914`. Метрологические и технические решения по допуску производственного ядра открыты. Выполнены [06-1 — сертификаты RN64](validation/06-reference-certification.md), [06-2 — входы, бюджеты и отказы](validation/06-input-loss-and-failures.md) и [06-3 — итоговый контроль и ресурсы](validation/06-final-verification.md). [Общий отчёт](iterations/06-independent-control.md). |
| 07-Д1 | По разрешению владельца в ветке `feature/07-demo-calculator` создан [экспериментальный расчёт одной позиции](iterations/07-demo-calculator.md). [Общий Draft PR №9](https://github.com/volkov43-beep/vsz-positioning-calculator/pull/9) ожидает проверки. 07-Д2 и 07-Д3 предстоят. |

## Открытые инженерные вопросы

- **Q5 и Q11.** Специалисту ВСЗ предстоит подтвердить связь знака прибора с координатой оси, происхождение наблюдений, применённые коррекции и форматы будущих выгрузок.
- **Q9 / D13.** Все положительные эталоны используют выборочное стандартное отклонение с делителем 4 при пяти наблюдениях. Метод `sample-n-minus-1` ожидает решения метролога.
- **Численная политика.** Входные бюджеты, обязательная дисперсия, критерий RN64, диапазон normal, форматирование и ресурсы ожидают решения по [таблице согласований](decisions/ADR-0002-numerical-policy.md).
- Выбор позиций, пригодность измерительной установки, приёмочные допуски и форма протокола сохраняют статус из [нормативной спецификации](methodology/scope.md). Причина четырёх расхождений печатной сводки А.1 остаётся открытой. Выбор лицензии остаётся открытым. Предложение по стеку ожидает решения владельца проекта.

## Следующая итерация

**Для демонстрационного прототипа следующий шаг — 07-Д2**, расчёт оси над защищёнными позиционными выражениями и независимая сверка. Производственная итерация №07 заблокирована до решения метролога по методу s и бюджетам и принятия владельцем численного контракта. [Матрица условий перехода](validation/06-final-verification.md#14-условия-перехода-к-07).
