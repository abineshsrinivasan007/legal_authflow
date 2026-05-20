import time
import os
import json
import re
import hashlib
from pathlib import Path
from django.utils import timezone
from .models import LegalDocument

# ── API key from environment only — never hardcode ──────────────────────────
# Run in terminal before starting Django:
#   Windows: set MISTRAL_API_KEY=your_new_key_here
#   Linux:   export MISTRAL_API_KEY=your_new_key_here

# Disk-based cache
_CACHE_FILE = os.path.join(os.path.dirname(__file__), "..", "mistral_cache.json")

def _load_cache() -> dict:
    try:
        if os.path.exists(_CACHE_FILE):
            with open(_CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}

def _save_cache(cache: dict):
    try:
        with open(_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2)
    except Exception as e:
        print(f"[cache] Failed to save: {e}")

try:
    from mistralai import Mistral
except ImportError:
    Mistral = None
    print("mistralai library not installed; LLM extraction disabled")

import config3

FAST_EXTRACT = os.environ.get("FAST_EXTRACT", "0") == "1"


def _hash_file(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


from bs4 import BeautifulSoup
from sklearn.feature_extraction.text import TfidfVectorizer
from collections import Counter


# ═══════════════════════════════════════════════════════════════════
# POST-PROCESSING CLEANERS
# ═══════════════════════════════════════════════════════════════════

def is_garbled(text: str) -> bool:
    """Detect broken Cyrillic encoded as Latin gibberish (e.g. 'GHHajineBHHa')."""
    cyrillic_clusters = re.compile(
        r'[CBHAJMKGNPRT]{2,}[iye]|[a-z][BHJMCK][a-z]|'
        r'\b[A-Z][0-9][A-Z]\b|\bp[y6]+[6b]\b|\b[a-z]{1,3}[A-Z]{2,}[a-z]'
    )
    if cyrillic_clusters.search(text):
        return True
    words = text.split()
    garbled = 0
    for w in words:
        alpha = [c for c in w if c.isalpha()]
        if len(alpha) >= 3:
            ur = sum(1 for c in alpha if c.isupper()) / len(alpha)
            if 0.2 < ur < 0.85 and len(alpha) >= 4 and not re.search(r'[aeiouAEIOU]', w):
                garbled += 1
    return (garbled / max(len(words), 1)) > 0.3


_GENERIC_KEYWORDS = {
    'case', 'civil', 'award', 'background', 'measured', 'ratio',
    'december', 'exhibit', 'declaration', 'federation', 'letter',
    'services', 'contract', 'parties', 'claimant', 'defendant', 'usa',
    'filed', 'panel', 'against', 'party', 'costs', 'fees', 'amount',
    'administrative', 'attorney', 'judgment', 'reasonable', 'expenses',
}


def clean_keyword(kw: str) -> str:
    """Strip punctuation noise, drop garbled/generic/short items."""
    kw = kw.strip()
    # Strip surrounding quotes, brackets, punctuation
    kw = re.sub(r'^[\s"\'()\[\]<>]+|[\s"\'(),;:\.\]>]+$', '', kw)
    if len(kw) < 4:
        return ''
    if len(kw) > 70:
        return ''
    # Drop dollar-amount sentences
    if re.search(r'\bUSD\b|\$\d', kw):
        return ''
    if re.match(r'^payment of\b', kw, re.I):
        return ''
    # Drop garbled OCR
    if is_garbled(kw):
        return ''
    # Drop OCR artifacts
    if re.search(r'[<>^\\]|\d\s+ec\s+id|\bTapH\b|\biipn\b', kw):
        return ''
    # Drop generic single words
    if kw.lower() in _GENERIC_KEYWORDS:
        return ''
    return kw


def clean_topic(t: str) -> str:
    """Strip punctuation noise, drop garbled/junk topics."""
    t = t.strip().strip('"\'().,- ')
    if len(t) < 5:
        return ''
    if len(t) > 120:
        return ''
    if is_garbled(t):
        return ''
    # Drop court case numbers (e.g. "1:17-cv-11378-ADB")
    if re.match(r'^\d+:\d+-cv-', t):
        return ''
    # Drop OCR artifact entries
    if re.search(r'[<>{}]', t):
        return ''
    # Drop lines starting with a dash followed by Cyrillic-style name
    if re.match(r'^-[A-Z],', t):
        return ''
    return t


# ═══════════════════════════════════════════════════════════════════
# LEAN HTML FILTER
# ═══════════════════════════════════════════════════════════════════

_EXCLUDE_CLASSES = {"page-header", "page-footer", "footnote", "caption", "table"}
_INCLUDE_CLASSES = {"section-header", "list-item", "text"}
_NOISE_PATTERNS  = [
    r'^Case \d+:\d+-cv-',
    r'^Page \d+ of \d+$',
    r'^\d+\.$',
    r'^[ivxlIVXL]+$',
    r'^\[…\]$',
    r'^…+$',
    r'^\.+$',
    r'^WHEREAS$',
    r'^RECITALS$',
    r'^TABLE OF CONTENTS$',
    r'^LIST OF TABLES$',
    r'^ABBREVIATIONS$',
    r'^Representing the (Claimants|Respondent)$',
    r'^Representation of the Parties$',
]

MAX_LEAN_CHARS = 90_000  # ~22k tokens — safe for mistral-large 128k context


def _build_lean_html(html_content: str) -> str:
    """
    Filter the OCR HTML down to only meaningful structural tags,
    strip known noise, and cap at 90k chars (≈22k tokens).
    """
    soup = BeautifulSoup(html_content, "lxml")
    lean_html = ""

    for tag in soup.find_all('p'):
        classes = set(tag.get('class', []))
        if classes & _EXCLUDE_CLASSES:
            continue
        if not (classes & _INCLUDE_CLASSES):
            continue

        text = tag.get_text(strip=True)
        if not text or len(text) < 3:
            continue

        # Skip known noise patterns
        skip = False
        for pattern in _NOISE_PATTERNS:
            if re.match(pattern, text, re.IGNORECASE):
                skip = True
                break
        if skip:
            continue

        fragment = f'<p class="{" ".join(tag.get("class", []))}">{text}</p>\n'
        if len(lean_html) + len(fragment) > MAX_LEAN_CHARS:
            print(f"[lean] Reached {MAX_LEAN_CHARS:,} char budget — truncating")
            break
        lean_html += fragment

    return lean_html


# ═══════════════════════════════════════════════════════════════════
# MISTRAL EXTRACTION  (BUG E FIXED: now returns 6 values always)
# ═══════════════════════════════════════════════════════════════════

def extract_topics_and_keywords_with_mistral(html_path: str):
    """
    Main AI extraction path.
    ALWAYS returns exactly 6 values:
      (n_topics, n_keywords, topics, keywords, mindmap, ai_topics_data)
    This matches the 6-value unpack in run_extraction_process.
    """
    # Safe default — always 6 values so caller never crashes
    _empty = (0, 0, [], [], [], "")

    api_key = os.environ.get("MISTRAL_API_KEY") or getattr(config3, "api_key", "")
    if Mistral is None or not api_key.strip():
        print("Mistral AI or API key not available.")
        return _empty

    try:
        client       = Mistral(api_key=api_key)
        html_content = Path(html_path).read_text(encoding="utf-8")

        lean_html = _build_lean_html(html_content)

        if len(lean_html.strip()) < 50:
            print("[WARN] lean_html is empty after filtering — skipping Mistral call")
            return _empty

        print(f"Sending {len(lean_html):,} chars (~{len(lean_html)//4:,} tokens) to Mistral...")

        messages = [
            {"role": "system", "content": config3.prompt},
            {"role": "user",   "content": lean_html},
        ]

        chat_response = client.chat.complete(
            model="mistral-large-latest",
            messages=messages,
            temperature=0.0,
            response_format={"type": "json_object"},
            random_seed=42,
        )

        content = chat_response.choices[0].message.content.strip()
        obj      = json.loads(content)

        raw_topics       = obj.get("topics",  [])
        raw_keywords     = obj.get("keywords", [])
        raw_ai_suggested = obj.get("ai_suggested_topics", [])
        mindmap          = obj.get("mindmap",  [])

        # ── Post-process: clean noise ────────────────────────────
        topics   = [c for t in raw_topics   if (c := clean_topic(t))]
        keywords = [c for k in raw_keywords if (c := clean_keyword(k))]

        ai_suggested_str = ", ".join(raw_ai_suggested[:5]) if isinstance(raw_ai_suggested, list) \
                           else str(raw_ai_suggested)[:200]

        print(f"[OK] Mistral success: {len(topics)} topics, {len(keywords)} keywords "
              f"(raw: {len(raw_topics)}/{len(raw_keywords)})")

        # 6 return values — fixes the unpack crash
        return len(topics), len(keywords), topics, keywords, mindmap, ai_suggested_str

    except Exception as e:
        print(f"Mistral extraction failed: {e}")
        return _empty


# ═══════════════════════════════════════════════════════════════════
# HTML FALLBACK (improved — uses section-header class, not bold heuristic)
# ═══════════════════════════════════════════════════════════════════

def extract_topics_and_keywords_from_html(html_path):
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html = f.read()
    except Exception as e:
        print(f"Error reading HTML: {e}")
        return 0, 0, [], []

    soup = BeautifulSoup(html, "lxml")
    topics = []
    seen   = set()

    # 1. Trust section-header class — it is reliable
    for tag in soup.find_all("p", class_="section-header"):
        text = clean_topic(tag.get_text(strip=True))
        if text and text not in seen:
            seen.add(text)
            topics.append(text)

    # 2. Numbered headings from list-items as secondary signal
    for tag in soup.find_all("p", class_="list-item"):
        text = tag.get_text(strip=True)
        if re.match(r'^[IVX]+\.|^\d+\.', text) and len(text) > 10:
            cleaned = clean_topic(text)
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                topics.append(cleaned)

    # TF-IDF keywords — with post-processing
    full_text = soup.get_text()
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), max_features=2000)
    tfidf      = vectorizer.fit_transform([full_text])
    scores     = zip(vectorizer.get_feature_names_out(), tfidf.toarray()[0])
    raw_kw     = [k for k, _ in sorted(scores, key=lambda x: x[1], reverse=True)[:40]]
    keywords   = [c for k in raw_kw if (c := clean_keyword(k))][:20]

    topics_list = topics or ["General Legal Document"]
    keywords    = keywords or ["document"]

    print(f"HTML fallback: {len(topics_list)} topics, {len(keywords)} keywords")
    return len(topics_list), len(keywords), topics_list, keywords


