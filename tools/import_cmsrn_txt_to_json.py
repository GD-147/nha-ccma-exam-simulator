#!/usr/bin/env python3

from pathlib import Path
import argparse
import json
import random
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
IMPORTS = ROOT / "imports" / "cmsrn"
DATA = ROOT / "packs" / "cmsrn" / "data"

SPECS = [
    {
        "code": "PCM",
        "file": "CMSRN_Practice_Exam_01_PCM.txt",
        "domain": "Patient/Care Management",
        "total": 48, "scored": 40, "pilot": 8,
    },
    {
        "code": "NTC",
        "file": "cmsrn_exam_01_domain_2_nursing_teamwork_collaboration.txt",
        "domain": "Nursing Teamwork and Collaboration",
        "total": 31, "scored": 26, "pilot": 5,
    },
    {
        "code": "EIC",
        "file": "cmsrn_exam_01_domain_3_elements_interprofessional_care.txt",
        "domain": "Elements of Interprofessional Care",
        "total": 25, "scored": 21, "pilot": 4,
    },
    {
        "code": "HPC",
        "file": "cmsrn_exam_01_domain_4_holistic_patient_care.txt",
        "domain": "Holistic Patient Care",
        "total": 23, "scored": 19, "pilot": 4,
    },
    {
        "code": "PRC",
        "file": "cmsrn_exam_01_domain_5_professional_concepts.txt",
        "domain": "Professional Concepts",
        "total": 23, "scored": 19, "pilot": 4,
    },
]

def clean(s):
    return re.sub(r"\s+", " ", s.strip())

def parse_bool(value):
    value = value.strip().lower()
    if value == "true":
        return True
    if value == "false":
        return False
    raise ValueError(f"Invalid boolean: {value}")

def parse_questions(text, spec):
    if "PART A, QUESTIONS" not in text:
        raise ValueError("missing PART A, QUESTIONS")
    if "PART B, ANSWER KEY AND EXPLANATIONS" not in text:
        raise ValueError("missing PART B, ANSWER KEY AND EXPLANATIONS")

    q_area = text.split("PART A, QUESTIONS", 1)[1].split(
        "PART B, ANSWER KEY AND EXPLANATIONS", 1
    )[0]

    pattern = re.compile(
        rf"(?m)^(CMSRN-{spec['code']}01-\d{{3}})\s*$"
    )
    matches = list(pattern.finditer(q_area))

    questions = []

    for i, m in enumerate(matches):
        qid = m.group(1)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(q_area)
        body = q_area[m.end():end].strip()
        lines = body.splitlines()

        def get_field(name):
            prefix = name + ":"
            for line in lines:
                if line.startswith(prefix):
                    return line[len(prefix):].strip()
            raise ValueError(f"{qid}: missing {name}")

        domain = get_field("Domain")
        category = get_field("Category")
        qtype = get_field("Type")
        unscored = parse_bool(get_field("Unscored"))
        scenario_based = parse_bool(get_field("Scenario-Based"))

        try:
            sc_idx = lines.index("Scenario Context:")
        except ValueError:
            raise ValueError(f"{qid}: missing Scenario Context:")

        try:
            prompt_idx = lines.index("Prompt:")
        except ValueError:
            raise ValueError(f"{qid}: missing Prompt:")

        if prompt_idx <= sc_idx:
            raise ValueError(f"{qid}: malformed scenario/prompt order")

        scenario = "\n".join(lines[sc_idx + 1:prompt_idx]).strip()
        if scenario.lower() == "none":
            scenario = ""

        tail = lines[prompt_idx + 1:]

        option_positions = []
        for pos, line in enumerate(tail):
            if re.match(r"^[A-D]\)\s*", line):
                option_positions.append(pos)

        if len(option_positions) != 4:
            raise ValueError(
                f"{qid}: expected exactly 4 choices A-D; found {len(option_positions)}"
            )

        first_option = option_positions[0]
        prompt = "\n".join(tail[:first_option]).strip()

        if not prompt:
            raise ValueError(f"{qid}: empty Prompt")

        choices = {}

        for j, pos in enumerate(option_positions):
            letter = tail[pos][0]
            option_end = (
                option_positions[j + 1]
                if j + 1 < len(option_positions)
                else len(tail)
            )

            first_line = re.sub(r"^[A-D]\)\s*", "", tail[pos]).strip()
            continuation = [
                x.strip() for x in tail[pos + 1:option_end] if x.strip()
            ]

            value = " ".join([first_line] + continuation).strip()
            choices[letter] = value

        if list(choices) != ["A", "B", "C", "D"]:
            raise ValueError(f"{qid}: choices must be A, B, C, D")

        questions.append({
            "id": qid,
            "domain": domain,
            "category": category,
            "type": qtype,
            "unscored": unscored,
            "isScenarioBased": scenario_based,
            "scenarioContext": scenario,
            "prompt": prompt,
            "choices": choices,
        })

    return questions

