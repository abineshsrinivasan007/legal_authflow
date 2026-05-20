"""
core/blog_converter.py
──────────────────────
Converts raw scraped blog HTML into the same _ocr.html format
that your existing utils.py / Mistral pipeline expects.

Blog HTML already has real semantic tags (<h1>, <h2>, <h3>, <p>, <li>)
so we just MAP them to the CSS classes your pipeline understands:

    <h1>  →  class="section-header"
    <h2>  →  class="section-header"
    <h3>  →  class="section-header"
    <h4>  →  class="section-header"
    <p>   →  class="text"
    <li>  →  class="list-item"

No PyMuPDF needed — blog is already clean text, not a scanned PDF.

CREATE this file at:
  D:\\Test_legal_auth\\Legal_Authflow\\BackEnd\\core\\blog_converter.py
"""

from bs4 import BeautifulSoup
import re


# Tags that map to section-header
_HEADER_TAGS = {"h1", "h2", "h3", "h4"}

# Tags to skip entirely (noise)
_SKIP_TAGS = {"script", "style", "form", "iframe", "noscript", "nav",
              "footer", "header", "aside", "button"}

# CSS class patterns to remove (share buttons, newsletter widgets etc.)
_NOISE_CLASS_RE = re.compile(
    r'share|social|newsletter|sidebar|widget|comment|footer|nav|cookie|banner|ad-',
    re.IGNORECASE
)


def _is_noise_tag(tag) -> bool:
    """Return True if this tag is a known noise element to skip."""
    classes = " ".join(tag.get("class", []))
    if _NOISE_CLASS_RE.search(classes):
        return True
    tag_id = tag.get("id", "")
    if _NOISE_CLASS_RE.search(tag_id):
        return True
    return False


def convert_blog_html_to_ocr_html(raw_html: str, title: str = "") -> str:
    """
    Takes raw scraped blog article HTML and returns an _ocr.html string
    in the same format your utils.py pipeline expects.

    Args:
        raw_html : the content_html string saved by Scrapy pipeline
        title    : article title (used as the first section-header if not
                   already present in the HTML)

    Returns:
        str — complete HTML string with section-header / text / list-item classes
    """
    soup = BeautifulSoup(raw_html, "lxml")

    # Remove all noise tags first
    for tag in soup(_SKIP_TAGS):
        tag.decompose()
    for tag in soup.find_all(True):
        if _is_noise_tag(tag):
            tag.decompose()

    output_lines = ["<html><body>"]

    # Inject title as first section-header if provided and not already in HTML
    if title:
        safe_title = title.replace("<", "&lt;").replace(">", "&gt;")
        output_lines.append(f'<p class="section-header"><b>{safe_title}</b></p>')

    for tag in soup.find_all(True):
        tag_name = tag.name.lower() if tag.name else ""

        # Skip container/layout tags — we only want leaf content
        if tag_name in {"div", "article", "section", "main", "span",
                        "figure", "figcaption", "blockquote", "ul", "ol",
                        "table", "tbody", "tr", "td", "th"}:
            continue

        if tag_name in _SKIP_TAGS:
            continue

        text = tag.get_text(separator=" ", strip=True)
        if not text or len(text) < 3:
            continue

        # Escape HTML special chars in text
        safe_text = text.replace("<", "&lt;").replace(">", "&gt;")

        # Preserve existing target classes (e.g. from Scrapy spider)
        existing_classes = set(tag.get("class", []))
        if "section-header" in existing_classes:
            output_lines.append(f'<p class="section-header"><b>{safe_text}</b></p>')
            continue
        elif "list-item" in existing_classes:
            output_lines.append(f'<p class="list-item">{safe_text}</p>')
            continue
        elif "text" in existing_classes:
            output_lines.append(f'<p class="text">{safe_text}</p>')
            continue

        if tag_name in _HEADER_TAGS:
            output_lines.append(f'<p class="section-header"><b>{safe_text}</b></p>')

        elif tag_name == "li":
            output_lines.append(f'<p class="list-item">{safe_text}</p>')

        elif tag_name == "p":
            # Skip very short paragraphs (likely captions or noise)
            if len(text) < 20:
                continue
            output_lines.append(f'<p class="text">{safe_text}</p>')

    output_lines.append("</body></html>")
    return "\n".join(output_lines)