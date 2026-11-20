# Независимая проверка RN64 · 06-1

Проверяется вычислительный слой проекта `vsz-num-0.2` над точными значениями binary64-входов. Одна проверка охватывает 32 положительных набора, 20 чисел каждой позиции и 12 итогов каждой оси. Программа читает [пакет v1](../../fixtures/v1/README.md). Для основного запуска достаточно файлов репозитория, Python 3.12 и mpmath 1.3.0 из [requirements.txt](../../fixtures/v1/requirements.txt).

## Воспроизведение

Из корня репозитория в среде с указанными зависимостями выполнить:

```bash
OUT=$(mktemp -d)
python -B tests/fixtures/v1/tools/generate_reference.py --check
python -B tests/fixtures/v1/tools/independent_check.py --fixtures tests/fixtures/v1 --output "$OUT/independent.json"
python -B tests/fixtures/v1/tools/validation_check.py --fixtures tests/fixtures/v1 --output "$OUT/validation.json"
python -B tests/fixtures/v1/tools/numerical_stress.py --fixtures-root tests/fixtures/v1 --output "$OUT/numerical.json"
for name in independent validation numerical; do
  cmp "$OUT/$name.json" "tests/fixtures/v1/checks/$name-results.json" || exit 1
done
python -B tests/verification/iteration-06/verify_reference.py --output "$OUT/public.json"
sha256sum "$OUT"/*.json
```

По умолчанию наблюдаемые значения вычисляет независимая программа 03А из репозитория, получая точные десятичные записи машинных входов b. Она использует mpmath при 120 десятичных цифрах. Верность выданных битов устанавливает отдельная проверка ячейки округления. При наличии ранее проверенного локального скрипта PRE-06 его можно испытать тем же эталоном:

```bash
python -B tests/verification/iteration-06/verify_reference.py \
  --candidate "$PRO_TOOLS/certified_policy_probe.py" --output "$OUT/candidate.json"
```

Переменная `PRO_TOOLS` указывает на каталог проверенного скрипта. Адаптер сверяет SHA-256 до загрузки. Скрипт нужен только для второго запуска. Обе команды используют одни математические ожидания и дают два наблюдения одних и тех же полей.

## Как читать результат

- [verify_reference.py](verify_reference.py) восстанавливает рациональные b, строит выражения полей и списки источников. [rounding.py](rounding.py) проверяет границы ячейки RN64 с помощью точных предикатов 03А. В [observations.py](observations.py) собраны адаптеры наблюдаемых результатов.
- Ключи журнала имеют вид `cases → case_id → fields → position_id / axis → поле`. Биты представлены 16 шестнадцатеричными цифрами от старшего байта. Для конечного числа `left` и `right` — знаки разностей точного эталона с левой и правой границей. Нулевой знак означает точную середину. `even` указывает чётность мантиссы. Для нулевого результата проверяется также `exact_sign`.
- `branches` и `extrema` сохраняют ожидаемые и наблюдаемые упорядоченные списки вместе с результатом сравнения. `decimal_source_changes` отмечает поля, для которых адреса изменились при d→b. `coordinates_mm` относится к исходным координатам. `boundary` содержит скалярные проверки границ, `mutations_rejected` — результаты намеренных искажений.
- Код 0 означает полный успех заявленного корпуса. `mismatch` отмечает доказанное несовпадение, `uncertified` — отсутствие доказательства для предложенных битов. Ошибка построения эталона всего случая остаётся в `errors`, его поля входят в `not_examined`. Любое из этих состояний исключает успешное завершение.
- Без `--output` программа печатает сводку. Для подробного JSON требуется новый путь вне репозитория. Запускать без `-O`: проверки исходного пакета и внешнего кандидата используют утверждения Python.

[Отчёт с числами, контрольными суммами и границами вывода](../../../docs/validation/06-reference-certification.md).
