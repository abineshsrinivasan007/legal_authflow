import os
import django
from pathlib import Path

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'legal_backend.settings')
django.setup()

from core.models import TopicMaster
from django.contrib.auth.models import User

def import_topics():
    topic_file = Path('core/topic_names.txt')
    if not topic_file.exists():
        print(f"Error: {topic_file} not found.")
        return

    print("Importing topics...")
    with open(topic_file, 'r', encoding='utf-8') as f:
        topics = [line.strip() for line in f if line.strip()]
    
    # Use bulk_create for performance
    existing_topics = set(TopicMaster.objects.values_list('name', flat=True))
    new_topics = [TopicMaster(name=t) for t in topics if t not in existing_topics]
    
    if new_topics:
        TopicMaster.objects.bulk_create(new_topics, batch_size=500)
        print(f"Successfully imported {len(new_topics)} new topics.")
    else:
        print("No new topics to import.")

def create_default_user():
    username = 'admin'
    password = 'admin123'
    email = 'admin@example.com'
    
    if not User.objects.filter(username=username).exists():
        print(f"Creating superuser '{username}'...")
        User.objects.create_superuser(username, email, password)
        print(f"Superuser '{username}' created successfully with password '{password}'")
    else:
        print(f"User '{username}' already exists.")

if __name__ == "__main__":
    import_topics()
    create_default_user()
