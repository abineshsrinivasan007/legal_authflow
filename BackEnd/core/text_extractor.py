import os
import sys
import glob
import json
import math
import pymupdf
# `pymupdf.layout` triggers a large ONNX model load on import; import only if
# the layout analyser is actually needed.  For the current pipeline we only
# call pymupdf.open()/to_json() so the layout submodule is unnecessary and
# dramatically slows startup.
try:
    import pymupdf.layout
except Exception as e:
    print(f"could not import pymupdf.layout (layout features disabled): {e}")
import pymupdf4llm
import multiprocessing

from pathlib import Path
from copy import deepcopy




# --- helper functions from TL pipeline ---

def pdf_to_json_path(pdf_path: str) -> str:
    return str(Path(pdf_path).with_suffix(".json"))


def save_json(pdf_path, json_path):
    # Pass the path string directly to pymupdf4llm
    doc = pymupdf.open(pdf_path)

    pdf_json_data = pymupdf4llm.to_json(doc)

    if isinstance(pdf_json_data, str):
        data = json.loads(pdf_json_data)
    else:
        data = pdf_json_data

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    return data


def align_span_vertical_coordinates(data):
    """
    Standardizes y0 and y1 for all spans in a textline to the line's
    overall highest and lowest vertical values.
    """
    # Navigate through pages -> boxes -> textlines
    for page in data.get("pages", []):
        for box in page.get("boxes", []):
            textlines = box.get("textlines")
            if not textlines:
                continue

            for line in textlines:
                spans = line.get("spans", [])
                if not spans:
                    continue

                # 1. Collect all y0 (index 1) and y1 (index 3) from all spans in the line
                all_y0s = [span["bbox"][1] for span in spans]
                all_y1s = [span["bbox"][3] for span in spans]

                # 2. Determine the highest (min y) and lowest (max y) bounds
                # In PDF coordinates, lower y values are closer to the top of the page
                top_y = min(all_y0s)
                bottom_y = max(all_y1s)

                # 3. Assign these values to every span in the line
                for span in spans:
                    # Keep x0 (index 0) and x1 (index 2) as they are, update y0 and y1
                    span["bbox"][1] = top_y
                    span["bbox"][3] = bottom_y

                # Optional: Update the parent line's bbox to match the new span alignment
                line["bbox"][1] = top_y
                line["bbox"][3] = bottom_y

    return data


