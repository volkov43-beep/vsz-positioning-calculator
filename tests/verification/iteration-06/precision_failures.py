"""Test-only failed-attempt envelopes and the proposed mandatory-output gate."""

from copy import deepcopy
from hashlib import sha256
import json
import math
import sys
from uuid import NAMESPACE_URL, uuid5

from verify_reference import v1
from rounding import bits, certify


def output_issue(exact, actual, *, certificate=certify):
    """Check the bit certificate first, then the output domain of §9.2.8."""
    if math.isnan(actual):
        return "output-nan", {"bits": bits(actual)}
    proof = certificate(exact, actual)
    if proof["status"] == "uncertified":
        reason = "certificate-resource-limit" if proof.get("failure_kind") == "comparison-limit" else "rounding-uncertified"
        return reason, proof
    if proof["status"] != "certified":
        return "rounding-mismatch", proof
    if math.isinf(actual):
        return "output-overflow", proof
    if actual == 0 and proof["exact_sign"] != 0:
        return "output-nonzero-to-zero", proof
    if 0 < abs(actual) < sys.float_info.min:
        return "output-subnormal", proof
    return None, proof


ACTIONS = {
    "parse": "Сверьте исходную запись и единицу с первичным документом.",
    "conversion": "Сохраните исходную десятичную запись и проверьте диапазон преобразования.",
    "collision": "Сверьте обе первичные записи по указанным адресам. Сохраните исходную редакцию.",
    "budget": "Передайте семейство, единицу и свидетельство на согласование метрологу и владельцу.",
    "rounding": "Сохраните снимок и проверьте указанное поле независимым вычислителем.",
    "resource": "Сохраните попытку и передайте границы сравнения на численную проверку.",
}


MESSAGES = {
    "syntax-invalid": "Запись измерения не является конечным числом допустимого формата.",
    "unit-unknown": "Единица измерения не распознана.",
    "input-nonfinite": "Нормализованное наблюдение выходит за конечный диапазон binary64.",
    "input-nonzero-to-zero": "Ненулевое исходное наблюдение преобразовалось в машинный ноль.",
    "input-collision": "Различные исходные отклонения получили одно машинное значение.",
    "budget-not-approved": "Бюджет ошибки представления для этого семейства ожидает согласования.",
    "budget-exceeded": "Прямое сравнение доказывает превышение заданного бюджета.",
    "budget-uncertified": "Достаточный сертификат соблюдения бюджета не получен.",
    "output-subnormal": "Округлённое поле попало в субнормальный диапазон.",
    "output-nonzero-to-zero": "Точная величина поля ненулевая, но её округление даёт ноль.",
    "output-overflow": "Округление поля даёт бесконечность.",
    "output-nan": "Вместо результата поля получено NaN.",
    "rounding-uncertified": "Для поля отсутствует доказательство правильного округления.",
    "rounding-mismatch": "Полученные биты расходятся с точной ячейкой округления.",
    "certificate-resource-limit": "Исчерпаны интервальные уточнения при сравнении с границей округления.",
}


def blocked_attempt(case_id, snapshot, stage, reason, field, evidence):
    # Stable IDs reproduce this synthetic run. A distinct test attempt has its own case_id.
    run_id = str(uuid5(NAMESPACE_URL, "vsz/06-2/run/" + case_id))
    record = str(uuid5(NAMESPACE_URL, "vsz/06-2/record/" + case_id))
    data = json.dumps(snapshot, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    input_error = stage == "parse"
    code = evidence["input_code"] if input_error else "PRECISION_LOSS"
    diag = {"diagnosticId": run_id + "/1", "recordRevision": record, "runId": run_id, "stage": stage,
            "reason": reason, "code": code, "field": field, "evidence": evidence, "action": ACTIONS[stage],
            "message": MESSAGES[reason], "severity": "error",
            "category": "input" if input_error else "arithmetic",
            "effects": {"calculate": "block", "applicability": "unchanged", "report": "draftOnly"}}
    return {"runId": run_id, "trialId": str(uuid5(NAMESPACE_URL, "vsz/06-2/trial/" + case_id)),
            "inputRevision": 1, "inputDigest": sha256(data.encode()).hexdigest(), "profileId": v1.PROFILE,
            "profileVersion": "synthetic-check-06-2", "sdMethod": "sample-n-minus-1",
            "algorithmVersion": "python-verification-06-2", "numericalPolicyVersion": "vsz-num-0.2",
            "methodStatus": "awaiting-metrologist", "origin": {"kind": "synthetic", "sourceId": case_id},
            "state": "notStarted" if input_error else "failed", "inputSnapshot": deepcopy(snapshot), "errors": [diag]}


def valid_block(run, original, reason):
    diag = run["errors"][0]
    raw = json.dumps(original, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    parse = diag["stage"] == "parse"
    return (run["inputSnapshot"] == original and run["inputDigest"] == sha256(raw.encode()).hexdigest()
            and run["state"] == ("notStarted" if parse else "failed") and diag["reason"] == reason
            and (diag["code"] != "PRECISION_LOSS" if parse else diag["code"] == "PRECISION_LOSS")
            and diag["category"] == ("input" if parse else "arithmetic") and diag["severity"] == "error"
            and diag["runId"] == run["runId"] and diag["effects"]["calculate"] == "block"
            and bool(diag["field"] and diag["action"] and diag["evidence"] and diag["recordRevision"])
            and all(k not in run for k in ("positions", "axis", "extrema")))
