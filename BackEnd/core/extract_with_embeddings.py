import faiss, hashlib, json, os as _os
import numpy as np
from bs4 import BeautifulSoup
from keybert import KeyBERT
from mistralai import Mistral
from collections import Counter
from pathlib import Path

_BASE_DIR = _os.path.dirname(_os.path.abspath(__file__))
_FAISS_INDEX_PATH = _os.path.join(_BASE_DIR, "topic_index.faiss")
_TOPIC_NAMES_PATH = _os.path.join(_BASE_DIR, "topic_names.txt")
_CACHE_PATH = _os.path.join(_BASE_DIR, "..", "hybrid_cache.json")

# Get API Key from config3 module
import importlib.util
_spec = importlib.util.spec_from_file_location("config3", _os.path.join(_BASE_DIR, "..", "config3.py"))
_config3 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_config3)
api_key = getattr(_config3, "api_key", "")

if not api_key:
    raise RuntimeError("[extract_with_embeddings] MISTRAL API key is empty. Set MISTRAL_API_KEY env var or update config3.py.")

# Initialize client
client = Mistral(api_key=api_key)
kw_model = KeyBERT()

def _load_cache():
    try:
        if _os.path.exists(_CACHE_PATH):
            with open(_CACHE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
    except: pass
    return {}

def _save_cache(data):
    try:
        with open(_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except: pass

try:
    index = faiss.read_index(_FAISS_INDEX_PATH)
    topics = open(_TOPIC_NAMES_PATH).read().splitlines()
    print(f"[FAISS] Loaded {len(topics)} topics from dictionary.")
except Exception as e:
    print(f"Warning: Could not load FAISS index or topic names: {e}")
    index = None
    topics = []


def search_topics(embedding, top_k=10, distance_threshold=600):
    """
    Search FAISS index for closest topics.
    distance_threshold: Only accept matches where L2 distance < threshold.
    """
    if index is None:
        return []
    vector = np.array([embedding]).astype("float32")
    distances, indices = index.search(vector, top_k)
    matched = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx == -1:
            continue
        if dist < distance_threshold:
            matched.append(topics[idx])
    return matched


def clean_html(html):
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    return " ".join(text.split())


def get_master_extraction(html):
    """
    MASTER STEP: Use the prompt from config3.py to perform
    the initial intelligent extraction from raw HTML.
    Uses mistral-small-latest (fast, cost-effective).
    """
    import time
    from mistralai.models.sdkerror import SDKError

    config3_path = _os.path.abspath(_os.path.join(_BASE_DIR, "..", "config3.py"))
    spec = importlib.util.spec_from_file_location("config3", config3_path)
    config3_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config3_mod)

    max_chars = 100000
    master_prompt = config3_mod.prompt

    print(f"[Master] Sending {min(len(html), max_chars)} chars to AI (Total: {len(html)})")
    full_prompt = f"{master_prompt}\n\nDocument HTML:\n{html[:max_chars]}"

    retries = 3
    while retries > 0:
        try:
            response = client.chat.complete(
                model="mistral-small-latest",   # ← fast + works well for extraction
                messages=[{"role": "user", "content": full_prompt}],
                response_format={"type": "json_object"},
                temperature=0.0,
                random_seed=42
            )
            data = json.loads(response.choices[0].message.content)
            print(f"[Master] Extracted: {len(data.get('topics', []))} topics, "
                  f"{len(data.get('keywords', []))} keywords")
            return data

        except SDKError as e:
            if e.status_code in [500, 502, 503, 504, 429]:
                print(f"[Master] Mistral Server Busy (Status {e.status_code}). Retrying in 2s... ({retries-1} left)")
                time.sleep(2)
                retries -= 1
            else:
                print(f"[Master] Fatal AI Error: {e}")
                break
        except Exception as e:
            print(f"[Master] Extraction failed: {e}")
            break

    return {"topics": [], "keywords": [], "ai_suggested_topics": [], "mindmap": []}


def analyze_document(html):
    """
    HYBRID PIPELINE:
    1. Check cache (skip re-processing same file)
    2. Master AI (config3 prompt, mistral-small) → extracts structured topics/keywords
    3. FAISS Grounding → maps AI topics to closest entries in topic_names.txt
    """
    # ── STEP 0: Cache Lookup ──
    h = hashlib.sha256(html.encode("utf-8")).hexdigest()
    cache = _load_cache()
    if h in cache:
        print("[Hybrid] --> Cache Hit! Returning identical results for this file.")
        return cache[h]

    print("[Hybrid] Start Master AI + FAISS Pipeline...")

    # ── STEP 1: Master AI Extraction ──
    master_data = get_master_extraction(html)

    ai_concepts  = master_data.get("topics", [])
    raw_keywords = master_data.get("keywords", [])
    suggested    = master_data.get("ai_suggested_topics", [])
    mindmap      = master_data.get("mindmap", [])

    # ── STEP 2: FAISS Grounding ──
    print(f"[Hybrid] Grounding {len(ai_concepts)} AI concepts via FAISS...")
    final_topics = []
    if ai_concepts:
        try:
            response = client.embeddings.create(model="mistral-embed", inputs=ai_concepts)
            for i, item in enumerate(response.data):
                matches = search_topics(item.embedding, top_k=5)
                found_grounded = False
                for match in matches:
                    if match not in final_topics:
                        final_topics.append(match)
                        found_grounded = True
                        break
                # FALLBACK: Use raw AI concept if FAISS has no match
                if not found_grounded:
                    raw_concept = ai_concepts[i]
                    if raw_concept not in final_topics:
                        final_topics.append(raw_concept)
        except Exception as e:
            print(f"[FAISS] Batch embed failed: {e}")
            # If FAISS embedding fails entirely, use raw AI concepts directly
            final_topics = ai_concepts[:]

    # ── STEP 3: Fallback for 0 topics ──
    if not final_topics:
        print("[Hybrid] No topics found via headers. Harvesting from Mindmap...")
        mm_nodes = []
        for item in mindmap:
            name = item.get("name", "")
            if name and name not in ["Root", "Global Legal Topics"] and name not in mm_nodes:
                mm_nodes.append(name)
        final_topics = mm_nodes[:10]

    if not final_topics:
        final_topics = ["General Legal Document Analysis"]

    print(f"[Hybrid]  Done → Topics: {len(final_topics)}, Keywords: {len(raw_keywords[:20])}")

    result = {
        "topics":              final_topics,
        "keywords":            raw_keywords[:20],
        "mindmap":             mindmap,
        "ai_suggested_topics": suggested
    }

    # ── STEP 4: Save to Cache ONLY when extraction actually worked ──
    if len(final_topics) > 1 or raw_keywords:
        cache[h] = result
        _save_cache(cache)
    else:
        print("[Hybrid]  Skipping cache save — extraction may have failed/fallen back.")

    return result