def process_multicolumn_json(data, output_path, gap_threshold=50):

    def merge_lines_in_column(lines, y_tolerance=2.0):
        """Merges lines that appear on the same vertical level (y0, y1)."""
        if not lines:
            return []

        # Sort primarily by y0
        lines.sort(key=lambda x: x['y0'])

        merged = []
        current_group = [lines[0]]

        for i in range(1, len(lines)):
            # Check if the vertical start (y0) is within tolerance of the current group
            if abs(lines[i]['y0'] - current_group[0]['y0']) <= y_tolerance:
                current_group.append(lines[i])
            else:
                # Merge the current group and start a new one
                merged.append(finalize_merge(current_group))
                current_group = [lines[i]]

        merged.append(finalize_merge(current_group))
        return merged

    def finalize_merge(group):
        """Combines multiple span objects into a single line structure."""
        # Sort spans horizontally within the line group
        group.sort(key=lambda x: x['x0'])

        combined_spans = []
        all_x = []
        all_y = []

        for item in group:
            combined_spans.append(item['span_data'])
            all_x.extend([item['span_data']['bbox'][0], item['span_data']['bbox'][2]])
            all_y.extend([item['span_data']['bbox'][1], item['span_data']['bbox'][3]])

        return {
            "bbox": [min(all_x), min(all_y), max(all_x), max(all_y)],
            "spans": combined_spans,
            "wmode": 0,
            "dir": [1.0, 0.0]
        }

    def IsBoxEligibleForSplit(UserBox):
        def collect_horizontal_gaps(box, min_gap=20):
            """
            Collect significant horizontal gaps per line.
            min_gap: filter out normal word spaces
            """

            gaps = []
            text_lines = box.get("textlines", [])
            if not text_lines:
                return gaps
            for textline in box.get("textlines", []):
                spans = textline.get("spans", [])

                if len(spans) < 2:
                    continue

                # Sort left → right
                spans = sorted(
                    [s for s in spans if isinstance(s.get("bbox"), list) and len(s["bbox"]) == 4],
                    key=lambda s: s["bbox"][0]
                )
                for i in range(len(spans) - 1):
                    prev_span = spans[i]
                    next_span = spans[i + 1]

                    prev_x1 = prev_span["bbox"][2]
                    next_x0 = next_span["bbox"][0]

                    gap_width = next_x0 - prev_x1

                    if gap_width > min_gap:
                        gaps.append({
                            "x0": prev_x1,
                            "x1": next_x0,
                            "width": gap_width
                        })

            return gaps

        def find_column_separator(gaps, min_overlap_count=3):
            """
            Find vertical region that overlaps across many gaps.
            """

            if not gaps:
                return None

            # Candidate regions = gap midpoints
            candidates = []

            for gap in gaps:
                mid = (gap["x0"] + gap["x1"]) / 2
                candidates.append(mid)

            # Cluster midpoints (simple grouping)
            candidates.sort()

            clusters = []
            current_cluster = [candidates[0]]

            for x in candidates[1:]:
                if abs(x - current_cluster[-1]) < 20:  # tolerance
                    current_cluster.append(x)
                else:
                    clusters.append(current_cluster)
                    current_cluster = [x]

            clusters.append(current_cluster)

            # Choose largest cluster
            largest = max(clusters, key=len)

            if len(largest) < min_overlap_count:
                return None

            return {
                "x": sum(largest)/len(largest),
                "supporting_lines": len(largest)
            }

        gaps = collect_horizontal_gaps(UserBox)

        column_sep = find_column_separator(gaps)
        if column_sep:
            return True
        return False

    for page in data.get('pages', []):
        boxes = page.get("boxes", [])
        i = 0

        while i < len(boxes):
            box = boxes[i]
            textlines = box.get("textlines")

            if not textlines:
                i += 1
                continue

            if not IsBoxEligibleForSplit(box):
                i += 1
                continue

            all_spans = []
            for line_idx, line in enumerate(textlines):
                for span in line.get('spans', []):
                    if not span.get("bbox") or len(span["bbox"]) != 4:
                        continue

                    all_spans.append({
                        'text': span['text'],
                        'x0': span['bbox'][0],
                        'y0': span['bbox'][1],
                        'x1': span['bbox'][2],
                        'y1': span['bbox'][3],
                        'span_data': span,
                        'line_idx': line_idx
                    })

            if not all_spans:
                i += 1
                continue

            def is_bridged_by_neighbors(span, all_spans):
                target_lines = [span['line_idx'] - 1, span['line_idx'] + 1]

                for other in all_spans:
                    if other['line_idx'] in target_lines:
                        if other['x0'] < span['x0'] - 10 and other['x1'] > span['x0'] + 5:
                            return True
                return False

            # ---- IDENTIFY COLUMN ANCHORS ----
            all_spans.sort(key=lambda s: s['x0'])

            column_anchors = []
            column_anchors.append(all_spans[0]['x0'])

            for idx in range(1, len(all_spans)):
                curr = all_spans[idx]
                prev = all_spans[idx - 1]

                if curr['x0'] - prev['x0'] > gap_threshold:
                    if not is_bridged_by_neighbors(curr, all_spans):
                        column_anchors.append(curr['x0'])

            column_anchors = sorted(set(column_anchors))

            if len(column_anchors) > 1:
                new_boxes = []
                columns = [[] for _ in column_anchors]

                for span in all_spans:
                    for col_idx in range(len(column_anchors) - 1, -1, -1):
                        if span['x0'] >= column_anchors[col_idx] - 5:
                            columns[col_idx].append(span)
                            break

                for col_spans in columns:
                    if not col_spans:
                        continue

                    merged_lines = merge_lines_in_column(col_spans)

                    xs, ys = [], []
                    for line in merged_lines:
                        xs.extend([line["bbox"][0], line["bbox"][2]])
                        ys.extend([line["bbox"][1], line["bbox"][3]])

                    new_boxes.append({
                        "x0": min(xs),
                        "y0": min(ys),
                        "x1": max(xs),
                        "y1": max(ys),
                        "textlines": merged_lines,
                        "type": box.get("type"),
                        "number": box.get("number")
                    })

                # 🔥 KEY CHANGE: Replace in-place instead of remove/extend
                boxes[i:i+1] = new_boxes
                i += len(new_boxes)
            else:
                i += 1
    # with open(output_path.replace(".json", "_2.json"), 'w', encoding='utf-8') as f:
    #     json.dump(data, f, indent=1, ensure_ascii=False)
    return data


