import os
import django
from django.db import connection

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'legal_backend.settings')
django.setup()

def reset_db():
    with connection.cursor() as cursor:
        print("Resetting database...")
        cursor.execute("DROP SCHEMA public CASCADE;")
        cursor.execute("CREATE SCHEMA public;")
        print("Database wiped successfully! It is now a clean slate.")

if __name__ == "__main__":
    reset_db()
