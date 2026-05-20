from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.views import APIView
from rest_framework.permissions import AllowAny

from .models import LegalDocument, BlogArticle
from .serializers import LegalDocumentSerializer, BlogArticleSerializer

class BlogArticleList(APIView):
    """
    List all blog articles found by Scrapy.
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        articles = BlogArticle.objects.all().order_by('-created_date')
        serializer = BlogArticleSerializer(articles, many=True)
        return Response(serializer.data)
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
import threading
from .extract_script import run_extraction_process  # ← single correct import


@method_decorator(csrf_exempt, name='dispatch')
class DocumentListCreate(APIView):
    parser_classes = (MultiPartParser, FormParser)
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        documents = LegalDocument.objects.all().order_by('-upload_date')
        serializer = LegalDocumentSerializer(documents, many=True)
        return Response(serializer.data)

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)
            
        # Check if a document with this identical name already exists to prevent duplicates
        if LegalDocument.objects.filter(name=file_obj.name).exists():
            return Response(
                {"error": f"A document with the name '{file_obj.name}' has already been uploaded."}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # STRICT PDF VALIDATION - Only accept PDF files
        file_name_lower = file_obj.name.lower()
        if not file_name_lower.endswith('.pdf'):
            return Response(
                {"error": f"Invalid file type. Only PDF files are supported. You uploaded: {file_obj.name}"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate file size (200MB max)
        if file_obj.size > 209715200:  # 200MB
            return Response(
                {"error": "File size exceeds 200MB limit"}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate PDF magic number (first 4 bytes should be %PDF)
        file_obj.seek(0)
        file_header = file_obj.read(4)
        file_obj.seek(0)
        if file_header != b'%PDF':
            return Response(
                {"error": "File is not a valid PDF. Please upload a proper PDF file."}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # SCANNED PDF GUARD: Reject image-only / scanned PDFs before saving to disk
        # This reads the first 3 pages purely in-memory (no disk write) using PyMuPDF.
        # If there are zero extractable text characters, the PDF is image-based and useless to our AI pipeline.
        try:
            import fitz  # PyMuPDF
            file_obj.seek(0)
            pdf_bytes = file_obj.read()
            file_obj.seek(0)
            pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            pages_to_check = min(3, len(pdf_doc))
            total_text = ""
            for i in range(pages_to_check):
                total_text += pdf_doc[i].get_text("text")
            pdf_doc.close()
            if len(total_text.strip()) < 50:
                return Response(
                    {
                        "error": "Scanned / image-based PDF rejected. This document has no digital text layer and cannot be processed by our AI extraction engine. Please upload a text-based PDF or run OCR on this file before uploading."
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
        except Exception as fitz_err:
            print(f"[WARN] Could not verify PDF text layer: {fitz_err}")
            # Non-fatal — let the document proceed if fitz check fails

        # Create the initial blank queued document
        document = LegalDocument.objects.create(
            name=file_obj.name,
            file=file_obj,
            file_type='pdf',
            status='Queued'
        )
        
        # Start background processing thread so the API responds instantly
        thread = threading.Thread(target=run_extraction_process, args=(document.id,))
        thread.daemon = True
        thread.start()

        serializer = LegalDocumentSerializer(document)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────────────────────────────────────────
#  FLOW 3: XML Upload (KEA-BASIC Format — KLI Kluwer Arbitration XMLs)
# ─────────────────────────────────────────────────────────────────────────────
import sys as _sys
import os as _os
from pathlib import Path as _Path
from xml.etree import ElementTree as ET

@method_decorator(csrf_exempt, name='dispatch')
class XmlDocumentUpload(APIView):
    """
    Upload a single KLI/KEA-BASIC XML file.
    Flow: XML → parse metadata → convert <juris-text> to HTML → AI pipeline.
    Same end-to-end processing as PDF and blog scrape flows.
    """
    parser_classes = (MultiPartParser, FormParser)
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            return Response({"error": "No file uploaded"}, status=status.HTTP_400_BAD_REQUEST)

        # Validate extension
        if not file_obj.name.lower().endswith('.xml'):
            return Response(
                {"error": f"Invalid file type. Only .xml files are accepted. Got: {file_obj.name}"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Validate size (50 MB max for XML — they are text-based)
        if file_obj.size > 52428800:
            return Response({"error": "XML file exceeds 50 MB limit."}, status=status.HTTP_400_BAD_REQUEST)

        # Duplicate check by name
        if LegalDocument.objects.filter(name=file_obj.name).exists():
            return Response(
                {"error": f"'{file_obj.name}' is already in the database."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Parse XML
        try:
            xml_bytes = file_obj.read()
            root = ET.fromstring(xml_bytes)
        except ET.ParseError as e:
            return Response({"error": f"Invalid XML file: {e}"}, status=status.HTTP_400_BAD_REQUEST)

        # Reuse batch_import_xml helpers (already built)
        try:
            _base = _Path(__file__).resolve().parent.parent
            _sys.path.insert(0, str(_base))
            from batch_import_xml import extract_metadata, xml_to_html
        except ImportError as e:
            return Response({"error": f"XML import helper not found: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        meta = extract_metadata(root)
        doc_id_str = meta.get("case_id") or _Path(file_obj.name).stem
        html_content = xml_to_html(root, meta)

        # Guard: must have meaningful text
        stripped = html_content.replace("<html><body>", "").replace("</body></html>", "").strip()
        if len(stripped) < 200:
            return Response(
                {"error": "No readable text found in this XML file."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Save HTML to media/documents/
        MEDIA_DOCS = _Path(__file__).resolve().parent.parent / "media" / "documents"
        MEDIA_DOCS.mkdir(parents=True, exist_ok=True)
        html_filename = f"{doc_id_str}_ocr.html"
        html_path     = MEDIA_DOCS / html_filename

        with open(html_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        # Create DB record
        document = LegalDocument.objects.create(
            name=file_obj.name,
            file=f"documents/{html_filename}",
            file_type='xml',
            status='Queued',
        )

        # Fire AI pipeline in background
        thread = threading.Thread(target=run_extraction_process, args=(document.id,))
        thread.daemon = True
        thread.start()

        serializer = LegalDocumentSerializer(document)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class DocumentDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = LegalDocument.objects.all()
    serializer_class = LegalDocumentSerializer

@api_view(['GET'])
def test_api(request):
    return Response({"message": "Successfully connected to Django API!"})

from django.contrib.auth import authenticate, login
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate, login

@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def login_view(request):
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '').strip()
    user = authenticate(request, username=username, password=password)
    
    if user is not None:
        login(request, user)
        return Response({"message": "Login successful!"})
    else:
        return Response({"error": "Invalid credentials. Please verify and try again."}, status=401)

import requests
import json
import sys
import os

# Add parent directory to path to import config3
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    import config3
except ImportError:
    config3 = None

@csrf_exempt
@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def generate_global_mindmap(request):
    topics = request.data.get('topics', [])
    if not topics:
        return Response({"error": "No topics provided"}, status=status.HTTP_400_BAD_REQUEST)
        
    if not config3 or not getattr(config3, 'api_key', None):
        return Response({"error": "Mistral API key not configured"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # Use Mistral to create a clear parent-child structure
    prompt_template = getattr(config3, 'global_mindmap_prompt', None)
    
    if prompt_template:
        prompt = prompt_template.format(topics=json.dumps(topics))
    else:
        # Fallback if config is outdated:
        prompt = f"""
        ROLE: You are an expert ontologist.
        TASK: Take the following legal/business topics and organize them into a clean, logical parent-child hierarchical tree.
        If possible, group specific items under broad conceptual parent headers (e.g. Science -> Biology -> Zoology), even if you have to invent a few high-level category nodes (like "Legal Proceedings", "Corporate Entities").
        
        INPUT TOPICS:
        {json.dumps(topics)}
        
        OUTPUT FORMAT:
        Return ONLY a raw JSON array of objects. Do not use Markdown formatting or code fences. Just a valid JSON array.
        Each object must have exactly two string fields: "name" (the child) and "parent" (the parent).
        Top-level nodes should have "Global Legal Topics" as their parent.
        
        EXAMPLE:
        [
          {{"name": "Legal Proceedings", "parent": "Global Legal Topics"}},
          {{"name": "Arbitration", "parent": "Legal Proceedings"}},
          {{"name": "Applicable rules", "parent": "Arbitration"}}
        ]
        """

    headers = {
        "Authorization": f"Bearer {config3.api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": "mistral-large-latest",
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.2
    }
    
    try:
        response = requests.post("https://api.mistral.ai/v1/chat/completions", json=payload, headers=headers)
        response.raise_for_status()
        result = response.json()
        content = result['choices'][0]['message']['content'].strip()
        
        if content.startswith('```json'):
            content = content[7:]
        elif content.startswith('```'):
            content = content[3:]
        if content.endswith('```'):
            content = content[:-3]
            
        mindmap_data = json.loads(content.strip())
        print(mindmap_data)
        return Response(mindmap_data)
    except Exception as e:
        print(f"Mistral API Error: {e}")
        # fallback parsing or error
        return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class TopicDictionaryView(APIView):
    """
    Returns the exact unified topic dictionary directly from the relational tables
    (topic_master, document_topics, blog_topics) to power the Topic Dictionary UI.
    """
    authentication_classes = []
    permission_classes = []

    def get(self, request):
        from .models import TopicMaster, DocumentTopic, BlogTopic
        
        topics = TopicMaster.objects.all()
        doc_links = DocumentTopic.objects.select_related('Document_ID').all()
        blog_links = BlogTopic.objects.select_related('Blog_ID').all()
        
        topic_files = {}
        for t in topics:
            topic_files[t.id] = {"topic": t.name, "files": []}
            
        for link in doc_links:
            if link.Topic_Id_id in topic_files and link.Document_ID:
                topic_files[link.Topic_Id_id]["files"].append({
                    "id": f"doc_{link.Document_ID.id}",
                    "name": link.Document_ID.name
                })
                
        for link in blog_links:
            if link.Topic_Id_id in topic_files and link.Blog_ID:
                topic_files[link.Topic_Id_id]["files"].append({
                    "id": f"blog_{link.Blog_ID.id}",
                    "name": link.Blog_ID.title
                })
                
        results = [topic for topic in topic_files.values() if len(topic["files"]) > 0]
        # Sort alphabetically by topic name
        results.sort(key=lambda x: x["topic"].lower())
        
        return Response(results)