def setParaBreak(line, is_para_start):
        line["IsParaStart"] = is_para_start
        if line.get("spans"):
            line["spans"][0]["IsParaStart"] = is_para_start


def mark_paragraph_starts(data):
    PARA_GAP_MIN = 5
    PARA_GAP_MAX = 10


    for page in data.get("pages", []):
        for box in page.get("boxes", []):

            textlines = box.get("textlines", [])
            if not textlines:
                continue

            prev_line = None

            isBoxHangingIndent = False
            for idx, curr_line in enumerate(textlines):

                # Always mark first line as paragraph start
                if idx == 0:
                    prev_line = curr_line
                    continue

                # Safety checks
                if not prev_line.get("bbox") or not curr_line.get("bbox"):
                    prev_line = curr_line
                    continue

                prev_bbox = prev_line["bbox"]
                curr_bbox = curr_line["bbox"]

                px0, py0, px1, py1 = prev_bbox
                cx0, cy0, cx1, cy1 = curr_bbox

                pwidth = px1 - py0
                cwidth = cx1 - cx0

                threshold = 5


                condition_1 = (cx0 <= px0 + threshold and cx1 > px1 + threshold) or (cx0 <= px0 - threshold and cx1 > px1 - threshold)  or (abs(cx0 - px0) <= 5 and abs(cx1 - px1) <=5) or (abs(cx0 - px0) <= 5 and abs(cx1 - px1) > 5)

                condition_2 = abs(cy0 - py1) > (abs((cy0-cy1) / 2))

                condition_3 = (abs(cx0 - box['x0']) <= 5) and (abs(cx1 - box['x1']) <= 20) and ((px1 + 20) < box['x1'])

                condition_4 = (abs(px0 - box['x0']) <= 5) and (abs(px1 - box['x1']) <= 5) and (abs(cx0 - box['x0']) <= 5) and (abs(cx1 - box['x0']) > 5)

                condition_5 = (abs(cx0 - box['x0']) <= 5) and (abs(cx1 - box['x1']) > 20) and (abs(px1 - box['x1']) > 20)

                #Haning indentation
                condition_6 = (abs(cx0 - px0) >= 10) and (abs(cx1-px1) <= threshold) and (cx0 > px0)

                if not isBoxHangingIndent and (condition_6 and not (condition_1 and condition_2 and condition_3 and condition_4 and condition_5)):
                    isBoxHangingIndent = True

                # ---------- Final Decision ----------

                if condition_4:
                    setParaBreak(curr_line, False)

                elif isBoxHangingIndent:
                    setParaBreak(curr_line, False)

                elif not condition_1 or condition_2 or condition_3 or condition_5:
                    setParaBreak(curr_line, True)
                else:
                    setParaBreak(curr_line, False)

                prev_line = curr_line

    return data


