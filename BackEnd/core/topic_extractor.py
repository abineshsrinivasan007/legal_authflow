import faiss,random,hashlib,json,os as _os
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
api_key = getattr(_config3, "api_key", "7vnJKsu6pd6wv9twn6komy9bYC5s6jKW")

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

def chunk_text(text, chunk_size=800):

    words = text.split()

    chunks = []

    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i:i+chunk_size])
        chunks.append(chunk)

    return chunks

def aggregate_topics(chunk_topics,topic_count):

    counter = Counter()

    for topics_list in chunk_topics:
        counter.update(topics_list)

    return [t[0] for t in counter.most_common(topic_count)]


def embed_text(text):

    response = client.embeddings.create(
            model="mistral-embed",
            inputs=text
        )

    return response.data[0].embedding

import time

def get_embeddings(text_list):
    embeddings=[]
    for i, text in enumerate(text_list):
        retries = 3
        while retries > 0:
            try:
                response = client.embeddings.create(
                        model="mistral-embed",
                        inputs=[text]
                    )
                for d in response.data:
                    embeddings.append(d.embedding)
                time.sleep(1.2) # Sleep to respect Mistral 1 RPS rate limit
                break
            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "Rate limit" in err_msg:
                    print(f"Rate limit hit! Sleeping for 5 seconds... (Retries left: {retries-1})")
                    time.sleep(5)
                    retries -= 1
                else:
                    print(f"Embedding error for chunk: {e}")
                    break
    return embeddings

def search_topics(embedding, top_k=10, distance_threshold=600):
    """
    Search FAISS index for closest topics.
    distance_threshold: Only accept matches where L2 distance < threshold.
    Higher = more permissive. Lower = more strict (fewer but more accurate results).
    """
    if index is None:
        return []
    vector = np.array([embedding]).astype("float32")

    distances, indices = index.search(vector, top_k)

    # Filter by distance — reject poor matches (too far from document content)
    matched = []
    for dist, idx in zip(distances[0], indices[0]):
        if idx == -1:
            continue  # FAISS returns -1 for empty slots
        if dist < distance_threshold:
            matched.append(topics[idx])
        else:
            pass  # too far away — skip this topic (prevents false positives)

    return matched

def clean_html(html):

    soup = BeautifulSoup(html, "html.parser")

    for tag in soup(["script","style"]):
        tag.decompose()

    text = soup.get_text(separator=" ")

    return " ".join(text.split())

def get_master_extraction(html):
    """
    MASTER STEP: Use the complex prompt from config3.py to perform 
    the initial intelligent extraction from raw HTML.
    """
    import sys, importlib.util, json, time
    from mistralai.models.sdkerror import SDKError

    # ... import logic ...
    config3_path = _os.path.join(_BASE_DIR, "..", "config3.py") #
    config3_path = _os.path.abspath(config3_path)
    spec = importlib.util.spec_from_file_location("config3", config3_path)
    config3_mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(config3_mod)
    # Increased from 15000 to 100000 to handle larger documents and ensure AI sees more than just the (often long) frontmatter.
    max_chars = 100000
    
    master_prompt = config3_mod.prompt
    
    print(f"[Master] Sending {min(len(html), max_chars)} chars to AI (Total: {len(html)})")
    full_prompt = f"{master_prompt}\n\nDocument HTML:\n{html[:max_chars]}"

    retries = 3
    while retries > 0:
        try:
            response = client.chat.complete(
                model="mistral-large-latest",
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
            # Handle 503/502/500 Temporary Server Errors
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



def batch_embed_and_search(concepts):
    """
    OPTIMIZED: Embed ALL concepts in ONE Mistral API call (no per-concept sleep),
    then search FAISS for each embedding vector.
    Much faster than one-by-one embedding.
    """
    if not concepts or index is None:
        return []
    try:
        # Single batched embedding call for all concepts at once
        response = client.embeddings.create(
            model="mistral-embed",
            inputs=concepts  # All concepts in one request
        )
        all_matches = []
        for item in response.data:
            matches = search_topics(item.embedding, top_k=5)
            all_matches.extend(matches)
        print(f"[FAISS] Batched {len(concepts)} concepts → found {len(all_matches)} raw matches")
        return all_matches
    except Exception as e:
        print(f"[FAISS] Batch embed failed: {e}")
        return []




def analyze_document(html):
    """
    THE ULTIMATE HYBRID PIPELINE
    1. Check Local Cache (Hash-based) → guarantees 100% same results for same file
    2. Master AI (config3 prompt) → extracts structured topics/keywords from HTML
    3. FAISS Grounding → maps AI topics to closest entries in topic_names.txt
    """
    # ── STEP 0: Cache Lookup ──
    h = hashlib.sha256(html.encode("utf-8")).hexdigest()
    cache = _load_cache()
    if h in cache:
        print("[Hybrid] --> Cache Hit! Returning identical results for this file.")
        return cache[h]

    print("[Hybrid] Start Master AI + FAISS Pipeline...")

    # ── STEP 1: Master AI Extraction (1 Mistral Chat API call) ──
    master_data = get_master_extraction(html)

    ai_concepts = master_data.get("topics", [])
    raw_keywords = master_data.get("keywords", [])
    suggested    = master_data.get("ai_suggested_topics", [])
    mindmap      = master_data.get("mindmap", [])

    # ── STEP 2: FAISS Grounding (1 batched Mistral Embed API call) ──
    print(f"[Hybrid] Grounding {len(ai_concepts)} AI concepts via FAISS...")
    final_topics = []
    if ai_concepts:
        try:
            response = client.embeddings.create(model="mistral-embed", inputs=ai_concepts)
            for i, item in enumerate(response.data):
                # Find top 5 matches to allow fallback if the top match is already used
                matches = search_topics(item.embedding, top_k=5)
                # Pick the first match that isn't already a duplicate
                found_grounded = False
                for match in matches:
                    if match not in final_topics:
                        final_topics.append(match)
                        found_grounded = True
                        break
                
                # FALLBACK: If FAISS grounding failed (e.g. non-English doc or unique domain),
                # we MUST still return the AI concept so the user sees results.
                if not found_grounded:
                    raw_concept = ai_concepts[i]
                    if raw_concept not in final_topics:
                        final_topics.append(raw_concept)
        except Exception as e:
            print(f"[FAISS] Batch embed failed: {e}")

    # ── STEP 3: Robust Fallback for 0 Topics ──
    if not final_topics:
        print("[Hybrid] No topics found via official headers. Harvesting from Mindmap...")
        # Grab unique child nodes from mindmap relationships
        mm_nodes = []
        for item in mindmap:
            name = item.get("name", "")
            if name and name not in ["Root", "Global Legal Topics"] and name not in mm_nodes:
                mm_nodes.append(name)
        
        # Take the top ones as topics
        final_topics = mm_nodes[:10]

    # Ultimate Safety
    if not final_topics:
        final_topics = ["General Legal Document Analysis"]

    print(f"[Hybrid] ✅ Done → Exact Topics: {len(final_topics)}, Keywords: {len(raw_keywords[:20])}")

    result = {
        "topics":              final_topics,
        "keywords":            raw_keywords[:20],
        "mindmap":             mindmap,
        "ai_suggested_topics": suggested
    }
    
    # ── STEP 4: Save to Cache ──
    cache[h] = result
    _save_cache(cache)
    
    return result