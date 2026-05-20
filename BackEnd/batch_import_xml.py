"""
batch_import_xml.py
====================
Production-grade batch importer for KLI/KEA-BASIC XML files (Kluwer Arbitration format).

Usage:
    python batch_import_xml.py --folder "C:\\Users\\AbineshSrinivasan.S\\Downloads\\kli_sample_xmls"
    python batch_import_xml.py --folder "C:\\path\\to\\xmls" --limit 5   # Test with 5 files first

What it does:
    1. Scans the given folder for all .xml files
    2. Parses the KEA-BASIC XML schema to extract the case title, date, parties, case number
    3. Converts the full legal body text (<juris-text>) into clean HTML
    4. Saves the HTML to BackEnd/media/documents/
    5. Creates a LegalDocument DB record (skips duplicates automatically)
    6. Triggers the full AI pipeline (FAISS + KeyBERT + Mistral) in a background thread

Author: Legal Authflow AI System
"""

import os
import sys
import django
import argparse
import threading
import time
import shutil
from pathlib import Path
from xml.etree import ElementTree as ET

# ── Django Setup ────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "legal_backend.settings")
django.setup()

from core.models import LegalDocument
from core.extract_script import run_extraction_process

# ──────────────────────────────────────────────────────────────────────────────
# MEDIA OUTPUT DIRECTORY
# ──────────────────────────────────────────────────────────────────────────────
MEDIA_DOCS_DIR = BASE_DIR / "media" / "documents"
MEDIA_DOCS_DIR.mkdir(parents=True, exist_ok=True)

MEDIA_SOURCE_DIR = BASE_DIR / "media" / "source_xmls"
MEDIA_SOURCE_DIR.mkdir(parents=True, exist_ok=True)

MEDIA_TEXT_DIR = BASE_DIR / "media" / "text_exports"
MEDIA_TEXT_DIR.mkdir(parents=True, exist_ok=True)


def safe_text(element) -> str:
    """Recursively collapse all text content inside an XML element, stripping tags."""
    if element is None:
        return ""
    parts = []
    if element.text:
        parts.append(element.text.strip())
    for child in element:
        child_text = safe_text(child)
        if child_text:
            parts.append(child_text)
        if child.tail:
            parts.append(child.tail.strip())
    return " ".join(p for p in parts if p)


def extract_metadata(root) -> dict:
    """
    Parse the KEA-BASIC XML header to extract structured case metadata.
    This gives the document a rich identity in the database.
    """
    meta = {
        "case_id": "",
        "title": "",
        "case_number": "",
        "case_date": "",
        "claimant": "",
        "respondent": "",
        "organization": "",
    }

    # Top-level caselaw ID attribute
    caselaw = root.find(".//caselaw")
    if caselaw is not None:
        meta["case_id"] = caselaw.get("id", "")

    # Title from frontmatter
    title_el = root.find(".//frontmatter/title")
    if title_el is not None and title_el.text:
        meta["title"] = title_el.text.strip()

    # Structured juris metadata — use the ACTIVE (non-commented) block
    juris_desc = root.find(".//juris/juris-description")
    if juris_desc is None:
        juris_desc = root.find(".//juris-description")

    if juris_desc is not None:
        # Case name
        juris_name = juris_desc.find("juris-name")
        if juris_name is not None:
            meta["title"] = safe_text(juris_name) or meta["title"]

        # Case date
        juris_date = juris_desc.find("juris-date")
        if juris_date is not None:
            raw_date = juris_date.get("value", "")
            if len(raw_date) == 8:
                meta["case_date"] = f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}"

        # Case number (ICSID, ICC, etc.)
        juris_num = juris_desc.find("juris-number")
        if juris_num is not None and juris_num.text:
            meta["case_number"] = juris_num.text.strip()

        # Arbitration body
        org = juris_desc.find(".//organization")
        if org is not None and org.text:
            meta["organization"] = org.text.strip()

        # Claimant / Respondent
        for party in juris_desc.findall(".//juris-party"):
            role = party.get("role", "")
            name_el = party.find("name")
            if name_el is not None:
                name = safe_text(name_el)
                if role == "claimant":
                    meta["claimant"] = name
                elif role == "defendant":
                    meta["respondent"] = name

    return meta


def xml_to_html(root, meta: dict) -> str:
    """
    Converts KEA-BASIC XML content into a structured HTML with semantic classes.
    Captures <number> tags and prepends them to headers/items.
    """
    output_lines = ["<html><body>"]
    output_lines.append('<p class="text">Click here to access the original PDF</p>')

    def process_node(node, parent_class="text"):
        tag = node.tag.split('}')[-1] if '}' in node.tag else node.tag
        
        # 1. Capture content from specific tags
        if tag in ["title", "heading"]:
            text = safe_text(node)
            if text:
                output_lines.append(f'<p class="section-header"><b>{text}</b></p>')
            return

        if tag == "number":
            # Let the parent handle the number if possible
            return

        if tag == "p":
            # Check for a number sibling/child
            num_el = node.find("number")
            prefix = f"{safe_text(num_el)} " if num_el is not None else ""
            text = safe_text(node)
            if text:
                # Heuristic: Short bolded paragraphs are often headers
                is_header = node.get("type") == "center" or len(text) < 100
                cls = "section-header" if is_header else "text"
                output_lines.append(f'<p class="{cls}">{prefix}{text}</p>')
            return

        if tag == "item":
            num_el = node.find("number")
            prefix = f"{safe_text(num_el)} " if num_el is not None else ""
            text = safe_text(node)
            if text:
                output_lines.append(f'<p class="list-item">{prefix}{text}</p>')
            return

        # 2. Handle generic sections/lists by recursing
        for child in node:
            process_node(child)

    # Find the main text body
    juris_texts = root.findall(".//juris-text")
    if not juris_texts:
        main_body = root.find(".//body") or root
        process_node(main_body)
    else:
        for jt in juris_texts:
            process_node(jt)

    output_lines.append("</body></html>")
    return "\n".join(output_lines)