def parse_answer_key(text):
    part = text.split("PART B, ANSWER KEY AND EXPLANATIONS", 1)[1]

    answers = {}

    rx = re.compile(
        r"^(CMSRN-[A-Z]+01-\d{3}), Correct: ([A-D]), "
        r"Correct Answer: (.*?), Explanation: (.+)$"
    )

    for raw in part.splitlines():
        line = raw.strip()
        if not line:
            continue

        m = rx.match(line)
        if not m:
            continue

        qid, correct, correct_text, explanation = m.groups()

        if qid in answers:
            raise ValueError(f"duplicate answer-key entry: {qid}")

        answers[qid] = {
            "correct": correct,
            "correctAnswer": correct_text.strip(),
            "explanation": explanation.strip(),
        }

    return answers

def validate_file(spec):
    path = IMPORTS / spec["file"]

    if not path.exists():
        raise ValueError(f"MISSING FILE: {path.name}")

    text = path.read_text(encoding="utf-8")

    questions = parse_questions(text, spec)
    answers = parse_answer_key(text)

    errors = []

    if len(questions) != spec["total"]:
        errors.append(
            f"question count {len(questions)} != expected {spec['total']}"
        )

    ids = [q["id"] for q in questions]

    expected_ids = [
        f"CMSRN-{spec['code']}01-{n:03d}"
        for n in range(1, spec["total"] + 1)
    ]

    if ids != expected_ids:
        errors.append("ID sequence is not exact/continuous")

    scored = sum(not q["unscored"] for q in questions)
    pilot = sum(q["unscored"] for q in questions)

    if scored != spec["scored"]:
        errors.append(
            f"scored count {scored} != expected {spec['scored']}"
        )

    if pilot != spec["pilot"]:
        errors.append(
            f"pilot count {pilot} != expected {spec['pilot']}"
        )

    for q in questions:
        qid = q["id"]

        if q["domain"] != spec["domain"]:
            errors.append(
                f"{qid}: domain '{q['domain']}' != '{spec['domain']}'"
            )

        if q["type"].lower() != "mcq":
            errors.append(f"{qid}: Type must be mcq")

        if q["isScenarioBased"] and not q["scenarioContext"]:
            errors.append(
                f"{qid}: Scenario-Based true but Scenario Context empty"
            )

        if not q["isScenarioBased"] and q["scenarioContext"]:
            errors.append(
                f"{qid}: Scenario-Based false but Scenario Context not empty"
            )

        if qid not in answers:
            errors.append(f"{qid}: missing answer key")
            continue

        key = answers[qid]
        letter = key["correct"]

        if letter not in q["choices"]:
            errors.append(f"{qid}: invalid correct letter {letter}")
            continue

        actual = clean(q["choices"][letter])
        stated = clean(key["correctAnswer"])

        if actual != stated:
            errors.append(
                f"{qid}: Correct Answer text mismatch\n"
                f"  OPTION: {actual}\n"
                f"  KEY:    {stated}"
            )

        if not key["explanation"]:
            errors.append(f"{qid}: explanation missing")

    extra_keys = sorted(set(answers) - set(ids))
    if extra_keys:
        errors.append(
            "answer key contains unknown IDs: " + ", ".join(extra_keys)
        )

    if len(answers) != spec["total"]:
        errors.append(
            f"answer-key count {len(answers)} != expected {spec['total']}"
        )

    if errors:
        raise ValueError(
            f"\n{path.name}: validation failed:\n- "
            + "\n- ".join(errors)
        )

    for q in questions:
        a = answers[q["id"]]
        q["correct"] = a["correct"]
        q["correctAnswer"] = a["correctAnswer"]
        q["explanation"] = a["explanation"]

    print(
        f"VALID | {path.name} | "
        f"{len(questions)} total | {scored} scored | {pilot} pilot"
    )

    return questions

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate-only", action="store_true")
    args = ap.parse_args()

    all_questions = []
    seen = set()

    for spec in SPECS:
        qs = validate_file(spec)

        for q in qs:
            if q["id"] in seen:
                raise ValueError(f"duplicate global ID: {q['id']}")
            seen.add(q["id"])

        all_questions.extend(qs)

    total = len(all_questions)
    scored = sum(not q["unscored"] for q in all_questions)
    pilot = sum(q["unscored"] for q in all_questions)

    if total != 150:
        raise ValueError(f"MASTER total {total} != 150")
    if scored != 125:
        raise ValueError(f"MASTER scored {scored} != 125")
    if pilot != 25:
        raise ValueError(f"MASTER pilot {pilot} != 25")

    print()
    print(
        f"MASTER VALID | {total} total | "
        f"{scored} scored | {pilot} pilot"
    )

    if args.validate_only:
        print("VALIDATION ONLY — no JSON written")
        return

    # Deterministic mixing so Full-Length is not grouped by domain.
    rnd = random.Random(1001)
    rnd.shuffle(all_questions)

    DATA.mkdir(parents=True, exist_ok=True)
    out = DATA / "cmsrn_exam_01.json"

    out.write_text(
        json.dumps(all_questions, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8"
    )

    print(f"CREATED | {out}")
    print(
        "FULL-LENGTH | 150 questions | "
        "125 scored | 25 pilot/unscored"
    )

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
