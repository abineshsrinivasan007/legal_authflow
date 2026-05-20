from django.conf import settings
from core.models import TopicMaster
import os

class Command(BaseCommand):
    help = 'Imports topics from topic_names.txt into the MasterTopic table'

    def handle(self, *args, **kwargs):
        # 1. Locate the file correctly (BackEnd/core/topic_names.txt)
        txt_path = os.path.join(settings.BASE_DIR, 'core', 'topic_names.txt')

        if not os.path.exists(txt_path):
            self.stderr.write(self.style.ERROR(f"File not found at: {txt_path}"))
            return

        self.stdout.write(self.style.NOTICE("Reading dictionary file..."))

        # 2. Read topics and clean them
        with open(txt_path, 'r', encoding='utf-8') as f:
            topic_names = [line.strip() for line in f if line.strip()]

        total_found = len(topic_names)
        self.stdout.write(self.style.SUCCESS(f"Found {total_found} topics. Syncing with database..."))

        # 3. Bulk create topics (skipping existing ones)
        new_topics = []
        existing_count = 0
        
        # Get existing names for speed
        existing_names = set(MasterTopic.objects.values_list('name', flat=True))
        
        for name in topic_names:
            if name not in existing_names:
                new_topics.append(MasterTopic(name=name))
                existing_names.add(name) # Prevent duplicates in the same run
            else:
                existing_count += 1

        if new_topics:
            MasterTopic.objects.bulk_create(new_topics, batch_size=1000)
            self.stdout.write(self.style.SUCCESS(f"✅ SUCCESSFULLY IMPORTED {len(new_topics)} NEW TOPICS!"))
        
        if existing_count > 0:
            self.stdout.write(self.style.WARNING(f"ℹ️  Skipped {existing_count} topics as they already exist in DB."))

        Final_count = MasterTopic.objects.count()
        self.stdout.write(self.style.SUCCESS(f"--- COMPLETE --- Total topics in DB: {Final_count}"))
