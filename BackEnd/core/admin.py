from django.contrib import admin
from .models import LegalDocument, BlogArticle, TopicMaster, BlogTopic, DocumentTopic

admin.site.register(LegalDocument)
admin.site.register(BlogArticle)
admin.site.register(TopicMaster)
admin.site.register(BlogTopic)
admin.site.register(DocumentTopic)