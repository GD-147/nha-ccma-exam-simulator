#!/usr/bin/env python3
"""Validate 35 NHA CCMA source TXT files and build five complete exam JSONs.

Run from any directory: python3 tools/import_ccma.py
Original import source TXT files are never modified.
All five JSON master files are written only after all sources pass validation.
"""

import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

DOMAIN_SPECS = {
    1: ("Foundational Knowledge and Basic Science", 15, 3),
    2: ("Anatomy and Physiology", 8, 2),
    3: ("Clinical Patient Care", 84, 17),
    4: ("Patient Care Coordination and Education", 12, 3),
    5: ("Administrative Assisting", 12, 2),
    6: ("Communication and Customer Service", 12, 2),
    7: ("Medical Law and Ethics", 7, 1),
}

ID_RE = r"CCMA-[A-Z]+\d{2}-\d{3}"
QUESTION_ID_RE = re.compile(rf"(?m)^({ID_RE})\s*$")
ANSWER_RE = re.compile(
    rf"^({ID_RE}),\s*Correct:\s*([A-D]),\s*"
    r"Correct Answer:\s*(.*?),\s*Explanation:\s*(.+)$"
)
SECTION_B_RE = re.compile(r"(?im)^PART B,\s*ANSWER KEY AND EXPLANATIONS\s*$")
SOURCE_RE = re.compile(r"^ccma_exam_(0[1-5])_domain_([1-7])_[\w-]+\.txt$")


class SourceError(Exception):
    pass


def require(ok, message):
    if not ok:
        raise SourceError(message)


def field_value(block, field, qid):
    match = re.search(rf"(?m)^{re.escape(field)}:\s*([^\n]*)$", block)
    require(match is not None, f"{qid}: missing '{field}'")
    value = match.group(1).strip()
    require(bool(value), f"{qid}: empty '{field}'")
    return value


def multiline_value(block, start_label, end_label, qid):
    match = re.search(
        rf"(?ms)^{re.escape(start_label)}:\s*\n(.*?)(?=^{re.escape(end_label)})",
        block,
    )
    require(match is not None, f"{qid}: missing or malformed '{start_label}'")
    return match.group(1).strip()


def parse_question(qid, raw, expected_domain, expected_exam):
    require(
        re.fullmatch(rf"CCMA-[A-Z]+{expected_exam:02d}-\d{{3}}", qid) is not None,
        f"{qid}: ID does not match exam {expected_exam:02d}",
    )
    domain = field_value(raw, "Domain", qid)
    require(domain == expected_domain, f"{qid}: wrong domain {domain!r}")
    category = field_value(raw, "Category", qid)
    require(field_value(raw, "Type", qid).lower() == "mcq", f"{qid}: type must be mcq")
    unscored_raw = field_value(raw, "Unscored", qid).lower()
    scenario_raw = field_value(raw, "Scenario-Based", qid).lower()
    require(unscored_raw in ("true", "false"), f"{qid}: invalid Unscored value")
    require(scenario_raw in ("true", "false"), f"{qid}: invalid Scenario-Based value")

    context = multiline_value(raw, "Scenario Context", "Prompt:", qid)
    prompt_and_options = re.search(r"(?ms)^Prompt:\s*\n(.*)\Z", raw)
    require(prompt_and_options is not None, f"{qid}: missing Prompt")
    question_text = prompt_and_options.group(1)
    options = list(re.finditer(r"(?m)^([A-D])\)\s*(.*)$", question_text))
    require(len(options) == 4, f"{qid}: expected four choices, found {len(options)}")
    require([match.group(1) for match in options] == list("ABCD"), f"{qid}: choices must be A/B/C/D in order")
    prompt = question_text[: options[0].start()].strip()
    require(bool(prompt), f"{qid}: empty prompt")

    choices = {}
    for i, match in enumerate(options):
        end = options[i + 1].start() if i + 1 < len(options) else len(question_text)
        value = (match.group(2) + question_text[match.end():end]).strip()
        require(bool(value), f"{qid}: empty choice {match.group(1)}")
        choices[match.group(1)] = value

    scenario_based = scenario_raw == "true"
    require(not scenario_based or (context and context.lower() != "none"), f"{qid}: scenario is true but context is missing")
    require(scenario_based or context.lower() in ("", "none"), f"{qid}: context exists but Scenario-Based is false")

    return {
        "id": qid,
        "domain": domain,
        "category": category,
        "itemType": "mcq_single",
        "type": "mcq",
        "unscored": unscored_raw == "true",
        "isScenarioBased": scenario_based,
        "scenarioContext": context if scenario_based else "",
        "prompt": prompt,
        "choices": choices,
    }


def normalize_answer(text):
    return re.sub(r"\s+", " ", text).strip().rstrip(".").casefold()