def process_links(data):
    def get_intersection_area(bbox1, bbox2):
        """Calculate the area of intersection between two rectangles."""
        x_left = max(bbox1[0], bbox2[0])
        y_top = max(bbox1[1], bbox2[1])
        x_right = min(bbox1[2], bbox2[2])
        y_bottom = min(bbox1[3], bbox2[3])
        if x_right < x_left or y_bottom < y_top: return 0.0
        return (x_right - x_left) * (y_bottom - y_top)

    def get_distance(bbox1, bbox2):
        """Distance between centers of two bboxes."""
        c1 = [(bbox1[0] + bbox1[2]) / 2, (bbox1[1] + bbox1[3]) / 2]
        c2 = [(bbox2[0] + bbox2[2]) / 2, (bbox2[1] + bbox2[3]) / 2]
        return math.sqrt((c1[0] - c2[0])**2 + (c1[1] - c2[1])**2)

    def is_point_in_bbox(point, bbox, tolerance=5):
        """Check if a point (x, y) is within a bbox with a small tolerance."""
        px, py = point
        return (bbox[0] - tolerance <= px <= bbox[2] + tolerance and
                bbox[1] - tolerance <= py <= bbox[3] + tolerance)

    if not data or "pages" not in data:
        return data

    for page in data.get("pages", []):
        links = page.get("links", [])
        for link in links:
            link_bbox = link.get("from")
            uri = link.get("uri", "").lower()
            is_orcid = "orcid.org" in uri

            best_span = None
            max_overlap = 0
            target_line = None
            nearest_span = None
            min_dist = float('inf')

            # Pass 1: Source Logic (Finding where to attach the link)
            for box in (page.get("boxes") or []):
                for line in (box.get("textlines") or []):
                    for span in (line.get("spans") or []):
                        span_bbox = span.get("bbox")
                        if not span_bbox: continue

                        overlap = get_intersection_area(link_bbox, span_bbox)
                        if overlap > max_overlap:
                            max_overlap = overlap
                            best_span = span

                        dist = get_distance(link_bbox, span_bbox)
                        if dist < min_dist:
                            min_dist = dist
                            nearest_span = span
                            target_line = line

            # Placement Logic
            if is_orcid and target_line and nearest_span:
                # Always create a new span for ORCID
                new_span = nearest_span.copy()
                if "link" in new_span: del new_span["link"]

                # Fix: Ensure ORCID span is placed strictly after the nearest span
                # This prevents it from "jumping" into the middle of author names
                near_bbox = nearest_span["bbox"]
                new_x0 = near_bbox[2] + 0.5  # Start 0.5pt after the nearest span ends
                new_x1 = new_x0 + (link_bbox[2] - link_bbox[0])

                new_span.update({
                    "text": "[ORCID]",
                    "bbox": [new_x0, link_bbox[1], new_x1, link_bbox[3]],
                    "origin": [new_x0, link_bbox[3]],
                    "link": link,
                    "IsParaStart": False  # ORCID is never a paragraph start
                })
                target_line["spans"].append(new_span)

                # Use a stable sort: primary by X-start, secondary by X-end
                target_line["spans"].sort(key=lambda x: (x["bbox"][0], x["bbox"][2]))

            elif best_span and max_overlap > 0:
                # Attach normal links to existing text spans
                best_span["link"] = link

            # Pass 2: Destination/Anchor Logic (Finding the target of the jump)
            dest_page_num = link.get("page")
            dest_coords = link.get("to")
            named_dest = link.get("nameddest")

            if dest_page_num is not None and dest_coords and named_dest:
                target_page = next((p for p in data["pages"] if p["page_number"] == dest_page_num), None)

                if target_page:
                    found_dest = False
                    for box in (target_page.get("boxes") or []):
                        for line in (box.get("textlines") or []):
                            for span in (line.get("spans") or []):
                                if is_point_in_bbox(dest_coords, span.get("bbox", [0,0,0,0])):
                                    span["anchor_link"] = {"nameddest": named_dest}
                                    found_dest = True
                                    break
                            if found_dest: break
                        if found_dest: break

                    # Fallback: If point is not inside a span, pick the one with nearest y-coordinate
                    if not found_dest:
                        best_fallback = None
                        min_y_diff = 10
                        for box in (target_page.get("boxes") or []):
                            for line in (box.get("textlines") or []):
                                for span in (line.get("spans") or []):
                                    sb = span.get("bbox", [0,0,0,0])
                                    y_diff = abs(dest_coords[1] - sb[1])
                                    if y_diff < min_y_diff:
                                        best_fallback = span
                                        min_y_diff = y_diff

                        if best_fallback:
                            best_fallback["anchor_link"] = {"nameddest": named_dest}

    return data


