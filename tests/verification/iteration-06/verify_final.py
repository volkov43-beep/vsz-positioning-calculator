#!/usr/bin/env python3
"""Reproduce iteration 06 in a new output directory outside the repository."""

import argparse
from copy import deepcopy
from hashlib import sha256
import json
from pathlib import Path
import platform
import subprocess
import sys

import mpmath
from verify_reference import FIXTURES
from final_checks import experimental_controls, ladder_probes, mutation_checks, reconcile
from verify_input_loss import require

HERE = Path(__file__).resolve().parent
ROOT = FIXTURES.parents[2]
SIZES = (5, 12, 1000, 10000)


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def save(path, data):
    with path.open("x", encoding="utf-8") as target:
        json.dump(data, target, sort_keys=True, ensure_ascii=False, indent=2, allow_nan=False)
        target.write("\n")


def read(path):
    return json.loads(path.read_bytes())


def command(*args):
    return subprocess.run([sys.executable, "-B", *map(str, args)], cwd=ROOT, text=True,
                          stdout=subprocess.PIPE, check=True).stdout


def semantic(report):
    result = deepcopy(report)
    for entry in result["p05"].values():
        del entry["wall_seconds"], entry["peak_rss_kib"]
    return result


def run(out):
    files = [*FIXTURES.rglob("*"), *HERE.glob("*.py")]
    source_hashes = {str(p.relative_to(ROOT)): digest(p) for p in files
                     if p.is_file() and "__pycache__" not in p.parts}
    save(out/"input-sha256.json", source_hashes)
    generator = json.loads(command(FIXTURES/"tools/generate_reference.py", "--check"))
    require(generator["status"] == "PASS" and not generator["mismatches"], "v1 generator")
    outputs = {}
    for name, tool in (("independent","independent_check"), ("validation","validation_check"),
                       ("numerical","numerical_stress")):
        path = out/(name+".json")
        command(FIXTURES/("tools/"+tool+".py"), "--output", path)
        require(path.read_bytes() == (FIXTURES/("checks/"+name+"-results.json")).read_bytes(), name)
        outputs[name] = digest(path)

    for name, script in (("reference", "verify_reference.py"), ("input", "verify_input_loss.py")):
        path = out/(name+".json")
        command(HERE/script, "--output", path)
        outputs[name] = digest(path)
    reference, inputs = read(out/"reference.json"), read(out/"input.json")
    require(reference["passed"] and inputs["passed"], "Previous iterations")
    command("-m", "unittest", "discover", "-s", HERE)
    matched = reconcile(reference, inputs)
    exploratory = experimental_controls()
    probes = ladder_probes()
    mutants = mutation_checks(inputs)
    scale = {}
    for size in SIZES:
        path = out/f"p05-{size}.json"
        command(HERE/"verify_scale.py", "--positions", size, "--output", path)
        scale[str(size)] = read(path)

    coverage = {"certified_cases": len(matched) + len(scale),
                "certified_fields": sum(m["certified"] for m in matched.values())
                                    + sum(m["fields"]["certified"] for m in scale.values()),
                "experimental_cases": len(exploratory),
                "experimental_fields": sum(m["experimental_fields"] for m in exploratory.values())}
    require(coverage == {"certified_cases":41, "certified_fields":226932,
                         "experimental_cases":3, "experimental_fields":336}, "Incomplete coverage")
    data = {"schema": "vsz-06-verification-1", "environment": {"python": platform.python_version(),
            "implementation": platform.python_implementation(), "mpmath": mpmath.__version__,
            "os": platform.system(), "kernel": platform.release(), "machine": platform.machine(),
            "radix": sys.float_info.radix, "mantissa_bits": sys.float_info.mant_dig},
            "source_hash_manifest": digest(out/"input-sha256.json"), "v1_generator": generator,
            "output_sha256": outputs, "coverage": coverage, "06-1": reference["summary"],
            "06-2": inputs["counts"], "cross_layer": matched, "experimental": exploratory,
            "ladder": probes, "mutations": mutants, "p05": scale}
    save(out/"final.json", data)
    save(out/"semantic.json", semantic(data))
    save(out/"output-sha256.json", {p.name: digest(p) for p in out.glob("*.json")})
    print(json.dumps(coverage, ensure_ascii=False), "semantic SHA-256:", digest(out/"semantic.json"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True, help="New directory outside the checkout")
    args = parser.parse_args()
    out = args.out.resolve()
    if out.is_relative_to(ROOT) or out.exists():
        parser.error("Choose a new directory outside the repository")
    if not __debug__:
        parser.error("Run with assertions enabled")
    out.mkdir()
    run(out)


if __name__ == "__main__":
    main()