def process_xml_file(xml_path: Path, index: int, total: int):
    """Full pipeline for a single XML file."""
    print(f"\n[{index}/{total}] Processing: {xml_path.name}")

    # ── 1. Parse XML ────────────────────────────────────────────────────────────
    try:
        tree = ET.parse(str(xml_path))
        root = tree.getroot()
    except ET.ParseError as e:
        print(f"  [FAIL] XML parse error: {e} — skipping.")
        return

    # ── 2. Extract metadata ─────────────────────────────────────────────────────
    meta = extract_metadata(root)
    doc_name = meta["case_id"] or xml_path.stem
    display_name = f"{doc_name}.xml"

    # ── 3. Skip duplicates ──────────────────────────────────────────────────────
    if LegalDocument.objects.filter(name=display_name).exists():
        print(f"  [SKIP] Already in DB — skipping '{display_name}'")
        return

    # ── 4. Convert to HTML ──────────────────────────────────────────────────────
    html_content = xml_to_html(root, meta)

    # Validate that we actually extracted meaningful text
    if len(html_content.replace("<html><body>", "").replace("</body></html>", "").strip()) < 200:
        print(f"  [WARN] Very little text extracted from '{xml_path.name}' — skipping (possibly empty).")
        return

    # ── 5. Save HTML to media/documents ─────────────────────────────────────────
    html_filename = f"{doc_name}_ocr.html"
    html_path = MEDIA_DOCS_DIR / html_filename

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)

    # ── 5b. Save Source XML and Text Export ─────────────────────────────────────
    source_filename = xml_path.name
    source_dest_path = MEDIA_SOURCE_DIR / source_filename
    shutil.copy2(xml_path, source_dest_path)

    # Generate clean text for export (reuse safe_text on main body)
    juris_texts = root.findall(".//juris-text")
    if not juris_texts:
        main_body = root.find(".//body") or root
        raw_text = safe_text(main_body)
    else:
        raw_text = "\n\n".join(safe_text(jt) for jt in juris_texts)

    text_filename = f"{doc_name}.txt"
    text_path = MEDIA_TEXT_DIR / text_filename
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(raw_text)

    print(f"  [OK] HTML saved: {html_filename}")
    print(f"  [OK] Source saved: {source_filename}")
    print(f"  [OK] Text export saved: {text_filename}")

    # ── 6. Create DB record ──────────────────────────────────────────────────────
    try:
        doc = LegalDocument.objects.create(
            name=display_name,
            file=f"documents/{html_filename}",
            source_file=f"source_xmls/{source_filename}",
            text_file=f"text_exports/{text_filename}",
            file_type="html",
            status="Queued",
        )
        print(f"  [DB] Record created: ID={doc.id}, Name={display_name}")
    except Exception as e:
        print(f"  [FAIL] DB creation error: {e}")
        return

    # ── 7. Trigger AI pipeline sequentially (to avoid API rate limits) ────────
    print(f"  [START] Triggering AI pipeline for {display_name}...")
    try:
        run_extraction_process(doc.id)
        print(f"  [OK] Finished AI pipeline for {display_name}")
    except Exception as e:
        print(f"  [FAIL] AI extraction error for {display_name}: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Batch import KLI/KEA-BASIC XML legal documents into the Legal Authflow pipeline."
    )
    parser.add_argument(
        "--folder",
        required=True,
        help="Absolute path to the folder containing .xml files"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Optional: limit the number of files to process (0 = no limit, for testing use --limit 10)"
    )
    args = parser.parse_args()

    xml_folder = Path(args.folder)
    if not xml_folder.exists():
        print(f"[FAIL] Folder not found: {xml_folder}")
        sys.exit(1)

    xml_files = sorted(xml_folder.glob("*.xml"))
    if not xml_files:
        print(f"[FAIL] No .xml files found in: {xml_folder}")
        sys.exit(1)

    if args.limit > 0:
        xml_files = xml_files[:args.limit]
        print(f"[WARN] Limit set: processing only first {args.limit} files.")

    total = len(xml_files)
    print(f"\n{'='*70}")
    print(f"  Legal Authflow XML Batch Importer")
    print(f"  Folder : {xml_folder}")
    print(f"  Found  : {total} XML files")
    print(f"{'='*70}\n")

    start = time.time()
    for i, xml_file in enumerate(xml_files, start=1):
        process_xml_file(xml_file, i, total)

    elapsed = round(time.time() - start, 1)
    print(f"\n{'='*70}")
    print(f"  [OK] Batch import complete! {total} files processed in {elapsed}s")
    print(f"  Check your Django dashboard UI to watch results!")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    main()