def extract_topics_and_keywords_from_json(json_path):
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON for extraction: {e}")
        return 0, 0, [], []

    topics    = set()
    full_text = []
    font_sizes = []

    for page in (data.get("pages") or []):
        for box in (page.get("boxes") or []):
            # Use boxclass first (reliable from pymupdf4llm)
            box_class = box.get('boxclass', '')
            for line in (box.get("textlines") or []):
                for span in (line.get("spans") or []):
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    size   = round(span.get("size", 10), 1)
                    is_bold = bool(span.get("flags", 0) & 16)
                    font_sizes.append(size)
                    full_text.append(text)

                    if box_class == 'section-header':
                        cleaned = clean_topic(text)
                        if cleaned:
                            topics.add(cleaned)
                    elif font_sizes:
                        body_size = Counter(font_sizes).most_common(1)[0][0]
                        if (size > body_size + 1.0 or is_bold) and len(text) >= 3 and not text.isdigit():
                            cleaned = clean_topic(text)
                            if cleaned:
                                topics.add(cleaned)

    words      = re.findall(r"\b[a-z]{4,}\b", " ".join(full_text).lower())
    stop_words = {
        'that','with','this','from','have','which','were','been','their',
        'other','there','they','would','into','under','these','upon','between',
        'shall','will','such','also','made','any','some','after','where','when',
        'could','should','about','only','than','over','what','then','because',
    }
    filtered = [w for w in words if w not in stop_words and w not in _GENERIC_KEYWORDS]
    keywords  = [word for word, _ in Counter(filtered).most_common(20)]

    topics_list = sorted(topics) or ["General Legal Document"]
    keywords    = keywords or ["document"]

    print(f"JSON extraction: {len(topics_list)} topics, {len(keywords)} keywords")
    return len(topics_list), len(keywords), topics_list, keywords


