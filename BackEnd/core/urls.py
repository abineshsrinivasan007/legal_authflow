from django.urls import path
from . import views

urlpatterns = [
    path('test/', views.test_api, name='test_api'),
    path('auth/login/', views.login_view, name='api-login'),
    path('documents/', views.DocumentListCreate.as_view(), name='document-list'),
    path('documents/<int:pk>/', views.DocumentDetail.as_view(), name='document-detail'),
    path('documents/upload-xml/', views.XmlDocumentUpload.as_view(), name='xml-upload'),
    path('blogs/', views.BlogArticleList.as_view(), name='blog-list'),
    path('global-mindmap/', views.generate_global_mindmap, name='global-mindmap'),
    path('topics/', views.TopicDictionaryView.as_view(), name='topic-dictionary'),
]
