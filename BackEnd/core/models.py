from django.db import models

class TopicMaster(models.Model):
    """
    TL REQUEST: Master table called topic_master containing all unique topics.
    """
    name = models.CharField(max_length=500, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'topic_master'

    def __str__(self):
        return self.name

# ── TL REQUEST: Bridge for PDFs (document_topics) ──────────────────────────────
class DocumentTopic(models.Model):
    Document_ID = models.ForeignKey('LegalDocument', on_delete=models.CASCADE, db_column='Document_ID')
    Topic_Id = models.ForeignKey(TopicMaster, on_delete=models.CASCADE, db_column='Topic_Id')

    class Meta:
        db_table = 'document_topics'

# ── TL REQUEST: Bridge for Blogs (blog_topics) ─────────────────────────────────
class BlogTopic(models.Model):
    Blog_ID = models.ForeignKey('BlogArticle', on_delete=models.CASCADE, db_column='Blog_ID')
    Topic_Id = models.ForeignKey(TopicMaster, on_delete=models.CASCADE, db_column='Topic_Id')

    class Meta:
        db_table = 'blog_topics'


class LegalDocument(models.Model):
    """
    Stores manually uploaded legal documents (PDFs).
    """
    STATUS_CHOICES = [
        ('Queued', 'Queued'),
        ('Processing', 'Processing'),
        ('Completed', 'Completed'),
        ('Failed', 'Failed'),
    ]

    # File information
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to='documents/')
    file_type = models.CharField(max_length=10) # 'pdf' or 'word'
    html_hash = models.CharField(max_length=64, blank=True, null=True)
    
    # Processing Status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Queued')
    upload_date = models.DateTimeField(auto_now_add=True)
    completed_date = models.DateTimeField(null=True, blank=True)
    process_time = models.FloatField(null=True, blank=True) # Time taken in seconds
    
    # TL REQUEST: Relational table 'document_topics' with Document_ID, Topic_Id
    topics_count = models.IntegerField(default=0)
    keywords_count = models.IntegerField(default=0)
    topics = models.ManyToManyField(TopicMaster, through=DocumentTopic, related_name='documents', blank=True)
    
    topics_list = models.JSONField(default=list, blank=True)
    keywords_list = models.JSONField(default=list, blank=True)
    mindmap_data = models.JSONField(default=list, blank=True)
    ai_topics = models.TextField(blank=True, default="")

    # TL REQUEST: Source and Text Export fields
    source_file = models.FileField(upload_to='source_xmls/', max_length=500, null=True, blank=True)
    text_file = models.FileField(upload_to='text_exports/', max_length=500, null=True, blank=True)

    def __str__(self):
        return self.name


class BlogArticle(models.Model):
    """
    Stores scraped blog articles from established legal sources.
    """
    # ── Scrapy metadata ───────────────────────────────────────────────────────
    url           = models.URLField(unique=True)
    title         = models.CharField(max_length=500)
    publish_date  = models.CharField(max_length=100, blank=True, default="")
    slug          = models.SlugField(max_length=300, unique=True)

    # ── File paths ────────────────────────────────────────────────────────────
    raw_html_path = models.CharField(max_length=500, blank=True, default="")
    ocr_html_path = models.CharField(max_length=500, blank=True, default="")

    # ── Extraction results ────────────────────────────────────────────────────
    topics_count   = models.IntegerField(default=0)
    keywords_count = models.IntegerField(default=0)
    
    # TL REQUEST: Relational table 'blog_topics' with Blog_ID, Topic_Id
    topics = models.ManyToManyField(TopicMaster, through=BlogTopic, related_name='blogs', blank=True)
    
    topics_list    = models.JSONField(default=list, blank=True)
    keywords_list  = models.JSONField(default=list, blank=True)
    mindmap_data   = models.JSONField(default=list, blank=True)
    ai_topics      = models.TextField(blank=True, default="")
    
    # TL REQUEST: Source and Text Export fields (source is usually a generated XML or raw HTML)
    source_file = models.FileField(upload_to='source_xmls/', max_length=500, null=True, blank=True)
    text_file = models.FileField(upload_to='text_exports/', max_length=500, null=True, blank=True)

    # ── Status tracking ───────────────────────────────────────────────────────
    STATUS_CHOICES = [
        ('Pending',    'Pending'),
        ('Processing', 'Processing'),
        ('Completed',  'Completed'),
        ('Failed',     'Failed'),
    ]
    status       = models.CharField(max_length=20, choices=STATUS_CHOICES, default='Pending')
    process_time = models.FloatField(null=True, blank=True)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_date   = models.DateTimeField(auto_now_add=True)
    completed_date = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-publish_date']
        verbose_name        = 'Blog Article'
        verbose_name_plural = 'Blog Articles'

    def __str__(self):
        return self.title