# ═══════════════════════════════════════════════════════════════════
# MAIN EXTRACTION PROCESS
# ═══════════════════════════════════════════════════════════════════

def run_extraction_process(document_id):
    try:
        doc = LegalDocument.objects.get(id=document_id)
        doc.status = 'Processing'
        doc.save()

        start_time = time.time()

        # Safe defaults
        ai_topics_data   = ""
        extracted_topics = 0
        extracted_keywords = 0
        topics_list      = []
        keywords_list    = []
        mindmap_data     = []

        pdf_path   = doc.file.path
        output_dir = os.path.dirname(pdf_path)

        from .text_extractor import main as text_extractor_main
        print(f"Starting AI processing for: {pdf_path}")

        try:
            html_path = None
            base_name = os.path.basename(pdf_path)
            pdf_dir   = os.path.dirname(pdf_path)

            if pdf_path.lower().endswith('.html'):
                print("HTML file detected. Bypassing PyMuPDF converter...")
                html_path = pdf_path
            else:
                text_extractor_main(pdf_path, output_dir)
                candidate1 = os.path.join(pdf_dir, base_name.replace('.pdf', '_ocr.html'))
                candidate2 = os.path.join(
                    pdf_dir,
                    base_name.split('.')[0] + "_output",
                    base_name.replace('.pdf', '_ocr.html')
                )
                if os.path.exists(candidate2):
                    html_path = candidate2
                elif os.path.exists(candidate1):
                    html_path = candidate1

            if html_path:
                new_hash = _hash_file(html_path)

                # Cache hit
                if getattr(doc, "html_hash", None) == new_hash and doc.topics_count:
                    print("HTML unchanged — reusing cached results")
                    extracted_topics   = doc.topics_count
                    extracted_keywords = doc.keywords_count
                    topics_list        = doc.topics_list or []
                    keywords_list      = doc.keywords_list or []
                    mindmap_data       = getattr(doc, "mindmap_data", [])
                else:
                    doc.html_hash = new_hash

                    # Scanned PDF guard
                    with open(html_path, 'r', encoding='utf-8', errors='ignore') as _f:
                        _raw_html = _f.read()
                    _soup        = BeautifulSoup(_raw_html, 'lxml')
                    _all_text    = _soup.get_text(separator=' ').strip()
                    _picture_tags = len(_soup.find_all(class_='picture'))
                    _is_scanned  = len(_all_text) < 100 and _picture_tags > 5

                    if _is_scanned:
                        print(f"[WARN] SCANNED PDF: {base_name} — skipping AI pipeline.")
                        doc.status        = 'Scanned PDF'
                        doc.topics_count  = 0
                        doc.keywords_count = 0
                        doc.topics_list   = []
                        doc.keywords_list = []
                        doc.mindmap_data  = []
                        doc.ai_topics     = ''
                        doc.process_time  = round(time.time() - start_time, 2)
                        doc.completed_date = timezone.now()
                        doc.save()
                        return

                    if FAST_EXTRACT:
                        print("FAST_EXTRACT enabled — quick HTML extraction")
                        extracted_topics, extracted_keywords, topics_list, keywords_list = \
                            extract_topics_and_keywords_from_html(html_path)
                        mindmap_data = []

                    else:
                        api_key = os.environ.get("MISTRAL_API_KEY") or getattr(config3, "api_key", "")
                        if api_key.strip() and Mistral is not None:
                            
                            # ── TL Request: Unified Hybrid AI + FAISS Extraction for ALL docs (PDF/XML) ──
                            print(f"--> Using Hybrid AI + FAISS Engine for {doc.file_type.upper()}")
                            from .extract_with_embeddings import analyze_document
                            with open(html_path, 'r', encoding='utf-8') as f:
                                html_content = f.read()
                            
                            extraction_res = analyze_document(html_content)
                            topics_list = extraction_res.get("topics", [])
                            keywords_list = extraction_res.get("keywords", [])
                            mindmap_data = extraction_res.get("mindmap", [])
                            ai_topics_data = extraction_res.get("ai_suggested_topics", "")
                            
                            # ── TL: Save to topic_master + document_topics (FAST bulk) ──
                            from .models import TopicMaster, DocumentTopic
                            topic_objs = []
                            for t_name in topics_list:
                                topic_obj, _ = TopicMaster.objects.get_or_create(name=t_name)
                                topic_objs.append(topic_obj)
                            # Single bulk DB call — much faster than N individual .add() calls
                            DocumentTopic.objects.filter(Document_ID=doc).delete()
                            DocumentTopic.objects.bulk_create([
                                DocumentTopic(Document_ID=doc, Topic_Id=t)
                                for t in topic_objs
                            ], ignore_conflicts=True)
                            
                            extracted_topics = len(topics_list)
                            extracted_keywords = len(keywords_list)


                            if topics_list or keywords_list:
                                print(f"Mistral extracted {extracted_topics} topics, "
                                      f"{extracted_keywords} keywords")

                    # Fallback if Mistral returned nothing
                    if not topics_list and not keywords_list:
                        print("Falling back to local extractor...")
                        json_path = os.path.join(
                            pdf_dir,
                            base_name.split('.')[0] + "_output",
                            base_name.replace('.pdf', '.json')
                        )
                        if os.path.exists(json_path):
                            extracted_topics, extracted_keywords, topics_list, keywords_list = \
                                extract_topics_and_keywords_from_json(json_path)
                            mindmap_data = []
                        else:
                            extracted_topics, extracted_keywords, topics_list, keywords_list = \
                                extract_topics_and_keywords_from_html(html_path)
                            mindmap_data = []
            else:
                print(f"HTML file not found")
                extracted_topics, extracted_keywords, topics_list, keywords_list, \
                    mindmap_data, ai_topics_data = 0, 0, [], [], [], ""

            doc.status = 'Completed'

        except Exception as script_error:
            print(f"Extraction failed: {script_error}")
            doc.status = 'Failed'

        doc.topics_count   = extracted_topics
        doc.keywords_count = extracted_keywords
        doc.topics_list    = topics_list
        doc.keywords_list  = keywords_list
        doc.mindmap_data   = mindmap_data
        doc.ai_topics      = ai_topics_data
        doc.process_time   = round(time.time() - start_time, 2)
        doc.completed_date = timezone.now()
        doc.save()

    except Exception as e:
        print(f"Error processing document {document_id}: {e}")
        try:
            doc = LegalDocument.objects.get(id=document_id)
            doc.status = 'Failed'
            doc.save()
        except Exception:
            pass
