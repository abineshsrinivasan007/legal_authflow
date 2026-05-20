"""
core/blog_utils.py
──────────────────
Extraction trigger for blog articles.
Called automatically by the Scrapy Django pipeline after saving each article.

Mirrors run_extraction_process() from utils.py but works on BlogArticle model.

CREATE this file at:
  D:\\Test_legal_auth\\Legal_Authflow\\BackEnd\\core\\blog_utils.py
"""

import os
import time
import json
import re
import hashlib
from pathlib import Path
from django.utils import timezone

# Reuse the exact same Mistral extraction function from your existing utils.py
from .utils import (
    extract_topics_and_keywords_with_mistral,
    extract_topics_and_keywords_from_html,
)
from .blog_converter import convert_blog_html_to_ocr_html
from .models import BlogArticle


def run_blog_extraction(article_id: int):
    """
    Full pipeline for one blog article:
      1. Read the _ocr.html file saved on disk
      2. Send to Mistral via existing utils pipeline
      3. Save topics + keywords back to BlogArticle DB record

    Called by Scrapy DjangoPipeline after saving the article.
    """
    try:
        article = BlogArticle.objects.get(id=article_id)
        article.status = 'Processing'
        article.save()

        start_time = time.time()

        ocr_html_path = article.ocr_html_path

        if not ocr_html_path or not os.path.exists(ocr_html_path):
            print(f"[blog_utils] _ocr.html not found for article {article_id}: {ocr_html_path}")
            article.status = 'Failed'
            article.save()
            return

        print(f"[blog_utils] Extracting: {article.title}")

        # ── TL Request: Use FAISS Embedding Engine for Blog Scraper ──
        print("[blog_utils] --> Using FAISS Embedding Engine for Blog Article")
        from .extract_with_embeddings import analyze_document
        with open(ocr_html_path, 'r', encoding='utf-8', errors='ignore') as f:
            html_content = f.read()

        faiss_res = analyze_document(html_content)
        topics   = faiss_res.get("topics", [])
        keywords = faiss_res.get("keywords", [])
        mindmap  = faiss_res.get("mindmap", [])
        ai_str   = faiss_res.get("ai_suggested_topics", "")
        n_topics   = len(topics)
        n_keywords = len(keywords)

        # Fallback to HTML extractor if FAISS returned nothing
        if not topics and not keywords:
            print("[blog_utils] FAISS returned nothing — using HTML fallback")
            from .utils import extract_topics_and_keywords_from_html
            n_topics, n_keywords, topics, keywords = \
                extract_topics_and_keywords_from_html(ocr_html_path)
            mindmap = []
            ai_str = ""

        article.topics_count   = n_topics
        article.keywords_count = n_keywords
        article.topics_list    = topics
        article.keywords_list  = keywords
        article.mindmap_data   = mindmap
        article.ai_topics      = ai_str
        article.status         = 'Completed'
        article.process_time   = round(time.time() - start_time, 2)
        article.completed_date = timezone.now()
        article.save()

        # ── TL Request: Unified Relational Mapping for Blogs (NEW) ──
        from .models import TopicMaster, BlogTopic
        topic_objs = []
        for t_name in topics:
            topic_obj, _ = TopicMaster.objects.get_or_create(name=t_name)
            topic_objs.append(topic_obj)
        
        # Clear existing and bulk create new relations
        BlogTopic.objects.filter(Blog_ID=article).delete()
        if topic_objs:
            BlogTopic.objects.bulk_create([
                BlogTopic(Blog_ID=article, Topic_Id=t)
                for t in topic_objs
            ], ignore_conflicts=True)
            print(f"[blog_utils] Created {len(topic_objs)} relational links in blog_topics table.")


        print(f"[blog_utils] Done: {n_topics} topics, {n_keywords} keywords "
              f"in {article.process_time}s")

    except BlogArticle.DoesNotExist:
        print(f"[blog_utils] BlogArticle {article_id} not found")
    except Exception as e:
        print(f"[blog_utils] Error processing article {article_id}: {e}")
        import traceback; traceback.print_exc()
        try:
            article = BlogArticle.objects.get(id=article_id)
            article.status = 'Failed'
            article.save()
        except Exception:
            pass