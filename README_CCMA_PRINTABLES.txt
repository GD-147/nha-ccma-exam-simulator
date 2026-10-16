NHA CCMA EXAM SIMULATOR - 35 PRINTABLE EXAMS + LENA WHITMORE LOGO

Contents:
- packs/nha-ccma/pdf/ccma_practice_exam_01.pdf ... ccma_practice_exam_35.pdf
- packs/nha-ccma/assets/logo.png (new Lena Whitmore PNG)
- tools/ccma_printables_manifest.json
- tools/install_ccma_printables.py

Exam numbering:
01-07: Exam Set 01, Domains 1-7
08-14: Exam Set 02, Domains 1-7
15-21: Exam Set 03, Domains 1-7
22-28: Exam Set 04, Domains 1-7
29-35: Exam Set 05, Domains 1-7

Each PDF contains its domain's scored questions, answer key, and explanations.
Total scored questions in PDFs: 750.
The 150 unscored/pilot questions remain part of the 5 online Full-Length tests.

Install on the Mac in the nha-ccma-exam-simulator repository:
1. Run (while inside the repository):
   /usr/bin/unzip -o ~/Downloads/NHA_CCMA_35_PDF_LOGO_UPDATE.zip -d .
2. Register the PDF links and clear logo cache:
   python3 tools/install_ccma_printables.py
3. Review staged changes before publishing:
   git status --short

After review, commit and push the PDF assets, logo, tools and config.
The installer does NOT push anything to GitHub and does NOT modify exams.