def draw_and_save_annotated_pdf(pdf_path, json_data, output_pdf_path):
    doc = pymupdf.open(pdf_path)
    for i, page_data in enumerate(json_data.get('pages', [])):
        page = doc.load_page(i)
        line_count = 1
        for box in page_data.get('boxes', []):
            # --- NEW: Draw blue rectangle for the box object ---
            # Extract box coordinates (x0, y0, x1, y1)
            box_bbox = [box.get('x0'), box.get('y0'), box.get('x1'), box.get('y1')]
            if all(v is not None for v in box_bbox):
                box_rect = pymupdf.Rect(box_bbox)
                # color=(0, 0, 1) is Blue
                page.draw_rect(box_rect, color=(0, 0, 1), width=1.0)

            # Existing logic for lines
            if box.get('textlines', []):
                for line in box.get('textlines', []):
                    bbox = line.get('bbox')
                    if bbox:
                        rect = pymupdf.Rect(bbox)
                        # Draw red rectangle for line
                        page.draw_rect(rect, color=(1, 0, 0), width=0.5)

                        # Insert line number in blue
                        page.insert_text(
                            (rect.x0, rect.y0 - 2),
                            str(line_count),
                            fontsize=6,
                            color=(0, 0, 1)
                        )
                        line_count += 1

    doc.save(output_pdf_path)
    doc.close()
    print(f"Annotated PDF saved as: {output_pdf_path}")


def process_pdf(pdf_path, output_dir):
    base_name = os.path.basename(pdf_path)
    new_dir = os.path.join(os.path.dirname(pdf_path), base_name.split('.')[0] + "_output")
    if not os.path.exists(new_dir):
        os.mkdir(new_dir)

    json_path = os.path.join(new_dir, base_name.replace('.pdf','.json'))



    print(f"Processing: {pdf_path}")

    save_json(pdf_path, json_path)
    # breakpoint()

    if not os.path.exists(json_path):
        print(f"JSON not found for: {pdf_path}")
        return
    # Load JSON
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Step 1 - Line normalization
    line_normalized_data = align_span_vertical_coordinates(data)

    step1_pdf = os.path.join(new_dir, base_name.replace(".pdf", "_1.pdf"))
    draw_and_save_annotated_pdf(pdf_path, line_normalized_data, step1_pdf)
    with open(step1_pdf.replace("_1.pdf","_1.json"), "w", encoding="utf-8") as f:
        json.dump(line_normalized_data, f, ensure_ascii=False, indent=4)
    # Step 2 - Column processing

    box_normalized_data = process_multicolumn_json(
        line_normalized_data,
        pdf_path.replace(".pdf","_2.json"),
        50
    )

    lines_processed = mark_paragraph_starts(box_normalized_data)
    # with open(pdf_path.replace(".pdf","_3.json"), "w", encoding="utf-8") as f:
    #     json.dump(lines_processed, f, ensure_ascii=False, indent=4)

    links_processed = process_links(line_normalized_data)
    # with open(pdf_path.replace(".pdf","_4.json"), "w", encoding="utf-8") as f:
    #     json.dump(lines_processed, f, ensure_ascii=False, indent=4)
    step2_pdf = os.path.join(new_dir, base_name.replace(".pdf", "_2.pdf"))

    draw_and_save_annotated_pdf(pdf_path, links_processed, step2_pdf)

    html_data = save_as_html(lines_processed)

    # cleaner = reference_cleanup()
    # print("Reference cleanup started")
    # html_data = cleaner.cleanup_processor(html_data)
    # print("Reference cleanup done")

    with open(os.path.join(output_dir, base_name.replace('.pdf', "_ocr.html")), 'w', encoding='utf-8') as f:
        f.write(html_data)

    print(f"Finished: {pdf_path}\n")