def parse_file(path, expected_domain, expected_exam):
    try:
        contents = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SourceError(f"{path.name}: not valid UTF-8") from exc
    contents = contents.replace("\r\n", "\n").replace("\r", "\n")
    parts = SECTION_B_RE.split(contents)
    require(len(parts) == 2, f"{path.name}: expected one PART B, ANSWER KEY AND EXPLANATIONS section")
    question_section, key_section = parts
    matches = list(QUESTION_ID_RE.finditer(question_section))
    require(bool(matches), f"{path.name}: no question IDs found")

    questions = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(question_section)
        questions.append(parse_question(match.group(1), question_section[match.end():end].strip(), expected_domain, expected_exam))

    answer_map = {}
    for line in key_section.splitlines():
        line = line.strip()
        if not line:
            continue
        m = ANSWER_RE.fullmatch(line)
        require(m is not None, f"{path.name}: invalid answer-key line: {line[:110]!r}")
        qid, correct, correct_text, explanation = m.groups()
        require(qid not in answer_map, f"{path.name}: duplicate key ID {qid}")
        require(bool(correct_text.strip()), f"{qid}: empty correct answer text")
        require(bool(explanation.strip()), f"{qid}: empty explanation")
        answer_map[qid] = (correct, correct_text.strip(), explanation.strip())

    ids = [q["id"] for q in questions]
    require(len(ids) == len(set(ids)), f"{path.name}: duplicate question IDs")
    require(set(ids) == set(answer_map), f"{path.name}: answer key does not match question IDs")

    for q in questions:
        letter, text, explanation = answer_map[q["id"]]
        require(
            normalize_answer(q["choices"][letter]) == normalize_answer(text),
            f"{q['id']}: correct-answer text mismatch for {letter}: {q['choices'][letter]!r} != {text!r}",
        )
        q["correct"] = letter
        q["explanation"] = explanation
    return questions


def build(root, validate_only=False):
    imports = root / "imports"
    output_dir = root / "packs" / "nha-ccma" / "data"
    require(imports.is_dir(), f"Missing source directory: {imports}")
    txt_paths = sorted(imports.glob("*.txt"))
    require(len(txt_paths) == 35, f"Expected exactly 35 TXT files, found {len(txt_paths)}")
    files = {}
    for path in txt_paths:
        match = SOURCE_RE.fullmatch(path.name)
        require(match is not None, f"Unexpected TXT filename: {path.name}")
        pair = (int(match.group(1)), int(match.group(2)))
        require(pair not in files, f"Duplicate source for exam/domain {pair}")
        files[pair] = path

    expected = {(exam, domain) for exam in range(1, 6) for domain in range(1, 8)}
    require(set(files) == expected, f"Incorrect exam/domain coverage: missing={expected-set(files)}")

    prepared = {}
    all_ids = set()
    for exam in range(1, 6):
        print(f"=== EXAM {exam:02d} ===")
        master = []
        for domain_number, (name, expected_scored, expected_unscored) in DOMAIN_SPECS.items():
            path = files[(exam, domain_number)]
            questions = parse_file(path, name, exam)
            counts = Counter(q["unscored"] for q in questions)
            scored, unscored = counts[False], counts[True]
            require(
                (scored, unscored) == (expected_scored, expected_unscored),
                f"{path.name}: expected {expected_scored} scored + {expected_unscored} unscored; found {scored} + {unscored}",
            )
            for q in questions:
                require(q["id"] not in all_ids, f"Duplicate ID across files: {q['id']}")
                all_ids.add(q["id"])
            master.extend(questions)
            print(f"Domain {domain_number}: {len(questions)} total | {scored} scored + {unscored} unscored | PASS")
        require(len(master) == 180, f"Exam {exam:02d}: expected 180 questions, found {len(master)}")
        require(sum(not q["unscored"] for q in master) == 150, f"Exam {exam:02d}: scored count mismatch")
        filename = f"nha-ccma_exam_{exam:02d}.json"
        prepared[filename] = {"questions": master}
        print(f"PASS | {filename} | 180 questions\n")

    require(len(all_ids) == 900, f"Expected 900 unique IDs, found {len(all_ids)}")
    if not validate_only:
        output_dir.mkdir(parents=True, exist_ok=True)
        for filename, data in prepared.items():
            (output_dir / filename).write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
    print("=== FINAL AUDIT ===")
    print("PASS | 35 TXT files | 900 unique questions")
    print("PASS | 750 scored + 150 unscored")
    print("PASS | 5 master JSONs " + ("validated (not written)" if validate_only else "generated"))
    print("NO CONFIG CHANGES | NO GIT PUSH")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate-only", action="store_true", help="Validate TXT inputs without writing JSON")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    try:
        build(root, args.validate_only)
    except (SourceError, OSError) as exc:
        print(f"IMPORT FAILED | {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