def save_as_html(data):
    def get_styling(flags):
        """
        Decodes PyMuPDF flags into HTML tags.
        """
        tags = []
        if bool(flags & 1): # bit 0: Superscript
            tags.append('sup')
        if bool(flags & 2): # bit 1: Italic
            tags.append('i')
        if bool(flags & 16): # bit 4: Bold
            tags.append('b')
        return tags

    html_output = ["<html><body>"]

    for page in data.get('pages', []):
        for box in page.get('boxes', []):
            box_class = box.get('boxclass', '')
            p_open = False

            html_output.append(f'<p class="{box_class}">')
            p_open = True

            for text_line in (box.get('textlines') or []):
                spans = text_line.get('spans', [])
                if not spans:
                    continue

                for span in spans:
                    text = span.get('text', '')
                    flags = span.get('flags', 0)
                    link_info = span.get('link')
                    anchor_info = span.get('anchor_link')

                    # 1. Apply basic styling (bold, italic, etc.)
                    styles = get_styling(flags)
                    styled_text = text
                    for tag in styles:
                        styled_text = f"<{tag}>{styled_text}</{tag}>"

                    # 2. Add Anchor (Internal Destination)
                    # If this span is a target for other links
                    if anchor_info and 'nameddest' in anchor_info:
                        anchor_name = anchor_info['nameddest']
                        styled_text = f'<span id="{anchor_name.replace(" ","_")}">{styled_text}</span>'

                    # 3. Add Outbound Link (Hyperlink)
                    if link_info:
                        href = ""
                        # Kind 2 is URI (External URL)
                        if link_info.get('kind') == 2:
                            href = link_info.get('uri', '')
                        # Kind 4 is LINK_GOTO (Internal link to an anchor)
                        elif link_info.get('kind') == 4:
                            dest = link_info.get('nameddest', '').replace(' ','_')
                            if dest:
                                href = f"#{dest}"

                        if href:
                            styled_text = f'<a href="{href}">{styled_text}</a>'

                    html_output.append(styled_text)

                html_output.append(" ")

            html_output.append("</p>")

    html_output.append("</body></html>")
    return "".join(html_output)


def main(pdf_path, output_path):
    multiprocessing.freeze_support()
    pdf_files = []

    # Check if the input is a single file
    if os.path.isfile(pdf_path):
        if pdf_path.lower().endswith(".pdf"):
            pdf_files.append(pdf_path)
        else:
            print(f"Error: {pdf_path} is not a PDF file.")
            sys.exit(1)

    # Check if the input is a directory
    elif os.path.isdir(pdf_path):
        pdf_files = glob.glob(os.path.join(pdf_path, "*.pdf"))
        if not pdf_files:
            print(f"No PDFs found in folder: {pdf_path}")
            return
        print(f"Found {len(pdf_files)} PDFs in directory.\n")

    else:
        print(f"Invalid path: {pdf_path}")
        sys.exit(1)

    # Process the collected PDFs
    for pdf_path in pdf_files:
        print(f"Processing: {pdf_path}")
        process_pdf(pdf_path, output_path)


if __name__ == "__main__":
    # Allow invocation from the command line with two arguments:
    #     python core/text_extractor.py <pdf_path> <output_dir>
    # If no arguments are provided we fall back to the previous hardcoded
    # example (useful during development).
    import argparse

    parser = argparse.ArgumentParser(
        description="Run PDF extraction outside of Django."
    )
    parser.add_argument("pdf", nargs="?", help="path to input PDF file")
    parser.add_argument("out", nargs="?", help="output directory")

    args = parser.parse_args()

    if args.pdf and args.out:
        main(args.pdf, args.out)
    else:
        # previously hardcoded test values
        pdf_path = r'C:\Users\AbineshSrinivasan.S\Downloads\Legal_UI\Auth-Flow\documents\italaw10124.pdf'
        output_path = r'C:\Users\AbineshSrinivasan.S\Downloads\Legal_UI\Auth-Flow\documents'
        print("No command‑line arguments supplied; running with default paths")
        main(pdf_path, output_path)
